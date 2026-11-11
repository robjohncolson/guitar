import * as tf from '@tensorflow/tfjs';

export interface Pitch { hz: number; confidence: number }
export const binCents = (bin: number) => 1997.3794084376191 + bin * (7180 / 359);
export function postprocess(activation: ArrayLike<number>): Pitch {
  if (activation.length !== 360) throw new Error('CREPE requires 360 output bins');
  let peak = 0;
  for (let i = 1; i < 360; i++) if (activation[i] > activation[peak]) peak = i;
  let mass = 0, cents = 0;
  for (let i = Math.max(0, peak - 4); i < Math.min(360, peak + 5); i++) {
    mass += activation[i]; cents += activation[i] * binCents(i);
  }
  return { hz: mass > 0 ? 10 * 2 ** (cents / mass / 1200) : 0, confidence: activation[peak] };
}
export function normalize(frame: Float32Array): Float32Array {
  if (frame.length !== 1024) throw new Error('CREPE requires 1024 samples');
  const mean = frame.reduce((a, b) => a + b, 0) / frame.length;
  const centered = frame.map(value => value - mean);
  const rms = Math.sqrt(centered.reduce((a, b) => a + b * b, 0) / frame.length);
  return rms < 1e-8 ? new Float32Array(1024) : centered.map(value => value / rms);
}
export class Crepe {
  private model?: tf.LayersModel;
  async load(): Promise<void> {
    if (!await tf.setBackend('webgl')) throw new Error('WebGL is unavailable');
    await tf.ready();
    // BASE_URL keeps the model path right when the site is served from a subpath (GitHub Pages) or a root (Vercel, dev).
    this.model = await tf.loadLayersModel(`${import.meta.env.BASE_URL}models/crepe-tiny/model.json`);
    if (this.model.inputs[0].shape[1] !== 1024 || this.model.outputs[0].shape[1] !== 360) throw new Error('Unexpected CREPE model shape');
    // Compile WebGL kernels before announcing readiness.
    await this.infer(new Float32Array(1024));
  }
  async infer(frame: Float32Array): Promise<Pitch> {
    if (!this.model) throw new Error('CREPE is not loaded');
    const output = tf.tidy(() => this.model!.predict(tf.tensor2d(normalize(frame), [1, 1024])) as tf.Tensor);
    try { return postprocess(await output.data()); } finally { output.dispose(); }
  }
  dispose(): void { this.model?.dispose(); }
}
