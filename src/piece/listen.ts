/**
 * Piano listening on a stored take. Attacks come from log spectral flux (score-free). Each expected note is then
 * judged only from partials that are its own: they must rise at the attack, and a lower or neighbouring note must
 * not explain them better. Doubled partials make a note "cannot check"; weak or mixed evidence is "unclear".
 */
export type NoteVerdict = 'heard' | 'not-heard' | 'unclear' | 'cannot-check' | 'wrong';
export interface PianoOnset { t: number; strength: number }
export interface Spectrum { mag: Float32Array; binHz: number; seconds: number }

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();
/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let table = twiddles.get(n);
  if (!table) {
    table = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) { table.cos[i] = Math.cos(-2 * Math.PI * i / n); table.sin[i] = Math.sin(-2 * Math.PI * i / n); }
    twiddles.set(n, table);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) for (let j = 0; j < half; j++) {
      const c = table.cos[j * step], s = table.sin[j * step], a = i + j, b = a + half;
      const br = re[b] * c - im[b] * s, bi = re[b] * s + im[b] * c;
      re[b] = re[a] - br; im[b] = im[a] - bi; re[a] += br; im[a] += bi;
    }
  }
}
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
const hann = new Map<number, Float64Array>();
function windowOf(length: number): Float64Array {
  let w = hann.get(length);
  if (!w) { w = Float64Array.from({ length }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / length)); hann.set(length, w); }
  return w;
}
/** Hann-windowed amplitude spectrum of [start, start + seconds). A steady sine reads its amplitude whatever the length. */
export function spectrum(samples: Float32Array, rate: number, start: number, seconds: number, minSize = 8192): Spectrum {
  const from = Math.max(0, Math.round(start * rate)), length = Math.max(16, Math.min(samples.length - from, Math.round(seconds * rate)));
  const size = Math.max(minSize, pow2(length)), re = new Float64Array(size), im = new Float64Array(size), w = windowOf(length);
  let sum = 0;
  for (let i = 0; i < length; i++) { re[i] = (samples[from + i] ?? 0) * w[i]; sum += w[i]; }
  fft(re, im);
  const mag = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = 2 * Math.hypot(re[i], im[i]) / sum;
  return { mag, binHz: rate / size, seconds: length / rate };
}
export const db = (x: number) => 20 * Math.log10(x + 1e-9);
export const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Typical piano string stiffness: upper partials run sharp, more so in the treble. */
const stiffness = (midi: number) => 10 ** (-4.8 + 0.035 * (midi - 21));
export const partialHz = (midi: number, k: number, cents = 0) => k * midiHz(midi) * Math.sqrt(1 + stiffness(midi) * k * k) * 2 ** (cents / 1200);
/** The app's metronome pips: their bands are ignored when clicks may have leaked into the microphone. */
const CLICK_BANDS = [1000, 1300, 2000, 2600, 3000, 3900];
export const inClickBand = (hz: number) => CLICK_BANDS.some(c => Math.abs(hz - c) < 70);

/**
 * Log-filtered spectral flux in semitone bands with a 5 ms hop. Each band is compared with the loudest neighbouring
 * band 15 ms earlier (SuperFlux), so slow beating between partials does not look like a new attack. Score-free.
 */
