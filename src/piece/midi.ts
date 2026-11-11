/** Minimal Standard MIDI File reader: an independent cross-check for transcriptions, not a score source. */
export interface MidiNote { track: number; channel: number; tick: number; dur: number; midi: number; velocity: number }
export interface MidiFile {
  format: number; division: number; trackNames: string[]; notes: MidiNote[];
  timeSignatures: { tick: number; num: number; den: number }[]; keySignatures: { tick: number; fifths: number; minor: boolean }[];
}
export function readMidi(bytes: Uint8Array): MidiFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (text(0, 4) !== 'MThd') throw new Error('Not a MIDI file.');
  const format = view.getUint16(8), tracks = view.getUint16(10), division = view.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported.');
  const result: MidiFile = { format, division, trackNames: [], notes: [], timeSignatures: [], keySignatures: [] };
  let p = 8 + view.getUint32(4);
  for (let track = 0; track < tracks; track++) {
    if (text(p, 4) !== 'MTrk') throw new Error(`Track ${track} is missing.`);
    const end = p + 8 + view.getUint32(p + 4);
    p += 8;
    let tick = 0, status = 0;
    const open = new Map<string, { tick: number; velocity: number }[]>();
    const vlq = () => { let value = 0; for (;;) { const c = bytes[p++]; value = value * 128 + (c & 127); if (c < 128) return value; } };
    result.trackNames[track] = '';
    while (p < end) {
      tick += vlq();
      if (bytes[p] === 0xff) {
        const type = bytes[p + 1]; p += 2;
        const length = vlq(), at = p; p += length;
        if (type === 3) result.trackNames[track] = text(at, length);
        if (type === 0x58) result.timeSignatures.push({ tick, num: bytes[at], den: 2 ** bytes[at + 1] });
        if (type === 0x59) result.keySignatures.push({ tick, fifths: (bytes[at] << 24) >> 24, minor: bytes[at + 1] === 1 });
        continue;
      }
      if (bytes[p] === 0xf0 || bytes[p] === 0xf7) { p++; p += vlq(); continue; }
      if (bytes[p] & 0x80) status = bytes[p++];
      const kind = status & 0xf0, channel = status & 15;
      if (kind === 0xc0 || kind === 0xd0) { p++; continue; }
      const a = bytes[p++], b = bytes[p++], key = `${channel}:${a}`;
      if (kind === 0x90 && b > 0) open.set(key, [...(open.get(key) ?? []), { tick, velocity: b }]);
      else if (kind === 0x80 || kind === 0x90) {
        const start = open.get(key)?.shift();
        if (start) result.notes.push({ track, channel, tick: start.tick, dur: tick - start.tick, midi: a, velocity: start.velocity });
      }
    }
    p = end;
  }
  result.notes.sort((x, y) => x.tick - y.tick || x.midi - y.midi);
  return result;
}
