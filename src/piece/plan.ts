import type { Exercise, XEvent } from './exercise';

/** Every sound of an attempt on the audio clock: demonstration, count-in, then the scored window. */
export type PieceKind = 'practice' | 'demo' | 'calibration';
export interface Sound { at: number; kind: 'click' | 'note' | 'pip'; midi?: number; length: number; accent?: boolean; level?: number; timbre?: 'piano' | 'guitar' }
export interface PiecePlan { kind: PieceKind; start: number; playAt: number; end: number; finish: number; period: number; support: number; beatsPerBar: number; sounds: Sound[] }

const notesOf = (events: XEvent[], from: number, period: number, timbre: Sound['timbre'], level: number): Sound[] =>
  events.flatMap(e => e.notes.map(n => ({ at: from + e.beat * period, kind: 'note' as const, midi: n.midi, length: Math.min(6, Math.max(0.12, n.dur * period)), level, timbre })));

/**
 * Below 50 BPM a quiet eighth-note click helps keep the slow beat. Support 2 keeps only the bar's first click.
 * backing: notes the app plays during the scored window (the other hand, or the melody under a guitar part).
 */
export function planExercise(ex: Exercise, bpm: number, now: number, kind: PieceKind, support = 0, demonstrate = false, backing: XEvent[] = []): PiecePlan {
  const period = 60 / bpm, start = now + 0.4, sounds: Sound[] = [], timbre = ex.instrument === 'guitar' ? 'guitar' : 'piano';
  if (kind === 'calibration') {
    for (let i = 0; i < 8; i++) sounds.push({ at: start + 0.3 + i * 0.6, kind: 'pip', length: 0.008 });
    return { kind, start, playAt: start, end: start + 5.4, finish: start + 5.6, period: 1, support: 0, beatsPerBar: 4, sounds };
  }
  const demo = kind === 'demo' || demonstrate, demoLength = demo ? ex.beats * period : 0;
  if (demo) sounds.push(...notesOf(ex.events, start, period, timbre, 0.7));
  if (kind === 'demo') return { kind, start, playAt: start, end: start + demoLength, finish: start + demoLength + 1.2, period, support, beatsPerBar: ex.beatsPerBar, sounds };
  const countAt = start + demoLength + (demo ? 1.5 * period : 0), playAt = countAt + ex.beatsPerBar * period, end = playAt + ex.beats * period;
  const sub = bpm < 50;
  for (let i = 0; i < ex.beatsPerBar; i++) {
    sounds.push({ at: countAt + i * period, kind: 'click', length: 0.01, accent: i === 0 });
    if (sub) sounds.push({ at: countAt + (i + 0.5) * period, kind: 'click', length: 0.01, level: 0.45 });
  }
  for (let i = 0; i < ex.beats; i++) {
    const downbeat = Math.abs(i % ex.beatsPerBar) < 1e-9;
    if (support < 2 || downbeat) sounds.push({ at: playAt + i * period, kind: 'click', length: 0.01, accent: downbeat });
    if (sub && support < 2) sounds.push({ at: playAt + (i + 0.5) * period, kind: 'click', length: 0.01, level: 0.45 });
  }
  if (backing.length) sounds.push(...notesOf(backing, playAt, period, 'piano', 0.45));
  return { kind, start, playAt, end, finish: end + 0.7, period, support, beatsPerBar: ex.beatsPerBar, sounds: sounds.sort((a, b) => a.at - b.at) };
}