export function pianoOnsets(samples: Float32Array, rate: number, from = 0, to = samples.length / rate, clicks = false): PianoOnset[] {
  const size = pow2(rate * 0.04), hop = Math.round(rate * 0.005), w = windowOf(size);
  const binHz = rate / size, edges: number[] = [];
  for (let m = 26; m <= 102; m++) edges.push(Math.round(midiHz(m - 0.5) / binHz));
  const bands: [number, number][] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const lo = edges[i], hi = Math.max(lo + 1, edges[i + 1]);
    if (bands.length && bands[bands.length - 1][1] > lo) continue;
    if (!(clicks && inClickBand((lo + hi) / 2 * binHz))) bands.push([lo, hi]);
  }
  const start = Math.max(0, Math.floor((from - 0.06) * rate)), end = Math.min(samples.length - size, Math.floor(to * rate));
  const re = new Float64Array(size), im = new Float64Array(size), powers: Float64Array[] = [], times: number[] = [];
  for (let at = start; at <= end; at += hop) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < size; i++) re[i] = samples[at + i] * w[i];
    fft(re, im);
    const power = new Float64Array(bands.length);
    bands.forEach(([lo, hi], b) => { let s = 0; for (let k = lo; k < hi; k++) s += re[k] * re[k] + im[k] * im[k]; power[b] = s; });
    powers.push(power); times.push((at + size / 2) / rate);
  }
  // Decibels make a rise mean the same at any recording level; the floor (a fraction of the take's median band power) keeps silent bands from flickering.
  const all = powers.flatMap(p => Array.from(p)).sort((a, b) => a - b), quiet = (all[Math.floor(all.length * 0.5)] ?? 0) * 0.5 + 1e-14;
  const flux: number[] = [], wide: number[][] = [], lag = 3;
  const levels = powers.map(p => Float64Array.from(p, v => 10 * Math.log10(v + quiet)));
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i], before = i >= lag ? levels[i - lag] : undefined, lifted: number[] = [];
    let f = 0;
    if (before) for (let b = 0; b < level.length; b++) {
      const rise = level[b] - Math.max(before[b], before[b - 1] ?? -Infinity, before[b + 1] ?? -Infinity);
      f += Math.max(0, rise - ONSET.bandDb); if (rise > ONSET.wideDb) lifted.push(b);
    }
    flux.push(f); wide.push(lifted);
  }
  const sorted = [...flux].sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.5)] ?? 0, high = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
  const onsets: PianoOnset[] = [], context = Math.round(0.1 / 0.005);
  for (let i = 2; i < flux.length - 2; i++) {
    let local = 0, count = 0;
    for (let j = Math.max(0, i - context); j <= Math.min(flux.length - 1, i + 6); j++) { local += flux[j]; count++; }
    const threshold = Math.max(floor * 3, ONSET.highFrac * high, local / count * ONSET.mult + ONSET.localHigh * high);
    // An attack lifts several bands within a few milliseconds (partials plus hammer noise); beating lifts one or two.
    let isPeak = flux[i] >= threshold && new Set([...wide[i - 1], ...wide[i], ...wide[i + 1]]).size >= ONSET.wideCount;
    for (let j = i - 6; isPeak && j <= i + 6; j++) if (j !== i && flux[j] > flux[i] || (j < i && flux[j] === flux[i])) isPeak = false;
    // The flux peak arrives when the attack sits just after the frame centre; calibrated on synthetic and recorded attacks.
    const t = times[i] + ONSET_LEAD;
    if (isPeak && t >= from - 0.05 && t <= to && (!onsets.length || t - onsets[onsets.length - 1].t > 0.045)) onsets.push({ t, strength: flux[i] / (high || 1) });
  }
  return onsets;
}
export const ONSET_LEAD = -0.0015;
/** Detector constants, chosen on the development recordings only (see PIECES.md). */
export const ONSET = { bandDb: 1, wideDb: 4, wideCount: 3, mult: 1.5, highFrac: 0.08, localHigh: 0.03 };

/** shared: unusable (another note in the attack has a partial here). leak: may be a neighbour's skirt, so it can show absence but never presence. */
export interface PartialReading { k: number; hz: number; post: number; pre: number; floor: number; shared: boolean; leak: boolean }
export interface NoteEvidence { midi: number; verdict: NoteVerdict; partials: PartialReading[]; heardAs?: number; reason: string }
export interface EventContext { pre: Spectrum; post: Spectrum; t0: number; cents: number; clicks: boolean; floors: Map<number, number>; gap: number }

