import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { parseChord } from '../src/piece/analysis';
import { compile } from '../src/piece/notation';
import { sliceExercise } from '../src/piece/exercise';
import { OPEN, arrange, guitarUnits, melodyBacking } from '../src/piece/guitar';
import { planExercise } from '../src/piece/plan';
import { suggestToday } from '../src/piece/progress';
import { mod12, type ScoreNote } from '../src/piece/score';
import { spotOffered } from '../src/piece/spot';
import { arrangePiece, guitarPieceUnits, otherLayer, pieceExercise } from '../src/piece/solo';

const score = compile(gymnopedie).score!;
const arranged = arrangePiece(score);
const units = guitarPieceUnits(score, arranged);
const indexOf = (string: number) => 6 - string;
const at = (bar: number, beat: number) => arranged.bars[bar].notes.filter(n => Math.abs(n.beat - beat) < 1e-6);
const pcs = (notes: { midi: number }[]) => new Set(notes.map(n => mod12(n.midi)));

it('folds Gymnopédie onto open-position grips and never invents a pitch', () => {
  const bar1 = at(0, 0), chord1 = at(0, 1);
  expect(bar1).toEqual([expect.objectContaining({ midi: 43, string: 6, fret: 3, hand: 'L' })]);
  expect(chord1.map(n => n.midi).sort((a, b) => a - b)).toEqual([59, 62, 66]);
  expect(chord1.find(n => n.midi === 59)).toMatchObject({ string: 3, fret: 4 });
  expect(chord1.find(n => n.midi === 62)).toMatchObject({ string: 2, fret: 3 });
  expect(chord1.find(n => n.midi === 66)).toMatchObject({ string: 1, fret: 2 });
  expect(at(1, 0)).toEqual([expect.objectContaining({ midi: 50, string: 4, fret: 0 })]);
  expect(at(1, 1).map(n => [n.midi, n.string, n.fret]).sort((a, b) => a[0] - b[0])).toEqual([[57, 3, 2], [61, 2, 2], [66, 1, 2]]);

  const shared = at(4, 1).filter(n => n.midi === 66);
  expect(shared).toHaveLength(1);
  expect(new Set([shared[0].hand, shared[0].also])).toEqual(new Set(['L', 'R']));
  expect(at(4, 2)).toEqual([expect.objectContaining({ midi: 69, string: 1, fret: 5 })]);
  expect(at(5, 0).length).toBeGreaterThanOrEqual(2);

  for (const bar of arranged.bars) {
    const written = score.notes.filter(n => n.bar === bar.index);
    const attacks = new Map<number, ScoreNote[]>();
    for (const n of written) attacks.set(n.tick, [...(attacks.get(n.tick) ?? []), n]);
    for (const [tick, group] of attacks) {
      const placed = bar.notes.filter(n => Math.abs(n.beat - tick / score.ppq) < 1e-6);
      const have = pcs(group);
      for (const n of placed) expect(have, `bar ${score.bars[bar.index].number}`).toContain(mod12(n.midi));
      for (const n of group.filter(g => g.hand === 'R')) expect(pcs(placed).has(mod12(n.midi)), `melody bar ${score.bars[bar.index].number}`).toBe(true);
      const bass = group.filter(g => g.hand === 'L' && g.midi < 48).sort((a, b) => a.midi - b.midi)[0];
      if (bass) expect(pcs(placed).has(mod12(bass.midi)), `bass bar ${score.bars[bar.index].number}`).toBe(true);
      expect(new Set(placed.map(n => n.string)).size).toBe(placed.length);
    }
    for (const n of bar.notes) {
      expect(n.fret).toBeGreaterThanOrEqual(0);
      expect(n.fret).toBeLessThanOrEqual(12);
      expect(n.midi).toBeGreaterThanOrEqual(40);
      expect(n.midi).toBeLessThanOrEqual(76);
      expect(OPEN[indexOf(n.string)] + n.fret).toBe(n.midi);
    }
  }
});

