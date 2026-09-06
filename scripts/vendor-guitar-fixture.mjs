// Reproduce a small test-only fixture from freely usable University of Iowa acoustic guitar recordings.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../',import.meta.url);
const sources = [
  {file:'G3-B3.aif',name:'Guitar.mf.sulG.G3B3.mono.aif',firstMidi:55},
  {file:'C4-E4.aif',name:'Guitar.mf.sulA.C4E4.mono.aif',firstMidi:60},
];
function readAiff(bytes) {
  let format, sound;
  for (let offset=12;offset+8<bytes.length;) {
    const id = bytes.toString('ascii',offset,offset+4), size = bytes.readUInt32BE(offset+4), data = bytes.subarray(offset+8,offset+8+size);
    if (id === 'COMM') format = data;
    if (id === 'SSND') sound = data.subarray(8+data.readUInt32BE(0));
    offset += 8+size+(size%2);
  }
  if (!format || !sound) throw new Error('Missing AIFF audio chunks');
  const channels = format.readUInt16BE(0), count = format.readUInt32BE(2), bits = format.readUInt16BE(6);
  const exponent = format.readUInt16BE(8)&0x7fff;
  const rate = Math.round(2**(exponent-16383)*(format.readUInt32BE(10)/2**31+format.readUInt32BE(14)/2**63));
  if (![16,24].includes(bits) || channels !== 1) throw new Error(`Expected mono PCM, got ${channels} channels / ${bits} bits`);
  const samples = Float32Array.from({length:count},(_,i) => sound.readIntBE(i*bits/8,bits/8)/2**(bits-1));
  return {rate,samples};
}
function attacks(samples,rate) {
  const hop = Math.round(rate*0.01), levels = [];
  for (let i=0;i<samples.length;i+=hop) {
    let energy = 0; for (let j=i;j<Math.min(samples.length,i+hop);j++) energy += samples[j]**2;
    levels.push(Math.sqrt(energy/hop));
  }
  const threshold = Math.max(...levels)*0.12, starts = []; let armed = true, quiet = 0;
  levels.forEach((level,i) => {
    if (level < threshold*0.25) quiet++; else quiet = 0;
    if (quiet >= 50) armed = true;
    // These published scale notes are separated by over five seconds; ignore tail/handling bumps when slicing.
    if (armed && level >= threshold) {
      if (!starts.length || i*0.01-starts.at(-1) > 5) starts.push(Math.max(0,i*0.01-0.015));
      armed = false;
    }
  });
  return starts;
}
await mkdir(new URL('.cache/guitar-reference/',root),{recursive:true});
const plucks = [], provenance = [];
for (const source of sources) {
  const file = new URL(`.cache/guitar-reference/${source.file}`,root);
  const url = `https://theremin.music.uiowa.edu/sound%20files/MIS/Piano_Other/guitar/${source.name}`;
  let bytes; try { bytes = await readFile(file); } catch {
    const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer()); await writeFile(file,bytes);
  }
  const {samples,rate} = readAiff(bytes), starts = attacks(samples,rate);
  console.log(JSON.stringify({source:source.name,rate,seconds:samples.length/rate,starts}));
  if (starts.length !== 5) throw new Error('Expected the five chromatic notes documented by the source filename');
  provenance.push({url,sha256:createHash('sha256').update(bytes).digest('hex'),starts});
  starts.forEach((start,i) => plucks.push({midi:source.firstMidi+i,rate,start,samples}));
}
if (!process.argv.includes('--inspect')) {
  const selected = [55,57,59,60,62,64], rate = 48000, length = Math.round(rate*0.55);
  const pcm = Buffer.alloc(selected.length*length*2);
  selected.forEach((midi,index) => {
    const source = plucks.find(pluck => pluck.midi === midi), values = [];
    for (let i=0;i<length;i++) {
      const position = (source.start+i/rate)*source.rate, floor = Math.floor(position), fraction = position-floor;
      values.push((source.samples[floor] ?? 0)*(1-fraction)+(source.samples[floor+1] ?? 0)*fraction);
    }
    const peak = Math.max(...values.map(Math.abs)), gain = 0.65/peak;
    values.forEach((value,i) => pcm.writeInt16LE(Math.round(value*gain*32767),2*(index*length+i)));
  });
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length+36,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(rate,24);
  header.writeUInt32LE(rate*2,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
  await mkdir(new URL('tests/fixtures/',root),{recursive:true});
  const wav = Buffer.concat([header,pcm]);
  await writeFile(new URL('tests/fixtures/guitar-plucks.wav',root),wav);
  await writeFile(new URL('tests/fixtures/guitar-plucks.json',root),JSON.stringify({rate,secondsPerPluck:0.55,midis:selected,sha256:createHash('sha256').update(wav).digest('hex'),provenance},null,2)+'\n');
}