/** Spectra just before the attack (what was already ringing) and just after it (what was added). */
export function eventContext(samples: Float32Array, rate: number, t0: number, previous: number | undefined, next: number | undefined, cents = 0, clicks = false): EventContext {
  const postStart = t0 + 0.035, postEnd = Math.min(t0 + 0.42, (next ?? Infinity) - 0.012, samples.length / rate);
  const preEnd = Math.max(0.05, t0 - 0.025), preLength = Math.max(0.05, Math.min(0.3, preEnd - Math.max(0, (previous ?? -Infinity) + 0.06)));
  return { pre: spectrum(samples, rate, preEnd - preLength, preLength), post: spectrum(samples, rate, postStart, Math.max(0.06, postEnd - postStart)), t0, cents, clicks, floors: new Map(), gap: t0 - (previous ?? -Infinity) };
}
/**
 * Did anything new sound? Rises are measured at spectral peaks only, against the strongest level nearby before the
 * attack, so a steady ringing peak reads the same in both windows. A real attack makes several partials grow: the
 * score is the second-largest rise (80 Hz to 7 kHz), so a single peak flickering from beating cannot carry it.
 * On the development recordings it overlaps between soft real attacks and silence, hence the band between
 * RULES.noAttack and RULES.attack that is treated as unsure.
 */
export function attackRise(ctx: EventContext): number {
  const rises = peakRises(ctx);
  return rises.length > 1 ? rises[1] : -99;
}
/** Rises (dB) of the post-attack spectral peaks over the pre-attack level nearby, largest first. */
export function peakRises(ctx: EventContext): number[] {
  const rises: number[] = [], lo = Math.ceil(80 / ctx.post.binHz), hi = Math.min(ctx.post.mag.length - 2, Math.floor(7000 / ctx.post.binHz));
  for (let k = lo; k <= hi; k++) {
    const m = ctx.post.mag[k];
    if (m < ctx.post.mag[k - 1] || m < ctx.post.mag[k + 1]) continue;
    const hz = k * ctx.post.binHz;
    if (db(m) - db(floorAt(ctx.post, hz, ctx.floors)) < RULES.snr) continue;
    rises.push(db(m) - db(peak(ctx.pre, hz, 30).value));
  }
  return rises.sort((a, b) => b - a);
}

/**
 * Strongest true peak near hz. It is leakage, not this partial, when the maximum sits on the edge of the range and
 * keeps rising outward, or when a peak 25 dB stronger lies within a semitone (a Hann sidelobe can reach that far).
 */
function peak(spec: Spectrum, hz: number, cents: number): { value: number; leak: boolean } {
  const lo = Math.max(1, Math.floor(hz * 2 ** (-cents / 1200) / spec.binHz)), hi = Math.min(spec.mag.length - 2, Math.ceil(hz * 2 ** (cents / 1200) / spec.binHz));
  let best = lo;
  for (let k = lo; k <= hi; k++) if (spec.mag[k] > spec.mag[best]) best = k;
  let leak = (best === lo && spec.mag[lo - 1] > spec.mag[lo]) || (best === hi && spec.mag[hi + 1] > spec.mag[hi]);
  const wideLo = Math.max(1, Math.floor(hz / 1.06 / spec.binHz)), wideHi = Math.min(spec.mag.length - 1, Math.ceil(hz * 1.06 / spec.binHz)), guard = Math.max(3, hi - lo);
  for (let k = wideLo; !leak && k <= wideHi; k++) if (Math.abs(k - best) > guard && spec.mag[k] > spec.mag[best] * 17.8) leak = true;
  return { value: spec.mag[best], leak };
}
/** Local noise floor: the median level within two semitones. Cached per bin. */
function floorAt(spec: Spectrum, hz: number, cache?: Map<number, number>): number {
  const key = Math.round(hz / spec.binHz / 4), cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const lo = Math.max(1, Math.floor(hz / 1.12 / spec.binHz)), hi = Math.min(spec.mag.length - 1, Math.ceil(hz * 1.12 / spec.binHz));
  const values = Array.from(spec.mag.subarray(lo, hi + 1)).sort((a, b) => a - b), floor = values[Math.floor(values.length * 0.5)] ?? 0;
  cache?.set(key, floor);
  return floor;
}
/** Two partials closer than the window can separate (or 50 cents) are indistinguishable. */
const close = (a: number, b: number, seconds: number) => Math.abs(a - b) < Math.max(a * (2 ** (50 / 1200) - 1), 2.2 / seconds);

