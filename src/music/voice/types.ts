import type { Slot } from '../../audio/grid';
import type { Scale } from '../scales';
import type { NoteOn } from '../notes';
export type Role = 'hole-filler' | 'bass' | 'harmony' | 'call-response';
export type Density = 'shy' | 'busy';
export const roles: Role[] = ['hole-filler', 'bass', 'harmony', 'call-response'];
export interface VoiceContext {
  slot: Slot; previous: Slot; scale: Scale; lastPlayer: NoteOn; playerMedian: number;
  density: Density; ready: boolean; playerSinceCompanion: boolean;
}
export interface VoiceNote { midi: number; duration: number }
