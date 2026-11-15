import { chordName, chunks, detectKey, difficulty, drillKeys, parseChord, prettyChord } from './analysis';
import { SCALES, keyLabel, type DrillMode } from './drills';
import { toEvents, type Exercise, type XEvent, type XNote } from './exercise';
import { LADDER, repeats, type Unit } from './curriculum';
import { OPEN, shapeFor } from './guitar';
import { mod12, noteName, pcName, type Hand, type Score, type ScoreNote } from './score';

/**
 * The written piece on one guitar in standard tuning, frets 0–12.
 * Below the low E, notes move up an octave. Above the 12th fret, the melody moves down an octave
 * so it can sit with the chord. A pluck never adds a pitch class the score does not have at that
 * moment. Two notes that fold onto one pitch are one pluck. What still will not fit is left out,
 * melody and bass last.
 */
const TOP = 76;
const MAX_FRET = 12;
const stringOf = (index: number) => 6 - index;
const indexOf = (string: number) => 6 - string;

export interface PlacedNote {
  beat: number; dur: number; midi: number; written: number; hand: Hand; also?: Hand;
  string: number; fret: number;
}
export interface ArrangedBar { index: number; notes: PlacedNote[]; omitted: { midi: number; hand: Hand }[] }
export interface PieceArrangement { bars: ArrangedBar[]; review: string[] }

interface Hold { index: number; until: number; fret: number }
interface Spot { index: number; fret: number; midi: number }
type Role = 'bass' | 'melody' | 'inner';

const choices = (midi: number): number[] => {
  const found: number[] = [];
  for (let m = midi; m >= 40; m -= 12) if (m <= TOP) found.push(m);
  for (let m = midi + 12; m <= TOP; m += 12) found.push(m);
  return [...new Set(found)].filter(m => m >= 40 && m <= TOP).sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi) || a - b);
};

/** A ringing bass keeps its string. A chord string may be plucked again for the melody. */
function cost(written: number, midi: number, index: number, fret: number, role: Role, held: boolean, placed: PlacedNote[], holds: Hold[], at: number): number {
  const live = holds.filter(h => h.until > at + 0.04);
  const grip = placed.filter(p => p.fret > 0).map(p => p.fret);
  const anchor = [...grip, ...live.filter(h => h.fret > 0).map(h => h.fret)];
  const span = fret > 0 && grip.length ? Math.max(fret, ...grip) - Math.min(fret, ...grip) : 0;
  const reach = fret > 0 && anchor.length ? Math.max(fret, ...anchor) - Math.min(fret, ...anchor) : 0;
  let score = Math.abs(midi - written) * 3 + fret * 2 + (fret === 0 ? -6 : 0);
  score += held && index <= 2 ? 48 : held ? 8 : 0;
  score += Math.max(0, span - 4) * 14 + Math.max(0, reach - 4) * 12;
  if (role === 'bass') score += index * 6;
  else if (role === 'melody') score += (5 - index) * 7;
  else score += (5 - index) * 3 + Math.abs(index - 4);
  return score;
}

function best(note: ScoreNote, used: Set<number>, holds: Hold[], at: number, placed: PlacedNote[], role: Role): (Spot & { merge?: boolean }) | undefined {
  let winner: { spot: Spot; score: number } | undefined;
  let merge: { midi: number; score: number } | undefined;
  for (const midi of choices(note.midi)) {
    if (placed.some(p => p.midi === midi)) {
      const score = Math.abs(midi - note.midi) * 3;
      if (!merge || score < merge.score) merge = { midi, score };
      continue;
    }
    for (let index = 0; index < 6; index++) {
      if (used.has(index)) continue;
      const fret = midi - OPEN[index];
      if (fret < 0 || fret > MAX_FRET) continue;
      const held = holds.some(h => h.index === index && h.until > at + 0.04);
      const score = cost(note.midi, midi, index, fret, role, held, placed, holds, at);
      if (!winner || score < winner.score) winner = { spot: { index, fret, midi }, score };
    }
  }
  if (merge && (!winner || merge.score <= winner.score)) return { index: -1, fret: 0, midi: merge.midi, merge: true };
  return winner?.spot;
}

