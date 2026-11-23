import { afterEach, expect, it, vi } from 'vitest';

const crepe = vi.hoisted(() => ({
  warm: vi.fn(async (_quiet?: () => Promise<void>): Promise<boolean> => true),
  batchReady: false,
  failLoad: false,
}));
vi.mock('../src/audio/crepe', () => ({
  Crepe: class {
    get batchReady() {
      return crepe.batchReady;
    }
    async load() {
      if (crepe.failLoad) throw new Error('no model');
    }
    warmBatch(quiet?: () => Promise<void>) {
      return crepe.warm(quiet);
    }
    async infer() {
      return { hz: 110, confidence: 0.9 };
    }
    dispose() {}
  },
}));
import { Ear } from '../src/audio/ear';
afterEach(() => {
  crepe.warm.mockReset();
  crepe.warm.mockImplementation(async () => true);
  crepe.batchReady = false;
  crepe.failLoad = false;
  vi.restoreAllMocks();
});
it('announces readiness before the batch shape compiles, with the same quiet gate, and reports the batch only once warm', async () => {
  const statuses: string[] = [],
    quiet = async () => {};
  const ear = new Ear(
    (s) => statuses.push(s),
    () => {},
    () => {},
  );
  await ear.load(quiet);
  expect(statuses).toEqual(['CREPE loading', 'CREPE ready (tiny)']);
  expect(ear.batchReady).toBe(false);
  await vi.waitFor(() => expect(crepe.warm).toHaveBeenCalledWith(quiet));
  crepe.batchReady = true;
  expect(ear.batchReady).toBe(true);
});
it('a failed batch warm-up leaves the real model ready, and the fallback never warms a batch', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  crepe.warm.mockImplementation(() => {
    throw new Error('compile failed');
  });
  const statuses: string[] = [];
  const ear = new Ear(
    (s) => statuses.push(s),
    () => {},
    () => {},
  );
  await ear.load();
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('CREPE batch warm-up failed:', expect.any(Error)));
  expect(statuses.at(-1)).toBe('CREPE ready (tiny)');
  expect(ear.batchReady).toBe(false);
  await expect(ear.analyze(new Float32Array(1024))).resolves.toEqual({ hz: 110, confidence: 0.9 });

  crepe.warm.mockClear();
  crepe.failLoad = true;
  crepe.batchReady = true;
  const fallback = new Ear(
    () => {},
    () => {},
    () => {},
  );
  await fallback.load();
  await new Promise((r) => setTimeout(r, 0));
  expect(crepe.warm).not.toHaveBeenCalled();
  expect(fallback.batchReady).toBe(false);
});
