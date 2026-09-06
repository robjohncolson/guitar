import { Crepe } from './crepe';
import type { Pitch } from './crepe';
import { yin } from './yin';
import { OnsetDetector } from './onset';
import type { CaptureMessage } from './worklet-grabber';
import type { CaptureFrame } from './frame-buffer';
import type { NoteOn, NoteEnd } from '../music/notes';

export class Ear {
  readonly onsets: OnsetDetector;
  private crepe = new Crepe();
  private fallback = false;
  private ready = false;
  private busy = false;
  private queued?: CaptureFrame;
  private generation = 0;
  constructor(readonly status: (text: string) => void, readonly pitch: (pitch: Pitch) => void,
    readonly note: (note: NoteOn) => void, readonly attack: (t: number) => void = () => {},
    readonly ended: (note: NoteEnd) => void = () => {}) { this.onsets = new OnsetDetector(ended); }
  async load(): Promise<void> {
    this.status('CREPE loading');
    try { await this.crepe.load(); this.status('CREPE ready (tiny)'); }
    catch (error) { this.crepe.dispose(); this.fallback = true; this.status('FALLBACK: YIN'); console.error('CREPE loading failed:', error); }
    this.ready = true;
  }
  receive(message: CaptureMessage): void {
    if (!this.ready) return;
    if (message.type === 'attack') { this.onsets.attack(message.t); this.attack(message.t); return; }
    // Bound the queue. A slow GPU must not accumulate seconds of stale pitch frames.
    this.queued = message;
    if (!this.busy) void this.drain();
  }
  resetCapture(now?: number): void { this.generation++; this.queued = undefined; this.onsets.reset(now); }
  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.queued) {
        const frame = this.queued, generation = this.generation; this.queued = undefined;
        const pitch = frame.rms < 0.001 ? { hz: 0, confidence: 0 } : this.fallback ? yin(frame.samples) : await this.crepe.infer(frame.samples);
        if (generation !== this.generation) continue;
        this.pitch(pitch);
        const note = this.onsets.process(frame.t, pitch, frame.rms);
        if (note) this.note(note);
      }
    } catch (error) { this.ready = false; this.status(`CREPE error: ${String(error)}`); }
    finally { this.busy = false; }
  }
}
