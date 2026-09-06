import { mod } from '../../audio/grid';
import { eligible } from './density';
import type { Scale } from '../scales';
import type { VoiceContext, VoiceNote } from './types';
export function snapClass(pc: number, scale: Scale): number {
  return [...scale.pitchClasses].sort((a,b) => distance(a,pc)-distance(b,pc))[0];
}
function distance(a: number, b: number): number { return Math.min(mod(a-b,12),mod(b-a,12)); }
export function harmony(context: VoiceContext): VoiceNote | null {
  if (!eligible(context)) return null;
  const { pitchClasses } = context.scale;
  const snapped = snapClass(context.lastPlayer.pitchClass, context.scale);
  const degree = pitchClasses.indexOf(snapped);
  let pc = pitchClasses[(degree+2) % pitchClasses.length];
  if (pc === context.lastPlayer.pitchClass) pc = pitchClasses[(degree+4) % pitchClasses.length];
  let midi = context.lastPlayer.midi + 1;
  while (mod(midi,12) !== pc) midi++;
  if (midi > 79) return null;
  return { midi, duration: (context.slot.endTime-context.slot.startTime) * 0.55 };
}
