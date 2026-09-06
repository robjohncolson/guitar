import { expect, it, vi } from 'vitest';

it('softens native playback under live input, recovers in silence, and keeps the recorded audio intact',async()=>{
  let Processor:any; const chunks:{samples:Float32Array}[]=[];
  vi.stubGlobal('sampleRate',1000); vi.stubGlobal('currentFrame',0);
  vi.stubGlobal('AudioWorkletProcessor',class {port={onmessage:undefined as any,postMessage:(event:any)=>{if(event.type==='chunk')chunks.push(event);}};});
  vi.stubGlobal('registerProcessor',(_name:string,processor:any)=>{Processor=processor;});
  try {
    await import('../src/audio/looper.worklet'); const processor=new Processor(); let frame=0;
    const render=(length:number,input:number)=>{
      const result=new Float32Array(length);
      for(let offset=0;offset<length;offset+=128) {
        const count=Math.min(128,length-offset), output=new Float32Array(count);
        // Reproduce an occasional repeated frame reading followed by a catch-up.
        vi.stubGlobal('currentFrame',frame-(Math.floor(frame/128)%10===3 ? 128 : 0));
        processor.process([[new Float32Array(count).fill(input)]],[[output]]); result.set(output,offset); frame+=count;
      }
      return result;
    };
    processor.port.onmessage({data:{type:'record',id:1,bpm:240,startFrame:0}}); render(4100,.5);
    processor.port.onmessage({data:{type:'soften',enabled:true}});
    const soft=render(500,.1); expect(soft.at(-1)).toBeGreaterThan(.43); expect(soft.at(-1)).toBeLessThan(.46);
    const recovered=render(1500,0); expect(recovered.at(-1)).toBeGreaterThan(.792); expect(recovered.at(-1)).toBeLessThanOrEqual(.800001);
    processor.port.onmessage({data:{type:'soften',enabled:false}});
    expect(render(500,.2).at(-1)).toBeGreaterThan(.792);
    expect(chunks.flatMap(chunk=>Array.from(chunk.samples)).every(sample=>sample===.5)).toBe(true);
  } finally {vi.unstubAllGlobals();}
});
