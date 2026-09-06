import type { Role } from '../music/voice/types';
import { midiToHz } from '../music/notes';

export class Synth {
  readonly clickGain: GainNode;
  readonly companionGain: GainNode;
  private oscillators = new Set<OscillatorNode>();
  volume = 0.22;
  constructor(readonly context: AudioContext) {
    this.clickGain = context.createGain();
    this.companionGain = context.createGain();
    this.clickGain.connect(context.destination);
    this.companionGain.connect(context.destination);
    this.setMutes(false, false);
  }
  setMutes(companion: boolean, click: boolean): void {
    this.companionGain.gain.value = companion ? 0 : this.volume;
    this.clickGain.gain.value = click ? 0 : 0.126;
  }
  click(t: number, downbeat: boolean): void {
    if (this.clickGain.gain.value === 0) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = downbeat ? 1300 : 1000;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
    oscillator.connect(gain).connect(this.clickGain);
    this.track(oscillator, t, t + 0.012, () => gain.disconnect());
  }
  note(midi: number, t: number, duration: number, role: Role): void {
    const gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = role === 'bass' ? 600 : role === 'harmony' ? 3000 : role === 'call-response' ? 1800 : 2000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.65, t + Math.min(0.012, duration * 0.1));
    gain.gain.setTargetAtTime(0.38, t + duration * 0.2, duration * 0.2);
    gain.gain.setValueAtTime(0.32, t + duration * 0.65);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    filter.connect(gain).connect(this.companionGain);
    const oscillator = this.context.createOscillator();
    oscillator.type = role === 'bass' ? 'sine' : 'triangle'; oscillator.frequency.value = midiToHz(midi);
    oscillator.connect(filter);
    this.track(oscillator, t, t + duration + 0.005, () => { gain.disconnect(); filter.disconnect(); });
    if (role === 'call-response') {
      const square = this.context.createOscillator(), mix = this.context.createGain();
      square.type = 'square'; square.frequency.value = midiToHz(midi); mix.gain.value = 0.08;
      square.connect(mix).connect(filter);
      this.track(square, t, t+duration, () => mix.disconnect());
    }
  }
  protected track(oscillator: OscillatorNode, start: number, end: number, cleanup: () => void): void {
    this.oscillators.add(oscillator);
    oscillator.onended = () => { this.oscillators.delete(oscillator); oscillator.disconnect(); cleanup(); };
    oscillator.start(start); oscillator.stop(end);
  }
  panic(): void {
    this.setMutes(true, true);
    for (const oscillator of this.oscillators) { try { oscillator.stop(); } catch { /* already ended */ } }
    this.oscillators.clear();
  }
}
