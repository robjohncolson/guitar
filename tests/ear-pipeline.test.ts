import { expect, it, vi } from 'vitest';
import type { NoteOn } from '../src/music/notes';

// Control inference completion to reproduce a busy GPU deterministically.
const work = vi.hoisted(() => [] as {resolve:(pitch:{hz:number;confidence:number})=>void}[]);
vi.mock('../src/audio/crepe',() => ({Crepe:class {
  async load() {}
  infer() { return new Promise(resolve => work.push({resolve})); }
  dispose() {}
}}));
import { Ear } from '../src/audio/ear';

it('retains two observations of a short pluck while inference is busy, without losing its release', async () => {
  const notes: NoteOn[] = [], ear = new Ear(()=>{},()=>{},note=>notes.push(note));
  await ear.load();
  const frame = (t:number,rms:number) => ear.receive({type:'frame',t,rms,samples:new Float32Array(1024)});
  frame(0,0.02); // An older inference is still running when the pluck arrives.
  ear.receive({type:'attack',t:0.1});
  for (const t of [0.12,0.14,0.16,0.18]) frame(t,0.02);
  for (const t of [0.26,0.28,0.3,0.32,0.34]) frame(t,0);
  // The next live pluck arrives before the first pluck's pitch work completes.
  ear.receive({type:'attack',t:0.38});
  work[0].resolve({hz:0,confidence:0}); await Promise.resolve();
  work[1].resolve({hz:220,confidence:0.9}); await Promise.resolve();
  work[2].resolve({hz:220,confidence:0.9}); await Promise.resolve();
  expect(work).toHaveLength(3); // No growing backlog of every captured frame.
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({t:0.1,hz:220});
  expect(notes[0].duration).toBeCloseTo(0.16);
});
