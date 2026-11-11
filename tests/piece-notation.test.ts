import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile, listing } from '../src/piece/notation';
import { readMidi } from '../src/piece/midi';
import { noteName } from '../src/piece/score';
import { fromBars } from '../src/piece/exercise';
import { buildCurriculum } from '../src/piece/curriculum';
import { arrange } from '../src/piece/guitar';

const head = (mode = 'printed', key = '2#', time = '4/4') => `title: t\npitch-mode: ${mode}\nkey: ${key}\ntime: ${time}\nvoices: rh@1:R lh@2:L\n`;
const pitches = (text: string) => compile(text).score!.notes.map(n => noteName(n.midi));

it('compiles the Gymnopédie pack exactly as the independent Mutopia MIDI sounds', () => {
  const { score, diagnostics } = compile(gymnopedie);
  expect(diagnostics).toEqual([]);
  const midi = readMidi(readFileSync(new URL('./fixtures/gymnopedie-1.mid', import.meta.url)));
  const ppq = midi.division, perBar = 3 * ppq, s = score!;
  const at = (bar: number, beat: number, m: number) => `${bar}:${beat}:${m}`;
  const fromMidi = midi.notes.map(n => at(Math.floor(n.tick / perBar) + 1, (n.tick % perBar) / ppq, n.midi)).sort();
  const fromScore = s.notes.map(n => at(s.bars[n.bar].number, n.tick / s.ppq, n.midi)).sort();
  expect(fromScore).toEqual(fromMidi);
  expect(s.notes).toHaveLength(282);
  // MIDI cannot hold a sustained melody note while the accompaniment restrikes the same key. Compare lengths elsewhere.
  let compared = 0;
  for (const note of s.notes) {
    const start = s.bars[note.bar].start + note.tick, end = start + note.dur;
    const unison = s.notes.some(o => o !== note && o.midi === note.midi && s.bars[o.bar].start + o.tick < end && s.bars[o.bar].start + o.tick + o.dur > start);
    const match = midi.notes.find(m => at(Math.floor(m.tick / perBar) + 1, (m.tick % perBar) / ppq, m.midi) === at(s.bars[note.bar].number, note.tick / s.ppq, note.midi));
    expect(match).toBeDefined();
    expect(note.staff).toBe(match!.track);
    if (!unison) { expect(match!.dur / ppq).toBe(note.dur / s.ppq); compared++; }
  }
  expect(compared).toBeGreaterThan(260);
  // Bars 1-31, first ending 32-39, bars 1-31 again, second ending 40-47.
  const numbers = s.playOrder.map(i => s.bars[i].number), range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  expect(numbers).toEqual([...range(1, 31), ...range(32, 39), ...range(1, 31), ...range(40, 47)]);
  expect(s.sections.map(x => x.name)).toEqual(['Intro', 'Theme', 'Return', 'Middle', 'Ending1', 'Ending2']);
  expect(s.notes.filter(n => s.bars[n.bar].number === 37 && n.voice === 'acc').every(n => n.hand === 'R')).toBe(true);
  expect(listing(s, m => noteName(m, s.key)).split('\n')[4]).toContain('RH 1:F♯5/1 2:A5/1');
});

it('applies the key signature and bar-long printed accidentals in time order across voices on a staff', () => {
  const text = head() + '== 1\nrh: f4:4 c5:4 f#4:4 f4:4\nlh: R\n== 2\nrh: fn4:4 f4:4 g4:4 cn5:4\nlh: c3:4 d3:4 d3:4 d3:4\n';
  expect(pitches(text)).toEqual(['F♯4', 'C♯5', 'F♯4', 'F♯4', 'C♯3', 'F4', 'D3', 'F4', 'D3', 'G4', 'D3', 'C5']);
  const voices = 'title: t\npitch-mode: printed\nkey: 0\ntime: 2/4\nvoices: up@1:R down@1:L\n== 1\nup: c5:4 f#4:4\ndown: f4:4 f4:4\n';
  expect(compile(voices).score!.notes.map(n => noteName(n.midi))).toEqual(['F4', 'C5', 'F♯4', 'F♯4']);
});

it('keeps a tied accidental across the barline, merges ties and reports broken ones', () => {
  const tie = head('printed', '0', '2/4') + '== 1\nrh: c4:4 f#4:4~\nlh: R\n== 2\nrh: f4:4 f4:4\nlh: R\n';
  const score = compile(tie).score!;
  expect(score.notes.map(n => `${noteName(n.midi)}/${n.dur / score.ppq}`)).toEqual(['C4/1', 'F♯4/2', 'F4/1']);
  const broken = compile(head('sounding', '0', '2/4') + '== 1\nrh: c4:4 e4:4~\nlh: R\n== 2\nrh: f4:2\nlh: R\n');
  expect(broken.diagnostics.some(d => d.level === 'warn' && d.message.includes('does not continue'))).toBe(true);
});

