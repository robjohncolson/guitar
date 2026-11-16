import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildCurriculum, type Unit } from '../src/piece/curriculum';
import { arrange, guitarUnits } from '../src/piece/guitar';
import { arrangePiece, guitarPieceUnits } from '../src/piece/solo';
import { answerLines, capNote, CLEAN_RULE, comfortAsk, firstSentence, floorPct, nextLine, nextState, outcome, routeTake, takeStatus, UNANSWERED, type LoopFlags, type NextLine, type NextState, type Outcome, type TakeFacts, type TakeRoute } from '../src/piece/loop';
import { compile } from '../src/piece/notation';
import { advanceUnit, DAY, dayOf, initialUnit, placeUnit, rungBpm, type UnitProgress } from '../src/piece/progress';

// loop.ts is pure: the NEXT TAKE sentence, the card's answer lines and the LAST TAKE chip. The wording of
// design/pieces-redesign/UX-REDESIGN.md A3.1 to A3.3 is pinned below as tables. What those sentences promise is then replayed through
// the real ladder (advanceUnit, placeUnit), on hand-built steps and on every unit of the piano and guitar courses of the public
// Gymnopédie pack at several goal tempos. A fixed local noon keeps day arithmetic zone-proof.
const now = new Date(2026, 10, 14, 12).getTime(), today = dayOf(now), earlier = dayOf(now - DAY);
const lately = { attempts: 2, last: now - 60_000 }; // took one earlier today
const yesterday = { attempts: 2, last: now - DAY }; // the last take was on an earlier day

const unitOf = (id: string, kind: Unit['kind'], rungs: number[], certify: number[], goalBpm: number, extra: Partial<Unit> = {}): Unit =>
  ({ id, kind, stage: 3, title: id, goal: '', why: '', bars: [0, 1, 2, 3], hands: ['L'], requires: [], rungs, certify, goalBpm, ...extra });
const ladder = [0.5, 0.6, 0.7, 0.8, 0.88, 0.94, 1];
const hand = unitOf('L:1-4', 'hand', [0.5, 0.6, 0.7, 0.8], [0.8], 66); // 33 40 46 53 BPM, one hand stops at 80%
const full = unitOf('LR:1-4', 'together', ladder, [0.8, 1], 66, { hands: ['L', 'R'] }); // 33 40 46 53 58 62 66 BPM
const slow = unitOf('L:9-12', 'hand', [0.5, 0.6, 0.7, 0.8], [0.8], 30); // 20 20 21 24 BPM: the first two steps sit on the 20 BPM floor
const tiny = unitOf('LR:9-12', 'together', ladder, [0.8, 1], 20, { hands: ['L', 'R'] }); // 20 BPM on every step
const steady = unitOf('section:A', 'section', [0.5, 0.7, 1], [], 60, { hands: ['L', 'R'] }); // 30 42 60 BPM, nothing to certify at the top
const listen = unitOf('listen', 'listen', [1], [], 66, { hands: ['L', 'R'] });
const covered = unitOf('L:5-8', 'hand', [0.5, 0.6, 0.7, 0.8], [0.8], 66, { sameAs: 'L:1-4' });

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(inner => deepFreeze(inner)); }
  return value;
};
[hand, full, slow, tiny, steady, listen, covered].forEach(unit => deepFreeze(unit)); // no call below may change a unit either
const prog = (over: Partial<UnitProgress> = {}): UnitProgress => ({ ...initialUnit(), ...over, certified: [...(over.certified ?? [])], days: [...(over.days ?? [])] });
const st = (unit: Unit, p: Partial<UnitProgress> = {}, over: Partial<NextState> = {}): NextState => ({ unit, p: prog(p), now, ...over });

it('builds the test units with the tempo ladders the cases assume', () => {
  const bpms = (unit: Unit) => unit.rungs.map((_, rung) => rungBpm(unit, { ...initialUnit(), rung }));
  expect(bpms(hand)).toEqual([33, 40, 46, 53]);
  expect(bpms(full)).toEqual([33, 40, 46, 53, 58, 62, 66]);
  expect(bpms(slow)).toEqual([20, 20, 21, 24]);
  expect(bpms(tiny)).toEqual([20, 20, 20, 20, 20, 20, 20]);
  expect(bpms(steady)).toEqual([30, 42, 60]);
});

// ---- floorPct and routeTake ----

it('prints a take percentage rounded down, never up', () => {
  for (const [score, pct] of [[0.896, 89], [0.9, 90], [0.29, 29], [1, 100], [0, 0], [0.57, 57], [0.58, 58], [0.899, 89], [0.8999, 89], [0.649, 64], [0.65, 65]] as const) {
    expect(floorPct(score), `${score}`).toBe(pct);
  }
});

it('does not lose a whole percent to floating point, nor gain one', () => {
  for (let i = 0; i <= 100; i++) expect(floorPct(i / 100), `${i}%`).toBe(i);
  for (let i = 0; i <= 1000; i++) expect(floorPct(i / 1000), `${i / 10}%`).toBe(Math.floor(i / 10));
});

it('routes an answered take to placement, free tempo or the ladder', () => {
  const cases: [string, Unit, Partial<UnitProgress>, { bpm: number; place?: number }, TakeRoute][] = [
    ['the step tempo', full, {}, { bpm: 33 }, 'ladder'],
    ['the step tempo on a higher step', full, { rung: 3 }, { bpm: 53 }, 'ladder'],
    ['one hand at its top step', hand, { rung: 3 }, { bpm: 53 }, 'ladder'],
    ['a saved step past the top reads as the top step', hand, { rung: 9 }, { bpm: 53 }, 'ladder'],
    ['the first 20 BPM floor step', slow, {}, { bpm: 20 }, 'ladder'],
    ['the second 20 BPM floor step', slow, { rung: 1 }, { bpm: 20 }, 'ladder'],
    ['a tempo off the step', full, {}, { bpm: 36 }, 'free'],
    ['one BPM off the step', full, {}, { bpm: 34 }, 'free'],
    ['the tempo of the step below', full, { rung: 3 }, { bpm: 46 }, 'free'],
    ['the next floor step tempo', slow, {}, { bpm: 21 }, 'free'],
    ['placement at its own tempo, not the step tempo', full, {}, { bpm: 53, place: 3 }, 'place'],
    ['placement at the step tempo', full, {}, { bpm: 33, place: 3 }, 'place'],
    ['placement target 0', full, {}, { bpm: 36, place: 0 }, 'place'],
  ];
  for (const [name, unit, p, take, route] of cases) expect(routeTake(unit, prog(p), take), name).toBe(route);
});

it('routes every tempo and placement target exactly as the old inline conditions did', () => {
  // main.ts used to decide this inline: a placement target first, then any tempo off the step, otherwise the ladder.
  const old = (unit: Unit, before: UnitProgress, take: { bpm: number; place?: number }): TakeRoute =>
    take.place !== undefined ? 'place' : take.bpm !== rungBpm(unit, before) ? 'free' : 'ladder';
  const tempos = [...Array.from({ length: 66 }, (_, i) => 15 + i), 33.5, 40.0000001, Number.NaN], places = [undefined, 0, 1, 3, 6, 9];
  const bad: string[] = [], seen = new Set<TakeRoute>();
  for (const unit of [hand, full, slow, tiny, steady, listen, covered]) {
    for (let rung = 0; rung <= 9; rung++) { // 9 is a saved step past every top
      const before = prog({ rung });
      for (const bpm of tempos) for (const place of places) {
        const take = place === undefined ? { bpm } : { bpm, place }, got = routeTake(unit, before, take);
        seen.add(got);
        if (got !== old(unit, before, take)) bad.push(`${unit.id}, rung ${rung}, ${bpm} BPM, place ${place}: ${got}`);
      }
    }
  }
  expect(bad).toEqual([]);
  expect([...seen].sort()).toEqual(['free', 'ladder', 'place']);
});

// ---- NEXT TAKE (A3.1) ----

type Action = NonNullable<NextLine['action']>;
interface NextRow { name: string; state: NextState; text: string; muted: string; action?: Action }
const n = (name: string, state: NextState, text: string, muted = '', action?: Action): NextRow => ({ name, state, text, muted, action });
function checkNext(rows: NextRow[]) {
  for (const r of rows) {
    const got = nextLine(r.state);
    expect(got.text, `${r.name}: sentence`).toBe(r.text);
    expect(got.muted, `${r.name}: muted line`).toBe(r.muted);
    expect(got.action, `${r.name}: action`).toEqual(r.action);
  }
}

const plainRows: NextRow[] = [
  n('plain rung 0, 0 in a row', st(hand), 'Two clean takes move you up to 40 BPM.', CLEAN_RULE),
  n('plain rung 0, 1 in a row', st(hand, { clean: 1 }), 'One more clean take moves you up to 40 BPM.', CLEAN_RULE),
  n('plain rung 1', st(hand, { rung: 1 }), 'Two clean takes move you up to 46 BPM.', CLEAN_RULE),
  n('plain rung 2, 1 in a row', st(hand, { rung: 2, clean: 1 }), 'One more clean take moves you up to 53 BPM.', CLEAN_RULE),
  n('plain rung 4 of the full step', st(full, { rung: 4 }), 'Two clean takes move you up to 62 BPM.', CLEAN_RULE),
  n('plain rung 5 of the full step, 1 in a row', st(full, { rung: 5, clean: 1 }), 'One more clean take moves you up to 66 BPM.', CLEAN_RULE),
  n('20 BPM floor, 0 in a row', st(slow), 'Two clean takes move you to the next step (still 20 BPM, the slowest allowed).', CLEAN_RULE),
  n('20 BPM floor, 1 in a row', st(slow, { clean: 1 }), 'One more clean take moves you to the next step (still 20 BPM, the slowest allowed).', CLEAN_RULE),
  n('past the floor the next tempo is named again', st(slow, { rung: 1 }), 'Two clean takes move you up to 21 BPM.', CLEAN_RULE),
  // Not in the tables: loop.ts's sentence for a top step that has nothing to certify.
  n('top step with nothing to certify', st(steady, { rung: 2 }), 'Top step: 60 BPM. Clean takes keep it steady.', CLEAN_RULE),
];

const certRows: NextRow[] = [
  n('help 0, one hand', st(hand, { rung: 3 }), 'Three clean takes certify 53 BPM, each with less help. This one: notes shown (1 of 3).'),
  n('help 0, full step', st(full, { rung: 3 }), 'Three clean takes certify 53 BPM, each with less help. This one: notes shown (1 of 3).'),
  n('help 0 at the goal tempo', st(full, { rung: 6, certified: [0.8] }), 'Three clean takes certify 66 BPM, each with less help. This one: notes shown (1 of 3).'),
  n('help 0, a saved step past the top reads as the top step', st(hand, { rung: 9 }), 'Three clean takes certify 53 BPM, each with less help. This one: notes shown (1 of 3).'),
  n('help 1', st(hand, { rung: 3, support: 1, clean: 1 }), 'Take 2 of 3 at 53 BPM, notes hidden. A clean take unlocks the last one: a click on each bar only.'),
  n('help 2 below the top', st(full, { rung: 3, support: 2, clean: 2 }), 'Last of 3 at 53 BPM: notes hidden, a click on each bar only. A clean take certifies it and moves you up to 58 BPM.'),
  n('help 2 at the top on one hand', st(hand, { rung: 3, support: 2, clean: 2 }), 'Last of 3 at 53 BPM: notes hidden, a click on each bar only. A clean take certifies 53 BPM, the top step for one hand.'),
  n('help 2 at the top of a full step', st(full, { rung: 6, support: 2, certified: [0.8] }), 'Last of 3 at 66 BPM: notes hidden, a click on each bar only. A clean take certifies 66 BPM, the goal tempo.'),
];

