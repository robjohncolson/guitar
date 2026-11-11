import { performedBeat, verticals, type Hand, type Score, type ScoreNote } from './score';

/** One practice take: what to play, beat by beat. Beats are quarter notes from the first downbeat. */
export interface XNote {
  midi: number; hand: Hand; dur: number; finger?: number;
  /** Guitar position for the lane and chord boxes. */
  string?: number; fret?: number;
}
export interface XEvent {
  beat: number; notes: XNote[];
  /** How the take is judged here: pitch evidence per note, the attack time only, or not at all. */
  grade: 'pitch' | 'onset' | 'none';
  strum?: 'D' | 'U'; label?: string;
}
export interface Exercise {
  id: string; title: string; instrument: 'piano' | 'guitar'; beatsPerBar: number; beats: number; keySig: number;
  events: XEvent[]; bars: { beat: number; number: number }[]; chords: { beat: number; symbol: string }[];
  /** Guitar arrangements: capo and the shapes in this take. */
  capo?: number; shapes?: { beat: number; name: string; frets: string; fingers: string }[];
}

/** Group simultaneous notes into events; a chord is one attack. */
export function toEvents(notes: (XNote & { beat: number })[], grade: XEvent['grade'] = 'pitch'): XEvent[] {
  const map = new Map<number, XEvent>();
  for (const { beat, ...note } of notes) {
    const key = Math.round(beat * 960) / 960, event = map.get(key) ?? { beat: key, notes: [], grade };
    event.notes.push(note); map.set(key, event);
  }
  return [...map.values()].sort((a, b) => a.beat - b.beat).map(e => ({ ...e, notes: e.notes.sort((a, b) => a.midi - b.midi) }));
}

/** When a note sounds and for how long, in beats from the take's start: swung bars delay their off-beat eighths. */
function timing(score: Score, n: ScoreNote, offset: number): { beat: number; dur: number } {
  const bar = score.bars[n.bar], start = performedBeat(bar, n.tick, score.ppq), end = n.tick + n.dur <= bar.ticks ? performedBeat(bar, n.tick + n.dur, score.ppq) : (n.tick + n.dur) / score.ppq;
  return { beat: offset + start, dur: Math.max(0.05, end - start) };
}
/** Concatenate written bars (in the given order) for the given hands. Notes are clipped at the end of the take. */
export function fromBars(score: Score, bars: number[], hands: Hand[], id: string, title: string): Exercise {
  const notes: (XNote & { beat: number })[] = [], marks: Exercise['bars'] = [], chords: Exercise['chords'] = [];
  let offset = 0;
  for (const index of bars) {
    const bar = score.bars[index];
    marks.push({ beat: offset, number: bar.number });
    for (const h of bar.harmony) chords.push({ beat: offset + h.tick / score.ppq, symbol: h.symbol });
    for (const n of score.notes) if (n.bar === index && hands.includes(n.hand)) notes.push({ ...timing(score, n, offset), midi: n.midi, hand: n.hand, finger: n.finger });
    offset += bar.ticks / score.ppq;
  }
  for (const n of notes) n.dur = Math.min(n.dur, offset - n.beat);
  const first = score.bars[bars[0]];
  return { id, title, instrument: 'piano', beatsPerBar: first.ticks / score.ppq, beats: offset, keySig: first.key, events: toEvents(notes), bars: marks, chords };
}

/**
 * The hand shapes a chord bar asks for: the largest simultaneous group per hand, or a broken-chord figure blocked
 * together (three to five pitches inside an octave, at least a third apart). A stepwise melody is not a grip.
 */
export function gripsInBar(score: Score, bar: number): { hand: Hand; midis: number[] }[] {
  const result: { hand: Hand; midis: number[] }[] = [];
  for (const hand of ['L', 'R'] as Hand[]) {
    const vs = verticals(score.notes.filter(n => n.bar === bar && n.hand === hand));
    const widest = vs.reduce((a, v) => (v.notes.length > a.length ? v.notes.map(n => n.midi) : a), [] as number[]);
    if (widest.length >= 2) { result.push({ hand, midis: widest }); continue; }
    const pitches = [...new Set(vs.flatMap(v => v.notes.map(n => n.midi)))].sort((a, b) => a - b);
    const leaps = pitches.every((p, i) => i === 0 || p - pitches[i - 1] >= 3);
    if (pitches.length >= 3 && pitches.length <= 5 && pitches[pitches.length - 1] - pitches[0] <= 12 && leaps) result.push({ hand, midis: pitches });
  }
  return result;
}

/** Practise a chord as written, then one tone at a time so each tone can be heard and checked. */
export function chordExercise(score: Score, bars: number[], id: string, title: string): Exercise {
  const written = (bar: number) => {
    const hands = gripsInBar(score, bar).map(g => g.hand);
    return score.notes.filter(n => n.bar === bar && hands.includes(n.hand));
  };
  const beatsPerBar = score.bars[bars[0]].ticks / score.ppq, notes: (XNote & { beat: number })[] = [], marks: Exercise['bars'] = [], chords: Exercise['chords'] = [];
  let offset = 0;
  const addWritten = (bar: number) => {
    marks.push({ beat: offset, number: score.bars[bar].number });
    for (const h of score.bars[bar].harmony) chords.push({ beat: offset + h.tick / score.ppq, symbol: h.symbol });
    for (const n of written(bar)) { const t = timing(score, n, offset); notes.push({ ...t, dur: Math.min(t.dur, offset + beatsPerBar - t.beat), midi: n.midi, hand: n.hand, finger: n.finger }); }
    offset += beatsPerBar;
  };
  const addBroken = (bar: number) => {
    const tones = gripsInBar(score, bar).flatMap(g => g.midis.map(midi => ({ midi, hand: g.hand }))).sort((a, b) => a.midi - b.midi);
    const length = Math.max(1, Math.ceil(tones.length / beatsPerBar)) * beatsPerBar;
    marks.push({ beat: offset, number: score.bars[bar].number });
    tones.forEach((t, i) => notes.push({ beat: offset + i, midi: t.midi, hand: t.hand, dur: 1 }));
    offset += length;
  };
  for (const bar of bars.length === 1 ? [bars[0], bars[0]] : bars) { addWritten(bar); addBroken(bar); }
  addWritten(bars[0]);
  return { id, title, instrument: 'piano', beatsPerBar, beats: offset, keySig: score.bars[bars[0]].key, events: toEvents(notes), bars: marks, chords };
}
