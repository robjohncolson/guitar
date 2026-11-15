import { describe, expect, it } from 'vitest';
import { keyAllowed, laneHeight, overlayOpen, statusChip, stepFinished, todayChip } from '../src/piece/stage';

describe('status chip', () => {
  it.each([
    [{ keys: true, midi: true, tooLoud: false, calibrated: false }, 'Keys · MIDI', 'Keys', false],
    [{ keys: true, midi: false, tooLoud: true, calibrated: false }, 'Keys', 'Keys', false],
    [{ keys: false, midi: false, tooLoud: true, calibrated: true }, 'Mic too loud', 'Too loud', true],
    [{ keys: false, midi: false, tooLoud: false, calibrated: false }, 'Calibrate', 'Calibrate', true],
    [{ keys: false, midi: true, tooLoud: false, calibrated: true }, 'Mic · calibrated', 'Mic', false],
  ])('%j', (input, long, short, warn) => {
    expect(statusChip(input)).toEqual({ long, short, warn });
  });
});

describe('Today chip', () => {
  it.each([
    [1, 4, 'Today 1 of 4', '1/4', "Today 1 of 4: steps of today's practice done"],
    [0, 4, 'Today 0 of 4', '0/4', "Today 0 of 4: steps of today's practice done"],
    [4, 4, 'Today 4 of 4', '4/4', "Today 4 of 4: steps of today's practice done"],
    [6, 4, 'Today 4 of 4', '4/4', "Today 4 of 4: steps of today's practice done"],
    [0, 0, 'Today', 'Today', "Today's practice"],
  ])('%i of %i', (done, total, long, short, label) => {
    expect(todayChip(done, total)).toEqual({ long, short, warn: false, label });
  });
});

describe('overlay guard', () => {
  it.each([
    [false, false, false], [true, false, true], [false, true, true], [true, true, true],
  ])('drawer %s, popover %s -> open %s', (drawer, popover, open) => expect(overlayOpen(drawer, popover)).toBe(open));
  it.each([
    [true, 'Space', false], [true, 'ArrowUp', false], [true, 'ArrowDown', false], [true, 'ArrowLeft', false], [true, 'ArrowRight', false],
    [true, 'KeyZ', false], [true, 'KeyQ', false], [true, 'Digit2', false], [true, 'Escape', true],
    [false, 'Space', true], [false, 'ArrowUp', true], [false, 'KeyZ', true], [false, 'Escape', true],
  ])('open %s, %s -> allowed %s', (open, code, allowed) => expect(keyAllowed(open, code)).toBe(allowed));
});

describe('lane height', () => {
  const phone = (vh: number, laneTop: number, below: number, card = false) => laneHeight({ phone: true, vh, laneTop, below, card, notice: false });
  const desk = (vh: number, laneTop: number, below: number, card = false, notice = false) => laneHeight({ phone: false, vh, laneTop, below, card, notice });
  it.each([
    // vh, lane top, sticky block -> height
    [844, 301, 205, 300],   // clamp(180, 344, 300) = 300 and 844 - 301 - 205 - 8 = 330
    [844, 301, 255, 280],   // the sticky block is taller: fit wins
    [844, 405, 205, 226],   // welcome card above
    [664, 301, 205, 180],   // clamp(180, 164, 300) = 180
    [700, 250, 200, 200],   // 100dvh - 500
    [844, 600, 205, 180],   // never under 180
  ])('phone %i tall, lane at %i, block %i -> %i', (vh, top, below, h) => expect(phone(vh, top, below)).toBe(h));
  it('collapses to 160 while a result card is open on a phone', () => {
    expect(phone(844, 301, 205, true)).toBe(160);
    expect(phone(664, 301, 400, true)).toBe(160);
  });
  it.each([
    // vh, lane top, Start below the lane, card, notice -> height
    [800, 366, 72, false, false, 354],
    [800, 286, 72, false, false, 434],
    [1000, 286, 72, false, false, 440],  // min(440, 640, 634)
    [800, 366, 134, false, true, 292],
    [800, 366, 300, true, false, 250],   // floor 250 with a card
    [800, 500, 72, false, false, 300],   // floor 300
    [600, 200, 72, false, false, 300],   // 100vh - 360 = 240, floored at 300
  ])('desktop %i tall, lane at %i, %i below -> %i', (vh, top, below, card, notice, h) => expect(desk(vh, top, below, card, notice)).toBe(h));
});

describe('Next in today\'s plan on stage', () => {
  it.each([
    ['done', false, true], ['learned', false, true], ['practising', true, true],
    ['practising', false, false], ['new', false, false], ['due', false, false], ['covered', false, false],
  ] as const)('%s, placed %s -> %s', (state, placed, show) => expect(stepFinished(state, placed)).toBe(show));
});
