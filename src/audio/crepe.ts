import * as tf from '@tensorflow/tfjs';

export interface Pitch {
  hz: number;
  confidence: number;
}
export const binCents = (bin: number) => 1997.3794084376191 + bin * (7180 / 359);
export function postprocess(activation: ArrayLike<number>): Pitch {
  if (activation.length !== 360) throw new Error('CREPE requires 360 output bins');
  let peak = 0;
  for (let i = 1; i < 360; i++) if (activation[i] > activation[peak]) peak = i;
  let mass = 0,
    cents = 0;
  for (let i = Math.max(0, peak - 4); i < Math.min(360, peak + 5); i++) {
    mass += activation[i];
    cents += activation[i] * binCents(i);
  }
  return { hz: mass > 0 ? 10 * 2 ** (cents / mass / 1200) : 0, confidence: activation[peak] };
}
export function normalize(frame: Float32Array): Float32Array {
  if (frame.length !== 1024) throw new Error('CREPE requires 1024 samples');
  const mean = frame.reduce((a, b) => a + b, 0) / frame.length;
  const centered = frame.map((value) => value - mean);
  const rms = Math.sqrt(centered.reduce((a, b) => a + b * b, 0) / frame.length);
  return rms < 1e-8 ? new Float32Array(1024) : centered.map((value) => value / rms);
}
/** The parts of the tfjs WebGL backend that compile shaders in parallel (tfjs 4.x, not in its public types). */
interface ParallelCompile {
  gpgpu: { parallelCompilationExtension: unknown };
  checkCompileCompletionAsync(): Promise<unknown>;
  getUniformLocations(): void;
}
/** Frames per batched model call. Measured best of 8 and 16 on an integrated GPU and on SwiftShader (no GPU). */
export const BATCH = 8;
export class Crepe {
  private model?: tf.LayersModel;
  /**
   * Compiling the WebGL shaders holds the main thread (seconds on a browser's first visit, before its shader cache
   * fills), so each warm-up first awaits quiet(): the caller resolves it when no take or demo is being timed.
   */
  async load(quiet: () => Promise<void> = async () => {}): Promise<void> {
    if (!(await tf.setBackend('webgl'))) throw new Error('WebGL is unavailable');
    await tf.ready();
    // BASE_URL keeps the model path right when the site is served from a subpath (GitHub Pages) or a root (Vercel, dev).
    this.model = await tf.loadLayersModel(`${import.meta.env.BASE_URL}models/crepe-tiny/model.json`);
    if (this.model.inputs[0].shape[1] !== 1024 || this.model.outputs[0].shape[1] !== 360)
      throw new Error('Unexpected CREPE model shape');
    // Compile WebGL kernels for one frame (the live ear) before announcing readiness. The batch shape is compiled
    // afterwards by warmBatch().
    await quiet();
    await this.infer(new Float32Array(1024));
  }
  /** inferMany's shape is compiled. Until then a take is rechecked one frame at a time, which reads the same pitches. */
  batchReady = false;
  /**
   * Compile inferMany's shape after load(). A new shape needs a new set of shaders, which takes as long as the first
   * set (seconds on a browser's first visit), so it is compiled only with the browser's parallel shader compilation
   * (KHR_parallel_shader_compile): tfjs then compiles without running anything and polls for completion once per frame,
   * and the page stays responsive. Without that extension the batch path stays off rather than freeze the page again.
   * One real batch then compiles the small readback shaders (a fraction of a second, once) and proves the path works
   * before any take uses it. Resolves true once inferMany can run without compiling.
   */
  async warmBatch(quiet: () => Promise<void> = async () => {}): Promise<boolean> {
    if (!this.model || this.batchReady) return this.batchReady;
    const backend = tf.backend() as unknown as Partial<ParallelCompile>;
    if (!backend.gpgpu?.parallelCompilationExtension || !backend.checkCompileCompletionAsync) return false;
    await quiet();
    if (!this.model) return false;
    let output: tf.Tensor;
    // Only the synchronous predict() below sees the flag, so nothing else can run in compile-only mode.
    tf.env().set('ENGINE_COMPILE_ONLY', true);
    try {
      output = tf.tidy(() => this.model!.predict(tf.zeros([BATCH, 1024])) as tf.Tensor);
    } finally {
      tf.env().set('ENGINE_COMPILE_ONLY', false);
    }
    try {
      await backend.checkCompileCompletionAsync();
      backend.getUniformLocations!();
    } finally {
      output.dispose();
    }
    await quiet();
    await this.inferMany([new Float32Array(1024)]);
    return (this.batchReady = true);
  }
  async infer(frame: Float32Array): Promise<Pitch> {
    if (!this.model) throw new Error('CREPE is not loaded');
    const output = tf.tidy(() => this.model!.predict(tf.tensor2d(normalize(frame), [1, 1024])) as tf.Tensor);
    try {
      return postprocess(await output.data());
    } finally {
      output.dispose();
    }
  }
  /**
   * Read many frames with one model call and one readback per chunk of BATCH frames, results in the order given. Each
   * frame is normalized alone, exactly as infer() does. A short chunk is padded with silent frames so every call has
   * the same shape: WebGL compiles a new set of shaders for each new shape (seconds on a cold start), and warmBatch()
   * compiles this one ahead of time. Chunks keep memory bounded on a long take; every tensor is disposed.
   * progress(read) reports how many frames have been read after each chunk.
   */
  async inferMany(frames: Float32Array[], progress?: (read: number) => void, chunk = BATCH): Promise<Pitch[]> {
    if (!this.model) throw new Error('CREPE is not loaded');
    const pitches: Pitch[] = [];
    for (let from = 0; from < frames.length; from += chunk) {
      const part = frames.slice(from, from + chunk),
        input = new Float32Array(chunk * 1024);
      part.forEach((frame, i) => input.set(normalize(frame), i * 1024));
      const output = tf.tidy(() => this.model!.predict(tf.tensor2d(input, [chunk, 1024])) as tf.Tensor);
      try {
        const data = await output.data();
        for (let i = 0; i < part.length; i++) pitches.push(postprocess(data.subarray(i * 360, (i + 1) * 360)));
      } finally {
        output.dispose();
      }
      progress?.(pitches.length);
    }
    return pitches;
  }
  dispose(): void {
    this.model?.dispose();
  }
}
