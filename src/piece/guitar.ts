import { chordSpans, noChord, parseChord, prettyChord } from './analysis';
import { toEvents, type Exercise, type XEvent, type XNote } from './exercise';
import { LADDER, repeats, type Unit } from './curriculum';
import { mod12, pcName, type Score } from './score';

/** Standard tuning, string 6 (low E) to string 1 (high E). */
export const OPEN = [40, 45, 50, 55, 59, 64];
/** frets: six characters from low E to high E, x = not played. tier 1 = first chords taught; 4 = full barre. */
export interface Shape { name: string; frets: string; fingers: string; tier: number }
export const SHAPES: Shape[] = [
  { name: 'E', frets: '022100', fingers: '023100', tier: 1 }, { name: 'A', frets: 'x02220', fingers: 'x01230', tier: 1 }, { name: 'D', frets: 'xx0232', fingers: 'xx0132', tier: 1 },
  { name: 'G', frets: '320003', fingers: '210003', tier: 2 }, { name: 'C', frets: 'x32010', fingers: 'x32010', tier: 2 },
  { name: 'Em', frets: '022000', fingers: '023000', tier: 1 }, { name: 'Am', frets: 'x02210', fingers: 'x02310', tier: 1 }, { name: 'Dm', frets: 'xx0231', fingers: 'xx0231', tier: 1 },
  { name: 'E7', frets: '020100', fingers: '020100', tier: 1 }, { name: 'A7', frets: 'x02020', fingers: 'x02030', tier: 1 }, { name: 'D7', frets: 'xx0212', fingers: 'xx0213', tier: 2 },
  { name: 'G7', frets: '320001', fingers: '320001', tier: 2 }, { name: 'C7', frets: 'x32310', fingers: 'x32410', tier: 3 }, { name: 'B7', frets: 'x21202', fingers: 'x21304', tier: 3 },
  { name: 'Cmaj7', frets: 'x32000', fingers: 'x32000', tier: 1 }, { name: 'Fmaj7', frets: 'xx3210', fingers: 'xx3210', tier: 2 }, { name: 'Amaj7', frets: 'x02120', fingers: 'x02130', tier: 2 },
  { name: 'Dmaj7', frets: 'xx0222', fingers: 'xx0111', tier: 2 }, { name: 'Gmaj7', frets: '320002', fingers: '320001', tier: 2 }, { name: 'Emaj7', frets: '021100', fingers: '031200', tier: 2 },
  { name: 'Em7', frets: '022030', fingers: '023040', tier: 1 }, { name: 'Am7', frets: 'x02010', fingers: 'x02010', tier: 1 }, { name: 'Dm7', frets: 'xx0211', fingers: 'xx0211', tier: 2 },
  { name: 'Asus2', frets: 'x02200', fingers: 'x01200', tier: 1 }, { name: 'Asus4', frets: 'x02230', fingers: 'x01240', tier: 1 }, { name: 'Dsus2', frets: 'xx0230', fingers: 'xx0130', tier: 1 },
  { name: 'Dsus4', frets: 'xx0233', fingers: 'xx0134', tier: 1 }, { name: 'Esus4', frets: '022200', fingers: '023400', tier: 1 }, { name: 'Cadd9', frets: 'x32033', fingers: 'x21034', tier: 2 },
  { name: 'Em9', frets: '022032', fingers: '023041', tier: 2 }, { name: 'F#m', frets: 'xx4222', fingers: 'xx3111', tier: 3 }, { name: 'Bm', frets: 'xx4432', fingers: 'xx3421', tier: 3 },
  { name: 'Em/D', frets: 'xx0000', fingers: 'xx0000', tier: 1 }, { name: 'Am/D', frets: 'xx0210', fingers: 'xx0210', tier: 1 }, { name: 'A/E', frets: '002220', fingers: '001230', tier: 1 },
  { name: 'Am/E', frets: '002210', fingers: '002310', tier: 1 }, { name: 'Dm/E', frets: '000231', fingers: '000231', tier: 1 }, { name: 'Fmaj7/E', frets: '003210', fingers: '003210', tier: 2 },
  { name: 'F#m7/E', frets: '002222', fingers: '001111', tier: 3 }, { name: 'D/F#', frets: '200232', fingers: '100243', tier: 3 }, { name: 'G/B', frets: 'x20003', fingers: 'x10003', tier: 2 },
  { name: 'C/E', frets: '032010', fingers: '032010', tier: 2 }, { name: 'F', frets: 'xx3211', fingers: 'xx3211', tier: 3 },
  // Sixth chords: the I-I6 rocking of boogie, swing and pop left hands (D to D6 is one finger lifted).
  { name: 'D6', frets: 'xx0202', fingers: 'xx0102', tier: 1 }, { name: 'G6', frets: '320000', fingers: '210000', tier: 1 }, { name: 'A6', frets: 'x02222', fingers: 'x01111', tier: 2 },
  { name: 'C6', frets: 'x32210', fingers: 'x42310', tier: 2 }, { name: 'E6', frets: '022120', fingers: '023140', tier: 2 },
];
/** Movable barre forms for any root (tier 4): E-shape on string 6, A-shape on string 5. */
function barre(root: number, quality: string): Shape[] {
  const forms: Record<string, [number[], string, number[], string]> = {
    '': [[0, 2, 2, 1, 0, 0], '134211', [-1, 0, 2, 2, 2, 0], 'x12341'], m: [[0, 2, 2, 0, 0, 0], '134111', [-1, 0, 2, 2, 1, 0], 'x13421'],
    '7': [[0, 2, 0, 1, 0, 0], '131211', [-1, 0, 2, 0, 2, 0], 'x13141'], m7: [[0, 2, 0, 0, 0, 0], '131111', [-1, 0, 2, 0, 1, 0], 'x13121'],
  };
  const form = forms[quality];
  if (!form) return [];
  const shapes: Shape[] = [];
  for (const [string, offsets, fingers] of [[0, form[0], form[1]], [1, form[2], form[3]]] as [number, number[], string][]) {
    const n = mod12(root - OPEN[string]) || 12;
    if (n > 9) continue;
    shapes.push({ name: `${pcName(root)}${quality} (barre ${n})`, frets: offsets.map(o => (o < 0 ? 'x' : String(n + o))).join(''), fingers, tier: 4 });
  }
  return shapes;
}
export const fretList = (shape: Shape) => [...shape.frets].map(c => (c === 'x' ? -1 : Number(c)));
/** Sounding MIDI per string (low to high), or -1 for muted strings. */
export const sounding = (shape: Shape, capo = 0) => fretList(shape).map((f, s) => (f < 0 ? -1 : OPEN[s] + capo + f));

