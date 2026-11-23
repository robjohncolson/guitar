import { expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum, exerciseFor, type Unit } from '../src/piece/curriculum';
import { drillExercise, drillSignature, keyLabel, type DrillMode } from '../src/piece/drills';
import { noteName, type Score } from '../src/piece/score';
import { arrange, guitarExerciseFor, guitarUnits, patternText } from '../src/piece/guitar';
import { arrangePiece, checkedText, guitarPieceUnits, pieceExercise } from '../src/piece/solo';
import type { Exercise, XEvent } from '../src/piece/exercise';
import { longPiece } from './helpers/long-piece';

/** A small original piece for these checks. */
const piece = (time: string, key: string, bars: string[][]) =>
  compile(
    [
      'title: Text check',
      'composer: Test',
      'source: written for the tests',
      'licence: CC0',
      'redistributable: yes',
      'verified: checks',
      'pitch-mode: sounding',
      `key: ${key}`,
      `time: ${time}`,
      'tempo: q=80',
      'voices: mel@1:R bass@2:L',
      ...bars.flatMap(([harmony, mel, bass], i) => [
        `== ${i + 1}`,
        `harmony: ${harmony}`,
        `mel: ${mel}`,
        `bass: ${bass}`,
      ]),
    ].join('\n'),
  ).score!;
const event = (grade: XEvent['grade'], notes: number): XEvent => ({
  beat: 0,
  grade,
  notes: Array.from({ length: notes }, (_, i) => ({ midi: 60 + i, hand: 'R' as const, dur: 1 })),
});

it('says what a guitar step checks from the grades its events have: pitch, timing only, or how many of each', () => {
  expect(checkedText([event('pitch', 1), event('pitch', 1)], 'R')).toBe(
    'Every melody note is a single string, so its pitch is checked.',
  );
  expect(checkedText([event('onset', 2), event('onset', 3)], 'R')).toBe(
    'Every attack here is two or more strings at once, so this step checks timing only.',
  );
  expect(checkedText([event('pitch', 1), event('onset', 2), event('onset', 2), event('none', 1)], 'R')).toBe(
    '1 of the 3 attacks is a single string, so its pitch is checked; the other 2 are two or more strings at once, timing only.',
  );
  expect(checkedText([event('pitch', 1), event('pitch', 1), event('onset', 2)], 'L')).toBe(
    '2 of the 3 attacks are a single string, so their pitch is checked; the other 1 is two or more strings at once, timing only.',
  );
});

it('labels a melody of double stops as timing only, and every one-part step by what it really grades', () => {
  // The melody moves in thirds: every attack is two strings, so nothing in it is checked for pitch.
  const thirds = piece('4/4', '0', [
    ['C', '<e4 g4>:4 <f4 a4>:4 <g4 b4>:4 <e4 g4>:4', 'c3:1'],
    ['G', '<d4 f4>:4 <e4 g4>:4 <f4 a4>:4 <d4 f4>:4', 'g2:1'],
    ['C', '<e4 g4>:1', 'c3:1'],
  ]);
  for (const score of [thirds, compile(gymnopedie).score!]) {
    const arranged = arrangePiece(score);
    for (const u of guitarPieceUnits(score, arranged).filter((x) => x.kind === 'hand')) {
      const graded = pieceExercise(score, arranged, u).events.filter((e) => e.grade !== 'none'),
        pitch = graded.filter((e) => e.grade === 'pitch').length;
      if (pitch === graded.length)
        expect(u.why, u.id).toMatch(/^Every .* is a single string, so its pitch is checked\.$/);
      else if (!pitch) expect(u.why, u.id).toMatch(/timing only\.$/);
      else expect(u.why, u.id).toContain(`${pitch} of the ${graded.length} attacks`);
    }
  }
  const melody = guitarPieceUnits(thirds, arrangePiece(thirds)).find((u) => u.id === 'gp-R:1-3')!;
  expect(melody.why).toBe('Every attack here is two or more strings at once, so this step checks timing only.');
});

