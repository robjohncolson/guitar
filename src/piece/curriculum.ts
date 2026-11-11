import { chordSpans, chunks, detectKey, difficulty, drillKeys, fingerprint, prettyChord, type Chunk } from './analysis';
import { chordExercise, fromBars, gripsInBar, type Exercise } from './exercise';
import { drillExercise, keyLabel, type DrillSpec } from './drills';
import { noteName, pcName, type Hand, type Score } from './score';

/** Tempo rungs as fractions of the goal tempo. Support fades only at the certification rungs. */
export const LADDER = [0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1];
export type UnitKind = 'listen' | 'chord' | 'change' | 'hand' | 'together' | 'seam' | 'section' | 'performance' | 'drill';
export const STAGES = ['Hear the piece', 'Chords', 'Chord changes', 'Left hand', 'Right hand', 'Hands together', 'Joins', 'Sections and the whole piece', 'Key drills'];
export interface Unit {
  id: string; kind: UnitKind; stage: number; title: string; goal: string; why: string;
  bars: number[]; hands: Hand[]; requires: { id: string; at: number }[];
  rungs: number[]; certify: number[]; goalBpm: number;
  /** Identical material taught by another unit: practise that one instead. */
  sameAs?: string; drill?: DrillSpec; difficulty?: { value: number; reasons: string[] }; optional?: boolean;
}
export interface Curriculum { title: string; key: string; goalBpm: number; units: Unit[]; summary: string[] }