export interface ArrangedBar { bar: number; symbol: string; shape: Shape; note?: string }
export interface Arrangement { capo: number; bars: ArrangedBar[]; shapes: Shape[]; review: string[]; cost: number }

/**
 * A shape may leave out chord tones (the piano holds the full harmony) but never adds a pitch class the chord does
 * not contain; it keeps the third. Colour tones the guitar omits are listed for review.
 */
export function shapeFor(symbol: string, capo: number, maxTier = 4): { shape: Shape; cost: number; note?: string } | undefined {
  const chord = parseChord(symbol);
  if (!chord) return undefined;
  const third = [3, 4].map(i => mod12(chord.root + i)).find(pc => chord.tones.includes(pc));
  let best: { shape: Shape; cost: number; note?: string } | undefined;
  for (const shape of [...SHAPES, ...barre(mod12(chord.root - capo), chord.quality === 'maj7' ? '' : chord.quality === 'm9' || chord.quality === 'm7b9' ? 'm7' : chord.quality)]) {
    if (shape.tier > maxTier) continue;
    const pcs = new Set(sounding(shape, capo).filter(m => m >= 0).map(mod12));
    if ([...pcs].some(pc => !chord.tones.includes(pc)) || !pcs.has(chord.root) && !pcs.has(chord.bass)) continue;
    if (third !== undefined && !pcs.has(third)) continue;
    const missing = chord.tones.filter(pc => !pcs.has(pc)), lowest = mod12(Math.min(...sounding(shape, capo).filter(m => m >= 0)));
    // A left-out colour tone costs about one difficulty tier: Dmaj7 keeps its C sharp rather than falling back to D.
    const cost = shape.tier + missing.length * 1.2 + (lowest === chord.bass ? 0 : 0.5);
    if (!best || cost < best.cost) best = { shape, cost, note: missing.length ? `leaves out ${missing.map(pc => pcName(pc)).join(', ')}` : undefined };
  }
  return best;
}

