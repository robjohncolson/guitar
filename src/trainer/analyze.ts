import { AttackDetector } from '../audio/attack';
import type { Pitch } from '../audio/crepe';
import type { Attack } from './grader';
/** Resample a stored native-rate window to CREPE's exact 1024 samples at 16 kHz. */
export function pitchFrame(samples:Float32Array,rate:number,center:number):Float32Array {
  return Float32Array.from({length:1024},(_,i)=>{
    const index=(center-.032+i/16000)*rate,from=Math.floor(index),fraction=index-from;
    return (samples[from] ?? 0)*(1-fraction)+(samples[from+1] ?? 0)*fraction;
  });
}
const rms=(samples:Float32Array,rate:number,from:number,length=.01)=>{
  const a=Math.max(0,Math.floor(from*rate)),b=Math.min(samples.length,Math.ceil((from+length)*rate));
  let sum=0;for(let i=a;i<b;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/Math.max(1,b-a));
};
/** A room tail can outlast a click. Muted strums are broadband; the app's pips are tonal. */
function clickLike(samples:Float32Array,rate:number,t:number):boolean {
  const size=Math.round(rate*.02),from=Math.round((t+.012)*rate);
  for(const hz of [1000,1300]) {
    let sin=0,cos=0,energy=0;
    for(let i=0;i<size;i++){const v=samples[from+i] ?? 0;sin+=v*Math.sin(2*Math.PI*hz*i/rate);cos+=v*Math.cos(2*Math.PI*hz*i/rate);energy+=v*v;}
    if(2*(sin*sin+cos*cos)/(size*energy+1e-12)>.6)return true;
  }
  return false;
}
/** No score/expected pitches enter this analysis. Slow hardware gets the same stored evidence. */
export async function analyzeTake(samples:Float32Array,rate:number,relativeStart:number,duration:number,infer:(frame:Float32Array)=>Promise<Pitch>,alive:()=>boolean=()=>true,update:(done:number,total:number)=>void=()=>{},rhythmOnly=false):Promise<Attack[]> {
  const detector=new AttackDetector(rate),raw:number[]=[];
  for(let from=0;from<samples.length;from+=128){
    const t=from/rate;
    if(detector.process(samples.subarray(from,from+128),t) && t>=relativeStart-.3 && t<=relativeStart+duration+.3)raw.push(t);
  }
  // Limit work on an extremely noisy take. The caller treats this as unscorable.
  if(raw.length>96)throw new Error('Too many attacks to judge. Try a quieter recording with clear, separate plucks.');
  const attacks:Attack[]=[];
  for(let i=0;i<raw.length;i++) {
    if(!alive())return [];
    const t=raw[i],level=rms(samples,rate,t,.1);
    // Require energy after the metronome's short tail, even in rhythm-only mode.
    if(rms(samples,rate,t+.035,.035)<.003)continue;
    if(rhythmOnly && clickLike(samples,rate,t))continue;
    let quiet:number|undefined,end=Math.min(raw[i+1] ?? Infinity,relativeStart+duration+.5),peak=level;
    for(let at=t;at<end;at+=.01){
      const value=rms(samples,rate,at);peak=Math.max(peak,value);
      if(value<Math.max(.0015,peak*.04)){quiet ??=at;if(at-quiet>=.08-1e-6){end=quiet;break;}}else quiet=undefined;
    }
    const readings:Pitch[]=[];
    if(!rhythmOnly)for(const after of [.08,.14,.2,.26]) {
      if(!alive())return [];
      if(t+after+.032>end+.02)break;
      const pitch=await infer(pitchFrame(samples,rate,t+after));
      if(pitch.hz>=70 && pitch.hz<=1400 && pitch.confidence>=.5)readings.push(pitch);
      if(readings.length>=2 && Math.abs(12*Math.log2(readings.at(-1)!.hz/readings[0].hz))<.5)break;
    }
    const clusters=readings.map(p=>readings.filter(q=>Math.abs(12*Math.log2(q.hz/p.hz))<.5)).sort((a,b)=>b.length-a.length),cluster=clusters[0] ?? [];
    const certain=cluster.length>=2 && cluster.length>=readings.length*.65;
    const midi=certain ? cluster.reduce((sum,p)=>sum+69+12*Math.log2(p.hz/440),0)/cluster.length : undefined;
    attacks.push({t:t-relativeStart,midi,confidence:certain ? Math.min(...cluster.map(p=>p.confidence)) : undefined,duration:Math.max(0,end-t),level});
    update(i+1,raw.length);
  }
  return attacks;
}
