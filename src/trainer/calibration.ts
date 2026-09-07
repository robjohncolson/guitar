/** Identify a short 1 kHz calibration pip, rejecting broadband plucks and diffuse noise. */
export function pipOnsets(samples:Float32Array,rate:number):number[] {
  const size=Math.round(rate*.008),hop=Math.max(1,Math.round(rate*.002)), values:{t:number;power:number}[]=[];
  let peak=0;
  for(let from=0;from+size<samples.length;from+=hop) {
    let sin=0,cos=0,energy=0;
    for(let i=0;i<size;i++) {const v=samples[from+i];sin+=v*Math.sin(2*Math.PI*1000*i/rate);cos+=v*Math.cos(2*Math.PI*1000*i/rate);energy+=v*v;}
    const power=(sin*sin+cos*cos)/(size*size), coherence=2*(sin*sin+cos*cos)/(size*energy+1e-12);
    const value=coherence>.35 ? power : 0; peak=Math.max(peak,value); values.push({t:(from+size/2)/rate,power:value});
  }
  if(peak<.0000003)return [];
  const result:number[]=[];let previous=-Infinity;
  for(const value of values) if(value.power>=peak*.25 && value.t-previous>.2) {result.push(value.t-.004);previous=value.t;}
  return result;
}
export interface Calibration { ok:boolean; offset:number; spread:number; matched:number; message:string }
/** Uses app-generated sound, never the player's tendency to play early/late. */
export function calibrate(expected:number[],observed:number[],outputLatency:number):Calibration {
  let best:number[]=[];
  for(const first of observed) {
    const candidate=first-expected[0]; if(candidate<-.03 || candidate>.65)continue;
    const used=new Set<number>(), offsets:number[]=[];
    for(const target of expected) {
      let index=-1,error=.05;
      observed.forEach((t,i)=>{const e=Math.abs(t-target-candidate);if(!used.has(i) && e<error){index=i;error=e;}});
      if(index>=0){used.add(index);offsets.push(observed[index]-target);}
    }
    if(offsets.length>best.length)best=offsets;
  }
  best.sort((a,b)=>a-b); const center=best.length ? best[Math.floor(best.length/2)] : 0;
  const spread=best.length ? best.at(-1)!-best[0] : Infinity, offset=center-outputLatency;
  const ok=best.length>=6 && spread<.035 && offset>=-.3 && offset<=.5;
  return {ok,offset:ok ? offset : 0,spread,matched:best.length,message:ok ? `Timing measured from ${best.length} clicks. Input offset ${Math.round(offset*1000)} ms.` : 'The clicks were not clear enough. Hold an earcup near the mic, keep the guitar quiet, and try again.'};
}
