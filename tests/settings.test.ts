import { expect, it } from 'vitest';
import { defaults, parseSettings } from '../src/ui/settings';
it('recovers from malformed saved state and only restores supported session preferences', () => {
  expect(parseSettings('{')).toEqual(defaults);
  expect(parseSettings('null')).toEqual(defaults);
  expect(parseSettings(JSON.stringify({role:'invalid',density:'busy',voicedThreshold:10,crepeCapacity:'small',bpm:200,locked:true}))).toEqual({...defaults,bpm:200,voicedThreshold:0.8});
  expect(parseSettings(JSON.stringify({bpm:0})).bpm).toBe(100);
  expect(parseSettings(JSON.stringify({memoryBars:4,phrase:[440]}))).toEqual(defaults);
  expect(parseSettings(JSON.stringify({clickMuted:false})).clickMuted).toBe(false);
  expect(parseSettings('{}').responsive).toBe(true);
  expect(parseSettings(JSON.stringify({responsive:false})).responsive).toBe(false);
  expect(parseSettings(JSON.stringify({autoTempo:true,bpm:85,pulse:{bpm:120,origin:4},attacks:[1,2,3]}))).toEqual({...defaults,bpm:85});
});
it('defaults to Harmony, restores an explicit Echo choice, and rejects obsolete reply modes', () => {
  expect(parseSettings(null).replyMode).toBe('harmony');
  expect(parseSettings(JSON.stringify({bpm:120})).replyMode).toBe('harmony');
  expect(parseSettings(JSON.stringify({replyMode:'echo'})).replyMode).toBe('echo');
  expect(parseSettings(JSON.stringify({replyMode:'harmony'})).replyMode).toBe('harmony');
  expect(parseSettings(JSON.stringify({replyMode:'chords'})).replyMode).toBe('harmony');
});
