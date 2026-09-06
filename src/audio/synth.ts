import { midiToHz } from '../music/notes';

export class Synth {
  readonly clickGain: GainNode;
  readonly companionGain: GainNode;
  readonly responseGain: GainNode;
  private responseTarget = 1;
  private oscillators = new Map<OscillatorNode, 'click' | 'echo'>();
  volume = 0.22;
  constructor(readonly context: AudioContext) {
    this.clickGain = context.createGain();
    this.companionGain = context.createGain();
    this.responseGain = context.createGain();
    this.clickGain.connect(context.destination);
    this.companionGain.connect(this.responseGain).connect(context.destination);
    this.setMutes(false,false);
  }
  setResponse(value: number): void {
    const target = Math.max(0.4,Math.min(1,value));
    if (Math.abs(target-this.responseTarget) < 0.005) return;
    const gain = this.responseGain.gain, now = this.context.currentTime;
    gain.cancelAndHoldAtTime(now);
    gain.setTargetAtTime(target,now,target < this.responseTarget ? 0.04 : 0.16);
    this.responseTarget = target;
  }
  setMutes(echo: boolean, click: boolean): void {
    this.companionGain.gain.value = echo ? 0 : this.volume;
    this.clickGain.gain.value = click ? 0 : 0.126;
  }
  click(t: number, downbeat: boolean): void {
    if (this.clickGain.gain.value === 0) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.frequency.value = downbeat ? 1300 : 1000;
    gain.gain.setValueAtTime(0.001,t);
    gain.gain.linearRampToValueAtTime(1,t+0.001);
    gain.gain.exponentialRampToValueAtTime(0.001,t+0.008);
    oscillator.connect(gain).connect(this.clickGain);
    this.track(oscillator,t,t+0.012,'click',() => gain.disconnect());
  }
  note(midi: number, t: number, duration: number, velocity = 0.75): void {
    velocity = Math.max(0.25,Math.min(1,velocity));
    const gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 1200+1600*velocity;
    gain.gain.setValueAtTime(0,t);
    gain.gain.linearRampToValueAtTime(0.65*velocity,t+Math.min(0.012,duration*0.1));
    gain.gain.exponentialRampToValueAtTime(0.32*velocity,t+duration*0.65);
    gain.gain.linearRampToValueAtTime(0,t+duration);
    filter.connect(gain).connect(this.companionGain);
    const oscillator = this.context.createOscillator();
    oscillator.type = 'triangle'; oscillator.frequency.value = midiToHz(midi);
    oscillator.connect(filter);
    this.track(oscillator,t,t+duration+0.005,'echo',() => { gain.disconnect(); filter.disconnect(); });
  }
  private track(oscillator: OscillatorNode, start: number, end: number, channel: 'click' | 'echo', cleanup: () => void): void {
    this.oscillators.set(oscillator,channel);
    oscillator.onended = () => { this.oscillators.delete(oscillator); oscillator.disconnect(); cleanup(); };
    oscillator.start(start); oscillator.stop(end);
  }
  stopEchoes(): void {
    this.companionGain.gain.value = 0;
    for (const [oscillator,channel] of this.oscillators) if (channel === 'echo') {
      try { oscillator.stop(); } catch { /* already stopped */ }
    }
  }
  panic(): void {
    this.setMutes(true,true);
    for (const oscillator of this.oscillators.keys()) { try { oscillator.stop(); } catch { /* already stopped */ } }
    this.oscillators.clear();
  }
}
