import { roles } from '../music/voice/types';
import type { Role, Density } from '../music/voice/types';
import type { OutputMode } from '../audio/context';
export const settingsKey = 'guitar.practice.v1';
export interface Settings {
  role: Role; density: Density; companionMuted: boolean; clickMuted: boolean;
  outputMode: OutputMode; crepeCapacity: 'tiny'; voicedThreshold: number;
}
export const defaults: Settings = { role:'hole-filler', density:'shy', companionMuted:false, clickMuted:false, outputMode:'speakers', crepeCapacity:'tiny', voicedThreshold:0.5 };
export function parseSettings(raw: string | null): Settings {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      role: roles.includes(value.role) ? value.role : defaults.role,
      density: value.density === 'busy' ? 'busy' : 'shy',
      companionMuted: value.companionMuted === true, clickMuted: value.clickMuted === true,
      outputMode: value.outputMode === 'headphones' ? 'headphones' : 'speakers', crepeCapacity:'tiny',
      voicedThreshold: typeof value.voicedThreshold === 'number' && Number.isFinite(value.voicedThreshold) ? Math.max(0.3,Math.min(0.8,value.voicedThreshold)) : 0.5,
    };
  } catch { return {...defaults}; }
}
export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(settingsKey)); } catch { return {...defaults}; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(settingsKey,JSON.stringify(settings)); } catch { /* A private session still works without persistence. */ }
}
