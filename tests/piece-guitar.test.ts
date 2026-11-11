import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { parseChord } from '../src/piece/analysis';
import { arrange, guitarExerciseFor, guitarUnits, melodyBacking, OPEN, SHAPES, shapeFor, sounding } from '../src/piece/guitar';
import { mod12 } from '../src/piece/score';

const score = compile(gymnopedie).score!;

it('defines every shape so that it sounds exactly its chord in standard tuning, root or slash bass lowest', () => {
  expect(OPEN).toEqual([40, 45, 50, 55, 59, 64]);
  for (const shape of SHAPES) {
    const chord = parseChord(shape.name)!, notes = sounding(shape).filter(m => m >= 0), pcs = new Set(notes.map(mod12));
    expect([...pcs].every(pc => chord.tones.includes(pc)), `${shape.name} adds a note`).toBe(true);
    expect(pcs.has(chord.root) || pcs.has(chord.bass), shape.name).toBe(true);
    const third = [3, 4].map(i => mod12(chord.root + i)).find(pc => chord.tones.includes(pc));
    if (third !== undefined) expect(pcs.has(third), `${shape.name} lacks its third`).toBe(true);
    if (shape.name.includes('/')) expect(mod12(Math.min(...notes)), `${shape.name} bass`).toBe(chord.bass);
    expect(shape.fingers).toHaveLength(6);
  }
});

it('arranges Gymnopédie with shapes that never add a pitch outside the harmony', () => {
  const arrangement = arrange(score);
  expect(arrangement.bars).toHaveLength(score.bars.length);
  for (const b of arrangement.bars) {
    const chord = parseChord(b.symbol)!;
    for (const m of sounding(b.shape, arrangement.capo)) if (m >= 0) expect(chord.tones, `bar ${score.bars[b.bar].number} ${b.symbol} ${b.shape.name}`).toContain(mod12(m));
  }
  expect(arrangement.bars.find(b => b.symbol === 'Dmaj7')!.shape.name).not.toBe('D');
  expect(shapeFor('Em7b9', 0)!.note).toContain('F');
  // I to I6 is one finger lifted: A-flat 6 with the capo at 6 is a full D6 shape, not D with the F left out.
  expect(shapeFor('Ab6', 6)).toMatchObject({ shape: { name: 'D6' } });
  expect(shapeFor('Ab6', 6)!.note).toBeUndefined();
});

it('builds a guitar course: shapes checked string by string, changes, the pattern, sections with the melody', () => {
  const arrangement = arrange(score), units = guitarUnits(score, arrangement);
  expect(units.filter(u => u.id.startsWith('g-shape:'))).toHaveLength(arrangement.shapes.length);
  for (const u of units) expect(u.requires.every(r => units.some(v => v.id === r.id)), u.id).toBe(true);
  const shape = guitarExerciseFor(score, arrangement, units[0]);
  expect(shape.events.filter(e => e.grade === 'pitch').every(e => e.notes.length === 1)).toBe(true);
  expect(shape.events[shape.events.length - 1].grade).toBe('onset');
  const section = guitarExerciseFor(score, arrangement, units.find(u => u.id === 'g-section:Theme')!);
  expect(section.events.filter(e => e.label === 'p')).toHaveLength(8);
  expect(section.events.every(e => e.grade === 'onset')).toBe(true);
  expect(melodyBacking(score, [4]).map(e => e.notes[0].midi)).toEqual([78, 81]);
});
