import { afterAll, beforeAll, expect, it } from 'vitest';
import { KeyInput } from '../src/piece/keys';

// No DOM here: a minimal window that collects the listeners KeyInput adds, and an Element class for its typing check.
const listeners = new Map<string, (e: unknown) => void>();
const g = globalThis as unknown as { window?: unknown; Element?: unknown };
const saved = { window: g.window, Element: g.Element };
beforeAll(() => {
  g.window = { addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn) };
  g.Element = class {};
});
afterAll(() => {
  g.window = saved.window;
  g.Element = saved.Element;
});

const key = (code: string) => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  timeStamp: 1,
  preventDefault() {},
});

it.each([
  [false, 1, 1],
  [true, 0, 0],
])('paused %s: key down plays %i, MIDI note-on plays %i', (paused, keys, midi) => {
  listeners.clear();
  const downs: number[] = [],
    ups: number[] = [];
  const input = new KeyInput(
    { down: (m) => downs.push(m), up: (m) => ups.push(m) },
    () => {},
    () => paused,
  );
  input.enabled = true;
  listeners.get('keydown')!(key('KeyZ'));
  expect(downs.length).toBe(keys);
  (input as unknown as { message(m: unknown): void }).message({ data: [0x90, 64, 100], timeStamp: 2 });
  expect(downs.length).toBe(keys + midi);
});

it('still releases a key held down before the pause began', () => {
  listeners.clear();
  let paused = false;
  const downs: number[] = [],
    ups: number[] = [];
  const input = new KeyInput(
    { down: (m) => downs.push(m), up: (m) => ups.push(m) },
    () => {},
    () => paused,
  );
  input.enabled = true;
  listeners.get('keydown')!(key('KeyZ'));
  paused = true;
  listeners.get('keyup')!(key('KeyZ'));
  (input as unknown as { message(m: unknown): void }).message({ data: [0x80, 64, 0], timeStamp: 3 });
  expect(downs).toEqual([48]);
  expect(ups).toEqual([48, 64]);
});
