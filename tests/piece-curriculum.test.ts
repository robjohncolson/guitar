import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, exerciseFor, LADDER, type Unit } from '../src/piece/curriculum';
import { chordSpans, chunks, detectKey, drillKeys, parseChord, prettyChord, recognise } from '../src/piece/analysis';
import { drillExercise, SCALES, type DrillMode } from '../src/piece/drills';
import { advanceUnit, DAY, initialUnit, parsePieceProgress, rungBpm, suggestToday, unitState, type UnitProgress } from '../src/piece/progress';
import { isBlack, mod12, noteName } from '../src/piece/score';

const score = compile(gymnopedie).score!;
const curriculum = buildCurriculum(score);
const unit = (id: string) => curriculum.units.find(u => u.id === id)!;
const numbers = (from: number, to: number) => `${score.bars[from].number}-${score.bars[to].number}`;

it('labels every chord so that it explains the notes, and finds D major with D minor borrowing', () => {
  expect(detectKey(score)).toMatchObject({ tonic: 2, mode: 'major' });
  for (const span of chordSpans(score)) expect(span.fit, `bar ${score.bars[span.bar].number} ${span.symbol}`).toBeGreaterThanOrEqual(0.75);
  expect(recognise(score, score.bars[0].start, score.bars[0].start + score.bars[0].ticks).symbol).toBe('Gmaj7');
  expect(parseChord('F#m7/E')).toMatchObject({ root: 6, bass: 4, tones: [6, 9, 1, 4] });
  expect(prettyChord('Bbmaj7/Ab')).toBe('B♭maj7/A♭');
  expect(drillKeys(score).map(k => [k.tonic, k.mode, k.optional])).toEqual([[2, 'major', false], [2, 'natural', true]]);
});

it('splits sections into phrases that end on long notes and never inside a held note', () => {
  expect(chunks(score).map(c => numbers(c.from, c.to))).toEqual(['1-4', '5-8', '9-12', '13-16', '17-18', '19-21', '22-24', '25-28', '29-31', '32-35', '36-39', '40-43', '44-47']);
});

it('teaches every chord, every change, every passage per hand and together, every join and section, and key drills', () => {
  const kinds = (k: Unit['kind']) => curriculum.units.filter(u => u.kind === k);
  expect(kinds('chord')).toHaveLength(new Set(chordSpans(score).map(s => s.symbol)).size);
  expect(unit('chord:Gmaj7').why).toBe('Left hand: G2 · B3 D4 F♯4. It occurs in 8 bars.');
  expect(kinds('change').length).toBeGreaterThan(20);
  // Repeated material is practised once.
  expect(unit('L:5-8').sameAs).toBe('L:1-4');
  expect(unit('LR:13-16').sameAs).toBe('LR:5-8');
  expect(unit('R:13-16').sameAs).toBe('R:5-8');
  expect(unit('LR:5-8').requires).toEqual([{ id: 'L:1-4', at: 0.7 }, { id: 'R:5-8', at: 0.7 }]);
  // The intro has no right hand, so its left-hand unit stands in for hands together.
  expect(curriculum.units.some(u => u.id === 'R:1-4' || u.id === 'LR:1-4')).toBe(false);
  expect(unit('seam:39-1').requires.map(r => r.id)).toEqual(['LR:36-39', 'L:1-4']);
  expect(unit('seam:31-40')).toBeDefined();
  expect(unit('performance').bars).toHaveLength(78);
  expect(unit('L:1-4').rungs).toEqual([0.5, 0.6, 0.7, 0.8]);
  expect(kinds('drill').filter(u => !u.optional)).toHaveLength(7);
  for (const u of curriculum.units) expect(u.requires.every(r => curriculum.units.some(v => v.id === r.id)), u.id).toBe(true);
});

