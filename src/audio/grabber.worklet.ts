import { FrameBuffer } from './frame-buffer';
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class Grabber extends AudioWorkletProcessor {
  private frames = new FrameBuffer(sampleRate);
  private previousSample = 0;
  private highAverage = 0.0005;
  private energyAverage = 0.0005;
  private lastAttack = -1;
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let high = 0, energy = 0;
    for (const value of input) { high += (value - this.previousSample) ** 2; energy += value * value; this.previousSample = value; }
    high = Math.sqrt(high / input.length); energy = Math.sqrt(energy / input.length);
    // Positive high-frequency energy flux catches repeated plucks of the same pitch.
    if (currentTime - this.lastAttack >= 0.04 && energy > 0.003 &&
      ((high > Math.max(0.002, this.highAverage * 2.8)) || energy > this.energyAverage * 2.5)) {
      this.lastAttack = currentTime; this.port.postMessage({ type: 'attack', t: currentTime });
    }
    this.highAverage = 0.85 * this.highAverage + 0.15 * high;
    this.energyAverage = 0.85 * this.energyAverage + 0.15 * energy;
    for (const frame of this.frames.push(input, currentTime)) this.port.postMessage({ type: 'frame', ...frame }, [frame.samples.buffer]);
    return true;
  }
}
registerProcessor('guitar-grabber', Grabber);