/** One capo for the whole piece: the lowest total difficulty, weighted by how many bars use each chord. */
export function arrange(score: Score, maxTier = 4): Arrangement {
  const spans = chordSpans(score).filter(s => s.tick === 0);
  let best: Arrangement | undefined;
  for (let capo = 0; capo <= 7; capo++) {
    const bars: ArrangedBar[] = [], review: string[] = [];
    let cost = 0.15 * capo;
    for (const span of spans) {
      if (noChord(span.symbol)) continue;
      const choice = shapeFor(span.symbol, capo, maxTier);
      if (!choice) { cost += 20; review.push(`Bar ${score.bars[span.bar].number}: no playable shape for ${prettyChord(span.symbol)}.`); continue; }
      cost += choice.cost;
      if (choice.note) review.push(`${prettyChord(span.symbol)} as ${choice.shape.name}: ${choice.note}.`);
      bars.push({ bar: span.bar, symbol: span.symbol, shape: choice.shape, note: choice.note });
    }
    if (!best || cost < best.cost) best = { capo, bars, shapes: [...new Map(bars.map(b => [b.shape.name, b.shape])).values()], review: [...new Set(review)], cost };
  }
  return best!;
}

/** The accompaniment texture: in 3/4 a bass note on 1 and a three-string pinch on 2 that rings through 3, like the piano's left hand. */
export function patternEvents(shape: Shape, capo: number, beatOffset: number, beatsPerBar: number, level: 0 | 1, hand: 'pick' | 'muted' = 'pick'): XEvent[] {
  const frets = fretList(shape), strings = frets.map((f, i) => ({ f, i })).filter(s => s.f >= 0);
  const note = (i: number, dur: number): XNote => ({ midi: OPEN[i] + capo + frets[i], hand: 'R', dur, string: 6 - i, fret: frets[i] });
  if (level === 0 || hand === 'muted') {
    // One down-strum per bar (or a muted strum on every beat when learning the motion).
    const beats = hand === 'muted' ? Array.from({ length: beatsPerBar }, (_, b) => b) : [0];
    return beats.map(b => ({ beat: beatOffset + b, grade: 'onset' as const, strum: 'D' as const, notes: strings.map(s => note(s.i, hand === 'muted' ? 0.25 : beatsPerBar)) }));
  }
  const bass = strings[0], top = strings.slice(-3);
  const events: XEvent[] = [{ beat: beatOffset, grade: 'onset', notes: [note(bass.i, beatsPerBar)], label: 'p' }];
  const pinches = beatsPerBar === 3 ? [1] : Array.from({ length: beatsPerBar - 1 }, (_, b) => b + 1);
  for (const b of pinches) events.push({ beat: beatOffset + b, grade: 'onset', notes: top.map(s => note(s.i, beatsPerBar - b)), label: 'i m a' });
  return events;
}

const guitarExercise = (id: string, title: string, beatsPerBar: number, events: XEvent[], capo: number, shapes: Exercise['shapes'], chords: Exercise['chords'], bars: Exercise['bars'], keySig: number): Exercise =>
  ({ id, title, instrument: 'guitar', beatsPerBar, beats: Math.max(...events.map(e => e.beat + Math.max(...e.notes.map(n => n.dur)))), keySig, events, bars, chords, capo, shapes });