function placeGroup(group: ScoreNote[], at: number, holds: Hold[], ppq: number, third?: number): { notes: PlacedNote[]; omitted: { midi: number; hand: Hand }[] } {
  const basses = group.filter(n => n.hand === 'L' && n.midi < 48).sort((a, b) => a.midi - b.midi);
  const melody = group.filter(n => n.hand === 'R').sort((a, b) => b.midi - a.midi);
  const inner = group.filter(n => n.hand === 'L' && n.midi >= 48).sort((a, b) => b.midi - a.midi);
  const order: { note: ScoreNote; role: Role }[] = [
    ...basses.map(note => ({ note, role: 'bass' as const })),
    ...melody.map(note => ({ note, role: 'melody' as const })),
    ...inner.map(note => ({ note, role: 'inner' as const })),
  ];
  const placed: PlacedNote[] = [], used = new Set<number>(), skipped: ScoreNote[] = [], omitted: { midi: number; hand: Hand }[] = [];
  const put = (note: ScoreNote, spot: Spot) => {
    used.add(spot.index);
    placed.push({
      beat: Math.round(note.tick / ppq * 960) / 960, dur: Math.max(0.25, Math.round(note.dur / ppq * 960) / 960),
      midi: spot.midi, written: note.midi, hand: note.hand, string: stringOf(spot.index), fret: spot.fret,
    });
  };
  const take = (note: ScoreNote, role: Role, live: Hold[]) => {
    const spot = best(note, used, live, at, placed, role);
    if (!spot) return false;
    if (spot.merge) {
      const host = placed.find(p => p.midi === spot.midi);
      if (host && host.hand !== note.hand && host.also === undefined) host.also = note.hand;
      return true;
    }
    put(note, spot);
    return true;
  };
  for (const { note, role } of order) if (!take(note, role, holds)) skipped.push(note);
  for (const note of [...skipped]) {
    const role: Role = note.hand === 'R' ? 'melody' : note.midi < 48 ? 'bass' : 'inner';
    if (role === 'inner' || !take(note, role, [])) continue;
    skipped.splice(skipped.indexOf(note), 1);
  }
  for (const note of [...skipped]) {
    const role: Role = note.hand === 'R' ? 'melody' : note.midi < 48 ? 'bass' : 'inner';
    const victims = placed.filter(p => p.hand === 'L' && p.also === undefined && p.written >= 48
      && (third === undefined || mod12(p.written) !== third || placed.filter(q => mod12(q.written) === third).length > 1));
    victims.sort((a, b) => b.midi - a.midi);
    for (const victim of victims) {
      used.delete(indexOf(victim.string));
      const spot = best(note, used, [], at, placed.filter(p => p !== victim), role);
      if (!spot) { used.add(indexOf(victim.string)); continue; }
      if (spot.merge) {
        used.add(indexOf(victim.string));
        const host = placed.find(p => p.midi === spot.midi);
        if (host && host.hand !== note.hand && host.also === undefined) host.also = note.hand;
        skipped.splice(skipped.indexOf(note), 1);
        break;
      }
      placed.splice(placed.indexOf(victim), 1);
      omitted.push({ midi: victim.written, hand: victim.hand });
      put(note, spot);
      skipped.splice(skipped.indexOf(note), 1);
      break;
    }
  }
  for (const note of placed) {
    const index = indexOf(note.string), until = at + note.dur, i = holds.findIndex(h => h.index === index);
    if (i >= 0) { holds[i].until = until; holds[i].fret = note.fret; } else holds.push({ index, until, fret: note.fret });
  }
  return { notes: placed, omitted: [...omitted, ...skipped.map(n => ({ midi: n.midi, hand: n.hand }))] };
}