const certifiedFull = { rung: 6, certified: [0.8, 1] }; // the goal tempo is certified
const learnedFull = { ...certifiedFull, learned: true, interval: 2, days: [earlier, today] };
const learnedHand = { rung: 3, certified: [0.8], learned: true, interval: 2, days: [earlier, today] };
const reviewAtTop = 'Review due: one clean take at 66 BPM passes it. A take that needs more room moves you one step slower.';
const doneRows: NextRow[] = [
  n('certified today', st(full, { ...certifiedFull, days: [today] }), 'Certified today. Come back on another day to call it learned.'),
  n('certified today, one hand', st(hand, { rung: 3, certified: [0.8], days: [today] }), 'Certified today. Come back on another day to call it learned.'),
  n('certified on an earlier day, help 0', st(full, { ...certifiedFull, days: [earlier] }), 'Certified before. Three clean takes today make it learned.'),
  n('certified on an earlier day, help 1', st(full, { ...certifiedFull, days: [earlier], support: 1 }), 'Certified before. Two clean takes today make it learned.'),
  n('certified on an earlier day, help 2', st(full, { ...certifiedFull, days: [earlier], support: 2 }), 'Certified before. One clean take today makes it learned.'),
  n('certified on an earlier day, one hand', st(hand, { rung: 3, certified: [0.8], days: [earlier], support: 1 }), 'Certified before. Two clean takes today make it learned.'),
  n('learned, back in 3 days', st(full, { ...learnedFull, due: now + 3 * DAY }), 'Learned. It comes back for review in 3 days.'),
  n('learned, back in 1 day', st(full, { ...learnedFull, due: now + DAY }), 'Learned. It comes back for review in 1 day.'),
  n('learned, a part of a day counts as a day', st(full, { ...learnedFull, due: now + 2.4 * DAY }), 'Learned. It comes back for review in 3 days.'),
  n('learned, seconds to go', st(full, { ...learnedFull, due: now + 5000 }), 'Learned. It comes back for review in 1 day.'),
  n('learned, below its top step', st(full, { ...learnedFull, rung: 3, due: now + 2 * DAY }), 'Learned. It comes back for review in 2 days.'),
  n('review due at the top', st(full, { ...learnedFull, due: now - DAY }), reviewAtTop),
  n('review due exactly now', st(full, { ...learnedFull, due: now }), reviewAtTop),
  n('review due at the top, one hand', st(hand, { ...learnedHand, due: now - DAY }), 'Review due: one clean take at 53 BPM passes it. A take that needs more room moves you one step slower.'),
  n('review due below the top', st(full, { ...learnedFull, rung: 3, due: now - DAY }), 'Review due: work back up to 66 BPM, then one clean take there passes it.'),
  n('review due below the top, one hand', st(hand, { ...learnedHand, rung: 1, due: now - DAY }), 'Review due: work back up to 53 BPM, then one clean take there passes it.'),
];

const coverRows: NextRow[] = [
  n('listening step', st(listen), 'Let it play to the end. Then it counts as heard. Nothing is scored.'),
  n('covered step', st(covered, {}, { sameAsTitle: 'Bars 1–4 · left hand' }), 'Same notes as “Bars 1–4 · left hand”. Practise that step; this one follows it.', '', { kind: 'goto', label: 'Go to “Bars 1–4 · left hand”' }),
  n('covered step without a title names its id', st(covered), 'Same notes as “L:1-4”. Practise that step; this one follows it.', '', { kind: 'goto', label: 'Go to “L:1-4”' }),
];

const flagRows: NextRow[] = [
  n('answer owed', st(hand, {}, { owed: 'answer' }), 'Answer first: how did that take feel? ↑ comfortable · ↓ needs more room.'),
  n('answer owed during a demo or a playback', st(hand, {}, { owed: 'demo' }), 'Answer when the playback ends.'),
  n('offer after a miss', st(hand, {}, { offer: { bars: 'bar 3', bpm: 28 } }), 'Practise bar 3 at 28 BPM, or carry on.'),
  n('offer when the bars were unclear', st(hand, {}, { offer: 'choose' }), 'Choose the bars to practise, or carry on.'),
  n('spot pass, 0 clean passes', st(hand, {}, { pass: 0 }), 'Again until it comes out clean, or slow it down.'),
  n('spot pass, 1 clean pass', st(hand, {}, { pass: 1 }), 'Clean pass. One more in a row, then back to the step.'),
  n('spot pass, 2 clean passes', st(hand, {}, { pass: 2 }), 'Two clean passes in a row. Put them back in context.'),
  n('spot pass, 3 clean passes', st(hand, {}, { pass: 3 }), 'Two clean passes in a row. Put them back in context.'),
  n('spot loop', st(hand, {}, { spot: { bars: 'bar 3', bpm: 28 } }), 'Spot practice on bar 3 at 28 BPM. It never changes your tempo step.'),
  n('wait for me', st(hand, {}, { wait: true }), 'Wait for me: the notes wait for your keys. Only keys are checked, and it never moves your tempo.'),
  n('mic not calibrated', st(hand, {}, { uncalibrated: true }), 'Takes will not move your tempo until timing is calibrated: 8 clicks, with an earcup held to the mic.', '', { kind: 'calibrate', label: 'Calibrate' }),
  n('placement take', st(full, {}, { placing: 53 }), 'Placement take at 53 BPM: one clean, comfortable take places you here. Otherwise nothing is recorded.'),
  n('free tempo', st(hand, {}, { free: 36 }), 'Free tempo: takes at 36 BPM do not move the ladder. Go back to 33 BPM to count takes.', '', { kind: 'free-back', label: 'Back to 33 BPM' }),
  n('free tempo goes back to the current step', st(full, { rung: 3 }, { free: 40 }), 'Free tempo: takes at 40 BPM do not move the ladder. Go back to 53 BPM to count takes.', '', { kind: 'free-back', label: 'Back to 53 BPM' }),
];

const NEXT_ROWS = [...plainRows, ...certRows, ...doneRows, ...coverRows, ...flagRows];

it('states the clean rule as the muted line, word for word', () => {
  expect(CLEAN_RULE).toBe('Clean = 90% or better, and you say it felt comfortable.');
});

it('NEXT TAKE on a plain rung names the next tempo and the clean rule', () => checkNext(plainRows));
it('NEXT TAKE on a certification rung counts the three takes with fading help', () => checkNext(certRows));
it('NEXT TAKE after certifying says what is left: certified, learned, review due', () => checkNext(doneRows));
it('NEXT TAKE on a listening step or a covered step', () => checkNext(coverRows));
it('NEXT TAKE while an answer is owed, an offer or a spot is shown, or a mode is set', () => checkNext(flagRows));

it('NEXT TAKE keeps its priority: owed, offer or spot pass, spot, wait, calibrate, placement, free tempo, then the step', () => {
  const base = st(hand, { rung: 1 }), step = nextLine(base);
  const tail: [string, Partial<NextState>][] = [
    ['spot loop', { spot: { bars: 'bar 3', bpm: 28 } }], ['wait for me', { wait: true }], ['mic not calibrated', { uncalibrated: true }],
    ['placement take', { placing: 53 }], ['free tempo', { free: 36 }],
  ];
  const choices: [string, Partial<NextState>][] = [['offer', { offer: { bars: 'bar 3', bpm: 28 } }], ['spot pass', { pass: 1 }]];
  for (const choice of choices) {
    const chain: [string, Partial<NextState>][] = [['answer owed', { owed: 'answer' }], choice, ...tail];
    const stack = (from: number) => chain.slice(from).reduce<Partial<NextState>>((all, [, flag]) => ({ ...all, ...flag }), {});
    const alone = chain.map(([, flag]) => nextLine({ ...base, ...flag }));
    expect(new Set([step.text, ...alone.map(line => line.text)]).size, `${choice[0]}: every sentence differs`).toBe(chain.length + 1);
    chain.forEach(([name], i) => expect(nextLine({ ...base, ...stack(i) }), `${choice[0]} chain: ${name} beats everything below it`).toEqual(alone[i]));
    expect(nextLine({ ...base, ...stack(0), owed: 'demo' }).text, `${choice[0]} chain: a demo`).toBe('Answer when the playback ends.');
  }
});

it('NEXT TAKE never asks a listening or covered step to calibrate', () => {
  for (const unit of [listen, covered]) {
    const alone = nextLine(st(unit, {}, { sameAsTitle: 'Bars 1–4 · left hand' }));
    expect(nextLine(st(unit, {}, { sameAsTitle: 'Bars 1–4 · left hand', uncalibrated: true })), unit.id).toEqual(alone);
  }
});

it('NEXT TAKE: the last of 3 on a certification rung at the 20 BPM floor stays within 130 characters', () => {
  const text = nextLine(st(tiny, { rung: 3, support: 2, clean: 2 })).text;
  expect(text).toBe('Last of 3 at 20 BPM: notes hidden, a click on each bar only. A clean take certifies it and moves you to the next step.');
  expect(text.length).toBeLessThanOrEqual(130);
});

// ---- the page's flags: nextState decides what NEXT TAKE is told ----

/** Each sentence the page flags can choose between, for the hand step at its first rung unless noted. */
const SAY = {
  answer: 'Answer first: how did that take feel? ↑ comfortable · ↓ needs more room.',
  playback: 'Answer when the playback ends.',
  spot: 'Spot practice on bar 3 at 28 BPM. It never changes your tempo step.',
  wait: 'Wait for me: the notes wait for your keys. Only keys are checked, and it never moves your tempo.',
  listen: 'Let it play to the end. Then it counts as heard. Nothing is scored.',
  same: 'Same notes as “Bars 1–4 · left hand”. Practise that step; this one follows it.',
  calibrate: 'Takes will not move your tempo until timing is calibrated: 8 clicks, with an earcup held to the mic.',
  placing: 'Placement take at 53 BPM: one clean, comfortable take places you here. Otherwise nothing is recorded.',
  free: 'Free tempo: takes at 36 BPM do not move the ladder. Go back to 33 BPM to count takes.',
  step: 'Two clean takes move you up to 40 BPM.',
};
const SPOT = { bars: 'bar 3', bpm: 28 };
/** The flags of a calibrated microphone on a step that counts, with nothing playing and nothing owed. */
const lf = (unit: Unit, over: Partial<LoopFlags> = {}): LoopFlags =>
  ({ unit, p: prog(), now, sameAsTitle: 'Bars 1–4 · left hand', pending: false, running: false, practice: false, wait: false, keys: false, calibrated: true, ...over });

