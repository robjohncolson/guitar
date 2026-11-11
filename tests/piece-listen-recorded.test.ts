import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { eventContext, pianoOnsets, verifyEvent } from '../src/piece/listen';
import { gradePiano } from '../src/piece/grade';
import { fromBars } from '../src/piece/exercise';
import { compile } from '../src/piece/notation';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';

// Real Steinway notes (University of Iowa, see tests/fixtures/NOTICE.md), mixed into takes with known timing.
const meta = JSON.parse(readFileSync(new URL('./fixtures/piano-notes.json', import.meta.url), 'utf8'));
const wav = readFileSync(new URL('./fixtures/piano-notes.wav', import.meta.url));
const each = Math.round(meta.rate * meta.secondsPerNote);
const clips = new Map<number, Float32Array>();
const clip = (midi: number) => {
  const index = meta.midis.indexOf(midi);
  if (index < 0) throw new Error(`fixture lacks ${midi}`);
  if (!clips.has(midi)) clips.set(midi, Float32Array.from({ length: each }, (_, i) => wav.readInt16LE(44 + 2 * (index * each + i)) / 32768));
  return clips.get(midi)!;
};
interface Hit { midi: number; at: number; dur?: number }
function take(hits: Hit[], seconds: number, rate = meta.rate as number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  let seed = 9;
  for (let i = 0; i < out.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; out[i] = ((seed >>> 0) / 4294967296 - 0.5) * 0.0006; }
  for (const { midi, at, dur = 9 } of hits) {
    const source = clip(midi), start = Math.round(at * rate);
    for (let i = 0; i < Math.round(1.5 * rate) && start + i < out.length; i++) {
      const t = i / rate, position = t * meta.rate, floor = Math.floor(position), value = (source[floor] ?? 0) * (1 - (position - floor)) + (source[floor + 1] ?? 0) * (position - floor);
      out[start + i] += value * (t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1);
    }
  }
  return out;
}
const score = compile(gymnopedie).score!, intro = fromBars(score, [0, 1, 2, 3], ['L'], 'L:1-4', 'Intro');
const introHits = (change: (h: Hit) => Hit | undefined = h => h) => intro.events.flatMap(e => e.notes.map(n => change({ midi: n.midi, at: 0.6 + e.beat + (n.midi % 3) * 0.007, dur: Math.min(1.4, n.dur) }))).filter(Boolean) as Hit[];
const grade = (hits: Hit[], rate = meta.rate as number) => {
  const samples = take(hits, 0.6 + intro.beats + 1, rate);
  return gradePiano(intro, 60, { samples, rate, playAt: 0.6, coverage: 1, clipped: 0, clicks: false }, pianoOnsets(samples, rate, 0, samples.length / rate), 0);
};
const verdictsOf = (g: ReturnType<typeof grade>) => g.events.flatMap(e => e.notes.map(n => ({ beat: e.beat, ...n })));

it('grades a recorded Gymnopédie intro on time without accusing any played note, at 24 and 48 kHz', { timeout: 60000 }, () => {
  for (const rate of [24000, 48000]) {
    const g = grade(introHits(), rate);
    expect(g.trusted).toBe(true);
    expect(g.events.map(e => e.mark)).toEqual(Array(8).fill('good'));
    expect(verdictsOf(g).filter(v => v.verdict === 'not-heard' || v.verdict === 'wrong')).toEqual([]);
    expect(verdictsOf(g).filter(v => v.verdict === 'heard').length).toBeGreaterThanOrEqual(10);
    expect(g.timing).toBe(1);
  }
});

it('never confirms a recorded wrong or missing chord tone', { timeout: 60000 }, () => {
  const wrong = verdictsOf(grade(introHits(h => (h.midi === 61 && h.at > 9 ? { ...h, midi: 60 } : h)))).find(v => v.beat === 10 && v.midi === 61)!;
  expect(['wrong', 'not-heard', 'unclear']).toContain(wrong.verdict);
  if (wrong.verdict === 'wrong') expect(wrong.heardAs).toBe(60);
  const missing = verdictsOf(grade(introHits(h => (h.midi === 62 && h.at < 3 ? undefined : h)))).find(v => v.beat === 1 && v.midi === 62)!;
  expect(missing.verdict).not.toBe('heard');
});

it('hears recorded melody notes and rejects a substituted one', () => {
  const samples = take([{ midi: 78, at: 0.5 }, { midi: 81, at: 1.5 }], 3);
  const first = verifyEvent(eventContext(samples, meta.rate, 0.5, undefined, 1.45), [78]).notes[0];
  expect(first.verdict).toBe('heard');
  const swapped = verifyEvent(eventContext(samples, meta.rate, 1.5, 0.5, undefined), [78]).notes[0];
  expect(swapped.verdict).not.toBe('heard');
});
