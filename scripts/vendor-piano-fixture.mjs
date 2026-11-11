// Reproduce a small test-only fixture from freely usable University of Iowa piano recordings (Steinway B, mf).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
// Gymnopédie left-hand chords and bass, its first melody notes, and the neighbours used as wrong notes in tests.
const notes = [['D2', 38], ['G2', 43], ['A3', 57], ['B3', 59], ['C4', 60], ['Db4', 61], ['D4', 62], ['E4', 64], ['Gb4', 66], ['G4', 67], ['Gb5', 78], ['A5', 81]];
const rate = 24000, seconds = 1.5;
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
  const samples = Float32Array.from({ length: count }, (_, i) => {
    let sum = 0; for (let c = 0; c < channels; c++) sum += sound.readIntBE((i * channels + c) * width, width) / 2 ** (bits - 1);
    return sum / channels;
  });
  return { rate: source, samples };
}
/** First 5 ms window above 4% of the note's peak level: the hammer attack. */
function onset(samples, rate) {
  const hop = Math.round(rate * 0.005); let peak = 0; const levels = [];
  for (let i = 0; i + hop < samples.length; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += samples[j] ** 2; const v = Math.sqrt(e / hop); levels.push(v); peak = Math.max(peak, v); }
  return Math.max(0, levels.findIndex(v => v > peak * 0.04) * hop / rate - 0.005);
}
/** Blackman-windowed sinc low-pass at 10 kHz, then linear interpolation to 24 kHz. */
function resample(samples, from, start) {
  const taps = 63, cutoff = 10000 / from, kernel = Array.from({ length: taps }, (_, i) => {
    const n = i - (taps - 1) / 2, sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    return sinc * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (taps - 1)));
  });
  const filtered = (index) => { let s = 0; for (let k = 0; k < taps; k++) s += (samples[index + k - (taps - 1) / 2] ?? 0) * kernel[k]; return s; };
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => {
    const position = (start + i / rate) * from, floor = Math.floor(position), fraction = position - floor;
    return filtered(floor) * (1 - fraction) + filtered(floor + 1) * fraction;
  });
}
await mkdir(new URL('.cache/piano-reference/', root), { recursive: true });
const clips = [], provenance = [];
for (const [name, midi] of notes) {
  const file = new URL(`.cache/piano-reference/Piano.mf.${name}.aiff`, root);
  const url = `https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/piano/Piano.mf.${name}.aiff`;
  let bytes; try { bytes = await readFile(file); } catch {
    const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
    bytes = Buffer.from(await response.arrayBuffer()); await writeFile(file, bytes);
  }
  const { samples, rate: from } = readAiff(bytes), start = onset(samples, from);
  clips.push({ midi, samples: resample(samples, from, start) });
  provenance.push({ name, midi, url, sha256: createHash('sha256').update(bytes).digest('hex'), sourceRate: from, onsetSeconds: Math.round(start * 1e4) / 1e4 });
  console.log(JSON.stringify({ name, midi, sourceRate: from, onset: start.toFixed(4) }));
}
// One gain for all notes keeps their recorded relative loudness.
const peak = Math.max(...clips.flatMap(c => [Math.max(...c.samples), -Math.min(...c.samples)])), gain = 0.6 / peak;
const pcm = Buffer.alloc(clips.length * clips[0].samples.length * 2);
clips.forEach((clip, n) => clip.samples.forEach((v, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * gain * 32767))), 2 * (n * clip.samples.length + i))));
const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);
await writeFile(new URL('tests/fixtures/piano-notes.wav', root), wav);
await writeFile(new URL('tests/fixtures/piano-notes.json', root), JSON.stringify({ rate, secondsPerNote: seconds, gain, midis: notes.map(n => n[1]), sha256: createHash('sha256').update(wav).digest('hex'), provenance }, null, 2) + '\n');
