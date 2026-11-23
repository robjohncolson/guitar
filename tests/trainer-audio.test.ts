import { afterEach, expect, it, vi } from 'vitest';
const inference = vi.hoisted(() => ({
  infer: vi.fn(),
  inferMany: vi.fn(),
  ears: 0,
  // The model load: resolves at once unless a test holds it, then reports this status.
  gate: undefined as Promise<void> | undefined,
  status: 'CREPE ready (tiny)',
  quiet: undefined as (() => Promise<void>) | undefined,
  // Whether the batch shape has compiled (Crepe.warmBatch).
  batchReady: true,
}));
vi.mock('../src/audio/ear', () => ({
  Ear: class {
    onsets = {};
    receive = () => {};
    resetCapture = () => {};
    analyze = inference.infer;
    analyzeMany = inference.inferMany;
    get batchReady() {
      return inference.batchReady;
    }
    constructor(readonly status: (s: string) => void) {
      inference.ears++;
    }
    async load(quiet?: () => Promise<void>) {
      inference.quiet = quiet;
      this.status('CREPE loading');
      await inference.gate;
      this.status(inference.status);
    }
  },
}));
import { TrainerAudio } from '../src/trainer/audio';
import { lessons } from '../src/trainer/curriculum';
import { LoopEngine, loopFrames } from '../src/audio/loop-engine';
afterEach(() => {
  vi.unstubAllGlobals();
  inference.ears = 0;
  inference.gate = undefined;
  inference.status = 'CREPE ready (tiny)';
  inference.batchReady = true;
  inference.infer.mockReset();
  inference.inferMany.mockReset();
});
const gain = () => ({
  gain: { value: 0 },
  connect() {
    return this;
  },
  disconnect() {},
});
function stubAudio(getUserMedia: () => Promise<unknown>): void {
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 1;
      sampleRate = 48000;
      outputLatency = 0.04;
      destination = {};
      resume = async () => {};
      createGain = gain;
      audioWorklet = { addModule: vi.fn() };
    },
  );
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
}
it('a rhythm-only lesson and calibration open the microphone without loading the pitch ear', async () => {
  inference.gate = new Promise(() => {});
  const getUserMedia = vi.fn(() => new Promise(() => {}));
  stubAudio(getUserMedia);
  const audio = new TrainerAudio(),
    rhythm = lessons.find((l) => l.rhythmOnly)!;
  void audio.start(rhythm, 60, 'practice');
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  void audio.start(lessons[0], 60, 'calibration');
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  expect(inference.ears).toBe(0);
  expect(audio.model).toBe('Pitch ear loading…');
  // Not loaded yet is not a problem, so the status line does not ask for attention.
  expect(audio.pitchTrouble).toBe(false);
  audio.stop();
});
it('a pitched take waits for the pitch ear, which loads once, and refuses the labelled fallback', async () => {
  let open!: () => void;
  inference.gate = new Promise((r) => (open = r));
  const getUserMedia = vi.fn(() => new Promise(() => {}));
  stubAudio(getUserMedia);
  const audio = new TrainerAudio();
  audio.prefetchEar();
  void audio.start(lessons[0], 60, 'practice');
  await vi.waitFor(() => expect(inference.ears).toBe(1));
  await new Promise((r) => setTimeout(r, 20));
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(audio.model).toBe('Pitch ear loading…');
  expect(audio.pitchReady).toBe(false);
  expect(audio.pitchTrouble).toBe(false);
  open();
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  expect(audio.model).toBe('Pitch ear ready');
  expect(audio.pitchReady).toBe(true);
  expect(audio.pitchTrouble).toBe(false);
  expect(inference.ears).toBe(1);
  audio.stop();

  inference.gate = undefined;
  inference.status = 'FALLBACK: YIN';
  const fallback = new TrainerAudio();
  await fallback.start(lessons[0], 60, 'practice');
  expect(fallback.model).toBe('FALLBACK: YIN');
  expect(fallback.pitchTrouble).toBe(true);
  expect(fallback.error).toMatch(/pitch ear is not ready/);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});