it('describes the guitar pattern the step really plays, in 4/4 and in 3/4', () => {
  const four = piece('4/4', '0', [
    ['C', 'e4:4 g4:4 c5:4 g4:4', 'c3:1'],
    ['G', 'd4:4 g4:4 b4:4 g4:4', 'g2:1'],
    ['C', 'e4:1', 'c3:1'],
  ]);
  const goals = (score: ReturnType<typeof piece>) => {
    const arrangement = arrange(score),
      units = guitarUnits(score, arrangement);
    const of = (id: string) => units.find((u) => u.id === id)!;
    return {
      muted: of('g-pattern:muted').goal,
      chord: of('g-pattern:chord').goal,
      events: guitarExerciseFor(score, arrangement, of('g-pattern:chord')).events,
      strums: guitarExerciseFor(score, arrangement, of('g-pattern:muted')).events,
    };
  };
  const g4 = goals(four);
  expect(g4.muted).toBe(
    'Rest the fretting hand lightly on the strings and play the rhythm only: a muted down-strum on beats 1, 2, 3 and 4.',
  );
  expect(g4.chord).toBe('Bass note on 1 with the thumb, then index, middle and ring together on 2, 3 and 4.');
  // What the step plays is unchanged: four strums a bar on muted strings, a bass then three pinches on the chord.
  expect(g4.strums.filter((e) => e.beat < 4).map((e) => [e.beat, e.strum])).toEqual([
    [0, 'D'],
    [1, 'D'],
    [2, 'D'],
    [3, 'D'],
  ]);
  expect(g4.events.filter((e) => e.beat < 4).map((e) => [e.beat, e.notes.length])).toEqual([
    [0, 1],
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
  const g3 = goals(compile(gymnopedie).score!);
  expect(g3.muted).toBe(
    'Rest the fretting hand lightly on the strings and play the rhythm only: a muted down-strum on beats 1, 2 and 3.',
  );
  expect(g3.chord).toBe(
    'Bass note on 1 with the thumb, then index, middle and ring together on 2, letting it ring through 3.',
  );
  expect(patternText(g3.events.filter((e) => e.beat < 3))).toBe(g3.chord.slice(0, -1).replace(/^B/, 'b'));
});

it("spells a borrowed key from the piece's own signature: A♭ natural minor in A♭ major, never G♯", () => {
  const score = compile(longPiece(36, 12)).score!;
  expect(score.key).toBe(-4);
  const titles = [...buildCurriculum(score).units, ...guitarPieceUnits(score, arrangePiece(score))]
    .filter((u) => u.kind === 'drill')
    .map((u) => u.title);
  expect(titles).toContain('A♭ natural minor scale, hands together');
  expect(titles).toContain('A♭ natural minor scale, open position');
  expect(titles).toContain('A♭ major cadence I–IV–V–I');
  expect(titles.join(' ')).not.toMatch(/[A-G]♯/);
  // The label follows the signature it is given; without one it keeps the usual name.
  expect(keyLabel(8, 'natural', -4)).toBe('A♭ natural minor');
  expect(keyLabel(8, 'natural')).toBe('G♯ natural minor');
  expect(keyLabel(3, 'natural', 6)).toBe('D♯ natural minor');
  expect(keyLabel(6, 'major', -6)).toBe('G♭ major');
  expect(keyLabel(2, 'major', 2)).toBe('D major');
});

const MODES: DrillMode[] = ['major', 'harmonic', 'natural'];
/** The lane's name for an exercise's first note, without its octave. */
const firstName = (ex: Exercise) => noteName(ex.events[0].notes[0].midi, ex.keySig).replace(/-?\d+$/, '');
/** A guitar drill step as guitarPieceUnits makes it: its id carries the tonic, mode and kind; it reads only the key. */
const guitarDrill = (tonic: number, mode: DrillMode, piece: number) =>
  pieceExercise({ key: piece } as Score, arrangePiece(compile(gymnopedie).score!), {
    id: `gp-drill:${tonic}:${mode}:scale`,
    title: '',
  } as Unit);

it("names every drill in the spelling its lane uses, for every key and every piece's signature", () => {
  for (let piece = -7; piece <= 7; piece++)
    for (let tonic = 0; tonic < 12; tonic++)
      for (const mode of MODES) {
        const title = keyLabel(tonic, mode, piece).split(' ')[0],
          where = `${tonic} ${mode} in a piece of ${piece} fifths`;
        expect(
          firstName(drillExercise({ kind: 'scale', tonic, mode, hands: ['R'], octaves: 1, piece }, 'x', 'x')),
          where,
        ).toBe(title);
        expect(firstName(guitarDrill(tonic, mode, piece)), `guitar: ${where}`).toBe(title);
        expect(Math.abs(drillSignature(tonic, mode, piece))).toBeLessThanOrEqual(7);
      }
});

it.each([
  ['A♭ major borrows A♭ minor (7 flats)', 8, 'natural', -4, 'A♭ natural minor', -7],
  ['D♭ major borrows C♯ minor (8 flats is no signature)', 1, 'natural', -5, 'C♯ natural minor', 4],
  ['G♭ major at home', 6, 'major', -6, 'G♭ major', -6],
  ['G♭ major borrows F♯ minor', 6, 'natural', -6, 'F♯ natural minor', 3],
  ['C♯ major at home', 1, 'major', 7, 'C♯ major', 7],
  ['C♯ major, its relative minor', 10, 'natural', 7, 'A♯ natural minor', 7],
  ['E♭ minor in a flat piece', 3, 'harmonic', -6, 'E♭ harmonic minor', -6],
  ['D major at home', 2, 'major', 2, 'D major', 2],
  ['C major borrows C minor', 0, 'natural', 0, 'C natural minor', -3],
] as const)('%s', (_, tonic, mode, piece, name, sig) => {
  expect(keyLabel(tonic, mode, piece)).toBe(name);
  expect(drillSignature(tonic, mode, piece)).toBe(sig);
  const lane = drillExercise({ kind: 'scale', tonic, mode, hands: ['R'], octaves: 1, piece }, 'x', 'x');
  expect(lane.keySig).toBe(sig);
  expect(guitarDrill(tonic, mode, piece).keySig).toBe(sig);
});

it("changes only names: every drill's id and notes are as HEAD (46e6bc8) made them", () => {
  // FNV-1a of every drill step's id and its exercise's events (beat, grade, and each note's pitch, hand, finger, string
  // and fret), for the piano and guitar courses of Gymnopédie, the long test piece, the 36-bar test piece and a small
  // piece in each signature from 7 flats to 7 sharps, major and minor; and of every piano drill spec's events. The
  // numbers were computed by running HEAD's own code (curriculum.ts, solo.ts, drills.ts at 46e6bc8) on the same input.
  const fnv = (text: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  const ser = (ex: Exercise) =>
    ex.events
      .map(
        (e) =>
          `${e.beat}:${e.grade}:${e.notes.map((n) => `${n.midi}/${n.hand}/${n.finger ?? ''}/${n.string ?? ''}/${n.fret ?? ''}`).join(',')}`,
      )
      .join(';');
  const small = (k: number, mode: string) =>
    [
      'title: Sig',
      'composer: T',
      'source: t',
      'licence: CC0',
      'redistributable: yes',
      'verified: checks',
      'pitch-mode: printed',
      `key: ${k === 0 ? '0' : `${Math.abs(k)}${k < 0 ? 'b' : '#'}`}`,
      `mode: ${mode}`,
      'time: 4/4',
      'tempo: q=80',
      'voices: mel@1:R bass@2:L',
      ...[1, 2, 3, 4].flatMap((b) => [`== ${b}`, 'mel: c5:4 d5:4 e5:4 f5:4', 'bass: c3:1']),
    ].join('\n');
  const texts = [gymnopedie, longPiece(), longPiece(36, 12)];
  for (let k = -7; k <= 7; k++) for (const m of ['major', 'minor']) texts.push(small(k, m));
  const parts: string[] = [];
  for (const text of texts) {
    const score = compile(text).score!;
    for (const u of buildCurriculum(score).units.filter((x) => x.kind === 'drill'))
      parts.push(`${u.id}|${ser(exerciseFor(score, u))}`);
    const arranged = arrangePiece(score);
    for (const u of guitarPieceUnits(score, arranged).filter((x) => x.kind === 'drill'))
      parts.push(`${u.id}|${ser(pieceExercise(score, arranged, u))}`);
  }
  const specs: string[] = [];
  for (let tonic = 0; tonic < 12; tonic++)
    for (const mode of MODES)
      for (const kind of ['scale', 'arpeggio', 'cadence'] as const)
        for (const hands of [['R'], ['L'], ['L', 'R']] as const)
          for (const octaves of [1, 2] as const)
            specs.push(ser(drillExercise({ kind, tonic, mode, hands: [...hands], octaves, piece: -5 }, 'x', 'x')));
  expect([parts.length, fnv(parts.join('\n'))]).toEqual([313, '1e31a83f']);
  expect([specs.length, fnv(specs.join('\n'))]).toEqual([648, '3e9e3b27']);
});