it('builds a guitar course with the same kinds of steps, and leaves the accompaniment course alone', () => {
  expect(units.filter(u => u.kind === 'chord').length).toBeGreaterThan(5);
  expect(units.filter(u => u.kind === 'chord').length).toBeLessThan(40);
  expect(new Set(units.map(u => u.id)).size).toBe(units.length);
  for (const u of units) {
    expect(u.id.length).toBeLessThanOrEqual(160);
    expect(u.requires.every(r => units.some(v => v.id === r.id)), u.id).toBe(true);
    if (u.sameAs) expect(units.some(v => v.id === u.sameAs)).toBe(true);
  }
  const fig = pieceExercise(score, arranged, units.find(u => u.id === 'gp-fig:1')!);
  const played = fig.events.filter(e => e.label !== 'one string');
  expect(fig.events.filter(e => e.label === 'one string').every(e => e.grade === 'pitch' && e.notes.length === 1)).toBe(true);
  expect(played[0]).toMatchObject({ grade: 'pitch' });
  expect(played[0].notes[0]).toMatchObject({ midi: 43, string: 6, fret: 3 });
  expect(played[1].grade).toBe('onset');

  const melody = units.find(u => u.kind === 'hand' && u.hands.join('') === 'R' && u.bars.includes(5) && !u.sameAs)!;
  const mel = pieceExercise(score, arranged, melody);
  const mark = mel.bars.find(b => b.number === 6)!, next = mel.bars.find(b => b.beat > mark.beat + 0.01);
  const bar6 = mel.events.filter(e => e.beat >= mark.beat - 1e-6 && (next ? e.beat < next.beat - 1e-6 : true));
  expect(bar6.every(e => e.notes.length === 1 && e.grade === 'pitch')).toBe(true);
  expect(pcs(bar6.flatMap(e => e.notes))).toEqual(new Set([7, 6, 1]));

  const together = units.find(u => u.kind === 'together' && u.bars.includes(5) && !u.sameAs)!;
  const both = pieceExercise(score, arranged, together);
  const from = both.bars.findIndex(b => b.number === 6);
  const sliced = sliceExercise(both, from, from, ['R'], 'spot/x', 'melody');
  expect(sliced.events.every(e => e.grade === 'pitch' && e.notes.length === 1)).toBe(true);
  const full = sliceExercise(both, from, from, ['L', 'R'], 'spot/y', 'both');
  expect(full.events.some(e => e.grade === 'onset')).toBe(true);
  expect(full.events.some(e => e.grade === 'pitch')).toBe(true);
  expect(spotOffered('guitar', melody)).toBe(true);
  expect(spotOffered('guitar', { ...melody, id: 'g-shape:G' })).toBe(false);

  const scale = pieceExercise(score, arranged, units.find(u => u.id === 'gp-drill:2:major:scale')!);
  expect(scale.events.map(e => e.notes[0].midi)).toEqual([50, 52, 54, 55, 57, 59, 61, 62, 61, 59, 57, 55, 54, 52, 50]);
  expect(scale.events.every(e => e.grade === 'pitch' && (e.notes[0].fret ?? 99) <= 5)).toBe(true);
  const arp = pieceExercise(score, arranged, units.find(u => u.id === 'gp-drill:2:major:arpeggio')!);
  expect(arp.events.map(e => e.notes[0].midi)).toEqual([50, 54, 57, 62, 57, 54, 50]);
  const cad = pieceExercise(score, arranged, units.find(u => u.id === 'gp-drill:2:major:cadence')!);
  expect(cad.events.some(e => e.grade === 'pitch' && e.notes.length === 1)).toBe(true);
  expect(cad.events.some(e => e.strum === 'D' && e.grade === 'onset')).toBe(true);
  for (const e of cad.events) for (const n of e.notes) {
    const symbol = [...cad.chords].reverse().find(c => c.beat <= e.beat + 1e-6)!.symbol;
    expect(parseChord(symbol)!.tones).toContain(mod12(n.midi));
  }

  const today = suggestToday({ title: score.meta.title, key: 'D major', goalBpm: score.tempo.bpm, units, summary: [] }, () => undefined, Date.now());
  expect(today[0]?.unit.id).toBe('gp-listen');
  expect(today.find(r => r.slot === 'chord')?.unit.id.startsWith('gp-fig:')).toBe(true);
  expect(today.some(r => r.slot === 'phrase')).toBe(true);

  const backing = otherLayer(score, arranged, melody.bars, 'R');
  const plan = planExercise(mel, 60, 0, 'practice', 0, false, backing);
  expect(plan.sounds.filter(s => s.kind === 'note').every(s => s.timbre === 'guitar')).toBe(true);
  const pianoBack = melodyBacking(score, [4]);
  const withMelody = planExercise(mel, 60, 0, 'practice', 0, false, pianoBack);
  expect(withMelody.sounds.filter(s => s.midi === 78).every(s => s.timbre === 'piano')).toBe(true);
  expect(guitarUnits(score, arrange(score)).some(u => u.id.startsWith('gp-'))).toBe(false);
});
