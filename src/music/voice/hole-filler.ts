import { mod } from '../../audio/grid';
import type { VoiceContext, VoiceNote } from './types';
import { eligible } from './density';
export function holeFiller(context: VoiceContext): VoiceNote | null {
  if (!eligible(context) || (context.density === 'shy' && context.previous.occupancy !== 'player')) return null;
  const { scale, lastPlayer } = context;
  let pc = mod(scale.tonic + 7, 12);
  if (pc === lastPlayer.pitchClass) pc = scale.tonic;
  if (pc === lastPlayer.pitchClass) pc = scale.pitchClasses.find(value => value !== pc)!;
  const choices = Array.from({ length: 22 }, (_, i) => i + 60).filter(midi => mod(midi,12) === pc);
  choices.sort((a,b) => score(a) - score(b));
  function score(midi: number): number { return Math.abs(midi-65) + (midi>69 ? 5 : 0) + (Math.abs(midi-lastPlayer.midi)<7 ? 30 : 0); }
  return { midi: choices[0], duration: (context.slot.endTime-context.slot.startTime) * 0.55 };
}