const range = (score: Score, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(i => i < score.bars.length);
const barsLabel = (score: Score, from: number, to: number) => from === to ? `Bar ${score.bars[from].number}` : `Bars ${score.bars[from].number}–${score.bars[to].number}`;
const handLabel = (hands: Hand[]) => hands.length === 2 ? 'hands together' : hands[0] === 'L' ? 'left hand' : 'right hand';

/** True when the performance replays bars (repeats, endings, D.C. or D.S.). */
export const repeats = (score: Score) => score.playOrder.length !== score.bars.length || score.playOrder.some((b, i) => b !== i);

export function buildCurriculum(score: Score, goalBpm = score.tempo.bpm): Curriculum {
  const units: Unit[] = [], key = detectKey(score), keyText = `${pcName(key.tonic, score.key)} ${key.mode}`;
  const full = LADDER, certify = [0.8, 1];
  units.push({ id: 'listen', kind: 'listen', stage: 0, title: 'Hear the whole piece', goal: `Listen once at ${goalBpm} BPM with the notes moving. Notice where each section starts.`, why: `${score.meta.title} is in ${keyText} (${key.reason}).`, bars: score.playOrder, hands: ['L', 'R'], requires: [], rungs: [1], certify: [], goalBpm });

  // Chords: every harmony in the piece, in each distinct voicing the hands must grab (two at most per name).
  const spans = chordSpans(score), inOrder = score.playOrder.flatMap(i => spans.filter(s => s.bar === i));
  const chordBars = new Map<string, number[]>(), voicings = new Map<string, Set<string>>();
  for (const span of inOrder) {
    const hands = gripsInBar(score, span.bar).map(g => g.hand);
    if (!hands.length || !span.chord) continue;
    const print = fingerprint(score, span.bar, span.bar, hands), seen = voicings.get(span.symbol) ?? new Set();
    if (!seen.has(print) && seen.size < 2) { seen.add(print); chordBars.set(span.symbol, [...(chordBars.get(span.symbol) ?? []), span.bar]); }
    voicings.set(span.symbol, seen);
  }
  // A hand's notes in a bar, onset by onset: "G2 · B3 D4 F♯4".
  const handText = (bar: number, hand: Hand) => {
    const onsets = new Map<number, string[]>();
    for (const n of score.notes) if (n.bar === bar && n.hand === hand) onsets.set(n.tick, [...(onsets.get(n.tick) ?? []), noteName(n.midi, score.bars[bar].key)]);
    return [...onsets.entries()].sort((a, b) => a[0] - b[0]).map(([, names]) => names.join(' ')).join(' · ');
  };
  for (const [symbol, bars] of chordBars) {
    const shapes = bars.map(bar => gripsInBar(score, bar).map(g => `${g.hand === 'L' ? 'Left hand' : 'Right hand'}: ${handText(bar, g.hand)}`).join('. '));
    const count = spans.filter(s => s.symbol === symbol).length;
    units.push({ id: `chord:${symbol}`, kind: 'chord', stage: 1, title: `${prettyChord(symbol)} chord`, goal: `Play it as in bar ${score.bars[bars[0]].number}, then one note at a time, bottom to top, so each note can be heard.`, why: `${shapes.join('. Also: ')}. It occurs in ${count} bar${count === 1 ? '' : 's'}.`, bars, hands: [...new Set(bars.flatMap(b => gripsInBar(score, b).map(g => g.hand)))].sort() as Hand[], requires: [], rungs: full, certify, goalBpm });
  }
  // Changes: each pair of neighbouring chords once, in the order the piece first asks for them.
  const pairs = new Map<string, [number, number]>();
  for (let i = 1; i < inOrder.length; i++) {
    const a = inOrder[i - 1], b = inOrder[i];
    if (a.symbol === b.symbol || !chordBars.has(a.symbol) || !chordBars.has(b.symbol) || a.bar === b.bar) continue;
    const id = [a.symbol, b.symbol].sort().join(' ↔ ');
    if (!pairs.has(id)) pairs.set(id, [a.bar, b.bar]);
  }
  for (const [id, [a, b]] of pairs) {
    const hands = [...new Set([a, b].flatMap(bar => gripsInBar(score, bar).map(g => g.hand)))].sort() as Hand[];
    const [first, second] = [spans.find(s => s.bar === a)!.symbol, spans.find(s => s.bar === b)!.symbol];
    units.push({ id: `change:${id}`, kind: 'change', stage: 2, title: `${prettyChord(first)} → ${prettyChord(second)}`, goal: `Move between the two shapes from bars ${score.bars[a].number} and ${score.bars[b].number}. Prepare the next shape during the rest or long note.`, why: 'Changes are where most hesitations happen. Short alternations make them automatic.', bars: [a, b, a, b], hands, requires: [{ id: `chord:${first}`, at: 0.6 }, { id: `chord:${second}`, at: 0.6 }], rungs: full, certify, goalBpm });
  }

  // Passages: phrase-aware chunks per hand, then together. Identical material is practised once.
  const parts = chunks(score), seen = new Map<string, string>(), together = new Map<Chunk, string>();
  const sectionNote = (name: string) => score.sections.find(s => s.name === name)?.note ?? '';
  for (const chunk of parts) {
    const label = barsLabel(score, chunk.from, chunk.to), ids: Partial<Record<'L' | 'R', string>> = {};
    const attacks = (hand: Hand) => new Set(score.notes.filter(n => n.bar >= chunk.from && n.bar <= chunk.to && n.hand === hand).map(n => `${n.bar}:${n.tick}`)).size;
    const count = { L: attacks('L'), R: attacks('R') };
    for (const hand of ['L', 'R'] as Hand[]) {
      // A pickup or a lone chord under a busy other hand is learned hands together, not as a step of its own.
      if (!count[hand] || (count[hand] < 3 && count[hand === 'L' ? 'R' : 'L'] > count[hand])) continue;
      const id = `${hand}:${score.bars[chunk.from].number}-${score.bars[chunk.to].number}`, print = `${hand}|${fingerprint(score, chunk.from, chunk.to, [hand])}`;
      const sameAs = seen.get(print);
      if (!sameAs) seen.set(print, id);
      ids[hand] = sameAs ?? id;
      units.push({ id, kind: 'hand', stage: hand === 'L' ? 3 : 4, title: `${label} · ${handLabel([hand])}`, goal: sameAs ? 'Same notes as an earlier passage: practise that one.' : `Play the ${handLabel([hand])} alone, keeping the count going through rests and held notes.`, why: sectionNote(chunk.section), bars: range(score, chunk.from, chunk.to), hands: [hand], requires: [], rungs: full.filter(r => r <= 0.8), certify: [0.8], goalBpm, sameAs, difficulty: difficulty(score, chunk.from, chunk.to, [hand], goalBpm) });
    }
    if (!count.L || !count.R) { together.set(chunk, (ids.L ?? ids.R)!); continue; }
    const id = `LR:${score.bars[chunk.from].number}-${score.bars[chunk.to].number}`, print = `LR|${fingerprint(score, chunk.from, chunk.to, ['L', 'R'])}`, sameAs = seen.get(print);
    if (!sameAs) seen.set(print, id);
    together.set(chunk, sameAs ?? id);
    units.push({ id, kind: 'together', stage: 5, title: `${label} · hands together`, goal: sameAs ? 'Same notes as an earlier passage: practise that one.' : 'Both hands. Keep the left-hand chord soft under the melody.', why: sectionNote(chunk.section), bars: range(score, chunk.from, chunk.to), hands: ['L', 'R'], requires: (['L', 'R'] as Hand[]).filter(h => ids[h]).map(h => ({ id: ids[h]!, at: 0.7 })), rungs: full, certify, goalBpm, sameAs, difficulty: difficulty(score, chunk.from, chunk.to, ['L', 'R'], goalBpm) });
  }
  // Joins: the last bar of one passage and the first of the next, wherever the performance crosses a boundary.
  const chunkOf = (bar: number) => parts.find(c => bar >= c.from && bar <= c.to)!;
  const joins = new Set<string>();
  for (let i = 1; i < score.playOrder.length; i++) {
    const a = score.playOrder[i - 1], b = score.playOrder[i], ca = chunkOf(a), cb = chunkOf(b);
    if (ca === cb && b === a + 1) continue;
    const id = `seam:${score.bars[a].number}-${score.bars[b].number}`;
    if (joins.has(id)) continue;
    joins.add(id);
    units.push({ id, kind: 'seam', stage: 6, title: `Join bars ${score.bars[a].number} → ${score.bars[b].number}`, goal: b < a ? 'Cross the repeat without stopping: the end of one pass into the start of the next.' : 'Cross from one passage into the next without a gap.', why: 'Joins are practised separately so each passage does not end with a pause.', bars: [a, b], hands: ['L', 'R'], requires: [{ id: together.get(ca)!, at: 0.7 }, { id: together.get(cb)!, at: 0.7 }], rungs: full, certify, goalBpm });
  }
  // Sections, then the whole performance including repeats.
  const sections = score.sections.length ? score.sections : [{ name: 'Piece', from: 0, to: score.bars.length - 1, note: '' }];
  for (const section of sections) {
    const inside = parts.filter(c => c.from >= section.from && c.to <= section.to);
    units.push({ id: `section:${section.name}`, kind: 'section', stage: 7, title: `${section.name.replace(/(\d)$/, ' $1')} · ${barsLabel(score, section.from, section.to).toLowerCase()}`, goal: 'Play the whole section without stopping. Keep going past small slips.', why: section.note ?? '', bars: range(score, section.from, section.to), hands: ['L', 'R'], requires: [...new Set(inside.map(c => together.get(c)!))].map(id => ({ id, at: 0.8 })), rungs: full, certify, goalBpm });
  }
  units.push({ id: 'performance', kind: 'performance', stage: 7, title: 'The whole piece', goal: `From the first bar to the last${repeats(score) ? ', with the repeats' : ''} (${score.playOrder.length} bars). No stopping.`, why: 'A performance run-through. Mistakes are information for tomorrow, not a reason to restart.', bars: score.playOrder, hands: ['L', 'R'], requires: sections.map(s => ({ id: `section:${s.name}`, at: 0.88 })), rungs: full.filter(r => r >= 0.8), certify: [1], goalBpm });

  // Drills in the key, plus keys the music borrows.
  for (const dk of drillKeys(score)) {
    const name = keyLabel(dk.tonic, dk.mode), tag = `${dk.tonic}:${dk.mode}`;
    const specs: [DrillSpec, string, number][] = dk.optional
      ? [[{ kind: 'scale', tonic: dk.tonic, mode: dk.mode, hands: ['L', 'R'], octaves: 1 }, 'scale, hands together', 96], [{ kind: 'arpeggio', tonic: dk.tonic, mode: dk.mode === 'major' ? 'major' : 'natural', hands: ['R'], octaves: 2 }, 'arpeggio, right hand', 66]]
      : [[{ kind: 'scale', tonic: dk.tonic, mode: dk.mode, hands: ['R'], octaves: 1 }, 'scale, right hand', 96], [{ kind: 'scale', tonic: dk.tonic, mode: dk.mode, hands: ['L'], octaves: 1 }, 'scale, left hand', 96],
        [{ kind: 'scale', tonic: dk.tonic, mode: dk.mode, hands: ['L', 'R'], octaves: 1 }, 'scale, hands together', 96], [{ kind: 'scale', tonic: dk.tonic, mode: dk.mode, hands: ['L', 'R'], octaves: 2 }, 'two octaves, hands together', 72],
        [{ kind: 'arpeggio', tonic: dk.tonic, mode: dk.mode, hands: ['R'], octaves: 2 }, 'arpeggio, right hand', 66], [{ kind: 'arpeggio', tonic: dk.tonic, mode: dk.mode, hands: ['L'], octaves: 2 }, 'arpeggio, left hand', 66],
        [{ kind: 'cadence', tonic: dk.tonic, mode: dk.mode, hands: ['L', 'R'], octaves: 1 }, 'cadence I–IV–V–I', 72]];
    for (const [drill, what, bpm] of specs) units.push({ id: `drill:${tag}:${drill.kind}:${drill.hands.join('')}:${drill.octaves}`, kind: 'drill', stage: 8, title: `${name} ${what}`, goal: drill.kind === 'cadence' ? 'Block chords over their bass notes: home, away, tension, home.' : 'Even notes, suggested fingering shown on each key. Up and back down.', why: dk.reason, bars: [], hands: drill.hands, requires: [], rungs: full, certify: [1], goalBpm: bpm, drill, optional: dk.optional });
  }
  const summary = [`${score.meta.title}${score.meta.composer ? ` · ${score.meta.composer}` : ''}`, `${keyText} · ${score.bars[0].num}/${score.bars[0].den} · ${repeats(score) ? `${score.bars.length} written bars, ${score.playOrder.length} with the repeats` : `${score.bars.length} bars`}`, `${chordBars.size} chords, ${pairs.size} changes, ${parts.length} passages, ${sections.length} sections`];
  return { title: score.meta.title, key: keyText, goalBpm, units, summary };
}

/** The take a unit asks for. */
export function exerciseFor(score: Score, unit: Unit): Exercise {
  if (unit.drill) return drillExercise(unit.drill, unit.id, unit.title);
  if (unit.kind === 'chord') return chordExercise(score, unit.bars, unit.id, unit.title);
  // Change drills use only the chord-carrying hands; the melody in those bars belongs to passage practice.
  return fromBars(score, unit.bars, unit.hands, unit.id, unit.title);
}

export const unitById = (curriculum: Curriculum, id: string) => curriculum.units.find(u => u.id === id);
