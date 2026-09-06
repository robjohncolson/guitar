import type { VoiceContext } from './types';
export function eligible(context: VoiceContext): boolean {
  return context.ready && context.slot.occupancy === 'empty' &&
    (context.density === 'busy' || context.playerSinceCompanion);
}