/** Each sounding string plucked alone (pitch checked by CREPE), then one gentle strum (timing only). */
export function shapeExercise(shape: Shape, capo: number, id: string): Exercise {
  const frets = fretList(shape), strings = frets.map((f, i) => ({ f, i })).filter(s => s.f >= 0);
  const notes = strings.map((s, k) => ({ beat: k, midi: OPEN[s.i] + capo + s.f, hand: 'R' as const, dur: 0.8, string: 6 - s.i, fret: s.f }));
  const events: XEvent[] = [...toEvents(notes, 'pitch').map(e => ({ ...e, label: 'one string' })), { beat: strings.length + 1, grade: 'onset', strum: 'D', notes: strings.map(s => ({ midi: OPEN[s.i] + capo + s.f, hand: 'R' as const, dur: 2, string: 6 - s.i, fret: s.f })) }];
  const beats = Math.ceil((strings.length + 3) / 4) * 4;
  return { ...guitarExercise(id, `${shape.name} shape`, 4, events, capo, [{ beat: 0, name: shape.name, frets: shape.frets, fingers: shape.fingers }], [{ beat: 0, symbol: shape.name }], [{ beat: 0, number: 1 }], 0), beats };
}

export function arrangedExercise(score: Score, arrangement: Arrangement, bars: number[], level: 0 | 1, id: string, title: string, hand: 'pick' | 'muted' = 'pick'): Exercise {
  const events: XEvent[] = [], marks: Exercise['bars'] = [], chords: Exercise['chords'] = [], shapes: NonNullable<Exercise['shapes']> = [];
  let offset = 0;
  for (const index of bars) {
    const bar = score.bars[index], arranged = arrangement.bars.find(b => b.bar === index), beatsPerBar = bar.ticks / score.ppq;
    marks.push({ beat: offset, number: bar.number });
    if (arranged) {
      chords.push({ beat: offset, symbol: arranged.symbol });
      if (shapes[shapes.length - 1]?.name !== arranged.shape.name) shapes.push({ beat: offset, name: arranged.shape.name, frets: arranged.shape.frets, fingers: arranged.shape.fingers });
      events.push(...patternEvents(arranged.shape, arrangement.capo, offset, beatsPerBar, level, hand));
    }
    offset += beatsPerBar;
  }
  return { ...guitarExercise(id, title, score.bars[bars[0]].ticks / score.ppq, events, arrangement.capo, shapes, chords, marks, score.key), beats: offset };
}

/** The melody the guitar accompanies, played by the app in headphones. */
export function melodyBacking(score: Score, bars: number[]): XEvent[] {
  const notes: (XNote & { beat: number })[] = [];
  let offset = 0;
  for (const index of bars) {
    const bar = score.bars[index], right = score.notes.filter(n => n.bar === index && n.hand === 'R');
    const top = new Map<number, typeof right[number]>();
    for (const n of right) if (!top.has(n.tick) || top.get(n.tick)!.midi < n.midi) top.set(n.tick, n);
    for (const n of top.values()) notes.push({ beat: offset + n.tick / score.ppq, midi: n.midi, hand: 'R', dur: n.dur / score.ppq });
    offset += bar.ticks / score.ppq;
  }
  return toEvents(notes, 'none');
}

