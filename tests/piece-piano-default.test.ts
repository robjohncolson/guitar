import { expect, it } from 'vitest';
import { PieceAudio } from '../src/piece/audio';

it('starts on the sampled grand piano, not the simple voice', () => {
  const audio = new PieceAudio();
  expect(audio.piano).toBe('grand');
  expect(audio.pianoStatus).toBe('');
});
