import { expect, it } from 'vitest';
import { gradeKeys, judgeKeys, keyPerfect, keyReach, keyTier, keyWindow, type KeyPress } from '../src/piece/grade';
import { toEvents, type Exercise } from '../src/piece/exercise';

/** A small deterministic random source, so a failure can be replayed. */
function rng(seed: number): () => number { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

function randomTake(r: () => number): { ex: Exercise; bpm: number; presses: KeyPress[] } {
  const bpm = 40 + Math.floor(r() * 140), period = 60 / bpm, notes: { beat: number; midi: number; hand: 'R'; dur: number }[] = [];
  let beat = 0;
  for (let i = 0; i < 3 + Math.floor(r() * 8); i++) {
    const size = r() < 0.3 ? 3 : 1, root = 55 + Math.floor(r() * 12);
    for (let k = 0; k < size; k++) notes.push({ beat, midi: root + k * 4, hand: 'R', dur: 0.25 });
    beat += [0.25, 0.5, 1, 1, 2][Math.floor(r() * 5)];
  }
  const ex: Exercise = { id: 'p', title: 'p', instrument: 'piano', beatsPerBar: 4, beats: Math.ceil(beat), keySig: 0, bars: [{ beat: 0, number: 1 }], chords: [], events: toEvents(notes) };
  const presses: KeyPress[] = [];
  for (const e of ex.events) {
    if (r() < 0.12) continue; // a skipped attack
    const at = e.beat * period + (r() - 0.5) * 2 * Math.min(0.45, period * 0.6); // sometimes on time, sometimes outside the window or reach
    for (const n of e.notes) {
      if (r() < 0.1) continue; // a missing chord tone
      const midi = r() < 0.12 ? n.midi + (r() < 0.5 ? 1 : -1) : n.midi; // a neighbouring wrong key
      presses.push({ t: at + (e.notes.length > 1 ? r() * 0.12 : 0), midi }); // chords may be spread past the grouping limit
    }
    if (r() < 0.1) presses.push({ t: at + (r() - 0.5) * 0.3, midi: e.notes[0].midi + (r() < 0.5 ? 0 : 2) }); // a re-press or stray
  }
  return { ex, bpm, presses: presses.sort((a, b) => a.t - b.t) };
}
const onTime = (t?: string) => t === 'perfect' || t === 'good';

it('the tiers nest inside the pass window and the match reach', () => {
  for (const bpm of [30, 60, 100, 160, 240]) {
    const period = 60 / bpm;
    expect(keyPerfect(period)).toBeLessThanOrEqual(keyWindow(period)); expect(keyWindow(period)).toBeLessThan(keyReach(period));
    expect(keyTier(0, period)).toBe('perfect'); expect(keyTier(keyWindow(period), period)).toBe('good');
    expect(keyTier(-keyWindow(period) - 1e-6, period)).toBe('early'); expect(keyTier(keyWindow(period) + 1e-6, period)).toBe('late');
  }
});

it('after the last press the live lane equals the final grade, note by note, spread chords included', () => {
  const r = rng(7);
  for (let run = 0; run < 400; run++) {
    const { ex, bpm, presses } = randomTake(r), live = judgeKeys(ex, bpm, presses, true), grade = gradeKeys(ex, bpm, presses);
    for (const ev of grade.events) for (const n of ev.notes) {
      const tier = live.notes.get(`${ev.beat}:${n.midi}`);
      expect(tier !== undefined).toBe(n.verdict === 'heard');
      if (tier) { expect(tier).toBe(ev.tier); expect(onTime(tier)).toBe(ev.mark === 'good'); }
    }
  }
});

it('while a take runs, the lane is never more generous than the final grade', () => {
  const r = rng(11);
  let checked = 0, rewards = 0;
  for (let run = 0; run < 600; run++) {
    const { ex, bpm, presses } = randomTake(r), period = 60 / bpm, grade = gradeKeys(ex, bpm, presses);
    const final = new Map<string, { ev: (typeof grade.events)[number]; n: (typeof grade.events)[number]["notes"][number] }>(grade.events.flatMap(ev => ev.notes.map(n => [`${ev.beat}:${n.midi}`, { ev, n }] as const)));
    for (let k = 1; k <= presses.length; k++) {
      for (const [key, tier] of judgeKeys(ex, bpm, presses.slice(0, k)).notes) {
        const { ev, n } = final.get(key)!;
        checked++; if (onTime(tier)) rewards++;
        // "played" claims nothing. Any other verdict must hold in the final grade, unless the player pressed again
        // within reach of that note afterwards, and the lane changed on that press.
        const generous = tier !== 'played' && (n.verdict !== 'heard' || (onTime(tier) && ev.mark !== 'good') || (tier === 'perfect' && ev.tier !== 'perfect'));
        if (generous) expect(presses.slice(k).some(p => Math.abs(p.t - ev.beat * period) <= keyReach(period))).toBe(true);
      }
    }
  }
  expect(checked).toBeGreaterThan(5000); expect(rewards).toBeGreaterThan(1000);
});

it('steady quarter and eighth notes are rewarded the moment they are played', () => {
  const r = rng(3);
  for (const [step, bpm] of [[1, 50], [1, 140], [0.5, 50]]) {
    const period = 60 / bpm, ex: Exercise = { id: 'q', title: 'q', instrument: 'piano', beatsPerBar: 4, beats: 12, keySig: 0, bars: [{ beat: 0, number: 1 }], chords: [],
      events: toEvents(Array.from({ length: 12 }, (_, i) => ({ beat: i * step, midi: 60 + (i % 5), hand: 'R' as const, dur: step }))) };
    const presses = ex.events.map(e => ({ t: e.beat * period + (r() - 0.5) * 0.1, midi: e.notes[0].midi }));
    ex.events.forEach((e, k) => expect(onTime(judgeKeys(ex, bpm, presses.slice(0, k + 1)).notes.get(`${e.beat}:${e.notes[0].midi}`))).toBe(true));
  }
});

it('a wrong key is flagged at once and a late right key is matched but not on time', () => {
  const ex: Exercise = { id: 'k', title: 'k', instrument: 'piano', beatsPerBar: 4, beats: 4, keySig: 0, bars: [{ beat: 0, number: 1 }], chords: [], events: toEvents([{ beat: 0, midi: 60, hand: 'R', dur: 1 }, { beat: 1, midi: 62, hand: 'R', dur: 1 }]) };
  const live = judgeKeys(ex, 60, [{ t: 0.01, midi: 60 }, { t: 1.25, midi: 62 }, { t: 2.9, midi: 70 }]);
  expect(live.notes.get('0:60')).toBe('perfect'); expect(live.notes.get('1:62')).toBe('late'); expect([...live.wrong]).toEqual([2]);
});