export function readPartials(ctx: EventContext, midi: number, others: number[], maxK = 8): PartialReading[] {
  const readings: PartialReading[] = [];
  for (let k = 1; k <= maxK; k++) {
    const hz = partialHz(midi, k, ctx.cents);
    if (hz > 5000) break;
    const tolerance = Math.min(40, Math.max(25, 1200 * Math.log2(1 + 1.5 * ctx.post.binHz / hz)));
    const post = peak(ctx.post, hz, tolerance), pre = peak(ctx.pre, hz, tolerance);
    // A window too short to separate this partial from a semitone neighbour's cannot tell the two notes apart.
    const unresolved = 2.2 / Math.min(ctx.post.seconds, ctx.pre.seconds + 0.1) > hz * (2 ** (100 / 1200) - 1);
    const shared = others.some(o => { for (let j = 1; j <= 16; j++) { const f = partialHz(o, j, ctx.cents); if (f > hz * 1.1) break; if (close(f, hz, ctx.post.seconds)) return true; } return false; })
      || hz < 70 || (ctx.clicks && inClickBand(hz)) || unresolved;
    readings.push({ k, hz, post: db(post.value), pre: db(pre.value), floor: db(floorAt(ctx.post, hz, ctx.floors)), shared, leak: post.leak });
  }
  return readings;
}

/** Thresholds were set on synthetic tones and dev recordings, then frozen; see PIECES.md for the measured error rates. */
export const RULES = { snr: 12, rise: 5, absentSnr: 6, decay: -1, decayGap: 0.5, attack: 13, noAttack: 6, single: { snr: 20, rise: 8 } };
const present = (p: PartialReading) => p.post - p.floor >= RULES.snr && (p.post - p.pre >= RULES.rise || p.pre - p.floor < RULES.absentSnr);
/**
 * Absent means quiet after the attack, or, when the last attack was long enough ago, still decaying: a struck string
 * adds energy. A ringing partial that merely failed to rise could be a soft restrike, which stays unclear.
 */
const absent = (p: PartialReading, gap: number) => p.post - p.floor < RULES.absentSnr || (gap >= RULES.decayGap && p.post - p.pre <= RULES.decay);

/**
 * Evidence for one pitch from its own partials. Heard: the lowest own partial rose, with a second low partial and an
 * odd-numbered one (a note an octave higher has only even partials of this one). Upper partials can sit on the
 * partials of whatever was really played, so they never carry a verdict alone.
 */
function judge(readings: PartialReading[], healthy: boolean, gap: number, candidate = false): { verdict: Exclude<NoteVerdict, 'wrong'>; reason: string } {
  const own = readings.filter(p => !p.shared);
  if (!own.length) return { verdict: 'cannot-check', reason: 'every partial is shared with another note sounding with it' };
  const low = own.filter(p => p.k <= 4), usable = low.filter(p => !p.leak), on = usable.filter(present), off = low.filter(p => absent(p, gap));
  if (!low.length) return { verdict: 'unclear', reason: 'only high partials are its own' };
  if (usable.length && present(usable[0]) && on.length >= 2 && on.some(p => p.k % 2 === 1)) return { verdict: 'heard', reason: `${on.length} of its own low partials rose at the attack` };
  // An expected note whose only usable low partial is its fundamental or twelfth may rest on that one, if it rose clearly. A guessed pitch may not.
  const one = usable[0];
  if (!candidate && usable.length === 1 && (one.k === 1 || one.k === 3) && present(one) && one.post - one.floor >= RULES.single.snr && one.post - one.pre >= RULES.single.rise) return { verdict: 'heard', reason: 'its only own low partial rose clearly' };
  if (!on.length && off.length >= Math.min(2, low.length) && healthy) return { verdict: 'not-heard', reason: 'its own partials did not rise while the rest of the attack did' };
  return { verdict: 'unclear', reason: on.length ? 'only part of its evidence rose' : healthy ? 'the evidence was weak' : 'the attack was too quiet to judge absence' };
}