it('holds the model warm-up while a take or demo is being timed', async () => {
  const audio = new TrainerAudio();
  await audio.loadEar();
  audio.plan = { kind: 'demo', start: 0, playAt: 1, end: 9, finish: 9.65, period: 1, support: 0, events: [] };
  let quiet = false;
  void inference.quiet!().then(() => (quiet = true));
  await new Promise((r) => setTimeout(r, 250));
  expect(quiet).toBe(false);
  audio.stop();
  await vi.waitFor(() => expect(quiet).toBe(true));
});
it('closes late microphone permission after Stop without starting transport or worklets', async () => {
  let resolve!: (s: unknown) => void;
  const stop = vi.fn();
  stubAudio(() => new Promise((r) => (resolve = r)));
  const audio = new TrainerAudio(),
    starting = audio.start(lessons[0], 60, 'practice');
  await vi.waitFor(() => expect(resolve).toBeDefined());
  audio.stop();
  resolve({ getTracks: () => [{ stop }] });
  await starting;
  expect(stop).toHaveBeenCalledOnce();
  expect(audio.plan).toBeUndefined();
  expect(audio.busy).toBe(false);
  expect(audio.micActive).toBe(false);
});
it('captures short lessons with a tail while preserving the original sixteen-beat default', () => {
  const engine = new LoopEngine(1000);
  engine.command({ type: 'record', id: 1, bpm: 60, startFrame: 0, beats: 9 }, 0);
  engine.process(0, new Float32Array(9100).fill(0.1), new Float32Array(9100));
  expect(engine.take?.samples.length).toBe(9000);
  expect(loopFrames(1000, 60)).toBe(16000);
  engine.command({ type: 'clear' }, 9100);
  engine.command({ type: 'record', id: 2, bpm: 60, startFrame: 9200, beats: Infinity }, 9100);
  engine.process(9100, undefined, new Float32Array(100));
  expect(engine.take).toBeUndefined();
});
/** Put a recorded practice take (one plucked A2) in place, as the take's end would. */
function recordedTake(audio: TrainerAudio): Promise<void> {
  audio.context = { currentTime: 10, sampleRate: 48000 } as AudioContext;
  const samples = new Float32Array(444000);
  for (let i = 24000; i < 48000; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 110 * i) / 48000);
  const internals = audio as any;
  internals.capture = {
    id: 1,
    from: 0.5,
    samples,
    copied: samples.length,
    ready: true,
    evidence: { result: () => ({ attacks: [], coverage: 1, clipped: 0 }) },
  };
  internals.current = { lesson: lessons[0], bpm: 60, offset: 0 };
  audio.plan = { kind: 'practice', start: 0, playAt: 1, end: 9, finish: 9.65, period: 1, support: 0, events: [] };
  return internals.complete();
}
it('rechecks a take one frame at a time until the batch shape has compiled', async () => {
  inference.batchReady = false;
  inference.infer.mockImplementation(async () => ({ hz: 110, confidence: 0.9 }));
  const audio = new TrainerAudio(),
    onTake = vi.fn();
  await audio.loadEar();
  audio.onTake = onTake;
  await recordedTake(audio);
  expect(inference.infer).toHaveBeenCalled();
  expect(inference.inferMany).not.toHaveBeenCalled();
  expect(onTake).toHaveBeenCalledOnce();
});
it('Stop during recorded-note analysis never publishes an abandoned take', async () => {
  let resolve!: (pitches: { hz: number; confidence: number }[]) => void,
    count = 0;
  inference.inferMany.mockImplementation((frames: Float32Array[]) => {
    count = frames.length;
    return new Promise((r) => (resolve = r));
  });
  const audio = new TrainerAudio(),
    onTake = vi.fn();
  await audio.loadEar();
  audio.onTake = onTake;
  audio.context = { currentTime: 10, sampleRate: 48000 } as AudioContext;
  const samples = new Float32Array(444000);
  for (let i = 24000; i < 48000; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 110 * i) / 48000);
  const internals = audio as any;
  internals.capture = {
    id: 1,
    from: 0.5,
    samples,
    copied: samples.length,
    ready: true,
    evidence: { result: () => ({ attacks: [], coverage: 1, clipped: 0 }) },
  };
  internals.current = { lesson: lessons[0], bpm: 60, offset: 0 };
  audio.plan = { kind: 'practice', start: 0, playAt: 1, end: 9, finish: 9.65, period: 1, support: 0, events: [] };
  const completed = internals.complete();
  await vi.waitFor(() => expect(resolve).toBeDefined());
  audio.stop();
  resolve(Array.from({ length: count }, () => ({ hz: 110, confidence: 0.9 })));
  await completed;
  expect(inference.infer).not.toHaveBeenCalled();
  expect(onTake).not.toHaveBeenCalled();
  expect(audio.take).toBeUndefined();
  expect(audio.busy).toBe(false);
  expect(audio.plan).toBeUndefined();
});
it('Stop during the one-at-a-time recheck (batch shape not compiled yet) never publishes an abandoned take', async () => {
  inference.batchReady = false;
  let resolve!: (pitch: { hz: number; confidence: number }) => void;
  inference.infer.mockImplementation(() => new Promise((r) => (resolve = r)));
  const audio = new TrainerAudio(),
    onTake = vi.fn();
  await audio.loadEar();
  audio.onTake = onTake;
  const completed = recordedTake(audio);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  audio.stop();
  resolve({ hz: 110, confidence: 0.9 });
  await completed;
  expect(inference.inferMany).not.toHaveBeenCalled();
  expect(onTake).not.toHaveBeenCalled();
  expect(audio.take).toBeUndefined();
  expect(audio.busy).toBe(false);
  expect(audio.plan).toBeUndefined();
});