it('holds a chord symbol until the next one, as on a lead sheet (N.C. too); only bars before any symbol are named from the notes', () => {
  const text = 'title: t\npitch-mode: sounding\nkey: 0\ntime: 4/4\nvoices: rh@1:R lh@2:L\n'
    + '== 1\nrh: <e4 g4 c5>:1\nlh: c3:1\n== 2\nharmony: F\nrh: <f4 a4 c5>:1\nlh: f2:1\n== 3\nrh: <f4 a4 d5>:1\nlh: f2:1\n'
    + '== 4\nharmony: N.C.\nrh: c5:1\nlh: R\n== 5\nrh: d5:1\nlh: R\n';
  expect(chordSpans(compile(text).score!).map(s => [s.symbol, s.source])).toEqual([['C', 'auto'], ['F', 'score'], ['F', 'score'], ['N.C.', 'score'], ['N.C.', 'score']]);
});

it('learns a lone pickup chord hands together, not as a right-hand step of its own', () => {
  const text = 'title: t\npitch-mode: sounding\nkey: 0\ntime: 4/4\nvoices: rh@1:R lh@2:L\nsection: A 1-2\n'
    + '== 1\nrh: R\nlh: c3:4 g3:4 c3:4 g3:4\n== 2\nrh: r:2 r:4 <e4 g4>:4\nlh: c3:4 g3:4 c3:4 g3:4\n';
  const units = buildCurriculum(compile(text).score!).units, ids = units.map(u => u.id);
  expect(ids).toContain('L:1-2');
  expect(ids).not.toContain('R:1-2');
  expect(units.find(u => u.id === 'LR:1-2')!.requires).toEqual([{ id: 'L:1-2', at: 0.7 }]);
  for (const u of units) expect(u.requires.every(r => ids.includes(r.id)), u.id).toBe(true);
});

it('builds chord drills as written, then one note at a time, and change drills from the chord-carrying hand only', () => {
  const chord = exerciseFor(score, unit('chord:Gmaj7'));
  expect(chord.events.map(e => `${e.beat}:${e.notes.map(n => noteName(n.midi)).join('+')}`)).toEqual(['0:G2', '1:B3+D4+F♯4', '3:B3', '4:D4', '5:F♯4', '6:G2', '7:B3+D4+F♯4', '9:B3', '10:D4', '11:F♯4', '12:G2', '13:B3+D4+F♯4']);
  const change = exerciseFor(score, unit('change:Dmaj7 ↔ Gmaj7'));
  expect(change.events.every(e => e.notes.every(n => n.hand === 'L'))).toBe(true);
  expect(change.beats).toBe(12);
  const together = exerciseFor(score, unit('LR:5-8'));
  expect(together.events[1].notes.map(n => noteName(n.midi))).toEqual(['B3', 'D4', 'F♯4', 'F♯5']);
});

it('uses fingerings that keep the thumb off black keys in all 24 scales and arpeggio patterns that fit the triad', () => {
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ['major', 'harmonic'] as DrillMode[]) for (const hand of ['L', 'R'] as const) {
    const scale = drillExercise({ kind: 'scale', tonic, mode, hands: [hand], octaves: 2 }, 'x', 'x');
    const notes = scale.events.map(e => e.notes[0]);
    expect(notes.map(n => mod12(n.midi - notes[0].midi)).slice(0, 7)).toEqual(SCALES[mode]);
    for (const n of notes) if (n.finger === 1) expect(isBlack(n.midi), `${tonic} ${mode} ${hand} ${noteName(n.midi)}`).toBe(false);
    // Neighbouring scale notes never use the same finger.
    for (let i = 1; i < notes.length; i++) expect(notes[i].finger).not.toBe(notes[i - 1].finger);
  }
  const cadence = drillExercise({ kind: 'cadence', tonic: 2, mode: 'major', hands: ['L', 'R'], octaves: 1 }, 'x', 'x');
  expect(cadence.events.map(e => e.notes.map(n => noteName(n.midi)).join(' '))).toEqual(['D3 D4 F♯4 A4', 'G2 D4 G4 B4', 'A2 C♯4 E4 A4', 'D3 D4 F♯4 A4']);
});

