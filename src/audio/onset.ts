import { median } from './tap-tempo';
import { centsOffset, hzToMidi, pitchClass } from '../music/notes';
import type { NoteOn, NoteEnd } from '../music/notes';
import type { Pitch } from './crepe';

export class OnsetDetector {
  threshold = 0.5;
  accepts: (note: NoteOn) => boolean = () => true;
  private pending?: { t: number; pitches: number[]; confidences: number[]; levels: number[] };
  private sounding?: number;
  private lastAttack = -Infinity;
  private canStart = true;
  private quietSince?: number;
  private peak = 0;
  private levelTime = -Infinity;
  private quietThrough = -Infinity;
  private releases: number[] = [];
  constructor(readonly ended: (note: NoteEnd) => void = () => {}) {}
  private finish(end: number): void {
    if (this.sounding === undefined) return;
    this.ended({t:this.sounding,end:Math.max(this.sounding+0.04,end)});
    this.sounding = undefined;
  }
  attack(t: number): void {
    if (this.pending && t-this.pending.t >= 0.14) this.pending = undefined;
    if (!Number.isFinite(t) || t - this.lastAttack < 0.09 || this.pending) return;
    this.lastAttack = t;
    this.pending = { t, pitches: [], confidences: [], levels: [] };
  }
  observeLevel(t: number, rms: number): void {
    if (t <= this.levelTime) return;
    this.levelTime = t;
    const quiet = rms < Math.max(0.0015,this.peak*0.04);
    if (quiet) {
      this.quietSince ??= t;
      if (t-this.quietSince >= 0.08-1e-6) {
        if (this.releases.at(-1) !== this.quietSince) this.releases.push(this.quietSince);
        this.finish(this.quietSince); this.canStart = true; this.peak = 0; this.quietThrough = t;
      }
    } else {
      this.quietSince = undefined;
    }
    this.releases = this.releases.filter(release => t-release <= 2);
  }
  process(t: number, pitch: Pitch, rms = 0): NoteOn | null {
    // Every captured frame supplies energy, even when the GPU skips pitch frames.
    this.observeLevel(t,rms);
    const voiced = pitch.confidence >= this.threshold && pitch.hz >= 70 && pitch.hz <= 1400;
    const quiet = rms < Math.max(0.0015,this.peak*0.04);
    if (!quiet) {
      // A confidence dropout or an octave jump in a ringing string is not a new attack.
      if (voiced && this.canStart && !this.pending && t > this.quietThrough) this.attack(t);
    }
    const pending = this.pending;
    if (!pending || t < pending.t) return null;
    if (voiced && !quiet) {
      pending.pitches.push(pitch.hz); pending.confidences.push(pitch.confidence);
      if (Number.isFinite(rms) && rms > 0) pending.levels.push(rms);
    }
    if (t - pending.t < 0.06 - 1e-6) return null;
    const cluster = pending.pitches.map(hz => pending.pitches.filter(other => Math.abs(12*Math.log2(other/hz)) <= 0.65))
      .sort((a,b) => b.length-a.length)[0] ?? [];
    if (cluster.length < 2 || cluster.length < pending.pitches.length*0.65) {
      if (t-pending.t >= 0.14) this.pending = undefined;
      return null;
    }
    this.pending = undefined; this.canStart = false;
    const hz = median(cluster), midi = hzToMidi(hz);
    const note: NoteOn = { t: pending.t, hz, midi: Math.round(midi), pitchClass: pitchClass(midi), cents: centsOffset(midi), confidence: median(pending.confidences),
      level:pending.levels.length ? median(pending.levels) : undefined };
    // Speaker bleed must not end the player's sustain before downstream masking.
    if (!this.accepts(note)) return null;
    this.peak = Math.max(...pending.levels,0);
    this.finish(pending.t); this.sounding = pending.t;
    // Inference may finish after the raw stream has already confirmed the release.
    const release = this.releases.find(release => release > pending.t);
    if (release !== undefined) {
      note.duration = release-pending.t;
      this.finish(release); this.canStart = true; this.peak = 0;
    }
    return note;
  }
  reset(now?: number): void {
    if (now !== undefined) this.finish(now);
    this.sounding = undefined; this.pending = undefined; this.canStart = true;
    this.lastAttack = -Infinity; this.quietSince = undefined; this.peak = 0; this.levelTime = -Infinity; this.quietThrough = -Infinity;
    this.releases = [];
  }
}
