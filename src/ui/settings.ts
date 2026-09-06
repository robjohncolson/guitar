import type { OutputMode } from '../audio/context';
import { validBpm } from '../audio/tap-tempo';
export const settingsKey = 'guitar.practice.v1';
export interface Settings {
  bpm: number; responsive: boolean; companionMuted: boolean; clickMuted: boolean;
  outputMode: OutputMode; crepeCapacity: 'tiny'; voicedThreshold: number;
}
export const defaults: Settings = { bpm:100, responsive:true, companionMuted:false, clickMuted:true, outputMode:'speakers', crepeCapacity:'tiny', voicedThreshold:0.5 };
export function parseSettings(raw: string | null): Settings {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      bpm: typeof value.bpm === 'number' && validBpm(value.bpm) ? value.bpm : defaults.bpm,
      responsive: value.responsive !== false,
      companionMuted: value.companionMuted === true, clickMuted: typeof value.clickMuted === 'boolean' ? value.clickMuted : defaults.clickMuted,
      outputMode: value.outputMode === 'headphones' ? 'headphones' : 'speakers', crepeCapacity:'tiny',
      voicedThreshold: typeof value.voicedThreshold === 'number' && Number.isFinite(value.voicedThreshold) ? Math.max(0.3,Math.min(0.8,value.voicedThreshold)) : 0.5,
    };
  } catch { return {...defaults}; }
}
export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(settingsKey)); } catch { return {...defaults}; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(settingsKey,JSON.stringify(settings)); } catch { /* Listening still works when storage is unavailable. */ }
}
