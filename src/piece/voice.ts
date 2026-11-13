/** Demonstration voices: a soft piano and a plucked guitar, built from a few decaying harmonics. Never sounds during scoring unless asked for as backing. */
export class PieceVoice {
  readonly out: GainNode;
  readonly clicks: GainNode;
  private waves = new Map<string, PeriodicWave>();
  private active = new Set<AudioScheduledSourceNode>();
  constructor(readonly context: AudioContext) {
    this.out = context.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(context.destination);
    // The same level and pitches as the guitar trainer's metronome (1.3 kHz accent, 1 kHz beat).
    this.clicks = context.createGain();
    this.clicks.gain.value = 0.126;
    this.clicks.connect(context.destination);
  }
  click(at: number, accent: boolean, level = 1): void {
    const c = this.context, t = Math.max(c.currentTime, at), oscillator = c.createOscillator(), gain = c.createGain();
    oscillator.frequency.value = accent ? 1300 : 1000;
    gain.gain.setValueAtTime(0.001, t); gain.gain.linearRampToValueAtTime(level, t + 0.001); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
    oscillator.connect(gain).connect(this.clicks); oscillator.start(t); oscillator.stop(t + 0.012);
    this.active.add(oscillator);
    oscillator.onended = () => { this.active.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }
  /** Build both waves ahead of the first note. */
  warm(): void { this.wave('piano'); this.wave('guitar'); }
  set volume(value: number) { this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.02); }
  private wave(timbre: 'piano' | 'guitar'): PeriodicWave {
    let wave = this.waves.get(timbre);
    if (!wave) {
      const harmonics = timbre === 'piano' ? [0, 1, 0.45, 0.28, 0.16, 0.1, 0.06, 0.04, 0.025] : [0, 1, 0.6, 0.45, 0.3, 0.22, 0.12, 0.08];
      wave = this.context.createPeriodicWave(new Float32Array(harmonics), new Float32Array(harmonics.length));
      this.waves.set(timbre, wave);
    }
    return wave;
  }
  play(midi: number, at: number, length: number, level = 0.7, timbre: 'piano' | 'guitar' = 'piano'): void {
    const { oscillator, gain, t } = this.voice(midi, at, level, timbre);
    gain.gain.setTargetAtTime(0, t + length, 0.06);
    oscillator.stop(t + length + 0.4);
  }
  /** A note that sounds until the returned release is called (a key held down). */
  hold(midi: number, level = 0.7, timbre: 'piano' | 'guitar' = 'piano'): () => void {
    const { oscillator, gain } = this.voice(midi, this.context.currentTime, level, timbre);
    oscillator.stop(this.context.currentTime + 30);
    return () => {
      const t = this.context.currentTime, g = gain.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
      g.setTargetAtTime(0, t, 0.06);
      try { oscillator.stop(t + 0.4); } catch { /* ended */ }
    };
  }
  private voice(midi: number, at: number, level: number, timbre: 'piano' | 'guitar'): { oscillator: OscillatorNode; gain: GainNode; t: number } {
    const c = this.context, t = Math.max(c.currentTime, at), oscillator = c.createOscillator(), gain = c.createGain(), filter = c.createBiquadFilter();
    const hz = 440 * 2 ** ((midi - 69) / 12), peak = 0.16 * level * Math.min(1.4, Math.max(0.55, 260 / hz) ** 0.25);
    oscillator.setPeriodicWave(this.wave(timbre)); oscillator.frequency.value = hz;
    filter.type = 'lowpass'; filter.frequency.value = Math.min(9000, hz * (timbre === 'piano' ? 6 : 8));
    const decay = timbre === 'piano' ? Math.max(0.35, 2.2 - (midi - 36) * 0.03) : 0.9;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.006);
    gain.gain.setTargetAtTime(peak * 0.25, t + 0.006, decay);
    oscillator.connect(filter).connect(gain).connect(this.out);
    oscillator.start(t);
    this.active.add(oscillator);
    oscillator.onended = () => { this.active.delete(oscillator); oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
    return { oscillator, gain, t };
  }
  stop(): void {
    for (const node of this.active) try { node.stop(); } catch { /* already stopped */ }
    this.active.clear();
  }
}
