import { FrameBuffer } from './frame-buffer';
import { AttackDetector } from './attack';
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class Grabber extends AudioWorkletProcessor {
  private frames = new FrameBuffer(sampleRate);
  private attacks = new AttackDetector(sampleRate);
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    if (this.attacks.process(input,currentTime)) this.port.postMessage({ type: 'attack', t: currentTime });
    for (const frame of this.frames.push(input, currentTime)) this.port.postMessage({ type: 'frame', ...frame }, [frame.samples.buffer]);
    return true;
  }
}
registerProcessor('guitar-grabber', Grabber);