const take = (score: number, trusted = true) => ({ score, trusted });
it('climbs with two clean takes, fades support over three at certification rungs, and steps down after two hard takes', () => {
  const u = unit('LR:5-8'), now = Date.UTC(2026, 10, 11, 18);
  let p: UnitProgress = initialUnit();
  expect(rungBpm(u, p)).toBe(33);
  p = advanceUnit(u, p, take(0.95), true, now, true).progress;
  expect(p.rung).toBe(0);
  p = advanceUnit(u, p, take(0.95), true, now, true).progress;
  expect(p.rung).toBe(1);
  for (let i = 0; i < 4; i++) p = advanceUnit(u, p, take(1), true, now, true).progress;
  expect(LADDER[p.rung]).toBe(0.8);
  const supports: number[] = [];
  for (let i = 0; i < 3; i++) { p = advanceUnit(u, p, take(1), true, now, true).progress; supports.push(p.support); }
  expect(supports).toEqual([1, 2, 0]);
  expect(p.certified).toEqual([0.8]);
  expect(LADDER[p.rung]).toBe(0.88);
  const unclear = advanceUnit(u, p, take(0.2, false), false, now, true);
  expect(unclear.progress).toEqual(p);
  expect(advanceUnit(u, p, take(1), true, now, false).progress.rung).toBe(p.rung);
  p = advanceUnit(u, p, take(0.5), true, now, true).progress;
  p = advanceUnit(u, p, take(0.9), false, now, true).progress;
  expect(LADDER[p.rung]).toBe(0.8);
});

it('calls a unit learned after certifying the goal tempo on two days, then schedules spaced reviews', () => {
  const u: Unit = { ...unit('chord:Bm'), rungs: [1], certify: [1] }, day1 = Date.UTC(2026, 10, 11, 18);
  let p = initialUnit();
  for (let i = 0; i < 3; i++) p = advanceUnit(u, p, take(1), true, day1, true).progress;
  expect(p.learned).toBe(false);
  expect(unitState(u, p, day1)).toBe('done');
  for (let i = 0; i < 3; i++) p = advanceUnit(u, p, take(1), true, day1 + DAY, true).progress;
  expect(p.learned).toBe(true);
  expect(unitState(u, p, day1 + DAY)).toBe('learned');
  expect(unitState(u, p, day1 + 2 * DAY + 1)).toBe('due');
  const reviewed = advanceUnit(u, p, take(1), true, day1 + 2 * DAY + 1, true).progress;
  expect(reviewed.interval).toBe(2);
  const failed = advanceUnit(u, p, take(0.3), true, day1 + 2 * DAY + 1, true).progress;
  expect(failed.interval).toBe(1);
});

it('plans a short session and survives corrupt saves', () => {
  const plan = suggestToday(curriculum, () => undefined, Date.UTC(2026, 10, 11));
  // One phrase at a time: hear it, the chord it needs, then the music itself (see piece-plan.test.ts). Drills wait for day two.
  expect(plan.map(p => p.slot)).toEqual(['listen', 'chord', 'phrase', 'phrase']);
  expect(plan.some(p => p.unit.kind === 'drill')).toBe(false);
  const parsed = parsePieceProgress(JSON.stringify({ version: 1, offset: 9, units: { 'g|chord:D': { rung: 999, best: 'x', days: ['2026-11-11', 'bad'] } }, history: [{ unit: 'x', date: 1, bpm: 60, score: 4 }] }));
  expect(parsed.offset).toBe(0.5);
  expect(parsed.units['g|chord:D']).toMatchObject({ rung: 20, best: 0, days: ['2026-11-11'] });
  expect(parsed.history[0].score).toBe(1);
  expect(parsePieceProgress('{nonsense').units).toEqual({});
});
