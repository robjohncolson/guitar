/**
 * Playing without a microphone: the computer keyboard as two piano rows (tracker layout) and any Web MIDI keyboard.
 * Key codes are physical positions, so the layout is the same on any keyboard language.
 */
const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight'];
const SYMBOL: Record<string, string> = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
export const keyLabel = (code: string) => SYMBOL[code] ?? code.replace(/^Key|^Digit/, '');

/** The bottom row starts at base (a C); the top row starts an octave higher. */
export function keyMap(base: number): Map<string, number> {
  const map = new Map<string, number>();
  LOWER.forEach((code, i) => map.set(code, base + i));
  UPPER.forEach((code, i) => map.set(code, base + 12 + i));
  return map;
}
/** One letter per playable pitch, for the lane: the bottom row below the top row's first C, the top row from there. */
export function keyLabels(base: number): Map<number, string> {
  const labels = new Map<number, string>();
  LOWER.forEach((code, i) => { if (i < 12) labels.set(base + i, keyLabel(code)); });
  UPPER.forEach((code, i) => labels.set(base + 12 + i, keyLabel(code)));
  return labels;
}
/** The C at or below the lowest note, so a one-hand passage usually fits on the two rows without shifting. */
export const baseFor = (midis: number[]) => Math.floor(Math.min(...midis) / 12) * 12;

export interface KeyHandlers { down(midi: number, stamp: number, source: 'keys' | 'midi'): void; up(midi: number): void }

/** Listens to the computer keyboard and to every MIDI input while enabled. Stamps are performance.now() milliseconds. */
export class KeyInput {
  enabled = false; base = 48; midiDevices = 0; midiError = '';
  private map = keyMap(48);
  private down = new Map<string, number>();
  private access?: MIDIAccess;
  constructor(private handlers: KeyHandlers, private onOctave: () => void = () => {}) {
    window.addEventListener('keydown', e => this.keydown(e));
    window.addEventListener('keyup', e => this.keyup(e));
    window.addEventListener('blur', () => this.releaseAll());
  }
  setBase(base: number): void { this.releaseAll(); this.base = Math.max(12, Math.min(96, base)); this.map = keyMap(this.base); }
  releaseAll(): void { for (const midi of this.down.values()) this.handlers.up(midi); this.down.clear(); }
  private typing(e: KeyboardEvent): boolean {
    const t = e.target;
    return e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && Boolean(t.closest('input, select, textarea, [contenteditable=true]')));
  }
  private keydown(e: KeyboardEvent): void {
    if (!this.enabled || this.typing(e)) return;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) { this.setBase(this.base + (e.code === 'ArrowLeft' ? -12 : 12)); this.onOctave(); } return; }
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