export function arrangePiece(score: Score): PieceArrangement {
  const holds: Hold[] = [], bars: ArrangedBar[] = [];
  let raised = 0, lowered = 0;
  for (const bar of score.bars) {
    const origin = bar.start / score.ppq, notes = score.notes.filter(n => n.bar === bar.index);
    const ticks = [...new Set(notes.map(n => n.tick))].sort((a, b) => a - b);
    const placed: PlacedNote[] = [], omitted: ArrangedBar['omitted'] = [];
    for (const tick of ticks) {
      const group = notes.filter(n => n.tick === tick), at = origin + tick / score.ppq;
      const chord = parseChord(bar.harmony[0]?.symbol ?? '');
      const third = chord ? [4, 3].map(i => mod12(chord.root + i)).find(pc => chord.tones.includes(pc)) : undefined;
      const got = placeGroup(group, at, holds, score.ppq, third);
      placed.push(...got.notes);
      omitted.push(...got.omitted);
    }
    for (let i = holds.length - 1; i >= 0; i--) if (holds[i].until <= origin + bar.ticks / score.ppq + 1e-6) holds.splice(i, 1);
    for (const n of placed) { if (n.midi > n.written) raised++; else if (n.midi < n.written) lowered++; }
    bars.push({ index: bar.index, notes: placed, omitted });
  }
  const review: string[] = ['Standard tuning, no capo. One pluck never adds a pitch the score does not have there.'];
  if (raised) review.push(`${raised} note${raised === 1 ? '' : 's'} below the low E ${raised === 1 ? 'is' : 'are'} played an octave higher.`);
  if (lowered) review.push(`The melody moves down an octave where the written note sits above the 12th fret (${lowered} note${lowered === 1 ? '' : 's'}), so it can be held with the chord.`);
  const left = bars.flatMap(b => b.omitted.map(n => `bar ${score.bars[b.index].number} ${noteName(n.midi, score.bars[b.index].key)}`));
  if (left.length) review.push(`No free string for ${left.slice(0, 8).join(', ')}${left.length > 8 ? ` and ${left.length - 8} more` : ''}.`);
  review.push('A single string is checked for pitch. Two or more at once are timing only.');
  return { bars, review };
}

const wants = (n: PlacedNote, hands: Hand[]) => hands.includes(n.hand) || (n.also !== undefined && hands.includes(n.also));
const asNote = (n: PlacedNote, hands?: Hand[]): XNote => {
  const hand = !hands || hands.includes(n.hand) ? n.hand : n.also!;
  return { midi: n.midi, hand, dur: n.dur, string: n.string, fret: n.fret, ...(n.also && hands === undefined ? { also: n.also } : {}) };
};

function rhythm(score: Score, arranged: PieceArrangement, bars: number[], hands: Hand[] | 'all'): { events: XEvent[]; marks: Exercise['bars']; chords: Exercise['chords']; beats: number; perBar: number } {
  const events: XEvent[] = [], marks: Exercise['bars'] = [], chords: Exercise['chords'] = [];
  let offset = 0;
  const perBar = score.bars[bars[0]].ticks / score.ppq;
  for (const index of bars) {
    const bar = score.bars[index], span = bar.ticks / score.ppq;
    marks.push({ beat: offset, number: bar.number });
    for (const h of bar.harmony) chords.push({ beat: offset + h.tick / score.ppq, symbol: prettyChord(h.symbol) });
    const groups = new Map<number, PlacedNote[]>();
    for (const n of arranged.bars[index].notes) if (hands === 'all' || wants(n, hands)) {
      const beat = Math.round(n.beat * 960) / 960, list = groups.get(beat) ?? [];
      list.push(n); groups.set(beat, list);
    }
    for (const [beat, notes] of [...groups].sort((a, b) => a[0] - b[0])) {
      const one = notes.length === 1, x = notes.map(n => ({ ...asNote(n, hands === 'all' ? undefined : hands), dur: Math.min(n.dur, span - beat) }));
      events.push({ beat: offset + beat, grade: one ? 'pitch' : 'onset', notes: x, label: one ? (x[0].hand === 'L' ? 'p' : '') : notes.length >= 3 ? 'i m a' : 'pinch' });
    }
    offset += span;
  }
  for (const e of events) for (const n of e.notes) n.dur = Math.max(0.2, Math.min(n.dur, offset - e.beat));
  return { events, marks, chords, beats: offset, perBar };
}

const exerciseOf = (id: string, title: string, keySig: number, perBar: number, beats: number, events: XEvent[], marks: Exercise['bars'], chords: Exercise['chords']): Exercise =>
  ({ id, title, instrument: 'guitar', beatsPerBar: perBar, beats, keySig, events, bars: marks, chords });

