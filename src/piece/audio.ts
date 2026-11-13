import recorderUrl from '../audio/looper.worklet.ts?worker&url';
import { enableContext, microphoneConstraints, outputDelay, type OutputMode } from '../audio/context';
import { edgeGain, type LoopEvent } from '../audio/loop-engine';
import { loopLevelGain } from '../audio/loop-level';
import { loopWav } from '../audio/loop-wav';
import { calibrate, pipOnsets, type Calibration } from '../trainer/calibration';
import type { Ear } from '../audio/ear';
import { analyzeTake } from '../trainer/analyze';
import { gradeAttacks, gradeKeys, type KeyPress, type PieceGrade } from './grade';
import { planExercise, type PieceKind, type PiecePlan, type Sound } from './plan';
import { PieceVoice } from './voice';
import type { Exercise, XEvent } from './exercise';
import type { AnalysisRequest } from './analysis.worker';

export interface PieceTake {
  id: number; exercise: Exercise; unit: string; bpm: number; support: number; kind: PieceKind; offset: number; calibrated?: boolean;
  samples: Float32Array; rate: number; levelGain: number; result?: PieceGrade;
  /** Keys takes: what was pressed, in seconds from the first beat. Such takes have no audio. */
  presses?: KeyPress[];
  /** Why the take was marked interrupted, if it was. */
  interruption?: string;
}
interface Capture { id: number; from: number; samples: Float32Array; copied: number; ready: boolean }