export const GUITAR_STAGES = ['Shapes', 'Changes', 'The pattern', 'Sections', 'The whole piece'];
/** Shapes string by string, every change in song order, the pattern on muted strings then on a chord, sections and the whole piece with the melody. */
export function guitarUnits(score: Score, arrangement: Arrangement, goalBpm = score.tempo.bpm): Unit[] {
  const units: Unit[] = [], full = LADDER, certify = [0.8, 1], first = arrangement.bars[0];
  const capoText = arrangement.capo ? ` with the capo at fret ${arrangement.capo}` : '';
  for (const shape of arrangement.shapes) {
    const uses = arrangement.bars.filter(b => b.shape.name === shape.name), symbols = [...new Set(uses.map(b => prettyChord(b.symbol)))];
    units.push({ id: `g-shape:${shape.name}`, kind: 'chord', stage: 0, title: `${shape.name} shape`, goal: `Fret ${shape.frets}${capoText}. Pluck each string alone, quieting it before the next, then one gentle strum.`, why: `Plays ${symbols.join(', ')} in ${uses.length} bar${uses.length === 1 ? '' : 's'}. Each plucked string is checked for pitch; the strum is timing only.`, bars: [uses[0].bar], hands: ['R'], requires: [], rungs: [0.6, 0.8, 1], certify: [1], goalBpm: 60 });
  }
  const pairs = new Map<string, [number, number]>();
  const order = score.playOrder.map(i => arrangement.bars.find(b => b.bar === i)).filter(Boolean) as ArrangedBar[];
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    if (a.shape.name === b.shape.name) continue;
    const key = [a.shape.name, b.shape.name].sort().join(' ↔ ');
    if (!pairs.has(key)) pairs.set(key, [a.bar, b.bar]);
  }
  for (const [key, [a, b]] of pairs) {
    const [x, y] = key.split(' ↔ ');
    units.push({ id: `g-change:${key}`, kind: 'change', stage: 1, title: `${x} → ${y}`, goal: 'One strum on beat 1 of each bar. Move during the last beat; keep any finger that stays.', why: 'Changes in the order the piece needs them. Timing of the first strum after each change is checked.', bars: [a, b, a, b], hands: ['R'], requires: [{ id: `g-shape:${x}`, at: 0.8 }, { id: `g-shape:${y}`, at: 0.8 }], rungs: full, certify, goalBpm });
  }
  units.push({ id: 'g-pattern:muted', kind: 'hand', stage: 2, title: 'Picking pattern on muted strings', goal: 'Rest the fretting hand lightly on the strings and play the rhythm only: bass on 1, pinch on 2, let 3 ring.', why: 'Learn the right hand before combining it with shapes. Timing only.', bars: [first.bar, first.bar, first.bar, first.bar], hands: ['R'], requires: [], rungs: full, certify, goalBpm });
  units.push({ id: 'g-pattern:chord', kind: 'hand', stage: 2, title: `Pattern on ${first.shape.name}`, goal: `Bass note on 1 with the thumb, then index, middle and ring together on 2. Let it ring.`, why: 'The same rhythm, now with a shape. Timing only: the microphone cannot certify that every string rang.', bars: [first.bar, first.bar, first.bar, first.bar], hands: ['R'], requires: [{ id: 'g-pattern:muted', at: 0.7 }, { id: `g-shape:${first.shape.name}`, at: 0.8 }], rungs: full, certify, goalBpm });
  for (const section of score.sections.length ? score.sections : [{ name: 'Piece', from: 0, to: score.bars.length - 1 }]) {
    const bars = Array.from({ length: section.to - section.from + 1 }, (_, i) => section.from + i), shapes = [...new Set(bars.map(b => arrangement.bars.find(x => x.bar === b)?.shape.name).filter(Boolean))] as string[];
    units.push({ id: `g-section:${section.name}`, kind: 'section', stage: 3, title: `${section.name.replace(/(\d)$/, ' $1')} · bars ${score.bars[section.from].number}–${score.bars[section.to].number}`, goal: 'The pattern through the section. With headphones the app plays the melody with you.', why: `${shapes.length} shape${shapes.length === 1 ? '' : 's'}: ${shapes.join(', ')}.`, bars, hands: ['R'], requires: [{ id: 'g-pattern:chord', at: 0.8 }, ...shapes.map(s => ({ id: `g-shape:${s}`, at: 0.8 }))], rungs: full, certify, goalBpm });
  }
  units.push({ id: 'g-performance', kind: 'performance', stage: 4, title: 'Accompany the whole piece', goal: `All ${score.playOrder.length} bars${repeats(score) ? ' with the repeats' : ''}, the melody playing in your headphones.`, why: 'A run-through: keep the pattern going even after a slip.', bars: score.playOrder, hands: ['R'], requires: units.filter(u => u.id.startsWith('g-section:')).map(u => ({ id: u.id, at: 0.88 })), rungs: full.filter(r => r >= 0.8), certify: [1], goalBpm });
  return units;
}

export function guitarExerciseFor(score: Score, arrangement: Arrangement, unit: Unit): Exercise {
  if (unit.id.startsWith('g-shape:')) return shapeExercise(arrangement.shapes.find(s => s.name === unit.id.slice(8))!, arrangement.capo, unit.id);
  if (unit.id.startsWith('g-change:')) return arrangedExercise(score, arrangement, unit.bars, 0, unit.id, unit.title);
  if (unit.id === 'g-pattern:muted') return arrangedExercise(score, arrangement, unit.bars, 1, unit.id, unit.title, 'muted');
  return arrangedExercise(score, arrangement, unit.bars, 1, unit.id, unit.title);
}
