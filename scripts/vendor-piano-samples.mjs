// Vendor a sampled piano for the Pieces page: University of Iowa Steinway B (mf), every minor third A0..C8 (30 notes),
// trimmed at the hammer attack, mono, 44.1 kHz, faded, MP3, with a manifest of per-note detune (cents) and gain (attack-loudness evening, clamped to +-6 dB).
// Run: node scripts/vendor-piano-samples.mjs   (downloads are cached in ignored .cache/piano-reference/)
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), outDir = new URL('public/piano/', root);
const RATE = 44100, MAX_SECONDS = 6, PRE = 0.002, FADE = 0.25, BUDGET = 2.6e6;
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameOf = midi => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const wanted = []; for (let m = 21; m <= 108; m++) if ([9, 0, 3, 6].includes(m % 12)) wanted.push(m);

/** The recordings are untrusted bytes: parsed as AIFF sample data only, never executed. */
function readAiff(bytes) {
  let format, sound;
  for (let offset = 12; offset + 8 < bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32BE(offset + 4), data = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === 'COMM') format = data;
    if (id === 'SSND') sound = data.subarray(8 + data.readUInt32BE(0));
    offset += 8 + size + (size % 2);
  }
  if (!format || !sound) throw new Error('Missing AIFF audio chunks');
  const channels = format.readUInt16BE(0), count = format.readUInt32BE(2), bits = format.readUInt16BE(6), width = bits / 8;
  const exponent = format.readUInt16BE(8) & 0x7fff;
  const source = Math.round(2 ** (exponent - 16383) * (format.readUInt32BE(10) / 2 ** 31 + format.readUInt32BE(14) / 2 ** 63));
  if (![16, 24].includes(bits)) throw new Error(`Expected 16 or 24-bit PCM, got ${bits}`);
  const samples = Float32Array.from({ length: Math.min(count, Math.floor(sound.length / (channels * width))) }, (_, i) => {
    let sum = 0; for (let c = 0; c < channels; c++) sum += sound.readIntBE((i * channels + c) * width, width) / 2 ** (bits - 1);
    return sum / channels;
  });
  return { rate: source, samples };
}
function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => err.push(d));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err)}`)));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const toBuffer = f32 => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
const fromBuffer = buf => { const copy = Buffer.from(buf); return new Float32Array(copy.buffer, copy.byteOffset, copy.length >> 2); };
async function fetchNote(name) {
  const file = new URL(`.cache/piano-reference/Piano.mf.${name}.aiff`, root);
  const url = `https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano/Piano.mf.${name}.aiff`;
  try { return { bytes: await readFile(file), url }; } catch {}
  const response = await fetch(url); if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer()); await writeFile(file, bytes);
  return { bytes, url };
}
// ---- DSP helpers (kept identical in vendor and check scripts) ----
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
/** Detune in cents (positive = sharp) of the note's fundamental, measured 0.1-0.6 s after `onset` (sample index).
 *  Piano partials are slightly stretched (f_k = k f0 sqrt(1 + B k^2)), so locate partials 1..12 near their predicted
 *  positions and fit f_k^2 / k^2 = f0^2 (1 + B k^2); a weak or missing fundamental then does not matter. */
function measureCents(x, rate, onset, midi) {
  // Window: 0.08 s after the onset for up to 0.5 s, or until the faded tail begins if the note is short.
  const start = onset + Math.round(0.08 * rate), len = Math.max(Math.round(0.2 * rate), Math.min(Math.round(0.5 * rate), x.length - Math.round(0.25 * rate) - start)), size = 2 ** 18;
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < len; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1)));
  fft(re, im);
  const half = size / 2, mag = new Float64Array(half), df = rate / size;
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  const maxMag = mag.slice(Math.floor(20 / df), Math.floor(12000 / df)).reduce((a, b) => Math.max(a, b), 0);
  const f0n = hz(midi), points = [];
  const predict = k => {
    if (points.length >= 1) { const fit = regress(points); return k * fit.f0 * Math.sqrt(1 + fit.B * k * k); }
    return k * f0n * Math.sqrt(1 + (points.length ? regress(points).B : 0) * k * k);
  };
  function regress(pts) {
    if (pts.length < 3) { const f0 = pts.reduce((s, p) => s + p.f / p.k, 0) / pts.length; return { f0, B: 0 }; }
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = pts.length;
    for (const p of pts) { const X = p.k * p.k, Y = (p.f / p.k) ** 2; sx += X; sy += Y; sxx += X * X; sxy += X * Y; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n;
    return { f0: Math.sqrt(icpt), B: Math.max(0, slope / icpt) };
  }
  for (let k = 1; k <= 12 && predict(k) < 12000; k++) {
    const c = predict(k), tol = points.length ? 35 : 90;
    const lo = Math.max(1, Math.floor(c * 2 ** (-tol / 1200) / df)), hi = Math.min(half - 2, Math.ceil(c * 2 ** (tol / 1200) / df));
    let best = lo; for (let i = lo; i <= hi; i++) if (mag[i] > mag[best]) best = i;
    if (best === lo || best === hi || mag[best] < 0.03 * maxMag) continue;
    const med = Array.from(mag.slice(Math.floor(c * 0.5 / df), Math.floor(c * 1.5 / df))).sort((a, b) => a - b)[Math.floor((c * 1.0 / df) / 2)];
    if (mag[best] < 8 * med) continue;
    const a = Math.log(mag[best - 1]), b = Math.log(mag[best]), d = Math.log(mag[best + 1]);
    points.push({ k, f: (best + 0.5 * (a - d) / (a - 2 * b + d)) * df });
  }
  if (points.length < 1) return { cents: NaN, partials: points.length, resid: NaN };
  const fit = regress(points);
  const resid = Math.sqrt(points.reduce((s, p) => s + (1200 * Math.log2(p.f / (p.k * fit.f0 * Math.sqrt(1 + fit.B * p.k * p.k)))) ** 2, 0) / points.length);
  return { cents: 1200 * Math.log2(fit.f0 / f0n), partials: points.length, resid };
}
/** First sample clearly above the recording's background level (the hammer attack). */
function findOnset(x, rate) {
  const hop = Math.round(rate * 0.005); let peak = 0; const levels = [];
  for (let i = 0; i + hop < x.length; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += x[j] ** 2; const v = Math.sqrt(e / hop); levels.push(v); peak = Math.max(peak, v); }
  const w = levels.findIndex(v => v > peak * 0.1), coarse = w * hop;
  const quiet = Math.max(0, coarse - Math.round(0.03 * rate)); let noise = 0;
  for (let i = 0; i < quiet; i++) noise = Math.max(noise, Math.abs(x[i]));
  let local = 0; for (let i = coarse; i < Math.min(x.length, coarse + 2 * hop); i++) local = Math.max(local, Math.abs(x[i]));
  const thr = Math.max(noise * 1.5, local * 0.05, 1e-5);
  let i = Math.max(0, coarse - 2 * hop); while (i < x.length && Math.abs(x[i]) <= thr) i++;
  return i;
}
const rmsAt = (x, from, to) => { let e = 0; for (let i = from; i < to; i++) e += (x[i] ?? 0) ** 2; return Math.sqrt(e / (to - from)); };
/** Attack loudness: the peak of the 5 ms RMS frames (non-overlapping, 20 frames) covering the first 100 ms from `onset` (sample index). */
const attackLevel = (x, rate, onset) => { const hop = Math.round(0.005 * rate); let peak = 0; for (let f = 0; f < 20; f++) peak = Math.max(peak, rmsAt(x, onset + f * hop, onset + (f + 1) * hop)); return peak; };
const GAIN_MIN = 0.501, GAIN_MAX = 1.995; // +-6 dB
await mkdir(new URL('.cache/piano-reference/', root), { recursive: true });
await mkdir(outDir, { recursive: true });
const clips = [];
for (const wantedMidi of wanted) {
  let midi = wantedMidi, got = await fetchNote(nameOf(midi));
  for (let d = 1; !got && d <= 3; d++) for (const m of [wantedMidi - d, wantedMidi + d]) { if (!got && m >= 21 && m <= 108) { midi = m; got = await fetchNote(nameOf(m)); } }
  if (!got) throw new Error(`No upstream recording near ${nameOf(wantedMidi)}`);
  if (midi !== wantedMidi) console.log(`SUBSTITUTE ${nameOf(wantedMidi)} <- ${nameOf(midi)}`);
  const { samples, rate: from } = readAiff(got.bytes), start = findOnset(samples, from);
  const begin = Math.max(0, start - Math.round(PRE * from)), take = Math.min(samples.length - begin, Math.round((MAX_SECONDS + 0.5) * from));
  let x = samples.subarray(begin, begin + take);
  if (from !== RATE) x = fromBuffer(await ffmpeg(['-f', 'f32le', '-ar', String(from), '-ac', '1', '-i', 'pipe:0', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], toBuffer(x)));
  const onset = Math.round(PRE * RATE);
  // Cut where the 50 ms level is 60 dB under its peak or within ~2 dB of the recording's own noise floor (its last 2 s), within 0.5-6 s.
  const tail = samples.subarray(Math.max(0, samples.length - 2 * from)), noise = rmsAt(tail, 0, tail.length);
  const win = Math.round(0.05 * RATE); let peakEnv = 0; const env = [];
  for (let i = 0; i + win < x.length; i += win) { const v = rmsAt(x, i, i + win); env.push(v); peakEnv = Math.max(peakEnv, v); }
  const peakAt = env.indexOf(peakEnv), cut = env.findIndex((v, i) => i > peakAt && v < Math.max(peakEnv * 1e-3, noise * 1.25));
  let length = cut < 0 ? x.length : cut * win;
  length = Math.max(Math.round(0.5 * RATE),Math.min(length, Math.round(MAX_SECONDS * RATE), x.length));
  const y = Float32Array.from(x.subarray(0, length)), fade = Math.round(FADE * RATE);
  for (let i = 0; i < fade; i++) y[length - fade + i] *= 0.5 + 0.5 * Math.cos(Math.PI * i / fade);
  const level = attackLevel(y, RATE, onset);
  const pitch = measureCents(y, RATE, onset, midi);
  console.log(JSON.stringify({ name: nameOf(midi), midi, srcRate: from, onsetMs: +(1000 * start / from).toFixed(2), seconds: +(length / RATE).toFixed(2), attack: +level.toFixed(5), cents: +pitch.cents.toFixed(1), partials: pitch.partials, residCents: +pitch.resid.toFixed(2), sha256: createHash('sha256').update(got.bytes).digest('hex').slice(0, 12) }));
  if (!Number.isFinite(pitch.cents)) throw new Error(`Could not measure pitch of ${nameOf(midi)}`);
  if (Math.abs(pitch.cents) > 50) { console.log(`SKIP ${nameOf(midi)}: recording is ${pitch.cents.toFixed(1)} cents from nominal (mistuned or mislabelled upstream), unusable`); continue; }
  clips.push({ midi, name: nameOf(midi), y, level, cents: pitch.cents });
}
clips.sort((a, b) => a.midi - b.midi);
// Peak-normalise the whole set with one factor so nothing clips; attack loudness is then evened out by per-note gain.
const peak = Math.max(...clips.map(c => c.y.reduce((m, v) => Math.max(m, Math.abs(v)), 0))), scale = 0.95 / peak;
for (const c of clips) { for (let i = 0; i < c.y.length; i++) c.y[i] *= scale; c.level *= scale; }
let chosen = 0;
for (const kbps of [160, 144, 128, 112, 96, 80, 64, 48]) {
  let total = 0;
  for (const c of clips) {
    const file = new URL(`${c.name}.mp3`, outDir);
    await ffmpeg(['-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-ar', String(RATE), '-ac', '1', fileURLToPath(file)], toBuffer(c.y));
    total += (await stat(file)).size;
  }
  console.log(`${kbps} kbps -> ${(total / 1e6).toFixed(3)} MB`);
  if (total <= BUDGET) { chosen = kbps; break; }
}
if (!chosen) throw new Error('Cannot fit within the size budget');
// gain = median attack level / the note's attack level, clamped to +-6 dB: beyond that the recordings' natural balance wins.
const median = clips.map(c => c.level).sort((a, b) => a - b)[Math.floor(clips.length / 2)];
for (const c of clips) { const want = median / c.level, g = Math.min(GAIN_MAX, Math.max(GAIN_MIN, want)); c.gain = Math.round(g * 1000) / 1000; if (g !== want) console.log(`CLAMPED ${c.name}: wanted ${(20 * Math.log10(want)).toFixed(2)} dB, applied ${(20 * Math.log10(g)).toFixed(2)} dB`); }
const manifest = { rate: RATE, notes: clips.map(c => ({ midi: c.midi, file: `${c.name}.mp3`, gain: c.gain, cents: Math.round(c.cents * 10) / 10 })) };
const row = n => `    { "midi": ${n.midi}, "file": "${n.file}", "gain": ${n.gain}, "cents": ${n.cents.toFixed(1)} }`;
await writeFile(new URL('manifest.json', outDir), `{\n  "rate": ${RATE},\n  "notes": [\n${manifest.notes.map(row).join(',\n')}\n  ]\n}\n`);
console.log(`Wrote ${clips.length} notes at ${chosen} kbps`);
