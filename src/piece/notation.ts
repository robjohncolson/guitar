import { PPQ, type Hand, type Harmony, type Score, type ScoreBar, type ScoreNote, type Section, type VoiceDef, type ScoreMeta } from './score';

/** Compiler for the plain-text piece format (see PIECES.md). Key signatures, bar-long accidentals and ties are compiled, never guessed. */
export interface Diagnostic { line: number; level: 'error' | 'warn'; message: string }
export interface Compiled { score?: Score; diagnostics: Diagnostic[] }

const STEP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ALTER: Record<string, number> = { n: 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };
const NOTE = /^([a-g])(##|bb|#|b|x|n)?([0-9])(?:-([1-5]))?(~)?$/;
const DURATION = /^(1|2|4|8|16|32|64)(\.{0,3})(~?)$/;

export function signatureAlter(fifths: number): Record<string, number> {
  const alter: Record<string, number> = { c: 0, d: 0, e: 0, f: 0, g: 0, a: 0, b: 0 };
  const order = fifths > 0 ? 'fcgdaeb' : 'beadgcf';
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++) alter[order[i]] = Math.sign(fifths);
  return alter;
}
export function parseKeySignature(text: string): number | undefined {
  const m = /^([0-7])\s*([#♯b♭])?$/.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n === 0) return 0;
  return m[2] ? (m[2] === '#' || m[2] === '♯' ? n : -n) : undefined;
}
function duration(text: string): { ticks: number; tie: boolean } | undefined {
  const m = DURATION.exec(text);
  if (!m) return undefined;
  const base = PPQ * 4 / Number(m[1]), dots = m[2].length;
  return { ticks: Math.round(base * (2 - 1 / 2 ** dots)), tie: m[3] === '~' };
}

interface PitchToken { letter: string; acc?: string; octave: number; finger?: number; tie: boolean }
interface Item { voice: string; staff: number; hand: Hand; tick: number; dur: number; pitches: PitchToken[]; line: number; order: number; grace?: boolean }

/** Split a voice line into tokens, keeping <...>:d and N:M{ together. */
function lex(text: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < text.length;) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text[i] === '<') {
      const close = text.indexOf('>', i);
      if (close < 0) { tokens.push(text.slice(i)); break; }
      let end = close + 1;
      while (end < text.length && !/\s/.test(text[end])) end++;
      tokens.push(text.slice(i, end)); i = end; continue;
    }
    let end = i;
    while (end < text.length && !/\s/.test(text[end]) && text[end] !== '<') end++;
    tokens.push(text.slice(i, end)); i = end;
  }
  return tokens;
}

