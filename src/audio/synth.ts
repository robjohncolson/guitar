import { midiToHz } from '../music/notes';

export class Synth {
  readonly clickGain: GainNode;
  readonly companionGain: GainNode;
  readonly responseGain: GainNode;
  private responseTarget = 1;
  private oscillators = new Map<OscillatorNode, {channel:'click' | 'reply';gain:GainNode;end:number}>();
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
    this.track(oscillator,t,t+0.012,'click',gain,() => gain.disconnect());
  }
  note(midi: number, t: number, duration: number, velocity: number): void {
    velocity = Math.max(0.1,Math.min(0.85,velocity));
    const gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 800+1000*velocity;
    gain.gain.setValueAtTime(0,t);
    gain.gain.linearRampToValueAtTime(0.42*velocity,t+Math.min(0.018,duration*0.15));
    gain.gain.exponentialRampToValueAtTime(0.22*velocity,t+duration*0.65);
    gain.gain.linearRampToValueAtTime(0,t+duration);
    filter.connect(gain).connect(this.companionGain);
    const oscillator = this.context.createOscillator();
    oscillator.type = 'triangle'; oscillator.frequency.value = midiToHz(midi);
    oscillator.connect(filter);
    this.track(oscillator,t,t+duration+0.005,'reply',gain,() => { gain.disconnect(); filter.disconnect(); });
  }
  private track(oscillator: OscillatorNode, start: number, end: number, channel: 'click' | 'reply', gain: GainNode, cleanup: () => void): void {
    this.oscillators.set(oscillator,{channel,gain,end});
    oscillator.onended = () => { this.oscillators.delete(oscillator); oscillator.disconnect(); cleanup(); };
    oscillator.start(start); oscillator.stop(end);
  }
  stopNotes(): void {
    const now = this.context.currentTime;
    for (const [oscillator,voice] of this.oscillators) if (voice.channel === 'reply' && voice.end > now) {
      voice.end = Math.min(voice.end,now+0.07);
      voice.gain.gain.cancelAndHoldAtTime(now);
      voice.gain.gain.linearRampToValueAtTime(0,Math.max(now,voice.end-0.005));
      try { oscillator.stop(voice.end); } catch { /* already stopped */ }
    }
  }
  panic(): void {
    this.setMutes(true,true);
    for (const oscillator of this.oscillators.keys()) { try { oscillator.stop(); } catch { /* already stopped */ } }
    this.oscillators.clear();
  }
}
