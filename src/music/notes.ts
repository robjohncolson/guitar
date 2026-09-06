import { mod } from '../audio/grid';
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const pitchClass = (midi: number) => mod(Math.round(midi), 12);
export const centsOffset = (midi: number) => (midi - Math.round(midi)) * 100;
export const noteNames = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function noteLabel(hz: number): string {
  const midi = hzToMidi(hz), cents = Math.round(centsOffset(midi));
  return `${noteNames[pitchClass(midi)]}${Math.floor(Math.round(midi) / 12) - 1} ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}
export interface NoteOn { t: number; hz: number; midi: number; pitchClass: number; cents: number; confidence: number }
