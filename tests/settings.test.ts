import { expect, it } from 'vitest';
import { defaults, parseSettings } from '../src/ui/settings';
it('recovers from malformed saved state and only restores supported session preferences', () => {
  expect(parseSettings('{')).toEqual(defaults);
  expect(parseSettings('null')).toEqual(defaults);
  expect(parseSettings(JSON.stringify({role:'invalid',density:'busy',voicedThreshold:10,crepeCapacity:'small',bpm:200,locked:true}))).toEqual({...defaults,bpm:200,voicedThreshold:0.8});
  expect(parseSettings(JSON.stringify({bpm:0})).bpm).toBe(100);
});