/** Pluck every note of the bar alone, low to high, then play the bar. */
function figureExercise(score: Score, arranged: PieceArrangement, index: number, id: string, title: string): Exercise {
  const bar = score.bars[index], perBar = bar.ticks / score.ppq, notes = [...arranged.bars[index].notes].sort((a, b) => a.midi - b.midi || a.string - b.string);
  const pad = Math.max(perBar, Math.ceil(notes.length / perBar) * perBar);
  const broken: XEvent[] = notes.map((n, i) => ({ beat: i, grade: 'pitch' as const, label: 'one string', notes: [{ ...asNote(n), dur: 0.9 }] }));
  const played = rhythm(score, arranged, [index], 'all');
  const events = [...broken, ...played.events.map(e => ({ ...e, beat: e.beat + pad }))];
  const marks = [{ beat: 0, number: bar.number }, { beat: pad, number: bar.number }];
  const chords = bar.harmony.map(h => ({ beat: h.tick / score.ppq, symbol: prettyChord(h.symbol) }));
  return exerciseOf(id, title, bar.key, perBar, pad + perBar, events, marks, [...chords, ...chords.map(c => ({ ...c, beat: c.beat + pad }))]);
}

function scaleLine(tonic: number, mode: DrillMode): { midi: number; string: number; fret: number }[] {
  const up: { midi: number; string: number; fret: number }[] = [];
  let prev = 2;
  for (const step of [...SCALES[mode], 12]) {
    const midi = tonic + step;
    let spot: { index: number; fret: number; score: number } | undefined;
    for (let index = 0; index < 6; index++) {
      const fret = midi - OPEN[index];
      if (fret < 0 || fret > 5) continue;
      const score = fret + Math.abs(index - prev) * 2 + (index < prev ? 4 : 0) + (fret === 0 ? -1 : 0);
      if (!spot || score < spot.score) spot = { index, fret, score };
    }
    if (!spot) continue;
    prev = spot.index;
    up.push({ midi, string: stringOf(spot.index), fret: spot.fret });
  }
  return [...up, ...up.slice(0, -1).reverse()];
}

function scaleStart(tonicPc: number): number {
  for (let midi = 40; midi <= 55; midi++) if (mod12(midi) === mod12(tonicPc)) {
    if (OPEN.some(open => { const fret = midi - open; return fret >= 0 && fret <= 3; })) return midi;
  }
  return 40 + mod12(tonicPc - 40);
}

function drillEvents(kind: 'scale' | 'arpeggio' | 'cadence', tonic: number, mode: DrillMode, keySig: number): { events: XEvent[]; beats: number; perBar: number; chords: Exercise['chords'] } | undefined {
  if (kind === 'cadence') {
    const minor = mode !== 'major', root = mod12(tonic), degrees: [number, string][] = [[0, minor ? 'm' : ''], [5, minor ? 'm' : ''], [7, minor ? '7' : ''], [0, minor ? 'm' : '']];
    const events: XEvent[] = [], chords: Exercise['chords'] = [];
    let offset = 0;
    for (const [step, quality] of degrees) {
      const symbol = chordName(mod12(root + step), quality, mod12(root + step), keySig), choice = shapeFor(symbol, 0, 3);
      if (!choice) return undefined;
      const frets = [...choice.shape.frets].map((c, i) => (c === 'x' ? -1 : Number(c)));
      const strings = frets.map((fret, i) => ({ fret, i })).filter(s => s.fret >= 0);
      chords.push({ beat: offset, symbol: prettyChord(symbol) });
      strings.forEach((s, k) => events.push({ beat: offset + k, grade: 'pitch', label: 'one string', notes: [{ midi: OPEN[s.i] + s.fret, hand: 'R', dur: 0.8, string: stringOf(s.i), fret: s.fret }] }));
      events.push({ beat: offset + strings.length, grade: 'onset', strum: 'D', label: 'strum', notes: strings.map(s => ({ midi: OPEN[s.i] + s.fret, hand: 'R' as const, dur: 1.5, string: stringOf(s.i), fret: s.fret })) });
      offset += 8;
    }
    return { events, beats: offset, perBar: 4, chords };
  }
  const start = scaleStart(tonic);
  const notes = kind === 'arpeggio' ? arpeggioLine(start, mode) : scaleLine(start, mode);
  if (notes.length < 2) return undefined;
  const events = toEvents(notes.map((n, i) => ({ beat: i, midi: n.midi, hand: 'R' as const, dur: i === notes.length - 1 ? 2 : 1, string: n.string, fret: n.fret })), 'pitch');
  const beats = Math.ceil((notes.length + 1) / 4) * 4;
  return { events, beats, perBar: 4, chords: [] };
}