/** One AudioContext per page. Demonstrations and scoring never overlap; Stop releases the microphone and all sound. */
export class PieceAudio {
  context?: AudioContext;
  error = ''; busy = false; analysis = ''; level = 0; model = 'not needed';
  plan?: PiecePlan; take?: PieceTake; previous?: PieceTake;
  mode: OutputMode = 'headphones'; volume = 0.5; click = true; deviceKey = ''; checkPitch = true;
  /** mic: listen to an acoustic instrument. keys: grade the computer keyboard or MIDI presses; no microphone. */
  input: 'mic' | 'keys' = 'mic';
  /** Keys held right now, for the lane, and the release for each one that sounds. */
  readonly held = new Set<number>();
  private releases = new Map<number, () => void>();
  private presses?: KeyPress[];
  /** The keys take being replayed, while it plays. */
  replaying?: PieceTake;
  onTake: (take: PieceTake) => void = () => {};
  onCalibration: (result: Calibration) => void = () => {};
  private voice?: PieceVoice;
  private ear?: Ear;
  private earLoading?: Promise<Ear>;
  private worker?: Worker;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private recorder?: AudioWorkletNode;
  private silent?: GainNode;
  private playback?: AudioBufferSourceNode;
  private playbackGain?: GainNode;
  private pips: OscillatorNode[] = [];
  private generation = 0;
  private sequence = 0;
  private capture?: Capture;
  private current?: { exercise: Exercise; unit: string; bpm: number; offset: number };
  private index = 0;
  private lastTick = 0;
  private interrupted = false;
  /** Why the current take was marked interrupted, for the note details. */
  why = '';
  private modules = false;
  get micActive(): boolean { return Boolean(this.stream); }
  get playing(): boolean { return Boolean(this.playback); }
  get now(): number { return this.context?.currentTime ?? 0; }
  private closeMic(): void {
    this.source?.disconnect(); this.source = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.recorder?.disconnect(); this.recorder?.port.close(); this.recorder = undefined;
    this.silent?.disconnect(); this.silent = undefined;
  }
  stop(): void {
    this.generation++; this.busy = false; this.analysis = ''; this.plan = undefined; this.capture = undefined; this.current = undefined; this.level = 0;
    this.closeMic(); this.voice?.stop(); this.releases.clear(); this.presses = undefined; this.replaying = undefined;
    for (const pip of this.pips) try { pip.stop(); } catch { /* ended */ }
    this.pips = [];
    try { this.playback?.stop(); } catch { /* ended */ }
    this.playback = undefined; this.playbackGain?.disconnect(); this.playbackGain = undefined;
  }
  /** CREPE (and TensorFlow.js) load only when a guitar take needs pitch. */
  private async loadEar(): Promise<Ear> {
    this.earLoading ??= import('../audio/ear').then(async ({ Ear }) => {
      const ear = new Ear(text => this.model = text, () => {}, () => {});
      await ear.load();
      return this.ear = ear;
    });
    return this.earLoading;
  }
  private async microphone(generation: number): Promise<boolean> {
    const context = this.context!;
    const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(this.mode));
    try {
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      if (!this.modules) { await context.audioWorklet.addModule(recorderUrl); this.modules = true; }
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream;
      const device = stream.getAudioTracks()[0]?.getSettings().deviceId ?? 'default';
      this.deviceKey = `${device}|${context.sampleRate}|${this.mode}`;
      this.recorder = new AudioWorkletNode(context, 'guitar-looper', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.silent = context.createGain(); this.silent.gain.value = 0;
      this.recorder.connect(this.silent); this.silent.connect(context.destination);
      this.source = context.createMediaStreamSource(stream); this.source.connect(this.recorder);
      this.recorder.port.onmessage = event => { if (generation === this.generation) this.receive(event.data as LoopEvent); };
      this.recorder.onprocessorerror = () => { this.error = 'The audio processor stopped. Please start a new take.'; this.stop(); };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (this.stream === stream) { this.error = 'The microphone disconnected. Please start a new take.'; this.stop(); } }));
      return true;
    } catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  }
  /** practice: count-in then a recorded, graded take. demo: listen only. calibration: eight pips through the audio path. */
  async start(exercise: Exercise, unit: string, bpm: number, kind: PieceKind, support = 0, offset = 0, demonstrate = false, backing: XEvent[] = []): Promise<void> {
    this.stop(); this.error = ''; this.busy = true;
    const generation = this.generation;
    try {
      this.context = await enableContext(this.context); if (generation !== this.generation) return;
      await this.settle(); if (generation !== this.generation) return;
      this.voice ??= new PieceVoice(this.context); this.voice.volume = this.volume;
      const needsPitch = kind === 'practice' && exercise.instrument === 'guitar' && exercise.events.some(e => e.grade === 'pitch');
      if (needsPitch) {
        const ear = await this.loadEar(); if (generation !== this.generation) return;
        if (!this.model.startsWith('CREPE ready')) throw new Error('CREPE is not ready. Reload to retry; plucked-note checks need the real pitch model.');
        void ear;
      }
      const keys = kind === 'practice' && this.input === 'keys' && exercise.instrument === 'piano';
      if (kind !== 'demo' && !keys && !await this.microphone(generation)) return;
      this.plan = planExercise(exercise, bpm, this.now + outputDelay(this.context), kind, support, demonstrate, backing);
      this.current = { exercise, unit, bpm, offset }; this.index = 0; this.lastTick = this.now; this.interrupted = false; this.why = '';
      if (keys) this.presses = [];
      else if (kind !== 'demo') {
        const plan = this.plan, rate = this.context.sampleRate, from = plan.playAt - (kind === 'calibration' ? 0.25 : 0.5), until = plan.end + 0.75;
        const length = Math.round((until - from) * rate), id = ++this.sequence;
        this.capture = { id, from, samples: new Float32Array(length), copied: 0, ready: false };
        // Recording length is expressed against a nominal 60 BPM so very slow tempos stay within the recorder's limits.
        this.recorder!.port.postMessage({ type: 'record', id, bpm: 60, beats: until - from, startFrame: Math.round(from * rate) });
      }
    } catch (error) { if (generation === this.generation) { this.stop(); this.error = error instanceof Error ? error.message : String(error); } }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private receive(event: LoopEvent): void {
    const capture = this.capture; if (!capture) return;
    if (event.type === 'error') { this.error = event.message; this.stop(); return; }
    if (event.type === 'chunk' && event.id === capture.id) {
      if (event.offset !== capture.copied || event.offset + event.samples.length > capture.samples.length) { this.interrupted = true; return; }
      capture.samples.set(event.samples, event.offset); capture.copied += event.samples.length;
      let peak = 0; for (const v of event.samples) peak = Math.max(peak, Math.abs(v));
      this.level = Math.max(peak, this.level * 0.8);
    }
    if (event.type === 'take' && event.id === capture.id) { capture.ready = true; this.recorder?.port.postMessage({ type: 'stop' }); }
  }
  private sound(event: Sound): void {
    const context = this.context!, at = event.at - outputDelay(context);
    if (event.kind === 'click') { if (this.click || event.at < this.plan!.playAt) this.voice!.click(at, Boolean(event.accent), event.level ?? 1); return; }
    if (event.kind === 'note') { this.voice!.play(event.midi!, at, event.length, event.level ?? 0.7, event.timbre); return; }
    const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.frequency.value = 1000;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.25, at + 0.001); gain.gain.linearRampToValueAtTime(0, at + 0.009);
    oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.011); this.pips.push(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.pips = this.pips.filter(p => p !== oscillator); };
  }
  tick(): void {
    const plan = this.plan, context = this.context; if (!plan || !context) return;
    if (context.state !== 'running') { this.error = 'Audio paused. Start again when you are ready.'; this.stop(); return; }
    const now = context.currentTime;
    if (now - this.lastTick > 0.25) { this.interrupted = true; this.why ||= `timer gap ${(now - this.lastTick).toFixed(2)} s at ${(now - plan.start).toFixed(2)} s`; }
    this.lastTick = now;
    while (this.index < plan.sounds.length && plan.sounds[this.index].at - outputDelay(context) <= now + 0.12) {
      const event = plan.sounds[this.index++];
      if (event.at - outputDelay(context) < now - 0.03) { this.interrupted = true; this.why ||= `sound late by ${(now - event.at + outputDelay(context)).toFixed(2)} s at ${(now - plan.start).toFixed(2)} s`; continue; }
      this.sound(event);
    }
    if (now < plan.finish) return;
    if (plan.kind === 'demo') { this.plan = undefined; this.replaying = undefined; return; }
    if (!this.presses && !this.capture?.ready && now < plan.end + 2) return;
    void this.complete();
  }
  private analyse(request: Omit<AnalysisRequest, 'id'>): Promise<PieceGrade> {
    this.worker ??= new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker, id = ++this.sequence, copy = request.take.samples.slice();
    return new Promise((resolve, reject) => {
      const done = () => { worker.removeEventListener('message', listen); worker.removeEventListener('error', fail); worker.removeEventListener('messageerror', fail); };
      const listen = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        done();
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
      };
      // A worker that cannot load (for example a stale tab after a new deploy) must not leave the take hanging.
      const fail = () => { done(); worker.terminate(); if (this.worker === worker) this.worker = undefined; reject(new Error('The piece analyser could not load. Reload the page.')); };
      worker.addEventListener('message', listen);
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
      worker.postMessage({ ...request, id, take: { ...request.take, samples: copy } }, [copy.buffer]);
    });
  }
  /**
   * A just-started AudioContext's clock can leap a few hundred milliseconds while the output device opens, which
   * would mark the first take interrupted. Wait (at most about a second) until it ticks evenly; a warm clock passes at once.
   */
  private async settle(): Promise<void> {
    const context = this.context!;
    let last = context.currentTime;
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const t = context.currentTime;
      if (t > 0.3 && t - last < 0.1) return;
      last = t;
    }
  }
  /** A key went down: sound it (unless the instrument makes its own) and, during a keys take, record when on the audio clock. */
  async keyDown(midi: number, stamp: number, sound: boolean): Promise<void> {
    this.held.add(midi);
    if (this.context && this.presses && this.plan) {
      const t = this.context.currentTime - Math.max(0, performance.now() - stamp) / 1000;
      if (t >= this.plan.playAt - 0.5 && t <= this.plan.end + 0.5) this.presses.push({ t: t - this.plan.playAt, midi });
    }
    if (!sound) return;
    try { this.context = await enableContext(this.context); } catch { return; }
    this.voice ??= new PieceVoice(this.context); this.voice.volume = this.volume;
    if (!this.held.has(midi)) return;
    this.releases.get(midi)?.();
    this.releases.set(midi, this.voice.hold(midi, 0.75));
  }
  /** Ready the voice ahead of time (a click is a user gesture), so notes the app plays sound at once. */
  async prepare(): Promise<void> {
    this.context = await enableContext(this.context);
    this.voice ??= new PieceVoice(this.context); this.voice.volume = this.volume;
  }
  /** One note now, for notes played on the player's behalf. */
  playNote(midi: number, length: number): void {
    if (this.context && this.voice) this.voice.play(midi, this.context.currentTime, Math.min(6, Math.max(0.15, length)), 0.5);
  }
  keyUp(midi: number): void {
    this.held.delete(midi);
    const open = this.presses && this.plan && this.context ? [...this.presses].reverse().find(p => p.midi === midi && p.dur === undefined) : undefined;
    if (open) open.dur = Math.max(0.05, this.context!.currentTime - this.plan!.playAt - open.t);
    this.releases.get(midi)?.(); this.releases.delete(midi);
  }
  /** Replay a keys take on the piano voice while the lane scrolls with it. */
  async replayKeys(take = this.take): Promise<void> {
    if (!take?.presses) return;
    this.stop();
    const generation = this.generation;
    this.context = await enableContext(this.context); if (generation !== this.generation) return;
    await this.settle(); if (generation !== this.generation) return;
    this.voice ??= new PieceVoice(this.context); this.voice.volume = this.volume;
    const period = 60 / take.bpm, first = Math.min(0, ...take.presses.map(p => p.t));
    const start = this.now + outputDelay(this.context) + 0.4 - first, end = start + take.exercise.beats * period;
    const sounds: Sound[] = take.presses.map(p => ({ at: start + p.t, kind: 'note' as const, midi: p.midi, length: Math.min(6, p.dur ?? 0.6), level: 0.75, timbre: 'piano' as const })).sort((a, b) => a.at - b.at);
    this.plan = { kind: 'demo', start, playAt: start, end, finish: Math.max(end, ...sounds.map(s => s.at + s.length)) + 0.8, period, support: 0, beatsPerBar: take.exercise.beatsPerBar, sounds };
    this.index = 0; this.lastTick = this.now; this.interrupted = false; this.why = ''; this.replaying = take;
  }
  private completeKeys(): void {
    const plan = this.plan!, current = this.current!, presses = this.presses ?? [];
    const result = gradeKeys(current.exercise, current.bpm, presses, this.interrupted);
    const take: PieceTake = { id: ++this.sequence, exercise: current.exercise, unit: current.unit, bpm: current.bpm, support: plan.support, kind: plan.kind, offset: 0, samples: new Float32Array(0), rate: this.context!.sampleRate, levelGain: 1, result, presses, interruption: this.why || undefined };
    this.stop(); this.previous = this.take; this.take = take; this.onTake(take);
  }
  private async complete(): Promise<void> {
    if (this.presses) { this.completeKeys(); return; }
    const capture = this.capture!, plan = this.plan!, current = this.current!, context = this.context!, generation = this.generation;
    this.plan = undefined; this.busy = true; this.analysis = 'Listening back to the take…';
    if (plan.kind === 'calibration') {
      const observed = pipOnsets(capture.samples, context.sampleRate).map(t => t + capture.from);
      const expected = plan.sounds.map(e => e.at - outputDelay(context));
      const result = calibrate(expected, observed, outputDelay(context)); this.stop(); this.onCalibration(result); return;
    }
    this.closeMic();
    const rate = context.sampleRate, playAt = plan.playAt - capture.from;
    let clipped = 0; for (const v of capture.samples) if (Math.abs(v) >= 0.999) clipped++;
    const coverage = capture.samples.length ? Math.min(1, capture.copied / capture.samples.length) : 0, interrupted = this.interrupted || !capture.ready;
    let result: PieceGrade | undefined;
    try {
      if (current.exercise.instrument === 'piano') {
        result = await this.analyse({ exercise: current.exercise, bpm: current.bpm, offset: current.offset, checkPitch: this.checkPitch, from: Math.max(0, playAt - 0.3), to: playAt + (plan.end - plan.playAt) + 0.4,
          take: { samples: capture.samples, rate, playAt, coverage, clipped: clipped / Math.max(1, capture.samples.length), interrupted, clicks: this.mode === 'speakers' && this.click } });
      } else {
        const pitched = current.exercise.events.some(e => e.grade === 'pitch');
        const ear = pitched ? await this.loadEar() : undefined;
        const attacks = await analyzeTake(capture.samples, rate, playAt, plan.end - plan.playAt, frame => ear!.analyze(frame), () => generation === this.generation, (done, total) => this.analysis = `Checking note ${done} of ${total}…`, !pitched);
        result = gradeAttacks(current.exercise, current.bpm, attacks, { coverage, clipped: clipped / Math.max(1, capture.samples.length), interrupted }, current.offset);
      }
    } catch (error) { if (generation === this.generation) { this.stop(); this.error = error instanceof Error ? error.message : String(error); } return; }
    if (generation !== this.generation) return;
    const length = Math.round((plan.end - plan.playAt) * rate), from = Math.round((plan.playAt + current.offset - capture.from) * rate);
    const samples = capture.samples.slice(Math.max(0, from), Math.max(0, from) + length);
    let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
    const take: PieceTake = { id: capture.id, exercise: current.exercise, unit: current.unit, bpm: current.bpm, support: plan.support, kind: plan.kind, offset: current.offset, samples, rate, levelGain: loopLevelGain(peak), result, interruption: this.why || undefined };
    this.stop(); this.previous = this.take; this.take = take; this.onTake(take);
  }
  async playTake(take = this.take, loop = false): Promise<void> {
    if (!take) return;
    this.stop();
    const generation = this.generation;
    this.context = await enableContext(this.context); if (generation !== this.generation) return;
    const context = this.context, buffer = context.createBuffer(1, take.samples.length, take.rate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = take.samples[i] * take.levelGain * edgeGain(i, data.length, take.rate);
    const player = context.createBufferSource(), gain = context.createGain(); player.buffer = buffer; player.loop = loop; gain.gain.value = this.volume;
    player.connect(gain).connect(context.destination); this.playback = player; this.playbackGain = gain;
    player.onended = () => { player.disconnect(); gain.disconnect(); if (this.playback === player) { this.playback = undefined; this.playbackGain = undefined; } };
    player.start();
  }
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.voice) this.voice.volume = this.volume;
    this.playbackGain?.gain.setTargetAtTime(this.volume, this.now, 0.02);
  }
  wav(take = this.take): Uint8Array<ArrayBuffer> | undefined { return take ? loopWav(take.samples, take.rate, take.levelGain) : undefined; }
  dispose(): void { this.stop(); this.worker?.terminate(); this.worker = undefined; }
}
