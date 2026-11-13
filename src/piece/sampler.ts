/** A sampled grand piano: recordings every few semitones, pitched by playback rate. Files come from this site's own public/piano folder. */
export const GAIN_CONSTANT = 0.62;
const VOICES = 48;
interface Entry { midi: number; file: string; gain: number; cents: number }
interface Loaded { buffer: AudioBuffer; onset: number; gain: number; cents: number }
interface Voice { source: AudioBufferSourceNode; gain: GainNode; at: number }

/** The recorded root closest to a note; on a tie the lower root, so the note is pitched up a little rather than down. */
export function nearestSample(midi: number, available: number[]): number | undefined {
  let best: number | undefined;
  for (const root of available) if (best === undefined || Math.abs(root - midi) < Math.abs(best - midi) || (Math.abs(root - midi) === Math.abs(best - midi) && root < best)) best = root;
  return best;
}
/** Playback rate that turns a recording at `root` (measured `cents` sharp) into `midi`. */
export function playbackRate(midi: number, root: number, cents: number): number { return 2 ** ((midi - root) / 12 - cents / 1200); }
/** Seconds to the first sample reaching 10% of the peak of the first half second; 0 when silent. */
export function measureOnset(data: Float32Array, rate: number): number {
  const end = Math.min(data.length, Math.round(rate * 0.5));
  let peak = 0; for (let i = 0; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak === 0) return 0;
  for (let i = 0; i < end; i++) if (Math.abs(data[i]) >= peak * 0.1) return i / rate;
  return 0;
}
/** When to start a buffer and from where in it, so its attack is heard at `at` (a late start skips ahead, scaled by the playback rate). */
export function startPoint(at: number, now: number, onset: number, rate: number): { when: number; offset: number } {
  return { when: Math.max(at, now), offset: onset + Math.max(0, now - at) * rate };
}
/** The roots needed to cover every note from lo to hi. */
export function needed(range: [number, number], available: number[]): number[] {
  const roots = new Set<number>();
  for (let m = Math.round(range[0]); m <= Math.round(range[1]); m++) { const r = nearestSample(m, available); if (r !== undefined) roots.add(r); }
  return [...roots].sort((a, b) => a - b);
}

export class PianoSampler {
  failed = false; message = '';
  private manifest?: Promise<Entry[]>;
  private entries = new Map<number, Entry>();
  private loaded = new Map<number, Loaded>();
  private inflight = new Map<number, Promise<void>>();
  private failedRoots = new Set<number>();
  private voices: Voice[] = [];
  constructor(readonly context: BaseAudioContext, readonly out: AudioNode) {}
  /** True while the manifest or a file is still on its way. */
  get loading(): boolean { return this.inflight.size > 0 || (this.manifest !== undefined && this.entries.size === 0 && !this.failed); }
  private fail(message: string): void { this.failed = true; this.message ||= message; }
  private fetchManifest(): Promise<Entry[]> {
    this.manifest ??= fetch(`${import.meta.env.BASE_URL}piano/manifest.json`).then(async r => {
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      const list = (await r.json() as { notes?: Entry[] }).notes ?? [];
      for (const e of list) this.entries.set(e.midi, e);
      if (!list.length) throw new Error('empty manifest');
      return list;
    }).catch(error => { this.fail(String(error)); return [] as Entry[]; });
    return this.manifest;
  }
  private fetchRoot(root: number): Promise<void> {
    let job = this.inflight.get(root);
    if (!job) {
      const entry = this.entries.get(root)!;
      job = fetch(`${import.meta.env.BASE_URL}piano/${entry.file}`).then(async r => {
        if (!r.ok) throw new Error(`${entry.file} ${r.status}`);
        const buffer = await this.context.decodeAudioData(await r.arrayBuffer());
        this.loaded.set(root, { buffer, onset: measureOnset(buffer.getChannelData(0), buffer.sampleRate), gain: entry.gain, cents: entry.cents });
      }).catch(error => { this.failedRoots.add(root); this.fail(String(error)); }).finally(() => this.inflight.delete(root));
      this.inflight.set(root, job);
    }
    return job;
  }
  /** Fetch and decode the recordings that cover lo..hi, once each. */
  async load(lo: number, hi: number): Promise<void> {
    const list = await this.fetchManifest(); if (!list.length) return;
    await Promise.all(needed([lo, hi], [...this.entries.keys()]).filter(r => !this.loaded.has(r) && !this.failedRoots.has(r)).map(r => this.fetchRoot(r)));
  }
  /** Every recording for lo..hi is decoded. */
  ready(lo: number, hi: number): boolean {
    const roots = needed([lo, hi], [...this.entries.keys()]);
    return roots.length > 0 && roots.every(r => this.loaded.has(r));
  }
  private pick(midi: number): { root: number; sample: Loaded } | undefined {
    const root = nearestSample(midi, [...this.entries.keys()]);
    if (root !== undefined && !this.loaded.has(root) && !this.inflight.has(root) && !this.failedRoots.has(root)) void this.fetchRoot(root);
    const use = this.loaded.has(root ?? -1) ? root : nearestSample(midi, [...this.loaded.keys()]);
    const sample = use === undefined ? undefined : this.loaded.get(use);
    return use !== undefined && sample ? { root: use, sample } : undefined;
  }
  private voice(midi: number, at: number, level: number): (Voice & { release: (t: number) => void }) | undefined {
    const found = this.pick(midi); if (!found) return undefined;
    const c = this.context, { root, sample } = found, rate = playbackRate(midi, root, sample.cents), { when, offset } = startPoint(at, c.currentTime, sample.onset, rate);
    const source = c.createBufferSource(), gain = c.createGain();
    source.buffer = sample.buffer; source.playbackRate.value = rate; gain.gain.value = GAIN_CONSTANT * level * sample.gain;
    source.connect(gain).connect(this.out); source.start(when, Math.min(offset, Math.max(0, sample.buffer.duration - 0.001)));
    const voice = { source, gain, at: when, release: (t: number) => {
      const g = gain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
      g.setTargetAtTime(0, t, 0.07);
      try { source.stop(t + 0.5); } catch { /* ended */ }
    } };
    while (this.voices.length >= VOICES) {
      const old = this.voices.shift()!, t = c.currentTime;
      old.gain.gain.cancelScheduledValues(t); old.gain.gain.setTargetAtTime(0, t, 0.003);
      try { old.source.stop(t + 0.03); } catch { /* ended */ }
    }
    this.voices.push(voice);
    source.onended = () => { this.voices = this.voices.filter(v => v !== voice); source.disconnect(); gain.disconnect(); };
    return voice;
  }
  /** One note at time `at` for `length` seconds. False when nothing is loaded yet. */
  play(midi: number, at: number, length: number, level = 0.7): boolean {
    const voice = this.voice(midi, at, level); if (!voice) return false;
    voice.release(Math.max(at, this.context.currentTime) + length);
    return true;
  }
  /** A note that sounds until the returned release is called; undefined when nothing is loaded yet. */
  hold(midi: number, level = 0.7): (() => void) | undefined {
    const voice = this.voice(midi, this.context.currentTime, level); if (!voice) return undefined;
    return () => voice.release(this.context.currentTime);
  }
  /** Silence every voice at once. */
  stop(): void {
    for (const v of this.voices) try { v.source.stop(); } catch { /* ended */ }
    this.voices = [];
  }
}