function arpeggioLine(start: number, mode: DrillMode): { midi: number; string: number; fret: number }[] {
  const third = mode === 'major' ? 4 : 3, steps = [0, third, 7, 12];
  const up: { midi: number; string: number; fret: number }[] = [];
  let prev = OPEN.findIndex(open => { const fret = start - open; return fret >= 0 && fret <= 3; });
  if (prev < 0) prev = 2;
  for (const step of steps) {
    const midi = start + step;
    let spot: { index: number; fret: number; score: number } | undefined;
    for (let index = 0; index < 6; index++) {
      const fret = midi - OPEN[index];
      if (fret < 0 || fret > 7) continue;
      const score = fret + Math.abs(index - prev) * 2 + (index < prev ? 3 : 0);
      if (!spot || score < spot.score) spot = { index, fret, score };
    }
    if (!spot) continue;
    prev = spot.index;
    up.push({ midi, string: stringOf(spot.index), fret: spot.fret });
  }
  return [...up, ...up.slice(0, -1).reverse()];
}

export const PIECE_STAGES = ['Hear it', 'The notes', 'Changes', 'Melody', 'Bass and chords', 'Together', 'Joins', 'The piece', 'The key'];

const figureId = (score: Score, index: number) => `gp-fig:${score.bars[index].number}`;
const handId = (hand: Hand, score: Score, from: number, to: number) => `gp-${hand}:${score.bars[from].number}-${score.bars[to].number}`;

