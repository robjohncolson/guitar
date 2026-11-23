import { expect, it } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import { BATCH, Crepe } from '../src/audio/crepe';
it('reads a batch in chunks of one fixed shape, in order, matching one frame at a time, and frees every tensor', async () => {
  await tf.setBackend('cpu');
  // A small stand-in Layers model with CREPE's input and output shape (the real weights need WebGL in a browser).
  const model = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [1024], units: 360, activation: 'sigmoid', kernelInitializer: 'glorotUniform' }),
    ],
  });
  const crepe = new Crepe(),
    shapes: number[][] = [];
  const predict = model.predict.bind(model);
  model.predict = ((x: tf.Tensor) => {
    shapes.push(x.shape);
    return predict(x);
  }) as typeof model.predict;
  (crepe as unknown as { model: tf.LayersModel }).model = model;
  const frames = Array.from({ length: 2 * BATCH + 3 }, (_, f) =>
    Float32Array.from({ length: 1024 }, (_, i) => Math.sin((i * (f + 1)) / 40) + 0.3 * Math.cos(i / (f + 2))),
  );
  frames[4] = new Float32Array(1024);
  const before = tf.memory().numTensors;
  const read: number[] = [];
  const batched = await crepe.inferMany(frames, (n) => read.push(n));
  expect(read).toEqual([BATCH, 2 * BATCH, 2 * BATCH + 3]);
  expect(tf.memory().numTensors).toBe(before);
  expect(shapes).toEqual([
    [BATCH, 1024],
    [BATCH, 1024],
    [BATCH, 1024],
  ]);
  expect(batched).toHaveLength(frames.length);
  for (let f = 0; f < frames.length; f++) {
    const single = await crepe.infer(frames[f]);
    expect(batched[f].hz).toBeCloseTo(single.hz, 4);
    expect(batched[f].confidence).toBeCloseTo(single.confidence, 5);
  }
  expect(await crepe.inferMany([])).toEqual([]);
  expect(tf.memory().numTensors).toBe(before);
  model.dispose();
});
it('leaves the batch path off where shaders cannot compile in parallel, so it never adds a page freeze', async () => {
  await tf.setBackend('cpu');
  const model = tf.sequential({ layers: [tf.layers.dense({ inputShape: [1024], units: 360 })] });
  const crepe = new Crepe();
  expect(await crepe.warmBatch()).toBe(false);
  (crepe as unknown as { model: tf.LayersModel }).model = model;
  const before = tf.memory().numTensors;
  expect(await crepe.warmBatch()).toBe(false);
  expect(crepe.batchReady).toBe(false);
  expect(tf.memory().numTensors).toBe(before);
  model.dispose();
});
