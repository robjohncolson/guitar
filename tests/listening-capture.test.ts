import { expect, it } from 'vitest';
import { ListeningCapture } from '../src/audio/listening-capture';

it('records only on request, aligns overlapping frames once, and exports a valid local WAV', () => {
  const capture = new ListeningCapture();
  const frame = (t:number,value:number) => ({type:'frame' as const,t,rms:0.1,samples:new Float32Array(1024).fill(value)});
  capture.receive(frame(10,0.25)); expect(capture.duration).toBe(0);
  capture.start(10); capture.receive(frame(10.032,0.25)); capture.receive(frame(10.052,0.5));
  expect(capture.duration).toBeCloseTo(0.084);
  capture.stop(10.084); capture.receive(frame(11,1)); expect(capture.duration).toBeCloseTo(0.084);
  const wav = capture.wav(), view = new DataView(wav.buffer as ArrayBuffer);
  expect(new TextDecoder().decode(wav.slice(0,4))).toBe('RIFF');
  expect(view.getUint32(24,true)).toBe(16000); expect(view.getUint32(40,true)).toBe(1344*2);
  expect(view.getInt16(44,true)).toBeCloseTo(8192,0); expect(view.getInt16(44+400*2,true)).toBe(16384);
});
it('keeps annotation timestamps relative to the clip and bounds recording to twenty seconds', () => {
  const capture = new ListeningCapture(); capture.start(3);
  const note = {t:3.5,hz:220,midi:57,pitchClass:9,cents:0,confidence:0.9};
  capture.note(note,true); capture.finish(3.5,3.7); capture.pitch(3.6,0.01,220,0.9);
  expect(capture.notes[0].t).toBe(0.5); expect(capture.notes[0].duration).toBeCloseTo(0.2);
  capture.receive({type:'frame',t:23,rms:0.1,samples:new Float32Array(1024)});
  expect(capture.recording).toBe(false); expect(capture.duration).toBe(20);
  capture.note({...note,t:24},true); expect(capture.notes).toHaveLength(1);
  expect(capture.snapshot({bpm:120})).toMatchObject({duration:20,metadata:{bpm:120}});
  expect(capture.frames[0].t).toBeCloseTo(0.6);
  capture.start(25); expect(capture.notes).toEqual([]); expect(capture.duration).toBe(0);
});