interface Guard { name: string; unit?: Unit; flags: Partial<LoopFlags>; text: string; action?: Action; owed?: 'answer' | 'demo'; uncalibrated?: boolean; placing?: number; free?: number; pass?: number }
const GUARDS: Guard[] = [
  { name: 'a calibrated microphone counts', flags: {}, text: SAY.step },
  { name: 'a microphone that is not calibrated', flags: { calibrated: false }, uncalibrated: true, text: SAY.calibrate, action: { kind: 'calibrate', label: 'Calibrate' } },
  { name: 'keys need no calibration', flags: { keys: true, calibrated: false }, text: SAY.step },
  { name: 'a listening step is never asked to calibrate', unit: listen, flags: { calibrated: false }, text: SAY.listen },
  { name: 'a covered step is never asked to calibrate', unit: covered, flags: { calibrated: false }, text: SAY.same, action: { kind: 'goto', label: 'Go to “Bars 1–4 · left hand”' } },
  { name: 'a spot is never asked to calibrate', flags: { calibrated: false, spot: SPOT }, text: SAY.spot },
  { name: 'a spot drops a placement take', flags: { spot: SPOT, running: true, practice: true, placing: 53 }, text: SAY.spot },
  { name: 'a spot drops a free tempo', flags: { spot: SPOT, free: 36 }, text: SAY.spot },
  { name: 'a spot keeps its pass count', flags: { spot: SPOT, pass: 1 }, pass: 1, text: 'Clean pass. One more in a row, then back to the step.' },
  { name: 'a pass count with no spot is dropped', flags: { pass: 2 }, text: SAY.step },
  { name: 'Wait for me with a take owed shows the wait line, not the answer', flags: { pending: true, wait: true, running: true, keys: true }, text: SAY.wait },
  { name: 'Wait for me with a take owed, between runs', flags: { pending: true, wait: true, keys: true }, text: SAY.wait },
  { name: 'a take owed while a demo or a playback runs', flags: { pending: true, running: true }, owed: 'demo', text: SAY.playback },
  { name: 'a take owed while nothing plays', flags: { pending: true }, owed: 'answer', text: SAY.answer },
  { name: 'nothing owed while something plays', flags: { running: true }, text: SAY.step },
  { name: 'a placement take that was stopped', flags: { placing: 53, practice: true }, text: SAY.step },
  { name: 'a placement tempo left over while a demo or a playback runs', flags: { placing: 53, running: true }, text: SAY.step },
  { name: 'a placement take under way', flags: { placing: 53, running: true, practice: true }, placing: 53, text: SAY.placing },
  { name: 'a free tempo', flags: { free: 36 }, free: 36, text: SAY.free, action: { kind: 'free-back', label: 'Back to 33 BPM' } },
  { name: 'a placement take under way beats a free tempo', flags: { placing: 53, free: 36, running: true, practice: true }, placing: 53, free: 36, text: SAY.placing },
  { name: 'an offer passes through', flags: { offer: { bars: 'bar 3', bpm: 28 } }, text: 'Practise bar 3 at 28 BPM, or carry on.' },
  { name: 'an offer to choose the bars passes through', flags: { offer: 'choose' }, text: 'Choose the bars to practise, or carry on.' },
];

it('turns the page flags into NEXT TAKE state: owed, calibrate, placement, free tempo and pass count', () => {
  for (const g of GUARDS) {
    const state = nextState(lf(g.unit ?? hand, g.flags)), line = nextLine(state);
    expect({ owed: state.owed, uncalibrated: state.uncalibrated, placing: state.placing, free: state.free, pass: state.pass }, `${g.name}: state`)
      .toEqual({ owed: g.owed, uncalibrated: g.uncalibrated ?? false, placing: g.placing, free: g.free, pass: g.pass });
    expect(line.text, `${g.name}: sentence`).toBe(g.text);
    expect(line.action, `${g.name}: action`).toEqual(g.action);
  }
});

it('hands the rest of the page state to NEXT TAKE as it is, and changes nothing it was given', () => {
  const flags = deepFreeze(lf(covered, { sameAsTitle: 'Bars 9–12', offer: { bars: 'bar 3', bpm: 28 }, spot: SPOT, wait: true, pass: 1, free: 40, placing: 53, running: true, practice: true }));
  const state = nextState(flags); // every input is frozen, so a write would throw
  expect(state).toMatchObject({ unit: covered, p: flags.p, now, sameAsTitle: 'Bars 9–12', offer: flags.offer, spot: SPOT, wait: true, pass: 1 });
  expect(nextState(lf(hand)).wait).toBe(false);
});

it('shows the right NEXT TAKE sentence for every combination of page flags', () => {
  const bad: string[] = [], seen = new Set<string>();
  const names = ['pending', 'running', 'practice', 'wait', 'keys', 'calibrated', 'spot', 'placing', 'free'] as const;
  for (const unit of [hand, listen, covered]) {
    for (let bits = 0; bits < 1 << names.length; bits++) {
      const on = Object.fromEntries(names.map((name, i) => [name, Boolean(bits & (1 << i))])) as Record<(typeof names)[number], boolean>;
      const f = lf(unit, { pending: on.pending, running: on.running, practice: on.practice, wait: on.wait, keys: on.keys, calibrated: on.calibrated, spot: on.spot ? SPOT : undefined, placing: on.placing ? 53 : undefined, free: on.free ? 36 : undefined });
      // The rules as the learner meets them, most pressing first, written from the page's flags and not from NextState's.
      const want = on.pending && !on.wait ? (on.running ? SAY.playback : SAY.answer)
        : on.spot ? SAY.spot
        : on.wait ? SAY.wait
        : unit.kind === 'listen' ? SAY.listen
        : unit.sameAs ? SAY.same
        : !on.keys && !on.calibrated ? SAY.calibrate
        : on.running && on.practice && on.placing ? SAY.placing
        : on.free ? SAY.free
        : SAY.step;
      const got = nextLine(nextState(f)).text;
      seen.add(got);
      if (got !== want) bad.push(`${unit.id} ${JSON.stringify(on)}: "${got}", wanted "${want}"`);
    }
  }
  expect(bad.slice(0, 10)).toEqual([]);
  expect([...seen].sort()).toEqual(Object.values(SAY).sort()); // and each sentence is reached
});

// ---- the card's answer lines (A3.2) and the LAST TAKE chip (A3.3) ----

interface Row {
  name: string; unit: Unit; score: number; before?: Partial<UnitProgress>;
  trusted?: boolean; reason?: string; calibrated?: boolean; bpm?: number; place?: number; route?: TakeRoute;
  /** [card line, LAST TAKE chip] for the answer "felt comfortable", and for "needs more room". */
  yes?: [string, string]; no?: [string, string];
}
const UNDER = 'Under 65%, so this counts as needing more room. ';
const ROOM = 'A second one in a row makes room: one step slower.';
// Clean takes add up at a step without having to be in a row, so no answer line warns that the count starts again.
const AGAIN: string = '';
const STAYS = 'Your tempo step stays as it is.';
const FLOOR_STAYS = 'Stays at 20 BPM, the slowest allowed.';
const FLOOR_DOWN = 'One step slower (still 20 BPM, the slowest allowed).';
const both =(line: string, chip: string): Pick<Row, 'yes' | 'no'> => ({ yes: [line, chip], no: [line, chip] });

const dueHand = { rung: 3, certified: [0.8], learned: true, interval: 1, due: now - DAY, days: [dayOf(now - 3 * DAY), dayOf(now - 2 * DAY)], attempts: 8, last: now - 2 * DAY };
const dueFull = { ...dueHand, rung: 6, certified: [0.8, 1] };
const interrupted = 'Audio timing was interrupted. This take will not change your progress.';

// What the grader writes in `reason`, and the clause each becomes after "Not counted:".
const REASONS: [string, string][] = [
  [interrupted, 'audio timing was interrupted'],
  ['Several attacks were too soft or blurred to place. This take will not change your progress.', 'several attacks were too soft or blurred to place'],
  ['The microphone recording had gaps. This take could not be judged.', 'the microphone recording had gaps'],
  ['The input distorted. Move a little farther from the microphone and try again.', 'the input distorted'],
  ['Some notes were unclear. This take will not change your progress.', 'some notes were unclear'],
  ['No keys were pressed during the take. Click the page outside any text box, then try again.', 'no keys were pressed during the take'],
  ['Too quiet to hear', 'too quiet to hear'], // no full stop
  ['  Gaps of 0.5 s were found. Try again.  ', 'gaps of 0.5 s were found'], // a decimal point does not end the sentence; edges are trimmed
  ['', 'the recording was unclear'],
  ['   ', 'the recording was unclear'],
];

