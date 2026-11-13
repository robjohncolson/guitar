// Independent check of the vendored piano samples in public/piano: decodes every MP3 listed in manifest.json with ffmpeg and
// re-measures pitch, clipping, onset, attack loudness, size and length. Prints one line per note; exits non-zero on any failure.
// Run: node scripts/check-piano-samples.mjs
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = new URL('../public/piano/', import.meta.url);
function decode(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => err.push(d));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err)}`));
      const buf = Buffer.concat(out), copy = Buffer.from(buf); resolve(new Float32Array(copy.buffer, copy.byteOffset, copy.length >> 2));
    });
  });
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
const RATE = 44100, manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
const rows = []; let failures = 0, totalBytes = 0;
const fail = (name, why) => { failures++; console.log(`  FAIL ${name}: ${why}`); };
if (manifest.rate !== RATE) fail('manifest', `rate ${manifest.rate} != ${RATE}`);
for (const note of manifest.notes) {
  const path = fileURLToPath(new URL(note.file, dir)), x = await decode(path);
  totalBytes += (await stat(path)).size;
  const onset = findOnset(x, RATE), peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const measured = measureCents(x, RATE, onset, note.midi), raw = attackLevel(x, RATE, onset);
  rows.push({ note, x, onset, peak, measured: measured.cents, raw, seconds: x.length / RATE });
}
const sorted = rows.map(r => r.raw).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
const clamped = []; let worstPitch = 0, worstLevel = 0, maxPeak = 0, maxSeconds = 0;
for (const r of rows) {
  const name = r.note.file, pitchErr = r.measured - r.note.cents, dB = 20 * Math.log10(r.note.gain * r.raw / median), isClamped = r.note.gain <= GAIN_MIN + 0.0015 || r.note.gain >= GAIN_MAX - 0.0015;
  worstPitch = Math.max(worstPitch, Math.abs(pitchErr)); if (isClamped) clamped.push(`${name} gain ${r.note.gain} residual ${dB.toFixed(2)} dB`); else worstLevel = Math.max(worstLevel, Math.abs(dB)); maxPeak = Math.max(maxPeak, r.peak); maxSeconds = Math.max(maxSeconds, r.seconds);
  console.log(`${name.padEnd(8)} midi ${r.note.midi}  measured ${r.measured.toFixed(1).padStart(6)}c  manifest ${r.note.cents.toFixed(1).padStart(6)}c  err ${pitchErr.toFixed(1).padStart(5)}c  peak ${r.peak.toFixed(3)}  onset ${(1000 * r.onset / RATE).toFixed(1)}ms  gain ${r.note.gain.toFixed(3)}  attack ${dB.toFixed(2).padStart(6)}dB${isClamped ? ' (clamped)' : ''}  ${r.seconds.toFixed(2)}s`);
  if (!Number.isFinite(r.measured) || Math.abs(pitchErr) > 10) fail(name, `pitch differs from manifest by ${pitchErr.toFixed(1)} cents`);
  if (Math.abs(r.note.cents) > 50) fail(name, `recording is ${r.note.cents} cents from nominal`);
  if (r.peak >= 0.99) fail(name, `clipping, peak ${r.peak.toFixed(3)}`);
  if (r.onset > 0.1 * RATE) fail(name, `no onset in the first 100 ms (found at ${(1000 * r.onset / RATE).toFixed(0)} ms)`);
  if (!(r.note.gain >= GAIN_MIN - 1e-9 && r.note.gain <= GAIN_MAX + 1e-9)) fail(name, `gain ${r.note.gain} outside +-6 dB`);
  if (!isClamped && Math.abs(dB) > 3) fail(name, `attack level ${dB.toFixed(1)} dB from the median after gain`);
  if (r.seconds > 6.05) fail(name, `${r.seconds.toFixed(2)} s is longer than 6.05 s`);
}
if (totalBytes > 3 * 1024 * 1024) fail('set', `${totalBytes} bytes exceeds 3 MB`);
console.log(`${rows.length} notes, ${(totalBytes / 1e6).toFixed(3)} MB; worst pitch error ${worstPitch.toFixed(1)} c, worst unclamped attack deviation ${worstLevel.toFixed(2)} dB, max peak ${maxPeak.toFixed(3)}, longest ${maxSeconds.toFixed(2)} s`);
console.log(`clamped (${clamped.length}): ${clamped.join('; ') || 'none'}`);
console.log(failures ? `FAILED: ${failures} problem(s)` : 'OK');
process.exit(failures ? 1 : 0);
