import { mod } from '../../audio/grid';
import { eligible } from './density';
import type { VoiceContext, VoiceNote } from './types';
export function bass(context: VoiceContext): VoiceNote | null {
  if (!eligible(context)) return null;
  const beat = mod(context.slot.index, 4);
  if (context.density === 'shy' && beat % 2 === 0) return null;
  let pc = mod(context.scale.tonic + (beat % 2 === 0 ? 0 : 7), 12);
  if (pc === context.lastPlayer.pitchClass) pc = context.scale.tonic;
  const choices = Array.from({ length: 17 }, (_, i) => i + 36).filter(midi => mod(midi,12) === pc);
  choices.sort((a,b) => Math.abs(a-(context.playerMedian-12)) - Math.abs(b-(context.playerMedian-12)));
  return { midi: choices[0], duration: (context.slot.endTime - context.slot.startTime) * 0.8 };
}