/** Verify the notes of one attack, then look for a neighbour or lower note that explains the sound better. */
export function verifyEvent(ctx: EventContext, expected: number[]): { notes: NoteEvidence[]; extras: number[]; rise: number } {
  const readings = expected.map(m => readPartials(ctx, m, expected.filter(o => o !== m)));
  const rise = attackRise(ctx), healthy = rise >= RULES.attack;
  const notes: NoteEvidence[] = expected.map((midi, i) => ({ midi, partials: readings[i], ...judge(readings[i], healthy, ctx.gap) }));
  const extras: number[] = [];
  const candidates = new Set<number>();
  for (const m of expected) for (const d of [-2, -1, 1, 2, -12, -19, -24]) if (!expected.includes(m + d) && m + d >= 21) candidates.add(m + d);
  for (const c of [...candidates].sort((a, b) => a - b)) {
    const own = readPartials(ctx, c, expected);
    if (judge(own, healthy, ctx.gap, true).verdict !== 'heard') continue;
    const explained = notes.filter(n => [12, 19, 24].includes(n.midi - c) && n.verdict === 'heard');
    for (const n of explained) { n.verdict = 'unclear'; n.reason = `a lower note (${c}) may have produced its partials`; }
    // Wrong needs both halves: the expected pitch is positively absent and the neighbour clearly sounded.
    const neighbour = notes.filter(n => Math.abs(n.midi - c) <= 2 && n.verdict === 'not-heard' && n.heardAs === undefined).sort((a, b) => Math.abs(a.midi - c) - Math.abs(b.midi - c))[0];
    if (neighbour) { neighbour.verdict = 'wrong'; neighbour.heardAs = c; neighbour.reason = 'a neighbouring pitch sounded instead'; }
    else if (!explained.length && !notes.some(n => n.heardAs === c)) extras.push(c);
  }
  return { notes, extras, rise };
}

/** Median deviation of strong, unshared fundamentals from equal temperament, in cents (old pianos drift flat). */
export function estimateTuning(contexts: { ctx: EventContext; expected: number[] }[]): number {
  const deviations: number[] = [];
  for (const { ctx, expected } of contexts) for (const m of expected) {
    const hz = partialHz(m, 1);
    if (hz < 110 || hz > 2000 || expected.some(o => o !== m && [1, 2, 3].some(k => close(partialHz(o, k), hz, ctx.post.seconds)))) continue;
    const lo = Math.floor(hz * 2 ** (-70 / 1200) / ctx.post.binHz), hi = Math.ceil(hz * 2 ** (70 / 1200) / ctx.post.binHz);
    let best = lo;
    for (let k = lo; k <= hi; k++) if (ctx.post.mag[k] > ctx.post.mag[best]) best = k;
    if (db(ctx.post.mag[best]) - db(floorAt(ctx.post, hz, ctx.floors)) < 20 || best <= lo || best >= hi) continue;
    const a = db(ctx.post.mag[best - 1]), b = db(ctx.post.mag[best]), c = db(ctx.post.mag[best + 1]);
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1), heard = (best + shift) * ctx.post.binHz;
    deviations.push(1200 * Math.log2(heard / hz));
  }
  if (deviations.length < 3) return 0;
  deviations.sort((x, y) => x - y);
  return deviations[Math.floor(deviations.length / 2)];
}