it('reads chords, tuplets, fingering and hand overrides, and rejects bars that do not add up', () => {
  const text = head('sounding', '0', '2/4') + '== 1\nrh: 3:2{ c5-1:8 d5-2:8 e5-3:8 } <c4 e4 g4>:4\nlh[R]: R\n';
  const score = compile(text).score!;
  expect(score.notes.map(n => [n.tick, n.dur, n.finger ?? 0])).toEqual([[0, 160, 1], [160, 160, 2], [320, 160, 3], [480, 480, 0], [480, 480, 0], [480, 480, 0]]);
  const short = compile(head('sounding', '0') + '== 1\nrh: c4:4 d4:4\nlh: R\n');
  expect(short.score).toBeUndefined();
  expect(short.diagnostics[0].message).toContain('fills 2 of 4 beats');
  expect(compile(head('sounding', '0') + '== 1\nxx: c4:1\n').diagnostics[0].message).toContain('Unknown voice');
  expect(compile(head('sounding') + '== 1\nrh: f4:1\nlh: R\n').diagnostics.some(d => d.message.includes('Write fn4'))).toBe(true);
});

it('reads grace notes, swing and N.C.: graces take no time but their accidentals count; swung off-beats come late', () => {
  const text = head('printed', '4b') + '== 1 swing\nharmony: N.C.\nrh: e5:8 g{ en5:8 } f5:8 e5:4 r:2\nlh: R\n'
    + '== 2\nharmony: Ab Ab6@2\nrh: <c4 a4>:2 <c4 f4>:2\nlh: a2:2 a2:2\n== 3 straight\nharmony: Ab\nrh: c5:8 c5:8 r:4 r:2\nlh: R\n';
  const { score, diagnostics } = compile(text);
  expect(diagnostics).toEqual([]);
  const s = score!;
  // E flat from the key; the grace E natural is not played but makes the later E natural for the rest of the bar.
  expect(s.notes.filter(n => n.bar === 0).map(n => [n.midi, n.tick, n.dur])).toEqual([[75, 0, 240], [77, 240, 240], [76, 480, 480]]);
  expect(s.bars.map(b => !!b.swing)).toEqual([true, true, false]);
  const take = fromBars(s, [0, 2], ['R'], 'x', 'x');
  expect(take.events.map(e => +e.beat.toFixed(3))).toEqual([0, 0.667, 1, 4, 4.5]);
  expect(take.events[0].notes[0].dur).toBeCloseTo(2 / 3);
  expect(buildCurriculum(s, 120).units.filter(u => u.id.startsWith('chord:')).map(u => u.id)).toEqual(['chord:Ab', 'chord:Ab6']);
  // The guitar plays one shape per bar (its downbeat chord) and nothing in an N.C. bar.
  expect(arrange(s).bars.map(b => b.symbol)).toEqual(['Ab', 'Ab']);
  expect(compile(head('printed', '0') + '== 1\nrh: g{ c5:8 c4:1\nlh: R\n').diagnostics[0].message).toContain('grace group was not closed');
  // A misspelt bar option would silently change the rhythm, so it is reported.
  const typo = compile(head('printed', '0') + '== 1 swingg\nrh: c4:1\nlh: R\n');
  expect(typo.diagnostics.map(d => [d.level, d.message.slice(0, 22)])).toEqual([['warn', 'Bar option "swingg" is']]);
  expect(typo.score!.bars[0].swing).toBeUndefined();
});

it('unrolls a plain repeat, a pickup and D.C. al Fine', () => {
  const pickup = head('sounding', '0', '3/4') + '== 0\nrh: g4:4\n|:\n== 1\nrh: c5:2.\nlh: R\n== 2 partial\nrh: e5:2\n:|\n';
  const score = compile(pickup).score!;
  expect(score.bars.map(b => b.ticks / score.ppq)).toEqual([1, 3, 2]);
  expect(score.playOrder).toEqual([0, 1, 2, 1, 2]);
  const dc = head('sounding', '0', '2/4') + '== 1\nrh: c4:2\n== 2\nrh: d4:2\nmark: fine\n== 3\nrh: e4:2\nmark: dc\n';
  expect(compile(dc).score!.playOrder).toEqual([0, 1, 2, 0, 1]);
});

it('ships only packs that may be shared, each compiling cleanly', () => {
  const packs = import.meta.glob('../src/piece/packs/*.piece.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  expect(Object.keys(packs).length).toBeGreaterThan(0);
  for (const [path, text] of Object.entries(packs)) {
    const { score, diagnostics } = compile(text);
    expect(diagnostics.filter(d => d.level === 'error'), path).toEqual([]);
    expect(score!.meta.redistributable, `${path} must say redistributable: yes or move to packs/local/`).toBe(true);
  }
});