export function guitarPieceUnits(score: Score, arranged: PieceArrangement, goalBpm = score.tempo.bpm): Unit[] {
  const units: Unit[] = [], full = LADDER, certify = [0.8, 1], oneHand = full.filter(r => r <= 0.8);
  const key = detectKey(score), home = `${pcName(key.tonic, score.key)} ${key.mode}`;
  units.push({ id: 'gp-listen', kind: 'listen', stage: 0, title: 'Hear it on guitar', goal: `Listen once at ${goalBpm} BPM. This is the piece on six strings: bass, then the chord, with the melody on top.`, why: `${score.meta.title} is in ${home}. ${arranged.review[1] ?? arranged.review[0]}`, bars: score.playOrder, hands: ['L', 'R'], requires: [], rungs: [1], certify: [], goalBpm });

  const printNotes = (notes: PlacedNote[]) => [...notes].sort((a, b) => a.beat - b.beat || a.string - b.string).map(n => `${n.beat}:${n.string}f${n.fret}`).join(' ');
  const seenFig = new Map<string, string>();
  for (const index of score.playOrder) {
    const notes = arranged.bars[index].notes;
    if (!notes.length) continue;
    const print = printNotes(notes);
    if (seenFig.has(print)) continue;
    const id = figureId(score, index);
    seenFig.set(print, id);
    const symbol = score.bars[index].harmony[0]?.symbol;
    units.push({ id, kind: 'chord', stage: 1, title: `${symbol ? prettyChord(symbol) : 'Bar'} · bar ${score.bars[index].number}`, goal: 'Pluck each note alone, quieting it before the next, then play the bar: bass on 1, the chord after it.', why: 'Each string alone is checked for pitch. The chord, several strings at once, is timing only.', bars: [index], hands: ['L', 'R'], requires: [], rungs: full, certify, goalBpm });
  }
  const order = score.playOrder.map(i => arranged.bars[i]).filter(b => b.notes.length);
  const pairs = new Map<string, { ids: [string, string]; bars: [number, number] }>();
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i], ka = seenFig.get(printNotes(a.notes))!, kb = seenFig.get(printNotes(b.notes))!;
    if (ka === kb) continue;
    const key2 = [ka, kb].sort().join(' ↔ ');
    if (!pairs.has(key2)) pairs.set(key2, { ids: [ka, kb], bars: [a.index, b.index] });
  }
  for (const [, { ids: [x, y], bars: [a, b] }] of pairs) {
    units.push({ id: `gp-change:${score.bars[a].number}-${score.bars[b].number}`, kind: 'change', stage: 2, title: `Bar ${score.bars[a].number} → ${score.bars[b].number}`, goal: 'Play one bar, then the other, twice. Move during the last beat and keep any finger that stays.', why: 'The change in the order the piece asks for it.', bars: [a, b, a, b], hands: ['L', 'R'], requires: [{ id: x, at: 0.6 }, { id: y, at: 0.6 }], rungs: full, certify, goalBpm });
  }

  const parts = chunks(score), printOf = (from: number, to: number, hands: Hand[]) => arranged.bars.slice(from, to + 1).map((bar, i) => bar.notes.filter(n => wants(n, hands)).map(n => `${i}:${n.beat}:${n.string}f${n.fret}`).join(' ')).join('|');
  const seen = new Map<string, string>(), together = new Map<(typeof parts)[number], string>();
  const attacks = (from: number, to: number, hand: Hand) => arranged.bars.slice(from, to + 1).reduce((n, bar) => n + new Set(bar.notes.filter(x => wants(x, [hand])).map(x => x.beat)).size, 0);
  for (const chunk of parts) {
    const label = score.bars[chunk.from].number === score.bars[chunk.to].number ? `Bar ${score.bars[chunk.from].number}` : `Bars ${score.bars[chunk.from].number}–${score.bars[chunk.to].number}`;
    const count = { L: attacks(chunk.from, chunk.to, 'L'), R: attacks(chunk.from, chunk.to, 'R') }, ids: Partial<Record<Hand, string>> = {};
    const range = Array.from({ length: chunk.to - chunk.from + 1 }, (_, i) => chunk.from + i);
    for (const hand of ['L', 'R'] as Hand[]) {
      if (!count[hand] || (count[hand] < 3 && count[hand === 'L' ? 'R' : 'L'] > count[hand])) continue;
      const id = handId(hand, score, chunk.from, chunk.to), sameAs = seen.get(`${hand}|${printOf(chunk.from, chunk.to, [hand])}`);
      if (!sameAs) seen.set(`${hand}|${printOf(chunk.from, chunk.to, [hand])}`, id);
      ids[hand] = sameAs ?? id;
      units.push({ id, kind: 'hand', stage: hand === 'L' ? 4 : 3, title: `${label} · ${hand === 'L' ? 'bass and chords' : 'melody'}`, goal: sameAs ? 'Same notes as an earlier passage: practise that one.' : hand === 'R' ? 'The melody alone. Let each note ring for its length.' : 'Bass on beat 1, then the chord. Let the bass ring under it.', why: hand === 'R' ? 'Every melody note is a single string, so its pitch is checked.' : 'The bass note is checked. A chord of several strings is timing only.', bars: range, hands: [hand], requires: [], rungs: oneHand, certify: [0.8], goalBpm, sameAs, difficulty: difficulty(score, chunk.from, chunk.to, [hand], goalBpm) });
    }
    if (!count.L || !count.R) { together.set(chunk, (ids.L ?? ids.R)!); continue; }
    const id = `gp-LR:${score.bars[chunk.from].number}-${score.bars[chunk.to].number}`, sameAs = seen.get(`LR|${printOf(chunk.from, chunk.to, ['L', 'R'])}`);
    if (!sameAs) seen.set(`LR|${printOf(chunk.from, chunk.to, ['L', 'R'])}`, id);
    together.set(chunk, sameAs ?? id);
    units.push({ id, kind: 'together', stage: 5, title: `${label} · melody with the bass`, goal: sameAs ? 'Same notes as an earlier passage: practise that one.' : 'Both parts. The bass and any note on its own are checked; the chord is timing.', why: 'Pitch was learned in the separate parts. Together, the microphone can hear one note at a time.', bars: range, hands: ['L', 'R'], requires: (['L', 'R'] as Hand[]).filter(h => ids[h]).map(h => ({ id: ids[h]!, at: 0.7 })), rungs: full, certify, goalBpm, sameAs, difficulty: difficulty(score, chunk.from, chunk.to, ['L', 'R'], goalBpm) });
  }
  const chunkOf = (bar: number) => parts.find(c => bar >= c.from && bar <= c.to);
  const joins = new Set<string>();
  for (let i = 1; i < score.playOrder.length; i++) {
    const a = score.playOrder[i - 1], b = score.playOrder[i], ca = chunkOf(a), cb = chunkOf(b);
    if (!ca || !cb || (ca === cb && b === a + 1)) continue;
    const id = `gp-seam:${score.bars[a].number}-${score.bars[b].number}`;
    if (joins.has(id) || !together.get(ca) || !together.get(cb)) continue;
    joins.add(id);
    units.push({ id, kind: 'seam', stage: 6, title: `Join bars ${score.bars[a].number} → ${score.bars[b].number}`, goal: b < a ? 'Cross the repeat without stopping.' : 'Cross from one passage into the next without a gap.', why: 'The join is where a passage otherwise grows a pause.', bars: [a, b], hands: ['L', 'R'], requires: [{ id: together.get(ca)!, at: 0.7 }, { id: together.get(cb)!, at: 0.7 }], rungs: full, certify, goalBpm });
  }
  const sections = score.sections.length ? score.sections : [{ name: 'Piece', from: 0, to: score.bars.length - 1, note: '' }];
  for (const section of sections) {
    const inside = parts.filter(c => c.from >= section.from && c.to <= section.to);
    const range = Array.from({ length: section.to - section.from + 1 }, (_, i) => section.from + i);
    units.push({ id: `gp-section:${section.name}`, kind: 'section', stage: 7, title: `${section.name.replace(/(\d)$/, ' $1')} · bars ${score.bars[section.from].number}–${score.bars[section.to].number}`, goal: 'The whole section without stopping. Keep going past a slip.', why: section.note ?? '', bars: range, hands: ['L', 'R'], requires: [...new Set(inside.map(c => together.get(c)!).filter(Boolean))].map(id => ({ id, at: 0.8 })), rungs: full, certify, goalBpm });
  }
  units.push({ id: 'gp-performance', kind: 'performance', stage: 7, title: 'The whole piece', goal: `From the first bar to the last${repeats(score) ? ', with the repeats' : ''} (${score.playOrder.length} bars). No stopping.`, why: 'A run-through of the guitar arrangement.', bars: score.playOrder, hands: ['L', 'R'], requires: sections.map(s => ({ id: `gp-section:${s.name}`, at: 0.88 })), rungs: full.filter(r => r >= 0.8), certify: [1], goalBpm });

  for (const dk of drillKeys(score)) {
    const name = keyLabel(dk.tonic, dk.mode), tag = `${dk.tonic}:${dk.mode}`;
    const specs: ['scale' | 'arpeggio' | 'cadence', string, number][] = dk.optional
      ? [['scale', 'scale, open position', 80]]
      : [['scale', 'scale, open position', 80], ['arpeggio', 'arpeggio, open position', 66], ['cadence', 'cadence, one shape each', 60]];
    for (const [kind, what, bpm] of specs) {
      if (kind !== 'scale' && !drillEvents(kind, scaleStart(dk.tonic), dk.mode, score.key)) continue;
      units.push({ id: `gp-drill:${tag}:${kind}`, kind: 'drill', stage: 8, title: `${name} ${what}`, goal: kind === 'cadence' ? 'Each shape string by string, then one down-strum. Home, away, tension, home.' : 'Even notes in open position, up and back. Every note is checked.', why: dk.reason, bars: [], hands: ['R'], requires: [], rungs: full, certify: [1], goalBpm: bpm, optional: dk.optional });
    }
  }
  return units;
}

