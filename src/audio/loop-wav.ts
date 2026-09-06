import { edgeGain } from './loop-engine';

/** Export the same native-rate mono loop, with its playback edge fades. */
export function loopWav(samples:Float32Array,rate:number):Uint8Array<ArrayBuffer> {
  const bytes=new Uint8Array(44+samples.length*2), view=new DataView(bytes.buffer);
  const ascii=(offset:number,text:string)=>[...text].forEach((char,i)=>bytes[offset+i]=char.charCodeAt(0));
  ascii(0,'RIFF'); view.setUint32(4,bytes.length-8,true); ascii(8,'WAVE'); ascii(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  ascii(36,'data'); view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++) view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]*edgeGain(i,samples.length,rate)))*32767),true);
  return bytes;
}
