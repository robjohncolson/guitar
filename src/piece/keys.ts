/**
 * Playing without a microphone: the computer keyboard as two piano rows (tracker layout) and any Web MIDI keyboard.
 * Key codes are physical positions, so the layout is the same on any keyboard language.
 */
const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight'];
const SYMBOL: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
export const keyLabel = (code: string) => SYMBOL[code] ?? code.replace(/^Key|^Digit/, '');

/**
 * Where each row starts, both on a C. Usually an octave apart, one run of about 2½ octaves; when the music spreads
 * wider (a bass note under a chord), the rows split so each sits where the notes are.
 */
export interface KeyLayout { lower: number; upper: number }
export const reaches = (l: KeyLayout, midi: number) => (midi >= l.lower && midi < l.lower + LOWER.length) || (midi >= l.upper && midi < l.upper + UPPER.length);
export function keyMap(l: KeyLayout): Map<string, number> {
  const map = new Map<string, number>();
  LOWER.forEach((code, i) => map.set(code, l.lower + i));
  UPPER.forEach((code, i) => map.set(code, l.upper + i));
  return map;
}
/** One letter per playable pitch, for the lane; where the rows overlap, the top row's letter. */
export function keyLabels(l: KeyLayout): Map<number, string> {
  const labels = new Map<number, string>();
  LOWER.forEach((code, i) => labels.set(l.lower + i, keyLabel(code)));
  UPPER.forEach((code, i) => labels.set(l.upper + i, keyLabel(code)));
  return labels;
}
/**
 * The row positions that reach the most of these notes (one entry per note played). Ties go to rows an octave
 * apart, then to the higher bottom row, so the bottom row starts at the lowest notes rather than below them.
 */
export function layoutFor(midis: number[]): KeyLayout {
  if (!midis.length) return { lower: 48, upper: 60 };
  const lo = Math.floor(Math.min(...midis) / 12) * 12, hi = Math.floor(Math.max(...midis) / 12) * 12;
  let best = { layout: { lower: lo, upper: lo + 12 }, covered: -1, gap: Infinity };
  for (let lower = lo - 12; lower <= hi; lower += 12) for (let upper = lower + 12; upper <= hi + 12; upper += 12) {
    const layout = { lower, upper }, covered = midis.filter(m => reaches(layout, m)).length, gap = upper - lower;
    if (covered > best.covered || (covered === best.covered && (gap < best.gap || (gap === best.gap && lower > best.layout.lower)))) best = { layout, covered, gap };
  }
  return best.layout;
}

export interface KeyHandlers { down(midi: number, stamp: number, source: 'keys' | 'midi'): void; up(midi: number): void }

/** Listens to the computer keyboard and to every MIDI input while enabled. Stamps are performance.now() milliseconds. */
export class KeyInput {
  enabled = false; layout: KeyLayout = { lower: 48, upper: 60 }; midiDevices = 0; midiError = '';
  private map = keyMap(this.layout);
  private down = new Map<string, number>();
  private access?: MIDIAccess;
  constructor(private handlers: KeyHandlers, private onOctave: () => void = () => {}) {
    window.addEventListener('keydown', e => this.keydown(e));
    window.addEventListener('keyup', e => this.keyup(e));
    window.addEventListener('blur', () => this.releaseAll());
  }
  setLayout(layout: KeyLayout): void {
    const shift = Math.max(12 - layout.lower, Math.min(0, 96 - layout.upper));
    this.releaseAll(); this.layout = { lower: layout.lower + shift, upper: layout.upper + shift }; this.map = keyMap(this.layout);
  }
  releaseAll(): void { for (const midi of this.down.values()) this.handlers.up(midi); this.down.clear(); }
  private typing(e: KeyboardEvent): boolean {
    const t = e.target;
    return e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && Boolean(t.closest('input, select, textarea, [contenteditable=true]')));
  }
  private keydown(e: KeyboardEvent): void {
    if (!this.enabled || this.typing(e)) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) { const step = e.code === 'ArrowLeft' ? -12 : 12; this.setLayout({ lower: this.layout.lower + step, upper: this.layout.upper + step }); this.onOctave(); } return; }
    const midi = this.map.get(e.code);
    if (midi === undefined) return;
    e.preventDefault();
    if (e.repeat || this.down.has(e.code)) return;
    this.down.set(e.code, midi); this.handlers.down(midi, e.timeStamp, 'keys');
  }
  private keyup(e: KeyboardEvent): void {
    const midi = this.down.get(e.code);
    if (midi === undefined) return;
    this.down.delete(e.code); this.handlers.up(midi);
  }
  /** Asks for MIDI once, the first time keys mode is used. Notes from every connected input count. */
  async connectMidi(): Promise<void> {
    if (this.access || !navigator.requestMIDIAccess) { if (!navigator.requestMIDIAccess) this.midiError = 'This browser has no Web MIDI'; return; }
    try {
      this.access = await navigator.requestMIDIAccess();
      const attach = () => {
        let count = 0;
        this.access!.inputs.forEach(input => { count++; input.onmidimessage = m => this.message(m); });
        this.midiDevices = count; this.onOctave();
      };
      this.access.onstatechange = attach; attach();
    } catch { this.midiError = 'MIDI access was not allowed'; }
  }
  private message(m: MIDIMessageEvent): void {
    if (!this.enabled || !m.data || m.data.length < 3) return;
    const [status, note, velocity] = m.data, type = status & 0xf0;
    if (type === 0x90 && velocity > 0) this.handlers.down(note, m.timeStamp, 'midi');
    else if (type === 0x80 || (type === 0x90 && velocity === 0)) this.handlers.up(note);
  }
}