const ROWS: Row[] = [
  // Plain rung: two clean takes climb, not necessarily in a row.
  { name: 'plain rung 0, 92%, 0 clean so far', unit: hand, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 40 BPM.', '92% · Clean, 1 of 2'],
    no: ['Stays at 33 BPM, the slowest step.', '92% · Needs more room: stays at 33 BPM'] },
  { name: 'plain rung 1, 92%, 0 clean so far', unit: hand, before: { rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 46 BPM.', '92% · Clean, 1 of 2'],
    no: [`Stays at 40 BPM. ${ROOM}`, '92% · Needs more room: stays at 40 BPM'] },
  { name: 'plain rung 0, 92%, 1 clean so far', unit: hand, before: { ...lately, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you up to 40 BPM.', '92% · Up to 40 BPM'],
    no: [`Stays at 33 BPM, the slowest step.${AGAIN}`, '92% · Needs more room: stays at 33 BPM'] },
  { name: 'plain rung 1, 92%, 1 clean so far', unit: hand, before: { ...lately, rung: 1, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you up to 46 BPM.', '92% · Up to 46 BPM'],
    no: [`Stays at 40 BPM. ${ROOM}${AGAIN}`, '92% · Needs more room: stays at 40 BPM'] },
  { name: 'plain rung 4 of the full step, 92%, 1 clean so far', unit: full, before: { ...lately, rung: 4, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you up to 62 BPM.', '92% · Up to 62 BPM'],
    no: [`Stays at 58 BPM. ${ROOM}${AGAIN}`, '92% · Needs more room: stays at 58 BPM'] },
  { name: 'a top step with nothing to certify, 92%', unit: steady, before: { ...lately, rung: 2 }, score: 0.92,
    yes: ['Clean at 60 BPM, the top step.', '92% · Clean at 60 BPM'],
    no: [`Stays at 60 BPM. ${ROOM}`, '92% · Needs more room: stays at 60 BPM'] },

  // 65 to 89%: held at the tempo. Under 65% counts as needing more room whichever way it felt.
  { name: 'plain rung 0, 84%', unit: hand, score: 0.84,
    yes: ['Kept at 33 BPM: 84% is under the 90% a clean take needs.', '84% · Kept at 33 BPM: under 90%'],
    no: ['Stays at 33 BPM, the slowest step.', '84% · Needs more room: stays at 33 BPM'] },
  { name: 'plain rung 1, 84%', unit: hand, before: { rung: 1 }, score: 0.84,
    yes: ['Kept at 40 BPM: 84% is under the 90% a clean take needs.', '84% · Kept at 40 BPM: under 90%'],
    no: [`Stays at 40 BPM. ${ROOM}`, '84% · Needs more room: stays at 40 BPM'] },
  { name: 'plain rung 1, 84%, 1 clean so far', unit: hand, before: { ...lately, rung: 1, clean: 1 }, score: 0.84,
    yes: [`Kept at 40 BPM: 84% is under the 90% a clean take needs.${AGAIN}`, '84% · Kept at 40 BPM: under 90%'],
    no: [`Stays at 40 BPM. ${ROOM}${AGAIN}`, '84% · Needs more room: stays at 40 BPM'] },
  { name: '89.6% prints as 89%, never 90%', unit: hand, score: 0.896,
    yes: ['Kept at 33 BPM: 89% is under the 90% a clean take needs.', '89% · Kept at 33 BPM: under 90%'],
    no: ['Stays at 33 BPM, the slowest step.', '89% · Needs more room: stays at 33 BPM'] },
  { name: 'exactly 65% is kept, not under 65%', unit: hand, before: { rung: 1 }, score: 0.65,
    yes: ['Kept at 40 BPM: 65% is under the 90% a clean take needs.', '65% · Kept at 40 BPM: under 90%'],
    no: [`Stays at 40 BPM. ${ROOM}`, '65% · Needs more room: stays at 40 BPM'] },
  { name: 'just under 65% counts as needing more room', unit: hand, before: { rung: 1 }, score: 0.649,
    ...both(`${UNDER}Stays at 40 BPM. ${ROOM}`, '64% · Needs more room: stays at 40 BPM') },
  { name: 'plain rung 0, 50%', unit: hand, score: 0.5,
    ...both(`${UNDER}Stays at 33 BPM, the slowest step.`, '50% · Needs more room: stays at 33 BPM') },
  { name: 'plain rung 1, 50%', unit: hand, before: { rung: 1 }, score: 0.5,
    ...both(`${UNDER}Stays at 40 BPM. ${ROOM}`, '50% · Needs more room: stays at 40 BPM') },
  { name: 'plain rung 1, 50%, 1 clean so far', unit: hand, before: { ...lately, rung: 1, clean: 1 }, score: 0.5,
    ...both(`${UNDER}Stays at 40 BPM. ${ROOM}${AGAIN}`, '50% · Needs more room: stays at 40 BPM') },

  // Certification rung: help fades over three clean takes, not necessarily in a row.
  { name: 'certification rung, help 0, 92%', unit: full, before: { ...lately, rung: 3 }, score: 0.92,
    yes: ['Clean. Next take: notes hidden.', '92% · Clean: next take hides the notes'],
    no: [`Stays at 53 BPM. ${ROOM}`, '92% · Needs more room: stays at 53 BPM'] },
  { name: 'certification rung, help 1, 92%', unit: full, before: { ...lately, rung: 3, support: 1, clean: 1 }, score: 0.92,
    yes: ['Clean. Next take: a click on each bar only.', '92% · Clean: next take has a click on each bar only'],
    no: [`Stays at 53 BPM. ${ROOM}`, '92% · Needs more room: stays at 53 BPM'] },
  { name: 'certification rung, help 2, 92%', unit: full, before: { ...lately, rung: 3, support: 2, clean: 2 }, score: 0.92,
    yes: ['Clean. Certifies 53 BPM and moves you up to 58 BPM.', '92% · Certified at 53 BPM'],
    no: [`Stays at 53 BPM. ${ROOM}`, '92% · Needs more room: stays at 53 BPM'] },
  { name: 'certification rung at the top on one hand, help 2', unit: hand, before: { ...lately, rung: 3, support: 2, clean: 2 }, score: 0.92,
    yes: ['Clean. Certifies 53 BPM.', '92% · Certified at 53 BPM'],
    no: [`Stays at 53 BPM. ${ROOM}`, '92% · Needs more room: stays at 53 BPM'] },
  { name: 'certification rung at the goal tempo, help 2', unit: full, before: { ...lately, rung: 6, certified: [0.8], support: 2, clean: 2 }, score: 0.92,
    yes: ['Clean. Certifies 66 BPM.', '92% · Certified at 66 BPM'],
    no: [`Stays at 66 BPM. ${ROOM}`, '92% · Needs more room: stays at 66 BPM'] },
  { name: 'certified on a second day is learned', unit: full, before: { ...lately, rung: 6, certified: [0.8, 1], days: [earlier], support: 2, clean: 2 }, score: 0.92,
    yes: ['Clean. Certified on a second day: learned.', '92% · Learned'],
    no: [`Stays at 66 BPM. ${ROOM}`, '92% · Needs more room: stays at 66 BPM'] },
  { name: 'certification rung, 84%: no "in a row" count there', unit: full, before: { ...lately, rung: 3, support: 1, clean: 1 }, score: 0.84,
    yes: ['Kept at 53 BPM: 84% is under the 90% a clean take needs.', '84% · Kept at 53 BPM: under 90%'],
    no: [`Stays at 53 BPM. ${ROOM}`, '84% · Needs more room: stays at 53 BPM'] },
  { name: 'certification rung, 50%', unit: full, before: { ...lately, rung: 3, support: 1, clean: 1 }, score: 0.5,
    ...both(`${UNDER}Stays at 53 BPM. ${ROOM}`, '50% · Needs more room: stays at 53 BPM') },

  // A second needs-more-room take in a row steps down; at the slowest step nothing moves.
  { name: 'second needs-more-room in a row, rung 1', unit: hand, before: { ...lately, rung: 1, hard: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 46 BPM.', '92% · Clean, 1 of 2'],
    no: ['One step slower: 33 BPM.', 'Needs more room twice in a row · one step slower: 33 BPM'] },
  { name: 'second needs-more-room in a row, rung 2', unit: hand, before: { ...lately, rung: 2, hard: 1 }, score: 0.92,
    no: ['One step slower: 40 BPM.', 'Needs more room twice in a row · one step slower: 40 BPM'] },
  { name: 'second needs-more-room in a row, slowest step', unit: hand, before: { ...lately, hard: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 40 BPM.', '92% · Clean, 1 of 2'],
    no: ['33 BPM is the slowest step, so it stays.', 'Needs more room twice in a row · 33 BPM is the slowest step, so it stays'] },
  { name: 'second needs-more-room in a row, under 65%', unit: hand, before: { ...lately, rung: 1, hard: 1 }, score: 0.5,
    ...both(`${UNDER}One step slower: 33 BPM.`, 'Needs more room twice in a row · one step slower: 33 BPM') },
  { name: 'second needs-more-room in a row, slowest step, under 65%', unit: hand, before: { ...lately, hard: 1 }, score: 0.5,
    ...both(`${UNDER}33 BPM is the slowest step, so it stays.`, 'Needs more room twice in a row · 33 BPM is the slowest step, so it stays') },
  { name: 'second needs-more-room in a row on a certification rung drops the help too', unit: full, before: { ...lately, rung: 3, hard: 1, support: 1, clean: 1 }, score: 0.92,
    no: ['One step slower: 46 BPM.', 'Needs more room twice in a row · one step slower: 46 BPM'] },
  { name: 'a pending needs-more-room is cleared by a middling take', unit: hand, before: { ...lately, rung: 1, hard: 1 }, score: 0.84,
    yes: ['Kept at 40 BPM: 84% is under the 90% a clean take needs.', '84% · Kept at 40 BPM: under 90%'],
    no: ['One step slower: 33 BPM.', 'Needs more room twice in a row · one step slower: 33 BPM'] },

  // Review due: one clean take at the top passes; needing more room moves one step slower, after a single take.
  { name: 'review due at the top, one hand', unit: hand, before: dueHand, score: 0.92,
    yes: ['Passes the review.', '92% · Review passed'],
    no: ['One step slower: 46 BPM. It comes back quickly.', 'Needs more room · one step slower: 46 BPM. It comes back quickly.'] },
  { name: 'review due at the top, full step', unit: full, before: dueFull, score: 0.92,
    yes: ['Passes the review.', '92% · Review passed'],
    no: ['One step slower: 62 BPM. It comes back quickly.', 'Needs more room · one step slower: 62 BPM. It comes back quickly.'] },
  { name: 'review due below the top', unit: full, before: { ...dueFull, rung: 3 }, score: 0.92,
    no: ['One step slower: 46 BPM. It comes back quickly.', 'Needs more room · one step slower: 46 BPM. It comes back quickly.'] },
  { name: 'review due, under 65%', unit: hand, before: dueHand, score: 0.5,
    ...both(`${UNDER}One step slower: 46 BPM. It comes back quickly.`, 'Needs more room · one step slower: 46 BPM. It comes back quickly.') },
  { name: 'review due at the slowest step', unit: hand, before: { ...dueHand, rung: 0 }, score: 0.92,
    no: ['33 BPM is the slowest step, so it stays.', 'Needs more room · 33 BPM is the slowest step, so it stays'] },

  // A clean take that is the step's first counted take on a new day: "it stuck overnight".
  { name: 'overnight, clean 1 of 2', unit: hand, before: { ...yesterday, rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 46 BPM.', '92% · Clean: it stuck overnight'],
    no: [`Stays at 40 BPM. ${ROOM}`, '92% · Needs more room: stays at 40 BPM'] },
  { name: 'overnight, climb', unit: hand, before: { ...yesterday, rung: 1, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you up to 46 BPM.', '92% · Clean: it stuck overnight'] },
  { name: 'overnight, help fades', unit: full, before: { ...yesterday, rung: 3 }, score: 0.92,
    yes: ['Clean. Next take: notes hidden.', '92% · Clean: it stuck overnight'] },
  { name: 'overnight, certified', unit: full, before: { ...yesterday, rung: 3, support: 2, clean: 2 }, score: 0.92,
    yes: ['Clean. Certifies 53 BPM and moves you up to 58 BPM.', '92% · Clean: it stuck overnight'] },
  { name: 'overnight, a top step with nothing to certify', unit: steady, before: { ...yesterday, rung: 2 }, score: 0.92,
    yes: ['Clean at 60 BPM, the top step.', '92% · Clean: it stuck overnight'] },
  { name: 'overnight, but a middling take is only kept', unit: hand, before: { ...yesterday, rung: 1 }, score: 0.84,
    yes: ['Kept at 40 BPM: 84% is under the 90% a clean take needs.', '84% · Kept at 40 BPM: under 90%'] },
  { name: 'a first take ever is not overnight, whatever last says', unit: hand, before: { attempts: 0, last: now - DAY, rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 46 BPM.', '92% · Clean, 1 of 2'] },
  { name: 'a take with no recorded time is not overnight', unit: hand, before: { attempts: 3, last: 0, rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 46 BPM.', '92% · Clean, 1 of 2'] },

  // The 20 BPM floor.
  { name: '20 BPM floor, 0 clean so far', unit: slow, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you to the next step (still 20 BPM, the slowest allowed).', '92% · Clean, 1 of 2'],
    no: ['Stays at 20 BPM, the slowest step.', '92% · Needs more room: stays at 20 BPM'] },
  // Not in the tables: the climb line and chip name the next step's tempo, 20 BPM again, where the NEXT TAKE sentence uses the floor wording.
  { name: '20 BPM floor, 1 clean so far', unit: slow, before: { ...lately, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you to the next step (still 20 BPM, the slowest allowed).', '92% · To the next step'],
    no: [`Stays at 20 BPM, the slowest step.${AGAIN}`, '92% · Needs more room: stays at 20 BPM'] },
  // The step below plays the same 20 BPM, so a first needs-more-room take says it stays there, and a second one says it
  // steps down without a slower tempo, instead of promising a slower tempo.
  { name: 'past the floor', unit: slow, before: { rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 21 BPM.', '92% · Clean, 1 of 2'],
    no: [FLOOR_STAYS, '92% · Needs more room: stays at 20 BPM'] },
  { name: 'past the floor, under 65%', unit: slow, before: { rung: 1 }, score: 0.5,
    ...both(`${UNDER}${FLOOR_STAYS}`, '50% · Needs more room: stays at 20 BPM') },
  { name: 'past the floor, 1 clean so far', unit: slow, before: { ...lately, rung: 1, clean: 1 }, score: 0.92,
    yes: ['Clean take 2 of 2. Moves you up to 21 BPM.', '92% · Up to 21 BPM'],
    no: [`${FLOOR_STAYS}${AGAIN}`, '92% · Needs more room: stays at 20 BPM'] },
  { name: 'second needs-more-room in a row, onto the 20 BPM floor', unit: slow, before: { ...lately, rung: 1, hard: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 21 BPM.', '92% · Clean, 1 of 2'],
    no: [FLOOR_DOWN, 'Needs more room twice in a row · one step slower (still 20 BPM, the slowest allowed)'] },
  { name: 'second needs-more-room in a row, onto the 20 BPM floor, under 65%', unit: slow, before: { ...lately, rung: 1, hard: 1 }, score: 0.5,
    ...both(`${UNDER}${FLOOR_DOWN}`, 'Needs more room twice in a row · one step slower (still 20 BPM, the slowest allowed)') },
  { name: 'second needs-more-room in a row, on the first 20 BPM step', unit: slow, before: { ...lately, hard: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you to the next step (still 20 BPM, the slowest allowed).', '92% · Clean, 1 of 2'],
    no: ['20 BPM is the slowest step, so it stays.', 'Needs more room twice in a row · 20 BPM is the slowest step, so it stays'] },
  { name: 'second needs-more-room in a row, off the floor', unit: slow, before: { ...lately, rung: 2, hard: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 24 BPM.', '92% · Clean, 1 of 2'],
    no: ['One step slower: 20 BPM.', 'Needs more room twice in a row · one step slower: 20 BPM'] },
  { name: 'review due, onto the 20 BPM floor', unit: slow, before: { ...dueHand, rung: 1 }, score: 0.92,
    yes: ['Clean take 1 of 2. One more moves you up to 21 BPM.', '92% · Clean: it stuck overnight'], // the last take was two days ago
    no: [`${FLOOR_DOWN} It comes back quickly.`, 'Needs more room · one step slower (still 20 BPM, the slowest allowed). It comes back quickly.'] },

  // A saved step past the top reads as the top step, so a second needs-more-room take cannot move it: no slower step is promised.
  { name: 'second needs-more-room in a row, on a saved step past the top', unit: hand, before: { ...lately, rung: 9, hard: 1 }, score: 0.92,
    yes: ['Clean. Next take: notes hidden.', '92% · Clean: next take hides the notes'],
    no: ['Stays at 53 BPM.', 'Needs more room twice in a row · stays at 53 BPM'] },
  { name: 'review due, on a saved step past the top', unit: hand, before: { ...dueHand, rung: 9 }, score: 0.92,
    yes: ['Passes the review.', '92% · Review passed'],
    no: ['Stays at 53 BPM.', 'Needs more room · stays at 53 BPM'] },

  // Not counted: an unclear recording, timing that is not calibrated, a free tempo. Either answer, one line.
  ...REASONS.map(([reason, quoted]): Row => ({
    name: `unclear recording: ${JSON.stringify(reason)}`, unit: hand, before: { rung: 1 }, score: 0.4, trusted: false, reason,
    ...both(`Not counted: ${quoted}. ${STAYS}`, `Not counted · ${quoted}`),
  })),
  { name: 'timing not calibrated', unit: hand, before: { rung: 1 }, score: 0.92, calibrated: false,
    ...both(`Not counted: timing is not calibrated. ${STAYS}`, 'Not counted · timing is not calibrated') },
  { name: 'an unclear recording is named before uncalibrated timing', unit: hand, before: { rung: 1 }, score: 0.4, trusted: false, calibrated: false, reason: 'The microphone recording had gaps. This take could not be judged.',
    ...both(`Not counted: the microphone recording had gaps. ${STAYS}`, 'Not counted · the microphone recording had gaps') },
  { name: 'free tempo', unit: hand, before: { rung: 1 }, score: 0.92, bpm: 36, route: 'free',
    ...both(`Not counted: free tempo. ${STAYS}`, 'Not counted · free tempo') },
  { name: 'free tempo is named before an unclear recording', unit: hand, before: { rung: 1 }, score: 0.4, trusted: false, reason: interrupted, bpm: 36, route: 'free',
    ...both(`Not counted: free tempo. ${STAYS}`, 'Not counted · free tempo') },

  // Placement: one clean, comfortable take at the target places; nothing else records anything.
  { name: 'placement, 92%', unit: full, score: 0.92, bpm: 53, place: 3, route: 'place',
    yes: ['Places you at 53 BPM.', 'Placed at 53 BPM'],
    no: ['Not placed. Nothing is recorded.', 'Not placed · nothing recorded'] },
  { name: 'placement at the goal tempo', unit: full, score: 0.97, bpm: 66, place: 6, route: 'place',
    yes: ['Places you at 66 BPM.', 'Placed at 66 BPM'],
    no: ['Not placed. Nothing is recorded.', 'Not placed · nothing recorded'] },
  { name: 'placement on one hand stops at its top step', unit: hand, score: 0.92, bpm: 53, place: 6, route: 'place',
    yes: ['Places you at 53 BPM.', 'Placed at 53 BPM'],
    no: ['Not placed. Nothing is recorded.', 'Not placed · nothing recorded'] },
  { name: 'placement, 84%', unit: full, score: 0.84, bpm: 53, place: 3, route: 'place',
    yes: ['Not placed: 84% is under 90%. Nothing is recorded.', 'Not placed · nothing recorded'],
    no: ['Not placed. Nothing is recorded.', 'Not placed · nothing recorded'] },
  { name: 'placement, 89.6% prints as 89%', unit: full, score: 0.896, bpm: 53, place: 3, route: 'place',
    yes: ['Not placed: 89% is under 90%. Nothing is recorded.', 'Not placed · nothing recorded'],
    no: ['Not placed. Nothing is recorded.', 'Not placed · nothing recorded'] },
  { name: 'placement, unclear recording', unit: full, score: 0.84, trusted: false, reason: interrupted, bpm: 53, place: 3, route: 'place',
    ...both('Not placed. Nothing is recorded.', 'Not placed · nothing recorded') },
  { name: 'placement, timing not calibrated', unit: full, score: 0.84, calibrated: false, bpm: 53, place: 3, route: 'place',
    ...both('Not placed. Nothing is recorded.', 'Not placed · nothing recorded') },
  { name: 'placement at a step it is already past', unit: full, before: { ...lately, rung: 4 }, score: 0.92, bpm: 53, place: 3, route: 'place',
    ...both('Not placed. Nothing is recorded.', 'Not placed · nothing recorded') },
];

const takeOf = (r: Row, before: UnitProgress): TakeFacts => ({
  bpm: r.bpm ?? rungBpm(r.unit, before), ...(r.place !== undefined ? { place: r.place } : {}),
  result: { trusted: r.trusted ?? true, score: r.score, reason: r.reason ?? '' }, calibrated: r.calibrated ?? true,
});
const answers = (r: Row) => [['felt comfortable', true, r.yes], ['needs more room', false, r.no]] as const;

it('gives each answer the consequence line of the A3.2 table', () => {
  for (const r of ROWS) {
    const before = prog(r.before), take = takeOf(r, before), lines = answerLines(r.unit, before, take, now);
    for (const [answer, comfortable, expected] of answers(r)) {
      if (!expected) continue;
      expect(comfortable ? lines.comfortable : lines.struggling, `${r.name}: ${answer}, answerLines`).toBe(expected[0]);
      expect(outcome(r.unit, before, take, comfortable, now).line, `${r.name}: ${answer}, outcome`).toBe(expected[0]);
    }
  }
});

it('shows the LAST TAKE chip of the A3.3 table', () => {
  for (const r of ROWS) {
    const before = prog(r.before), take = takeOf(r, before);
    for (const [answer, comfortable, expected] of answers(r)) {
      if (expected) expect(outcome(r.unit, before, take, comfortable, now).chip, `${r.name}: ${answer}`).toBe(expected[1]);
    }
  }
});

it('covers every chip of the A3.3 table', () => {
  const chips = ROWS.flatMap(r => [r.yes?.[1] ?? '', r.no?.[1] ?? '']);
  const forms: [string, RegExp][] = [
    ['clean', /^\d+% · Clean, 1 of 2$/], ['climb', /^\d+% · Up to \d+ BPM$/],
    ['fade, notes hidden', /^\d+% · Clean: next take hides the notes$/], ['fade, click only', /^\d+% · Clean: next take has a click on each bar only$/],
    ['certified', /^\d+% · Certified at \d+ BPM$/], ['learned', /^\d+% · Learned$/], ['review passed', /^\d+% · Review passed$/], ['overnight', /^\d+% · Clean: it stuck overnight$/],
    ['hold', /^\d+% · Kept at \d+ BPM: under 90%$/], ['needs more room', /^\d+% · Needs more room: stays at \d+ BPM$/],
    ['step-down after two', /^Needs more room twice in a row · one step slower: \d+ BPM$/],
    ['step-down after two, slowest step', /^Needs more room twice in a row · \d+ BPM is the slowest step, so it stays$/],
    ['step-down in review', /^Needs more room · one step slower: \d+ BPM\. It comes back quickly\.$/],
    ['step-down in review, slowest step', /^Needs more room · \d+ BPM is the slowest step, so it stays$/],
    ['step-down after two, onto the 20 BPM floor', /^Needs more room twice in a row · one step slower \(still 20 BPM, the slowest allowed\)$/],
    ['step-down after two, nothing to step down to', /^Needs more room twice in a row · stays at \d+ BPM$/],
    ['step-down in review, onto the 20 BPM floor', /^Needs more room · one step slower \(still 20 BPM, the slowest allowed\)\. It comes back quickly\.$/],
    ['step-down in review, nothing to step down to', /^Needs more room · stays at \d+ BPM$/],
    ['not counted, a reason', /^Not counted · audio timing was interrupted$/], ['not counted, free tempo', /^Not counted · free tempo$/], ['not counted, uncalibrated', /^Not counted · timing is not calibrated$/],
    ['placed', /^Placed at \d+ BPM$/], ['not placed', /^Not placed · nothing recorded$/],
  ];
  for (const [name, form] of forms) expect(chips.some(chip => form.test(chip)), name).toBe(true);
});

it('runs the real ladder and placement rules on a copy of the progress', () => {
  for (const r of ROWS) {
    const before = prog(r.before), take = takeOf(r, before), snapshot = structuredClone(before);
    for (const [answer, comfortable] of answers(r)) {
      const label = `${r.name}: ${answer}`, got = outcome(r.unit, before, take, comfortable, now);
      expect(got.route, `${label}, route`).toBe(r.route ?? 'ladder');
      expect(got.route, `${label}, route is routeTake's`).toBe(routeTake(r.unit, before, take));
      if (got.route === 'place') {
        const real = placeUnit(r.unit, before, take.place!, take.result, comfortable, now, take.calibrated);
        expect(got.after, `${label}, progress`).toEqual(real.progress);
        expect(got.event, `${label}, event`).toEqual(real.event);
      } else if (got.route === 'ladder' && take.result.trusted && take.calibrated) {
        const real = advanceUnit(r.unit, before, take.result, comfortable, now, take.calibrated);
        expect(got.after, `${label}, progress`).toEqual(real.progress);
        expect(got.event, `${label}, event`).toEqual(real.event);
      } else {
        expect(got.after, `${label}, progress`).toEqual(before);
        expect(got.event, `${label}, event`).toBeUndefined();
      }
    }
    expect(before, `${r.name}: the progress it was given`).toEqual(snapshot);
  }
});

it('never changes what it is given', () => {
  for (const r of ROWS) {
    const before = deepFreeze(prog(r.before)), snapshot = structuredClone(before), take = deepFreeze(takeOf(r, before));
    expect(Object.isFrozen(before) && Object.isFrozen(before.days) && Object.isFrozen(take.result) && Object.isFrozen(r.unit.rungs), `${r.name}: frozen`).toBe(true);
    for (const comfortable of [true, false]) outcome(r.unit, before, take, comfortable, now);
    answerLines(r.unit, before, take, now);
    expect(before, r.name).toEqual(snapshot);
  }
  for (const r of NEXT_ROWS) {
    const state = deepFreeze(structuredClone(r.state)), snapshot = structuredClone(state);
    nextLine(state);
    expect(state, r.name).toEqual(snapshot);
  }
});

// ---- promises: what a step sentence says the ladder will do, replayed through the real ladder ----

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** One take that counts and scores 95%: clean when the learner says it felt comfortable. */
const cleanTake = (unit: Unit, p: UnitProgress, comfortable = true, at = now) => advanceUnit(unit, p, { trusted: true, score: 0.95 }, comfortable, at, true);
/** n clean takes in a row at one moment: the progress after each, the start first. */
function cleanTakes(unit: Unit, start: UnitProgress, n: number, at = now): UnitProgress[] {
  const trace = [start];
  for (let i = 0; i < n; i++) trace.push(cleanTake(unit, trace[i], true, at).progress);
  return trace;
}
const stepText = (unit: Unit, p: UnitProgress, at = now) => nextLine({ unit, p, now: at }).text;

/** What a step sentence promises, read back from its own words. takes: the clean takes it names. */
interface Promised { kind: 'climb' | 'certify' | 'help' | 'last' | 'learn' | 'today' | 'review' | 'review-up' | 'learned' | 'steady'; takes: number; bpm?: number; to?: number; top?: number; label?: string; days?: number }
const COUNT = { One: 1, Two: 2, Three: 3 } as const;
const RULES: [RegExp, (m: RegExpMatchArray) => Promised][] = [
  [/^(Two clean takes move|One more clean take moves) you (?:up to (\d+) BPM|to the next step \(still (\d+) BPM, the slowest allowed\))\.$/,
    m => ({ kind: 'climb', takes: m[1].startsWith('Two') ? 2 : 1, bpm: Number(m[2] ?? m[3]) })],
  [/^Three clean takes certify (\d+) BPM, each with less help\. This one: notes shown \(1 of 3\)\.$/, m => ({ kind: 'certify', takes: 3, bpm: Number(m[1]) })],
  [/^Take 2 of 3 at (\d+) BPM, notes hidden\. A clean take unlocks the last one: a click on each bar only\.$/, m => ({ kind: 'help', takes: 1, bpm: Number(m[1]) })],
  [/^Last of 3 at (\d+) BPM: notes hidden, a click on each bar only\. A clean take certifies (?:it and moves you (?:up to (\d+) BPM|to the next step)|(\d+) BPM, the (top step for one hand|goal tempo))\.$/,
    m => ({ kind: 'last', takes: 1, bpm: Number(m[1]), to: m[2] === undefined ? undefined : Number(m[2]), top: m[3] === undefined ? undefined : Number(m[3]), label: m[4] })],
  [/^Certified before\. (One|Two|Three) clean takes? today makes? it learned\.$/, m => ({ kind: 'learn', takes: COUNT[m[1] as keyof typeof COUNT] })],
  [/^Certified today\. Come back on another day to call it learned\.$/, () => ({ kind: 'today', takes: 0 })],
  [/^Review due: one clean take at (\d+) BPM passes it\. A take that needs more room moves you one step slower\.$/, m => ({ kind: 'review', takes: 1, bpm: Number(m[1]) })],
  [/^Review due: work back up to (\d+) BPM, then one clean take there passes it\.$/, m => ({ kind: 'review-up', takes: 0, bpm: Number(m[1]) })],
  [/^Learned\. It comes back for review in (\d+) days?\.$/, m => ({ kind: 'learned', takes: 0, days: Number(m[1]) })],
  [/^Top step: (\d+) BPM\. Clean takes keep it steady\.$/, m => ({ kind: 'steady', takes: 0, bpm: Number(m[1]) })],
];
const promiseOf = (text: string): Promised | undefined => { for (const [rule, build] of RULES) { const m = text.match(rule); if (m) return build(m); } return undefined; };
/** The clean takes a sentence leaves before its step is done, for the sentences that count them. */
const left = (said?: Promised) => said?.kind === 'certify' ? 3 : said?.kind === 'help' ? 2 : said?.kind === 'last' ? 1 : said?.kind === 'climb' || said?.kind === 'learn' ? said.takes : undefined;

/** Replays the step sentence of one state through the real ladder; every promise it breaks is added to `bad`. Returns the kind of promise it made. */
function replay(unit: Unit, p: UnitProgress, bad: string[], at = now): Promised['kind'] | undefined {
  const text = stepText(unit, p, at), said = promiseOf(text), top = unit.rungs.length - 1, fraction = unit.rungs[Math.min(p.rung, top)], here = rungBpm(unit, p);
  const fail = (what: string) => bad.push(`${unit.id}, rung ${p.rung}, help ${p.support}, ${p.clean} clean: "${text}" ${what}`);
  const certifiedHere = (q: UnitProgress) => q.certified.some(c => same(c, fraction));
  if (!said) { fail('is not a sentence with a promise rule'); return undefined; }
  switch (said.kind) {
    case 'climb': {
      const trace = cleanTakes(unit, p, said.takes, at), after = trace[said.takes];
      if (p.rung >= top) fail('climbs from the top step');
      if (trace[said.takes - 1].rung !== p.rung) fail('climbs before its last take');
      if (after.rung !== p.rung + 1) fail(`ends on rung ${after.rung}`);
      if (rungBpm(unit, after) !== said.bpm) fail(`names ${said.bpm} BPM and lands on ${rungBpm(unit, after)}`);
      if (after.certified.length !== p.certified.length) fail('certifies on the way');
      break;
    }
    case 'certify': {
      const trace = cleanTakes(unit, p, 3, at);
      if (said.bpm !== here) fail(`names ${said.bpm} BPM, the step plays ${here}`);
      if (trace[1].support !== 1 || trace[2].support !== 2) fail('does not take one help away at a time');
      if (!certifiedHere(p) && certifiedHere(trace[2])) fail('certifies before the third take');
      if (!certifiedHere(trace[3])) fail('does not certify this step');
      break;
    }
    case 'help': {
      const after = cleanTakes(unit, p, 1, at)[1];
      if (said.bpm !== here) fail(`names ${said.bpm} BPM, the step plays ${here}`);
      if (after.support !== 2 || after.rung !== p.rung || after.certified.length !== p.certified.length) fail('does not unlock the last of the three');
      break;
    }
    case 'last': {
      const after = cleanTakes(unit, p, 1, at)[1], moves = said.top === undefined;
      if (said.bpm !== here) fail(`names ${said.bpm} BPM, the step plays ${here}`);
      if (!certifiedHere(after)) fail('does not certify this step');
      if (moves !== p.rung < top) fail(moves ? 'moves on from the top step' : 'stays on a step below the top');
      else if (moves) {
        if (after.rung !== p.rung + 1) fail(`ends on rung ${after.rung}`);
        else if (rungBpm(unit, after) !== (said.to ?? here)) fail(`lands on ${rungBpm(unit, after)} BPM`);
      } else {
        if (after.rung !== p.rung) fail('moves away from the top step');
        if (said.top !== here) fail(`names ${said.top} BPM for the top step, which plays ${here}`);
        if ((said.label === 'goal tempo') !== (fraction >= 1 - 1e-9)) fail('calls the top step by the wrong name');
      }
      break;
    }
    case 'learn': {
      const trace = cleanTakes(unit, p, said.takes, at);
      if (trace[said.takes - 1].learned) fail('is learned a take early');
      if (!trace[said.takes].learned) fail(`is not learned after ${said.takes} takes`);
      else if (promiseOf(stepText(unit, trace[said.takes], at))?.days !== 1) fail(`is followed by "${stepText(unit, trace[said.takes], at)}"`);
      break;
    }
    case 'today': {
      // However many clean takes come today, learned needs one more day; the next day then names the takes it needs.
      const sameDay = cleanTakes(unit, p, 6, at)[6], tomorrow = at + DAY, next = promiseOf(stepText(unit, sameDay, tomorrow));
      if (sameDay.learned || sameDay.days.length !== 1) fail('is learned, or counts a second day, on the same day');
      if (next?.kind !== 'learn') fail(`is followed the next day by "${stepText(unit, sameDay, tomorrow)}"`);
      else {
        const trace = cleanTakes(unit, sameDay, next.takes, tomorrow);
        if (trace[next.takes - 1].learned || !trace[next.takes].learned) fail(`is not learned on exactly the ${next.takes} takes the next day asks for`);
      }
      break;
    }
    case 'review': {
      const passed = cleanTake(unit, p, true, at), next = promiseOf(stepText(unit, passed.progress, at));
      if (said.bpm !== here) fail(`names ${said.bpm} BPM, the step plays ${here}`);
      if (passed.event.kind !== 'review') fail(`passes as "${passed.event.kind}"`);
      else if (!passed.progress.learned || passed.progress.due <= at || passed.progress.rung !== p.rung) fail('does not push the next review out');
      else if (next?.kind !== 'learned' || next.days !== passed.progress.interval) fail(`is followed by "${stepText(unit, passed.progress, at)}" at interval ${passed.progress.interval}`);
      for (const [how, eased] of [['not comfortable', cleanTake(unit, p, false, at)], ['under 65%', advanceUnit(unit, p, { trusted: true, score: 0.5 }, true, at, true)]] as const) {
        if (eased.event.kind !== 'step-down' || eased.progress.rung !== Math.max(0, p.rung - 1) || eased.progress.due !== at + DAY || !eased.progress.learned) fail(`does not move one step slower, once, when the take is ${how}`);
      }
      break;
    }
    case 'review-up': {
      let cur = p;
      for (let i = 0; i < 40 && cur.rung < top; i++) cur = cleanTake(unit, cur, true, at).progress;
      if (said.bpm !== rungBpm(unit, { ...p, rung: top })) fail(`names ${said.bpm} BPM for the top step`);
      if (cur.rung < top) fail('never gets back up to the top step');
      else if (!cur.learned || cur.due > at) fail('stops being due on the way up');
      else if (cleanTake(unit, cur, true, at).event.kind !== 'review') fail('a clean take at the top does not pass the review');
      break;
    }
    case 'learned': {
      const after = cleanTake(unit, p, true, at).progress;
      if (said.days !== Math.max(1, Math.ceil((p.due - at) / DAY))) fail(`names ${said.days} days`);
      if (!after.learned || after.due !== p.due) fail('is moved by a clean take before the review is due');
      break;
    }
    case 'steady': {
      if (said.bpm !== here || cleanTakes(unit, p, 4, at).some(q => q.rung !== p.rung)) fail('moves away from the top step');
      break;
    }
  }
  // Where it counts takes down, each take leaves one fewer on the next sentence.
  const total = left(said);
  if (total !== undefined) {
    const chain = cleanTakes(unit, p, total, at);
    for (let i = 1; i < total; i++) {
      const more = left(promiseOf(stepText(unit, chain[i], at)));
      if (more !== total - i) fail(`is followed after take ${i} by a sentence that counts ${more ?? 'nothing'} more, not ${total - i}`);
    }
  }
  return said.kind;
}

it('keeps every promise a step sentence makes when the real ladder takes the clean takes it asks for', () => {
  const bad: string[] = [], kinds = new Set<string>();
  for (const r of [...plainRows, ...certRows, ...doneRows]) { const kind = replay(r.state.unit, r.state.p, bad); if (kind) kinds.add(kind); }
  expect(bad).toEqual([]);
  expect([...kinds].sort()).toEqual(['certify', 'climb', 'help', 'last', 'learn', 'learned', 'review', 'review-up', 'steady', 'today']);
});

it('keeps those promises at every state on the way from a first take to a passed review', () => {
  for (const unit of [full, hand, slow]) {
    const top = unit.rungs.length - 1, bad: string[] = [], kinds = new Set<string>(), certifiedTop = (q: UnitProgress) => q.certified.some(c => same(c, unit.rungs[top]));
    let p = initialUnit(), at = now;
    const step = () => { const kind = replay(unit, p, bad, at); if (kind) kinds.add(kind); p = cleanTake(unit, p, true, at).progress; };
    for (let i = 0; i < 80 && !certifiedTop(p); i++) step(); // day one: every step up, then certified at the top
    expect(certifiedTop(p), `${unit.id}: certified at the top`).toBe(true);
    for (let i = 0; i < 4; i++) step(); // more takes the same day
    expect(p.learned, `${unit.id}: not learned on day one`).toBe(false);
    at += DAY; // day two
    for (let i = 0; i < 8 && !p.learned; i++) step();
    expect(p.learned, `${unit.id}: learned on day two`).toBe(true);
    step(); // learned, with the review not due
    at = p.due + 1; // the review is due
    step();
    expect(p.due, `${unit.id}: the next review`).toBeGreaterThan(at);
    expect(bad, unit.id).toEqual([]);
    expect([...kinds].sort(), unit.id).toEqual(['certify', 'climb', 'help', 'last', 'learn', 'learned', 'review', 'today']);
  }
});

/** What each "N BPM" in an answer line or chip stands for: the tempo this answer reaches, the one a further clean take reaches, or the step the take was at. */
type Role = 'reached' | 'next' | 'at';
function tempos(text: string): { bpm: number; role: Role; upTo: boolean }[] {
  if (!text.includes('BPM')) return [];
  return [...text.matchAll(/(\d+) BPM/g)].map(m => {
    const lead = text.slice(0, m.index ?? 0);
    const role: Role = /One more moves you (?:up to |to the next step \(still )$/.test(lead) ? 'next'
      : /(?:[Mm]oves you (?:up to |to the next step \(still )|[Oo]ne step slower(?:: | \(still )|Places you at |Placed at |Up to )$/.test(lead) ? 'reached' : 'at';
    return { bpm: Number(m[1]), role, upTo: /up to $/i.test(lead) };
  });
}
/**
 * Checks what an answer line and its chip claim against the real ladder: every tempo they name, that none says "up to" its
 * own tempo, that "a second one in a row makes room" means a slower step, that "it comes back quickly" means tomorrow, and
 * that "two clean takes in a row are needed again" means two takes that climb.
 */
function checkAnswer(unit: Unit, before: UnitProgress, got: Outcome, bad: string[], where: () => string, { tally, claims = true }: { tally?: Record<Role, number>; claims?: boolean } = {}): void {
  const current = rungBpm(unit, before), failLine = (what: string) => bad.push(`${where()}: "${got.line}" ${what}`);
  for (const text of [got.line, got.chip]) {
    for (const { bpm, role, upTo } of tempos(text)) {
      if (tally) tally[role]++;
      const fail = (what: string) => bad.push(`${where()}: "${text}" ${what}`);
      if (upTo && bpm === current) fail(`says up to ${bpm} BPM, the tempo it is at`);
      if (role === 'at' && bpm !== current) fail(`names ${bpm} BPM for the step, which plays ${current}`);
      if (role === 'reached' && bpm !== rungBpm(unit, got.after)) fail(`names ${bpm} BPM as reached, and the step then plays ${rungBpm(unit, got.after)}`);
      if (role === 'next') {
        const more = cleanTake(unit, got.after).progress;
        if (more.rung !== got.after.rung + 1 || bpm !== rungBpm(unit, more)) fail(`names ${bpm} BPM for one more clean take, which ends on rung ${more.rung} at ${rungBpm(unit, more)} BPM`);
      }
    }
  }
  if (!claims) return;
  const step = (q: UnitProgress) => Math.min(q.rung, unit.rungs.length - 1), said = got.line.replace(ROOM, '');
  if (/one step slower/i.test(said) && step(got.after) !== step(before) - 1) failLine('says one step slower, and the step does not move down by one');
  if (/the slowest step/.test(said) && step(before) !== 0) failLine('calls a step the slowest that is not the first');
  if (/the slowest allowed/.test(`${got.line} ${got.chip}`) && current !== 20) failLine('says the slowest allowed, and the tempo is not the 20 BPM floor');
  if (got.line.includes(ROOM)) {
    const second = cleanTake(unit, got.after, false).progress;
    if (second.rung !== got.after.rung - 1 || rungBpm(unit, second) >= current) failLine(`promises a slower step, but a second needs-more-room take ends on rung ${second.rung} at ${rungBpm(unit, second)} BPM`);
  }
  if (got.line.includes('It comes back quickly.') && (!got.after.learned || got.after.interval !== 1 || got.after.due !== now + DAY)) failLine('says it comes back quickly, but the review is not due tomorrow');
  if (AGAIN && got.line.includes(AGAIN.trim())) {
    const [, one, two] = cleanTakes(unit, got.after, 2);
    if (one.rung !== got.after.rung || two.rung !== got.after.rung + 1) failLine('says two clean takes in a row are needed, but they do not climb');
  }
}

it('keeps the claims of every answer line: the tempo it reaches, a slower step, a quick review, two clean takes', () => {
  const bad: string[] = [], tally: Record<Role, number> = { reached: 0, next: 0, at: 0 };
  let room = 0, quick = 0, again = 0;
  for (const r of ROWS) {
    const before = prog(r.before), take = takeOf(r, before);
    for (const [answer, comfortable] of answers(r)) {
      const got = outcome(r.unit, before, take, comfortable, now);
      checkAnswer(r.unit, before, got, bad, () => `${r.name}, ${answer}`, { tally });
      room += Number(got.line.includes(ROOM)); quick += Number(got.line.includes('It comes back quickly.')); again += Number(Boolean(AGAIN) && got.line.includes(AGAIN.trim()));
    }
  }
  expect(bad).toEqual([]);
  expect(tally.reached).toBeGreaterThan(30);
  expect(tally.next).toBeGreaterThan(10);
  expect(tally.at).toBeGreaterThan(60);
  expect([room, quick].every(count => count > 5)).toBe(true);
  expect(again).toBe(0);
});

// ---- the other lines the page writes: firstSentence, clause, capNote, takeStatus, comfortAsk, UNANSWERED ----

it('takes the first sentence up to a stop, question mark or exclamation mark that ends a word, or the whole text', () => {
  const cases: [string, string][] = [
    ['Listen once at 66 BPM with the notes moving. Notice where each section starts.', 'Listen once at 66 BPM with the notes moving.'],
    ['No end mark at all', 'No end mark at all'],
    ['', ''],
    ['A. B', 'A.'],
    ['Ends with question? Next', 'Ends with question?'],
    ['Stop! Then go.', 'Stop!'],
    ['Play at 3.5 BPM. Next', 'Play at 3.5 BPM.'], // a stop inside a number does not end the sentence
    ['Version 2.0', 'Version 2.0'], // with no space after the stop, the text has no end at all
    ['Wait... then go. Again', 'Wait...'],
    ['Only one sentence.', 'Only one sentence.'],
  ];
  for (const [text, first] of cases) expect(firstSentence(text), JSON.stringify(text)).toBe(first);
  // Whatever the text, the result is the start of it, and ends at a stop or is all of it.
  for (const text of ['', ' ', '.', '..', '?', '!', 'a', '.a', 'a.', 'a. ', ' a. b', 'a.b. c', '\n', 'a\nb. c', '“Quoted.” Next.', 'ü. Ö']) {
    const first = firstSentence(text);
    expect(text.startsWith(first), JSON.stringify(text)).toBe(true);
    expect(first === text || /[.!?]$/.test(first), JSON.stringify(text)).toBe(true);
  }
});

it('names an unclear recording by the first sentence of its reason, whatever shape the reason has', () => {
  const unclear = (reason: string) => outcome(hand, prog(), { bpm: 33, result: { trusted: false, score: 0.4, reason }, calibrated: true }, true, now);
  const cases: [string, string, string][] = [
    ['no full stop: the whole text', 'Too quiet to hear', 'too quiet to hear'],
    ['an empty reason', '', 'the recording was unclear'],
    ['a reason of spaces and a tab', ' \t ', 'the recording was unclear'],
    ['a lone full stop', '.', 'the recording was unclear'],
    ['one letter and a stop', 'A. B', 'a'],
    ['a question mark does not end it', 'Ends with question? Next', 'ends with question? Next'],
    ['a decimal point does not end it', 'Play at 3.5 BPM. Next', 'play at 3.5 BPM'],
    ['only the first sentence', 'The input distorted. Move a little farther away and try again.', 'the input distorted'],
    ['edges trimmed', '  Gaps of 0.5 s were found. Try again.  ', 'gaps of 0.5 s were found'],
  ];
  for (const [name, reason, clause] of cases) {
    const got = unclear(reason);
    expect(got.line, name).toBe(`Not counted: ${clause}. ${STAYS}`);
    expect(got.chip, name).toBe(`Not counted · ${clause}`);
    expect(got.route, name).toBe('ladder');
    expect(got.after, `${name}: nothing recorded`).toEqual(prog());
  }
});

it('explains the one-hand cap in the step note, and nowhere else', () => {
  expect(capNote(hand)).toBe('Top step for this passage on its own. Sections and the whole piece go on to 66.');
  expect(capNote({ ...hand, goalBpm: 90 })).toBe('Top step for this passage on its own. Sections and the whole piece go on to 90.');
  expect(capNote(slow)).toBe('Top step for this passage on its own. Sections and the whole piece go on to 30.');
  for (const unit of [full, tiny, steady, listen]) expect(capNote(unit), unit.id).toBe('');
});

it('writes the result card status line once per take: the score rounded down, or that it was not scored', () => {
  for (const [score, pct] of [[0.896, 89], [0.9, 90], [1, 100], [0, 0], [0.65, 65], [0.29, 29]] as const) expect(takeStatus({ trusted: true, score }), `${score}`).toBe(`Take finished: ${pct}%. Answer with ↑ or ↓.`);
  for (const score of [0, 0.5, 0.896, 1]) expect(takeStatus({ trusted: false, score }), `${score}`).toBe('Take finished. Not scored.');
  // The status line and the LAST TAKE chip never print different percentages for one take.
  for (const score of [0, 0.29, 0.5, 0.649, 0.65, 0.84, 0.896, 0.9, 0.999, 1]) for (const comfortable of [true, false]) {
    const got = outcome(hand, prog({ rung: 1 }), { bpm: 40, result: { trusted: true, score, reason: '' }, calibrated: true }, comfortable, now);
    expect(takeStatus({ trusted: true, score }), `${score}`).toBe(`Take finished: ${got.chip.split(' · ')[0]}. Answer with ↑ or ↓.`);
  }
});

it('asks how the take felt and names what Space answers', () => {
  expect(comfortAsk(true)).toBe('How did that feel? Space = felt comfortable');
  expect(comfortAsk(false)).toBe('How did that feel? Space = needs more room');
  // The page sets the question and the Space answer in two spans, split before "Space = ".
  for (const comfortable of [true, false]) expect(comfortAsk(comfortable).split(/(?=Space = )/)).toEqual(['How did that feel? ', `Space = ${comfortable ? 'felt comfortable' : 'needs more room'}`]);
});

it('says in one line that a take that was not answered changed nothing', () => {
  expect(UNANSWERED).toBe('That take was not answered, so it did not change your tempo step.');
});

// ---- every real unit ----

const pack = readFileSync(new URL('../src/piece/packs/gymnopedie-1.piece.txt', import.meta.url), 'utf8');
const piece = compile(pack).score!, arrangement = arrange(piece);
/** The piece's own goal tempo, 30 and 66, and 120: goals that put steps on the 20 BPM floor, or give the tempos three digits. */
const GOALS = [...new Set([piece.tempo.bpm, 30, 66, 120])];
const COURSES = [
  ...GOALS.flatMap(goal => [
    { name: `piano, goal ${goal}`, units: buildCurriculum(piece, goal).units },
    { name: `guitar, goal ${goal}`, units: guitarUnits(piece, arrangement, goal) },
  ]),
  { name: 'guitar piece', units: guitarPieceUnits(piece, arrangePiece(piece), piece.tempo.bpm) },
];
const states = (unit: Unit): [string, Partial<UnitProgress>][] => [
  ['plain', { attempts: 3, last: now - 60_000 }],
  ['certified on an earlier day', { certified: [...unit.certify], days: [earlier], attempts: 9, last: now - DAY }],
  ['certified today', { certified: [...unit.certify], days: [today], attempts: 9, last: now - 60_000 }],
  ['learned, review not due', { certified: [...unit.certify], learned: true, interval: 2, due: now + 3 * DAY, days: [earlier, today], attempts: 9, last: now - DAY }],
  ['learned, review due', { certified: [...unit.certify], learned: true, interval: 2, due: now - DAY, days: [earlier, today], attempts: 9, last: now - DAY }],
];
const facts = (unit: Unit, p: UnitProgress, score: number): TakeFacts => ({ bpm: rungBpm(unit, p), result: { trusted: true, score, reason: '' }, calibrated: true });
/** What an answer does depends on the ladder alone (and on a step that is only listened to or only covered), so such steps are swept once. */
const shapeOf = (unit: Unit) => JSON.stringify([unit.kind === 'listen', unit.rungs, unit.certify, unit.goalBpm, Boolean(unit.sameAs)]);

interface Sweep { bad: string[]; strings: Set<string>; lines: number; outcomes: number; replays: number; units: number }
let swept: Sweep | undefined;
/** Every real unit x rung x help level x state x clean count: NEXT TAKE for all, answers and promises for each distinct ladder. Run once. */
function sweepRealUnits(): Sweep {
  if (swept) return swept;
  const bad: string[] = [], strings = new Set<string>(), shapes = new Set<string>();
  let lines = 0, outcomes = 0, replays = 0, count = 0;
  for (const { name, units } of COURSES) {
    for (const unit of units) {
      // Takes count on every step but a listening step and a covered step, whose answers only have to be harmless.
      const top = unit.rungs.length - 1, shape = shapeOf(unit), fresh = !shapes.has(shape), counts = unit.kind !== 'listen' && !unit.sameAs;
      const sameAsTitle = unit.sameAs ? units.find(u => u.id === unit.sameAs)?.title : undefined;
      shapes.add(shape); count++;
      // The step caption and note.
      const first = firstSentence(unit.goal), rest = unit.goal.slice(first.length), note = capNote(unit);
      if (!first || !unit.goal.startsWith(first) || (first !== unit.goal && !/[.!?]$/.test(first)) || (rest !== '' && !/^\s/.test(rest))) bad.push(`${name}, ${unit.id}: the first sentence of "${unit.goal}" is "${first}"`);
      if (note !== '') { strings.add(note); if (!note.endsWith(`go on to ${unit.goalBpm}.`)) bad.push(`${name}, ${unit.id}: the cap note says "${note}"`); }
      for (let rung = 0; rung <= top; rung++) for (const support of [0, 1, 2] as const) for (const [state, over] of states(unit)) for (const clean of [0, 1]) {
        const p = prog({ ...over, rung, support, clean }), where = () => `${name}, ${unit.id}, rung ${rung}, help ${support}, ${state}, ${clean} clean`, here = rungBpm(unit, p);
        try {
          const line = nextLine({ unit, p, now, sameAsTitle });
          lines++;
          if (line.text.length > 130) bad.push(`${where()}: ${line.text.length} characters: "${line.text}"`);
          for (const text of [line.text, line.muted, line.action?.label ?? '']) {
            strings.add(text);
            for (const m of text.matchAll(/up to (\d+) BPM/gi)) if (Number(m[1]) === here) bad.push(`${where()}: "${text}" goes up to the tempo it is at`);
          }
          if (!fresh) continue;
          if (counts) {
            replays++; replay(unit, p, bad);
            // A free tempo: the line sends the learner back to the tempo that counts, which the router does count.
            const away = nextLine({ unit, p, now, free: here + 7 });
            strings.add(away.text); strings.add(away.action?.label ?? '');
            if (away.text.length > 130 || !away.text.endsWith(`Go back to ${here} BPM to count takes.`) || away.action?.label !== `Back to ${here} BPM`) bad.push(`${where()}: the free tempo line is "${away.text}", action "${away.action?.label}"`);
            if (routeTake(unit, p, { bpm: here + 7 }) !== 'free' || routeTake(unit, p, { bpm: here }) !== 'ladder') bad.push(`${where()}: the tempo the free tempo line names does not count`);
          }
          // Answers, with no needs-more-room take waiting and with one waiting (the second in a row steps down).
          for (const hard of [0, 1]) {
            const q = { ...p, hard }, why = () => `${where()}, hard ${hard}`;
            const answers: Outcome[] = hard ? [] : [outcome(unit, q, { ...facts(unit, q, 0.95), place: top }, true, now)];
            for (const score of [0.5, 0.8, 0.95]) for (const comfortable of [true, false]) answers.push(outcome(unit, q, facts(unit, q, score), comfortable, now));
            for (const got of answers) { outcomes++; strings.add(got.line); strings.add(got.chip); checkAnswer(unit, q, got, bad, why, { claims: counts }); }
          }
        } catch (error) {
          bad.push(`${where()}: threw ${String(error)}`);
        }
      }
    }
  }
  return (swept = { bad, strings, lines, outcomes, replays, units: count });
}

it('says something short and true about every real unit, rung, help level and state', () => {
  const { bad, lines, outcomes, replays, units } = sweepRealUnits();
  expect(bad.slice(0, 15), `${bad.length} problems`).toEqual([]);
  // The sweep covers a lot: piano and guitar courses at each goal, five states, three help levels, two clean counts.
  expect(units).toBeGreaterThan(300);
  expect(lines).toBeGreaterThan(30000);
  expect(outcomes).toBeGreaterThan(10000);
  expect(replays).toBeGreaterThan(1000);
});

// ---- wording rules ----

/** The tone rules as words that must never reach the learner: no loss, streaks, points, badges, XP or notifications. */
const BANNED = [/\b(lost|reset|failed|streaks?|points?|badges?|xp|notifications?)\b/i, /hard take/i];
const tone = (strings: Iterable<string>) => [...strings].flatMap(text => BANNED.filter(banned => banned.test(text)).map(banned => `${banned}: "${text}"`));

it('never uses a banned word, in any sentence, line, action, chip, status or note', () => {
  const strings = [
    ...NEXT_ROWS.flatMap(r => { const line = nextLine(r.state); return [line.text, line.muted, line.action?.label ?? '']; }),
    ...ROWS.flatMap(r => {
      const before = prog(r.before), take = takeOf(r, before), lines = answerLines(r.unit, before, take, now);
      return [lines.comfortable, lines.struggling, ...[true, false].flatMap(comfortable => { const got = outcome(r.unit, before, take, comfortable, now); return [got.line, got.chip]; })];
    }),
    ...GUARDS.flatMap(g => { const line = nextLine(nextState(lf(g.unit ?? hand, g.flags))); return [line.text, line.muted, line.action?.label ?? '']; }),
    ...Object.values(SAY),
    nextLine(st(tiny, { rung: 3, support: 2 })).text,
    UNANSWERED, comfortAsk(true), comfortAsk(false), takeStatus({ trusted: true, score: 0.896 }), takeStatus({ trusted: false, score: 0 }),
    capNote(hand), capNote(slow),
  ].filter(text => text !== '');
  expect(strings.length).toBeGreaterThan(300);
  expect(tone(strings)).toEqual([]);
  const everyUnit = sweepRealUnits().strings;
  expect(everyUnit.size).toBeGreaterThan(500);
  expect(tone(everyUnit)).toEqual([]);
  // The check itself bites.
  for (const bad of ['Your streak is lost', 'Your streaks go on', 'Badge earned', 'Two badges', 'That was a hard take', 'Reset to 33 BPM', 'You failed', 'Points: 3', 'One point', 'You earned XP', 'Notification sent', '3 notifications']) expect(tone([bad]), bad).not.toEqual([]);
});

it('keeps every NEXT TAKE sentence to 130 characters or fewer', () => {
  for (const r of NEXT_ROWS) expect(nextLine(r.state).text.length, r.name).toBeLessThanOrEqual(130);
});

it('does not promise a step slower when a saved rung past the top would only fall back to the top', () => {
  const before = { ...initialUnit(), rung: 9 }, now = new Date(2026, 10, 14, 12).getTime();
  const first = outcome(hand, before, facts(hand, before, 0.95), false, now);
  expect(first.line).toBe('Stays at 53 BPM.');
  const second = outcome(hand, first.after, facts(hand, first.after, 0.95), false, now);
  expect(rungBpm(hand, second.after)).toBe(53);
  expect(second.line).toBe('Stays at 53 BPM.');
});
