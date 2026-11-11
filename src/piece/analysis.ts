import { mod12, pcName, verticals, type Hand, type Score, type ScoreNote } from './score';

/** Deterministic analysis of a compiled score. Authored labels win; automatic ones are suggestions with reasons. */
export const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], '5': [0, 7],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], mmaj7: [0, 3, 7, 11],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  add9: [0, 4, 7, 2], madd9: [0, 3, 7, 2], '9': [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2], m9: [0, 3, 7, 10, 2], m7b9: [0, 3, 7, 10, 1], '7b9': [0, 4, 7, 10, 1],
};
const ALIASES: Record<string, string> = { M: '', maj: '', min: 'm', '-': 'm', '+': 'aug', sus: 'sus4', ø: 'm7b5', o: 'dim', o7: 'dim7', M7: 'maj7', 'Δ': 'maj7', 'm(maj7)': 'mmaj7' };
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export interface ChordSymbol { symbol: string; root: number; quality: string; bass: number; tones: number[] }

/** "N.C." marks a bar with no chord: no chord step, no guitar strum. */
export const noChord = (symbol: string) => /^n\.?\s*c\.?$/i.test(symbol.trim());
export function parseChord(symbol: string): ChordSymbol | undefined {
  const m = /^([A-G])([#♯b♭]?)([^/]*)(?:\/([A-G])([#♯b♭]?))?$/.exec(symbol.trim());
  if (!m) return undefined;
  const alter = (s: string) => (s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0);
  const root = mod12(LETTER[m[1]] + alter(m[2]));
  const quality = ALIASES[m[3]] ?? m[3];
  if (!(quality in QUALITIES)) return undefined;
  const bass = m[4] ? mod12(LETTER[m[4]] + alter(m[5])) : root;
  const tones = [...new Set([...QUALITIES[quality].map(i => mod12(root + i)), bass])];
  return { symbol, root, quality, bass, tones };
}
/** Display form: G#m7b5 -> G♯m7♭5. */
export const prettyChord = (symbol: string) => symbol.replace(/^([A-G])b/, '$1♭').replace(/\/([A-G])b/, '/$1♭').replace(/b(?=\d)/g, '♭').replace(/#/g, '♯');
export const chordName = (root: number, quality: string, bass: number, key = 0) =>
  `${pcName(root, key)}${quality}${bass !== root ? `/${pcName(bass, key)}` : ''}`.replace(/♯/g, '#').replace(/♭/g, 'b');

/** Note-time per pitch class sounding in [start, end) written ticks, with the lowest sounding pitch class. */
function sounding(score: Score, start: number, end: number) {
  const weight = new Array(12).fill(0);
  let bass = Infinity, total = 0;
  for (const n of score.notes) {
    const a = score.bars[n.bar].start + n.tick, b = a + n.dur, overlap = Math.min(b, end) - Math.max(a, start);
    if (overlap <= 0) continue;
    weight[mod12(n.midi)] += overlap; total += overlap; bass = Math.min(bass, n.midi);
  }
  return { weight: weight.map(w => (total ? w / total : 0)), bass: Number.isFinite(bass) ? mod12(bass) : -1 };
}

/** Share of the span's note-time that the chord explains: low values mean the label does not fit the notes. */
export function chordFit(score: Score, start: number, end: number, chord: ChordSymbol): number {
  const { weight } = sounding(score, start, end);
  return chord.tones.reduce((sum, pc) => sum + weight[pc], 0);
}

/** Template match after Pardo & Birmingham: matched weight minus unmatched and missing tones, with a bass-root bonus. */
export function recognise(score: Score, start: number, end: number): { symbol: string; confidence: number } {
  const { weight, bass } = sounding(score, start, end);
  let best = { symbol: '', score: -Infinity }, second = -Infinity;
  for (let root = 0; root < 12; root++) for (const [quality, intervals] of Object.entries(QUALITIES)) {
    if (quality === '5' || intervals.length > 4) continue;
    const tones = intervals.map(i => mod12(root + i)), matched = tones.reduce((s, pc) => s + weight[pc], 0);
    const missing = tones.filter(pc => weight[pc] < 0.02).length;
    const tier2 = ['sus2', 'sus4', '7sus4', '6', 'm6', 'add9', 'madd9', 'mmaj7', 'aug'].includes(quality);
    const s = matched - (1 - matched) - 0.22 * missing - (tier2 ? 0.12 : 0) - (tones.length > 3 ? 0.04 : 0) + (bass === root ? 0.12 : 0) - (bass >= 0 && !tones.includes(bass) ? 0.12 : 0);
    if (s > best.score) { second = best.score; best = { symbol: chordName(root, quality, bass >= 0 && tones.includes(bass) ? bass : root, score.key), score: s }; }
    else if (s > second) second = s;
  }
  return { symbol: best.symbol, confidence: Math.max(0, Math.min(1, (best.score - second) * 4)) };
}

export interface ChordSpan { bar: number; tick: number; dur: number; symbol: string; chord?: ChordSymbol; source: 'score' | 'auto'; fit: number; confidence: number }
export function chordSpans(score: Score): ChordSpan[] {
  const spans: ChordSpan[] = [];
  // As on a lead sheet, a chord symbol (or N.C.) lasts until the next one. Only bars before the first symbol, or in a
  // piece with none, are named from their notes.
  let held: string | undefined;
  for (const bar of score.bars) {
    const labels = bar.harmony.length ? bar.harmony : held ? [{ tick: 0, symbol: held }] : [];
    if (labels.length) held = labels[labels.length - 1].symbol;
    if (!labels.length) {
      const { symbol, confidence } = recognise(score, bar.start, bar.start + bar.ticks);
      const chord = parseChord(symbol);
      spans.push({ bar: bar.index, tick: 0, dur: bar.ticks, symbol, chord, source: 'auto', fit: chord ? chordFit(score, bar.start, bar.start + bar.ticks, chord) : 0, confidence });
      continue;
    }
    labels.forEach((h, i) => {
      const end = labels[i + 1]?.tick ?? bar.ticks, chord = parseChord(h.symbol);
      spans.push({ bar: bar.index, tick: h.tick, dur: end - h.tick, symbol: h.symbol, chord, source: 'score', fit: chord ? chordFit(score, bar.start + h.tick, bar.start + end, chord) : 0, confidence: 1 });
    });
  }
  return spans;
}

/** Key from the signature, choosing major or relative minor by the final bass and cadential evidence unless authored. */
export function detectKey(score: Score): { tonic: number; mode: 'major' | 'minor'; reason: string } {
  const major = mod12(score.key * 7), minor = mod12(major + 9);
  if (score.mode) return { tonic: score.mode === 'major' ? major : minor, mode: score.mode, reason: 'stated in the piece file' };
  const last = score.bars[score.playOrder[score.playOrder.length - 1]];
  const lowest = score.notes.filter(n => n.bar === last.index).sort((a, b) => a.midi - b.midi)[0];
  const raised = score.notes.filter(n => mod12(n.midi) === mod12(minor + 11)).length, plain = score.notes.filter(n => mod12(n.midi) === mod12(minor + 10)).length;
  if (lowest && mod12(lowest.midi) === minor || raised > plain * 1.5 && raised >= 3) return { tonic: minor, mode: 'minor', reason: lowest && mod12(lowest.midi) === minor ? 'the piece ends on the minor tonic' : 'the raised leading tone is frequent' };
  return { tonic: major, mode: 'major', reason: 'the key signature and closing bass' };
}

/** Distinct simultaneous shapes per hand, with where they occur. */
export interface Grip { hand: Hand; midis: number[]; bars: number[]; count: number }
export function grips(score: Score): Grip[] {
  const map = new Map<string, Grip>();
  for (const v of verticals(score.notes)) {
    if (v.notes.length < 2) continue;
    const midis = v.notes.map(n => n.midi), key = `${v.hand}:${midis.join(',')}`;
    const grip = map.get(key) ?? { hand: v.hand, midis, bars: [], count: 0 };
    grip.count++; if (!grip.bars.includes(v.bar)) grip.bars.push(v.bar);
    map.set(key, grip);
  }
  return [...map.values()];
}

/** A hand's content in bars [from, to], relative to the first bar: equal strings mean the same practice material. */
export function fingerprint(score: Score, from: number, to: number, hands: Hand[]): string {
  const origin = score.bars[from].start;
  return score.notes.filter(n => n.bar >= from && n.bar <= to && hands.includes(n.hand))
    .map(n => `${n.hand}${score.bars[n.bar].start + n.tick - origin}:${n.midi}:${n.dur}`).sort().join(' ');
}

/** Phrase-aware chunks inside each section: prefer ends after long melody notes, never split a held note. */
export interface Chunk { from: number; to: number; section: string }
export function chunks(score: Score, maxBeats = 16): Chunk[] {
  const result: Chunk[] = [];
  const sections = score.sections.length ? score.sections : [{ name: 'Piece', from: 0, to: score.bars.length - 1 }];
  for (const section of sections) {
    const bars = score.bars.slice(section.from, section.to + 1);
    const beats = bars[0].ticks / score.ppq, maxBars = Math.max(1, Math.min(4, Math.floor(maxBeats / beats))), target = maxBars;
    const boundary = (index: number): number => { // score for ending a chunk after bar `index`
      const bar = score.bars[index], end = bar.start + bar.ticks;
      if (index === section.to) return 0;
      if (score.notes.some(n => score.bars[n.bar].start + n.tick < end && score.bars[n.bar].start + n.tick + n.dur > end + score.ppq / 4)) return -3;
      const top = score.notes.filter(n => n.bar === index && n.hand === 'R').sort((a, b) => b.tick - a.tick)[0];
      const nextTop = score.notes.filter(n => n.bar === index + 1 && n.hand === 'R').sort((a, b) => a.tick - b.tick)[0];
      return (top && top.dur >= 2 * score.ppq ? 2 : 0) + (!nextTop || nextTop.tick > 0 ? 1 : 0);
    };
    const n = bars.length, best: { cost: number; cut: number }[] = [{ cost: 0, cut: -1 }];
    for (let i = 1; i <= n; i++) {
      best[i] = { cost: Infinity, cut: 0 };
      for (let size = 1; size <= Math.min(maxBars, i); size++) {
        const cost = best[i - size].cost + Math.abs(target - size) * 0.8 + (size === 1 && n > 1 ? 2 : 0) - boundary(section.from + i - 1);
        if (cost < best[i].cost) best[i] = { cost, cut: i - size };
      }
    }
    const cuts: number[] = [];
    for (let i = n; i > 0; i = best[i].cut) cuts.unshift(best[i].cut);
    cuts.forEach((cut, k) => result.push({ from: section.from + cut, to: section.from + (cuts[k + 1] ?? n) - 1, section: section.name }));
  }
  return result;
}

/** Transparent within-piece difficulty: rank chunks, show reasons, never claim a grade. */
export function difficulty(score: Score, from: number, to: number, hands: Hand[], bpm: number): { value: number; reasons: string[] } {
  const notes = score.notes.filter(n => n.bar >= from && n.bar <= to && hands.includes(n.hand));
  if (!notes.length) return { value: 0, reasons: [] };
  const seconds = (score.bars[to].start + score.bars[to].ticks - score.bars[from].start) / score.ppq * 60 / bpm;
  const onsets = new Set(notes.map(n => `${n.hand}${n.bar}:${n.tick}`)).size;
  const speed = Math.min(1, Math.max(0, (onsets / seconds - 1) / 5));
  let span = 0, leap = 0;
  for (const v of verticals(notes)) span = Math.max(span, v.notes[v.notes.length - 1].midi - v.notes[0].midi);
  for (const hand of hands) {
    const line = verticals(notes.filter(n => n.hand === hand));
    for (let i = 1; i < line.length; i++) leap = Math.max(leap, Math.abs(line[i].notes[0].midi - line[i - 1].notes[0].midi));
  }
  const chordy = notes.length / onsets;
  const accidentals = notes.filter(n => !inKey(n.midi, score.key)).length / notes.length;
  const parts: [number, string][] = [[speed, 'many notes per second'], [Math.min(1, Math.max(0, (span - 7) / 7)), `stretch of ${span} semitones`], [Math.min(1, leap / 24), `leaps up to ${leap} semitones`], [Math.min(1, (chordy - 1) / 3), 'chords to grab'], [Math.min(1, accidentals / 0.3), 'notes outside the key signature']];
  const value = parts.reduce((s, p) => s + p[0], 0) / parts.length;
  return { value, reasons: parts.filter(p => p[0] >= 0.35).sort((a, b) => b[0] - a[0]).slice(0, 2).map(p => p[1]) };
}
export const inKey = (midi: number, fifths: number) => { const pcs = Array.from({ length: 7 }, (_, i) => mod12((fifths - 1 + i) * 7)); return pcs.includes(mod12(midi)); };

/** Scale material: tonic key, plus keys the accidentals imply (relative/parallel minor colours). */
export interface DrillKey { tonic: number; mode: 'major' | 'harmonic' | 'natural'; reason: string; optional: boolean }
export function drillKeys(score: Score): DrillKey[] {
  const key = detectKey(score), keys: DrillKey[] = [{ tonic: key.tonic, mode: key.mode === 'major' ? 'major' : 'harmonic', reason: `the home key, ${pcName(key.tonic, score.key)} ${key.mode}`, optional: false }];
  const bars = (pc: number) => new Set(score.notes.filter(n => mod12(n.midi) === pc).map(n => n.bar)).size;
  if (key.mode === 'major') {
    const flat3 = mod12(key.tonic + 3), flat6 = mod12(key.tonic + 8), flat7 = mod12(key.tonic + 10);
    if (bars(flat3) >= 3) keys.push({ tonic: key.tonic, mode: 'natural', reason: `${pcName(flat3, -1)} appears in ${bars(flat3)} bars: the music borrows from ${pcName(key.tonic, score.key)} minor`, optional: true });
    else if (bars(flat7) >= 3 || bars(flat6) >= 3) keys.push({ tonic: mod12(key.tonic + 9), mode: 'natural', reason: 'the relative minor colours several bars', optional: true });
  }
  return keys;
}
export type { ScoreNote };