export function pieceExercise(score: Score, arranged: PieceArrangement, unit: Unit): Exercise {
  if (unit.id.startsWith('gp-fig:')) return figureExercise(score, arranged, unit.bars[0], unit.id, unit.title);
  if (unit.id.startsWith('gp-drill:')) {
    const [, tonic, mode, kind] = unit.id.split(':') as [string, string, DrillMode, 'scale' | 'arpeggio' | 'cadence'];
    const built = drillEvents(kind, scaleStart(Number(tonic)), mode, score.key)!;
    const marks = Array.from({ length: Math.ceil(built.beats / built.perBar) }, (_, i) => ({ beat: i * built.perBar, number: i + 1 }));
    return exerciseOf(unit.id, unit.title, score.key, built.perBar, built.beats, built.events, marks, built.chords);
  }
  const hands: Hand[] | 'all' = unit.hands.length === 2 || unit.kind === 'listen' || unit.kind === 'section' || unit.kind === 'performance' || unit.kind === 'seam' || unit.kind === 'change' ? 'all' : unit.hands;
  const played = rhythm(score, arranged, unit.bars, unit.kind === 'hand' ? unit.hands : hands);
  return exerciseOf(unit.id, unit.title, score.bars[unit.bars[0]].key, played.perBar, played.beats, played.events, played.marks, played.chords);
}

/** The other guitar layer, for headphones under a one-part step. */
export function otherLayer(score: Score, arranged: PieceArrangement, bars: number[], hand: Hand): XEvent[] {
  return rhythm(score, arranged, bars, [hand === 'L' ? 'R' : 'L']).events;
}
