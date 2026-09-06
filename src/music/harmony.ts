import { median } from '../audio/tap-tempo';
import { hzToMidi, noteNames, pitchClass } from './notes';
import type { NoteOn } from './notes';

export interface Harmony { readonly label: string; readonly midis: readonly number[]; readonly velocity: number }
const shapes = [
  {suffix:'',intervals:[0,4,7]}, {suffix:'m',intervals:[0,3,7]},
  {suffix:'7',intervals:[0,4,7,10]}, {suffix:'maj7',intervals:[0,4,7,11]},
  {suffix:'m7',intervals:[0,3,7,10]}, {suffix:'6',intervals:[0,4,7,9]},
  {suffix:'m6',intervals:[0,3,7,9]}, {suffix:'sus2',intervals:[0,2,7]}, {suffix:'sus4',intervals:[0,5,7]},
];

/** Support notes the player actually established; do not invent a missing third or fifth. */
export function chooseHarmony(notes: readonly NoteOn[]): Harmony | undefined {
  if (!notes.length) return;
  const mass = new Array<number>(12).fill(0);
  for (const note of notes) mass[pitchClass(hzToMidi(note.hz))] += 0.5+(note.velocity ?? 0.75);
  const total = mass.reduce((a,b) => a+b,0);
  const first = pitchClass(hzToMidi(notes[0].hz));
  const bass = pitchClass(Math.min(...notes.map(note => hzToMidi(note.hz))));
  const candidates = shapes.flatMap(shape => Array.from({length:12},(_,root) => {
    const pcs = shape.intervals.map(interval => (root+interval)%12);
    if (!pcs.every(pc => mass[pc] > 0)) return [];
    const coverage = pcs.reduce((sum,pc) => sum+mass[pc],0)/total;
    if (coverage < 0.65) return [];
    const score = coverage-0.015*(pcs.length-3)+(root === first ? 0.06 : 0)+(root === bass ? 0.04 : 0)+0.03*mass[root]/total;
    return [{root,shape,score}];
  })).flat().sort((a,b) => b.score-a.score);
  const winner = candidates[0];
  if (!winner || (candidates[1] && winner.score-candidates[1].score < 0.025)) return;
  const register = Math.max(43,Math.min(55,median(notes.map(note => hzToMidi(note.hz)))-7));
  const rootMidi = [36,48,60].map(octave => octave+winner.root).filter(midi => midi >= 40 && midi <= 57)
    .sort((a,b) => Math.abs(a-register)-Math.abs(b-register))[0];
  const midis = winner.shape.intervals.map(interval => rootMidi+interval+(interval > 0 && interval < 5 ? 12 : 0)).sort((a,b) => a-b);
  return Object.freeze({label:`${noteNames[winner.root]}${winner.shape.suffix}`,midis:Object.freeze(midis),
    velocity:Math.max(0.35,Math.min(0.8,median(notes.map(note => note.velocity ?? 0.75))))});
}