export function compile(source: string): Compiled {
  const diagnostics: Diagnostic[] = [];
  const error = (line: number, message: string) => diagnostics.push({ line, level: 'error', message });
  const warn = (line: number, message: string) => diagnostics.push({ line, level: 'warn', message });
  const meta: ScoreMeta = { title: 'Untitled', composer: '', source: '', licence: 'unknown', redistributable: false, verified: 'none' };
  let mode: 'printed' | 'sounding' | undefined, key = 0, keyMode: 'major' | 'minor' | undefined;
  let num = 4, den = 4, tempo = { bpm: 80, text: '' };
  const voices = new Map<string, VoiceDef>(), sectionText: { text: string; line: number }[] = [];
  const bars: ScoreBar[] = [], notes: ScoreNote[] = [];
  const open = new Map<string, Map<number, { note: ScoreNote; letter: string; octave: number; alter: number; line: number }>>();
  let pendingStart = false, ending: number[] | undefined, body = false, order = 0, swing = false;
  let current: { bar: ScoreBar; partial: boolean; lines: { voice: string; hand?: string; text: string; line: number }[] } | undefined;

  const finishBar = () => {
    if (!current) return;
    const { bar } = current, items: Item[] = [];
    const lengths: number[] = [];
    for (const voiceLine of current.lines) {
      const def = voices.get(voiceLine.voice);
      if (!def) { error(voiceLine.line, `Unknown voice "${voiceLine.voice}". Declare it in the voices: header.`); continue; }
      const hand = (voiceLine.hand ?? def.hand) as Hand;
      if (hand !== 'L' && hand !== 'R') { error(voiceLine.line, `Hand must be L or R, not "${voiceLine.hand}".`); continue; }
      let cursor = 0, grace = false;
      const scale: number[] = [], groups: ('tuplet' | 'grace')[] = [];
      const factor = () => scale.reduce((a, b) => a * b, 1);
      for (const token of lex(voiceLine.text)) {
        const tuplet = /^(\d+):(\d+)\{$/.exec(token);
        if (tuplet) { scale.push(Number(tuplet[2]) / Number(tuplet[1])); groups.push('tuplet'); continue; }
        // Grace notes are read (their accidentals count) but take no time and are not played or graded.
        if (token === 'g{') { if (grace) error(voiceLine.line, 'Grace groups cannot nest.'); grace = true; groups.push('grace'); continue; }
        if (token === '}') { const group = groups.pop(); if (!group) error(voiceLine.line, 'Unmatched } in this bar.'); else if (group === 'tuplet') scale.pop(); else grace = false; continue; }
        if (token === 'R') { cursor = Math.max(cursor, bar.ticks); continue; }
        const rest = /^([rs]):(.+)$/.exec(token);
        if (rest) {
          const d = duration(rest[2]);
          if (!d || d.tie) { error(voiceLine.line, `Bad rest "${token}". Write r:4, r:2. or s:8.`); continue; }
          cursor += Math.round(d.ticks * factor()); continue;
        }
        let pitchTexts: string[], durText: string;
        if (token.startsWith('<')) {
          const close = token.indexOf('>');
          pitchTexts = token.slice(1, close).trim().split(/\s+/).filter(Boolean);
          durText = token.slice(close + 1);
          if (!durText.startsWith(':')) { error(voiceLine.line, `Chord "${token}" needs a duration, for example <c4 e4 g4>:2.`); continue; }
          durText = durText.slice(1);
        } else {
          const colon = token.indexOf(':');
          if (colon < 0) { error(voiceLine.line, `"${token}" needs a duration, for example ${token}:4.`); continue; }
          pitchTexts = [token.slice(0, colon)]; durText = token.slice(colon + 1);
        }
        const d = duration(durText);
        if (!d) { error(voiceLine.line, `Bad duration in "${token}". Use 1, 2, 4, 8, 16, 32 or 64 with optional dots, then ~ for a tie.`); continue; }
        const pitches: PitchToken[] = [];
        for (const text of pitchTexts) {
          const m = NOTE.exec(text);
          if (!m) { error(voiceLine.line, `Bad pitch "${text}". Write letter, accidental, octave: f#4, bb3, cn5, e4-2 (finger 2).`); continue; }
          pitches.push({ letter: m[1], acc: m[2], octave: Number(m[3]), finger: m[4] ? Number(m[4]) : undefined, tie: d.tie || m[5] === '~' });
        }
        const ticks = Math.round(d.ticks * factor());
        if (grace) { if (pitches.length) items.push({ voice: voiceLine.voice, staff: def.staff, hand, tick: cursor, dur: 0, pitches: pitches.map(p => ({ ...p, tie: false })), line: voiceLine.line, order: order++, grace: true }); continue; }
        if (pitches.length) items.push({ voice: voiceLine.voice, staff: def.staff, hand, tick: cursor, dur: ticks, pitches, line: voiceLine.line, order: order++ });
        cursor += ticks;
      }
      if (groups.length) error(voiceLine.line, groups.includes('grace') ? 'A grace group was not closed with }.' : 'A tuplet was not closed with }.');
      lengths.push(cursor);
      if (!current.partial && cursor !== bar.ticks) error(voiceLine.line, `Voice ${voiceLine.voice} fills ${cursor / PPQ} of ${bar.ticks / PPQ} beats in bar ${bar.number}.`);
      if (current.partial && cursor > bar.ticks) error(voiceLine.line, `Voice ${voiceLine.voice} overfills partial bar ${bar.number}.`);
    }
    if (current.partial) bar.ticks = Math.max(0, ...lengths);
    // Printed accidentals last to the end of the bar on that staff line or space; resolve in time order across voices.
    items.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const sig = signatureAlter(bar.key);
    const accidentalAt = new Map<string, { tick: number; alter: number }[]>();
    for (const item of items) for (const p of item.pitches) if (mode === 'printed' && p.acc !== undefined) {
      const key2 = `${item.staff}:${p.letter}${p.octave}`;
      accidentalAt.set(key2, [...(accidentalAt.get(key2) ?? []), { tick: item.tick, alter: ALTER[p.acc] }]);
    }
    for (const item of items) {
      if (item.grace) continue;
      const previous = open.get(item.voice) ?? new Map();
      const next = new Map<number, { note: ScoreNote; letter: string; octave: number; alter: number; line: number }>();
      for (const p of item.pitches) {
        let alter: number;
        const tied = [...previous.values()].find(o => o.letter === p.letter && o.octave === p.octave);
        if (p.acc !== undefined) alter = ALTER[p.acc];
        else if (mode === 'sounding') {
          alter = 0;
          if (sig[p.letter] !== 0 && !tied) warn(item.line, `${p.letter.toUpperCase()}${p.octave} is natural here but the key signature alters ${p.letter.toUpperCase()}. Write ${p.letter}n${p.octave} if the natural is intended.`);
        } else if (tied) alter = tied.alter;
        else {
          const marks = (accidentalAt.get(`${item.staff}:${p.letter}${p.octave}`) ?? []).filter(a => a.tick <= item.tick);
          alter = marks.length ? marks[marks.length - 1].alter : sig[p.letter];
        }
        const midi = (p.octave + 1) * 12 + STEP[p.letter] + alter;
        if (midi < 21 || midi > 108) error(item.line, `${p.letter}${p.acc ?? ''}${p.octave} is outside the piano range.`);
        const absolute = bar.start + item.tick, carry = previous.get(midi);
        if (carry && bars[carry.note.bar].start + carry.note.tick + carry.note.dur === absolute) {
          carry.note.dur += item.dur; previous.delete(midi);
          if (p.tie) next.set(midi, carry);
          continue;
        }
        const note: ScoreNote = { id: 0, bar: bar.index, tick: item.tick, dur: item.dur, midi, hand: item.hand, staff: item.staff, voice: item.voice, finger: p.finger };
        notes.push(note);
        if (p.tie) next.set(midi, { note, letter: p.letter, octave: p.octave, alter, line: item.line });
      }
      for (const left of previous.values()) warn(left.line, `A tie on ${left.letter.toUpperCase()}${left.octave} in voice ${item.voice} does not continue on the next note.`);
      open.set(item.voice, next);
    }
    current = undefined;
  };

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1, text = lines[index].replace(/%.*$/, '').trim();
    if (!text) continue;
    if (text === '|:' || /^:\|\d?$/.test(text) || /^\[\d+(,\d+)*$/.test(text) || text === ']') {
      body = true;
      if (text === '|:') { finishBar(); pendingStart = true; ending = undefined; }
      else if (text.startsWith(':|')) {
        const target = current?.bar ?? bars[bars.length - 1];
        if (!target) error(lineNumber, ':| needs a bar before it.'); else target.repeatEnd = Number(text.slice(2)) || 2;
        finishBar(); ending = undefined;
      } else if (text === ']') { finishBar(); ending = undefined; }
      else { finishBar(); ending = text.slice(1).split(',').map(Number); }
      continue;
    }
    const barLine = /^==\s*(\d+)(.*)$/.exec(text);
    if (barLine) {
      finishBar(); body = true;
      const extra = barLine[2], number = Number(barLine[1]);
      const time = /time:\s*(\d+)\/(\d+)/.exec(extra), keyChange = /key:\s*([0-7]\s*[#♯b♭]?)/.exec(extra);
      const unknown = extra.replace(/time:\s*\d+\/\d+/, '').replace(/key:\s*[0-7]\s*[#♯b♭]?/, '').replace(/\b(partial|swing|straight)\b/g, '').trim();
      if (unknown) warn(lineNumber, `Bar option "${unknown}" is not understood and was ignored. Use partial, swing, straight, time: 3/4 or key: 2#.`);
      if (time) { num = Number(time[1]); den = Number(time[2]); }
      if (keyChange) { const k = parseKeySignature(keyChange[1]); if (k === undefined) error(lineNumber, `Bad key signature "${keyChange[1]}".`); else key = k; }
      const previous = bars[bars.length - 1];
      if (previous && number !== previous.number + 1) warn(lineNumber, `Bar ${number} follows bar ${previous.number}. Check for a missing or repeated bar.`);
      const bar: ScoreBar = { index: bars.length, number, ticks: Math.round(num * PPQ * 4 / den), num, den, key, start: previous ? previous.start + previous.ticks : 0, harmony: [] };
      if (/\bswing\b/.test(extra)) swing = true;
      if (/\bstraight\b/.test(extra)) swing = false;
      if (swing) bar.swing = true;
      if (pendingStart) { bar.repeatStart = true; pendingStart = false; }
      if (ending) bar.ending = ending;
      bars.push(bar); current = { bar, partial: number === 0 || /\bpartial\b/.test(extra), lines: [] };
      continue;
    }
    const field = /^([a-zA-Z][\w-]*)(?:\[([A-Za-z])\])?\s*:\s*(.*)$/.exec(text);
    if (!field) { error(lineNumber, `Cannot read "${text}".`); continue; }
    const [, name, handOverride, value] = field;
    if (current) {
      if (name === 'harmony') {
        for (const part of value.split(/\s+/).filter(Boolean)) {
          const [symbol, at] = part.split('@');
          current.bar.harmony.push({ tick: Math.round((Number(at ?? 0) || 0) * PPQ), symbol } as Harmony);
        }
      } else if (name === 'mark') current.bar.marks = [...(current.bar.marks ?? []), ...value.split(/\s+/).filter(Boolean)];
      else current.lines.push({ voice: name, hand: handOverride?.toUpperCase(), text: value, line: lineNumber });
      continue;
    }
    if (body) { error(lineNumber, `Header "${name}" must come before the first bar.`); continue; }
    switch (name) {
      case 'title': meta.title = value; break;
      case 'composer': meta.composer = value; break;
      case 'arranger': meta.arranger = value; break;
      case 'source': meta.source = value; break;
      case 'licence': case 'license': meta.licence = value; break;
      case 'redistributable': meta.redistributable = /^(yes|true)$/i.test(value); break;
      case 'verified': if (['none', 'checks', 'sources', 'owner'].includes(value)) meta.verified = value as ScoreMeta['verified']; else error(lineNumber, 'verified must be none, checks, sources or owner.'); break;
      case 'pitch-mode': if (value === 'printed' || value === 'sounding') mode = value; else error(lineNumber, 'pitch-mode must be printed or sounding.'); break;
      case 'key': { const k = parseKeySignature(value); if (k === undefined) error(lineNumber, `Bad key signature "${value}". Write 0, 2#, 3b.`); else key = k; break; }
      case 'mode': if (value === 'major' || value === 'minor') keyMode = value; else error(lineNumber, 'mode must be major or minor.'); break;
      case 'time': { const m = /^(\d+)\/(\d+)$/.exec(value); if (!m) error(lineNumber, 'time must look like 3/4.'); else { num = Number(m[1]); den = Number(m[2]); } break; }
      case 'tempo': { const m = /q=(\d+)/.exec(value); tempo = { bpm: m ? Number(m[1]) : tempo.bpm, text: value.replace(/q=\d+/, '').trim() }; break; }
      case 'voices':
        for (const part of value.split(/\s+/).filter(Boolean)) {
          const m = /^([a-zA-Z][\w-]*)@([12]):([LR])$/.exec(part);
          if (!m) error(lineNumber, `Voice "${part}" must look like mel@1:R (name, staff, hand).`);
          else voices.set(m[1], { name: m[1], staff: Number(m[2]), hand: m[3] as Hand });
        }
        break;
      case 'section': sectionText.push({ text: value, line: lineNumber }); break;
      default: warn(lineNumber, `Unknown header "${name}" ignored.`);
    }
  }
  finishBar();
  for (const [voice, left] of open) for (const tie of left.values()) warn(tie.line, `A tie on ${tie.letter.toUpperCase()}${tie.octave} in voice ${voice} is never completed.`);
  if (!mode) error(1, 'Add "pitch-mode: printed" or "pitch-mode: sounding" to the header.');
  if (!voices.size) error(1, 'Declare voices, for example "voices: rh@1:R lh@2:L".');
  if (!bars.length) error(1, 'No bars found. Each bar starts with a line such as "== 1".');
  const sections: Section[] = [];
  for (const { text, line } of sectionText) {
    const m = /^(.+?)\s+(\d+)-(\d+)(?:\s+"(.*)")?$/.exec(text);
    const from = m && bars.findIndex(b => b.number === Number(m[2])), to = m && bars.findIndex(b => b.number === Number(m[3]));
    if (!m || from === null || to === null || from < 0 || to < from) error(line, `Section "${text}" must look like: A 5-12 "optional note", using existing bar numbers.`);
    else sections.push({ name: m[1], from, to, note: m[4] });
  }
  if (diagnostics.some(d => d.level === 'error')) return { diagnostics };
  notes.sort((a, b) => a.bar - b.bar || a.tick - b.tick || a.midi - b.midi);
  notes.forEach((note, i) => note.id = i);
  if (meta.verified === 'none') meta.verified = 'checks';
  const score: Score = { meta, ppq: PPQ, key, mode: keyMode, tempo, bars, notes, playOrder: unroll(bars), sections, voices: [...voices.values()] };
  return { score, diagnostics };
}

/** Repeats with numbered endings, D.C./D.S. al Fine and To Coda. Repeats are not retaken after a jump. */
export function unroll(bars: ScoreBar[]): number[] {
  const order: number[] = [];
  const lastEnding = Math.max(1, ...bars.flatMap(b => b.ending ?? []));
  let i = 0, pass = 1, start = 0, returning = false, jumped = false, guard = 0;
  while (i < bars.length && guard++ < 100000) {
    const bar = bars[i], marks = bar.marks ?? [];
    if (bar.repeatStart && !returning && !jumped) { start = i; pass = 1; }
    returning = false;
    const wanted = jumped ? lastEnding : pass;
    if (bar.ending && !bar.ending.includes(wanted)) { i++; continue; }
    order.push(i);
    if (jumped && marks.includes('fine')) break;
    if (jumped && marks.includes('tocoda')) {
      const coda = bars.findIndex((b, j) => j > i && (b.marks ?? []).includes('coda'));
      if (coda > i) { i = coda; continue; }
    }
    if (bar.repeatEnd && pass < bar.repeatEnd && !jumped) { pass++; i = start; returning = true; continue; }
    if (!jumped && (marks.includes('dc') || marks.includes('ds'))) {
      jumped = true; i = marks.includes('ds') ? Math.max(0, bars.findIndex(b => (b.marks ?? []).includes('segno'))) : 0; continue;
    }
    i++;
  }
  return order;
}

/** Stateless per-bar listing for review: absolute pitch names and lengths, per hand. */
export function listing(score: Score, names: (midi: number) => string): string {
  return score.bars.map(bar => {
    const parts = (['R', 'L'] as Hand[]).map(hand => {
      const ns = score.notes.filter(n => n.bar === bar.index && n.hand === hand);
      const byTick = new Map<number, ScoreNote[]>();
      for (const n of ns) byTick.set(n.tick, [...(byTick.get(n.tick) ?? []), n]);
      const text = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, group]) => `${tick / score.ppq}:${group.map(n => `${names(n.midi)}/${n.dur / score.ppq}`).join('+')}`).join(' ');
      return `${hand}H ${text || '-'}`;
    });
    return `bar ${bar.number}${bar.harmony.length ? ` [${bar.harmony.map(h => h.symbol).join(' ')}]` : ''}  ${parts.join('  |  ')}`;
  }).join('\n');
}
