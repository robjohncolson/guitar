export interface CaptureFrame { t: number; samples: Float32Array; rms: number }
export class FrameBuffer {
  readonly buffer: Float32Array;
  private written = 0;
  private nextEnd: number;
  constructor(readonly rate: number, readonly hop = 320) {
    this.buffer = new Float32Array(2 ** Math.ceil(Math.log2(rate / 16000 * 1024)));
    this.nextEnd = Math.ceil(rate / 16000 * 1024);
  }
  push(input: Float32Array, blockStart: number): CaptureFrame[] {
    const frames: CaptureFrame[] = [];
    for (let j = 0; j < input.length; j++) {
      this.buffer[this.written % this.buffer.length] = input[j];
      this.written++;
      if (this.written < this.nextEnd) continue;
      const frame = new Float32Array(1024), ratio = this.rate / 16000;
      const start = this.written - 1 - 1023 * ratio;
      let energy = 0;
      for (let i = 0; i < 1024; i++) {
        const position = start + i * ratio, floor = Math.floor(position), fraction = position - floor;
        const a = this.buffer[(floor + this.buffer.length) % this.buffer.length];
        const b = this.buffer[(floor + 1 + this.buffer.length) % this.buffer.length];
        frame[i] = a + fraction * (b - a); energy += frame[i] ** 2;
      }
      frames.push({ t: blockStart + (j + 1) / this.rate - 0.032, samples: frame, rms: Math.sqrt(energy / 1024) });
      this.nextEnd += this.hop * ratio;
    }
    return frames;
  }
}
