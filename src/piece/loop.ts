import type { Unit } from './curriculum';
import { advanceUnit, CLEAN, DAY, dayOf, placeUnit, rungBpm, type AdvanceEvent, type UnitProgress } from './progress';
import { floorPct } from './pct';

export { floorPct };

/** Where an answered take goes: a placement, a free-tempo take (never on the ladder), or the ladder itself. */
export type TakeRoute = 'place' | 'free' | 'ladder';
export function routeTake(unit: Unit, before: UnitProgress, take: { bpm: number; place?: number }): TakeRoute {
  return take.place !== undefined ? 'place' : take.bpm !== rungBpm(unit, before) ? 'free' : 'ladder';
}

const at = (unit: Unit, p: UnitProgress, rung: number) => rungBpm(unit, { ...p, rung });
const topOf = (unit: Unit) => unit.rungs.length - 1;
const rungOf = (unit: Unit, p: UnitProgress) => Math.min(p.rung, topOf(unit));
const certifies = (unit: Unit, fraction: number) => unit.certify.some(c => Math.abs(c - fraction) < 1e-9);
/** What reaching the next rung is called: its tempo, or the 20 BPM floor when the next rung plays no faster. */
const upTo = (unit: Unit, p: UnitProgress, short = false) => {
  const now = at(unit, p, rungOf(unit, p)), next = at(unit, p, Math.min(rungOf(unit, p) + 1, topOf(unit)));
  return next > now ? `up to ${next} BPM` : short ? 'to the next step' : `to the next step (still ${now} BPM, the slowest allowed)`;
};
/** The top step's name: the goal tempo, or the one-hand cap. */
const topName = (unit: Unit, p: UnitProgress) => `${at(unit, p, topOf(unit))} BPM${unit.rungs[topOf(unit)] < 1 - 1e-9 ? ', the top step for one hand' : ', the goal tempo'}`;
/** A grade reason's first sentence, as a clause. */
const clause = (reason: string) => { const t = reason.trim(), s = (t.match(/^.*?\.(?=\s|$)/)?.[0] ?? t).replace(/\.$/, ''); return s ? s[0].toLowerCase() + s.slice(1) : 'the recording was unclear'; };
/** A text's first sentence (the whole text when it has no sentence end). */
export const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
/** The About-this-step note on a one-hand step, whose ladder stops below the goal tempo; empty on other steps. */
export const capNote = (unit: Unit) => unit.rungs[topOf(unit)] < 1 - 1e-9 ? `Top step for this passage on its own. Sections and the whole piece go on to ${unit.goalBpm}.` : '';
/** Coach line when picking a step, an instrument, a piece or Calibrate drops a take that waited for its answer. */
export const UNANSWERED = 'That take was not answered, so it did not change your tempo step.';
/** The result card's one status line, written once per take (none for spot passes). */
export const takeStatus = (result: { trusted: boolean; score: number }) => result.trusted ? `Take finished: ${floorPct(result.score)}%. Answer with ↑ or ↓.` : 'Take finished. Not scored.';
/** The comfort question over the two answer buttons, naming what Space answers. */
export const comfortAsk = (comfortable: boolean) => `How did that feel? Space = ${comfortable ? 'felt comfortable' : 'needs more room'}`;

export const CLEAN_RULE = 'Clean = 80% or better, and you say it felt comfortable.';

export interface NextState {
  unit: Unit; p: UnitProgress; now: number;
  /** The covered step's own title (unit.sameAs). */
  sameAsTitle?: string;
  /** A take waits for its answer; 'demo' while a demo plays over it. */
  owed?: 'answer' | 'demo';
  /** The trouble-spot offer after a take: its bars and tempo, or 'choose' when the bars were unclear. */
  offer?: { bars: string; bpm: number } | 'choose';
  /** After a spot pass: clean passes in a row so far. */
  pass?: number;
  spot?: { bars: string; bpm: number };
  wait?: boolean;
  /** A microphone take on a step that counts, with timing not calibrated. */
  uncalibrated?: boolean;
  /** A placement take is under way at this tempo. */
  placing?: number;
  /** A free tempo is set. */
  free?: number;
}
export interface NextLine { text: string; muted: string; action?: { kind: 'calibrate' | 'free-back' | 'goto'; label: string } }

/** NEXT TAKE: what the next take will do and why. First match wins, in the order of the checks below. */
export function nextLine(s: NextState): NextLine {
  const { unit, p, now } = s, line = (text: string, muted = '', action?: NextLine['action']): NextLine => ({ text, muted, ...(action ? { action } : {}) });
  if (s.owed) return line(s.owed === 'demo' ? 'Answer when the playback ends.' : 'Answer first: how did that take feel? ↑ comfortable · ↓ needs more room.');
  if (s.offer) return line(s.offer === 'choose' ? 'Choose the bars to practise, or carry on.' : `Practise ${s.offer.bars} at ${s.offer.bpm} BPM, or carry on.`);
  if (s.pass !== undefined) return line(s.pass >= 2 ? 'Two clean passes in a row. Put them back in context.' : s.pass === 1 ? 'Clean pass. One more in a row, then back to the step.' : 'Again until it comes out clean, or slow it down.');
  if (s.spot) return line(`Spot practice on ${s.spot.bars} at ${s.spot.bpm} BPM. It never changes your tempo step.`);
  if (s.wait) return line('Wait for me: the notes wait for your keys. Only keys are checked, and it never moves your tempo.');
  if (unit.kind === 'listen') return line('Let it play to the end. Then it counts as heard. Nothing is scored.');
  if (unit.sameAs) return line(`Same notes as “${s.sameAsTitle ?? unit.sameAs}”. Practise that step; this one follows it.`, '', { kind: 'goto', label: `Go to “${s.sameAsTitle ?? unit.sameAs}”` });
  if (s.uncalibrated) return line('Takes will not move your tempo until timing is calibrated: 8 clicks, with an earcup held to the mic.', '', { kind: 'calibrate', label: 'Calibrate' });
  if (s.placing !== undefined) return line(`Placement take at ${s.placing} BPM: one clean, comfortable take places you here. Otherwise nothing is recorded.`);
  const rung = at(unit, p, rungOf(unit, p));
  if (s.free !== undefined) return line(`Free tempo: takes at ${s.free} BPM do not move the ladder. Go back to ${rung} BPM to count takes.`, '', { kind: 'free-back', label: `Back to ${rung} BPM` });
  return line(...stepLine(unit, p, now));
}

/** What the page knows when it paints NEXT TAKE. placing: the placement target's tempo while a placement take was started. */
export interface LoopFlags {
  unit: Unit; p: UnitProgress; now: number; sameAsTitle?: string;
  /** A take waits for its answer; running: anything plays (take, demo, playback, Wait for me); practice: the live plan is a practice take. */
  pending: boolean; running: boolean; practice: boolean; wait: boolean;
  keys: boolean; calibrated: boolean; placing?: number; free?: number;
  offer?: NextState['offer']; pass?: number; spot?: NextState['spot'];
}
/** The guards that turn page state into NEXT TAKE's input. */
export function nextState(f: LoopFlags): NextState {
  return {
    unit: f.unit, p: f.p, now: f.now, sameAsTitle: f.sameAsTitle,
    owed: f.pending && !f.wait ? (f.running ? 'demo' : 'answer') : undefined,
    offer: f.offer, pass: f.spot ? f.pass : undefined, spot: f.spot, wait: f.wait,
    uncalibrated: !f.keys && !f.calibrated && f.unit.kind !== 'listen' && !f.unit.sameAs && !f.spot,
    placing: f.running && f.practice && !f.spot ? f.placing : undefined, free: f.spot ? undefined : f.free,
  };
}

/** The step's own state, as a sentence and an optional muted line. */
function stepLine(unit: Unit, p: UnitProgress, now: number): [string, string] {
  const r = rungOf(unit, p), top = p.rung >= topOf(unit), fraction = unit.rungs[r], bpm = at(unit, p, r);
  if (p.learned) {
    if (p.due > now) { const n = Math.max(1, Math.ceil((p.due - now) / DAY)); return [`Learned. It comes back for review in ${n} day${n === 1 ? '' : 's'}.`, '']; }
    return top ? [`Review due: one clean take at ${bpm} BPM passes it. A take that needs more room moves you one step slower.`, '']
      : [`Review due: work back up to ${at(unit, p, topOf(unit))} BPM, then one clean take there passes it.`, ''];
  }
  if (top && p.certified.some(c => Math.abs(c - fraction) < 1e-9)) {
    if (p.days.includes(dayOf(now))) return ['Certified today. Come back on another day to call it learned.', ''];
    const n = 3 - p.support;
    return [`Certified before. ${n === 1 ? 'One clean take' : `${n === 2 ? 'Two' : 'Three'} clean takes`} today make${n === 1 ? 's' : ''} it learned.`, ''];
  }
  if (certifies(unit, fraction)) {
    if (p.support === 0) return [`Three clean takes certify ${bpm} BPM, each with less help. This one: notes shown (1 of 3).`, ''];
    if (p.support === 1) return [`Take 2 of 3 at ${bpm} BPM, notes hidden. A clean take unlocks the last one: a click on each bar only.`, ''];
    return [`Last of 3 at ${bpm} BPM: notes hidden, a click on each bar only. ${top ? `A clean take certifies ${topName(unit, p)}.` : `A clean take certifies it and moves you ${upTo(unit, p, true)}.`}`, ''];
  }
  if (top) return [`Top step: ${bpm} BPM. Clean takes keep it steady.`, CLEAN_RULE];
  return [p.clean >= 1 ? `One more clean take moves you ${upTo(unit, p)}.` : `Two clean takes move you ${upTo(unit, p)}.`, CLEAN_RULE];
}

/** The answered take, as the ladder will see it. */
export interface TakeFacts { bpm: number; place?: number; result: { trusted: boolean; score: number; reason: string }; calibrated: boolean }
export interface Outcome { route: TakeRoute; event?: AdvanceEvent; after: UnitProgress; line: string; chip: string }

/**
 * What one answer would do, by running the real rules on a copy: the card's consequence line under the answer button and
 * the LAST TAKE chip once it is given. advanceUnit and placeUnit copy the progress they are given, so nothing is changed.
 */
export function outcome(unit: Unit, before: UnitProgress, take: TakeFacts, comfortable: boolean, now: number): Outcome {
  const route = routeTake(unit, before, take), { result } = take, pct = `${floorPct(result.score)}%`;
  const uncounted = (why: string): Outcome => ({ route, after: before, line: `Not counted: ${why}. Your tempo step stays as it is.`, chip: `Not counted · ${why}` });
  if (route === 'place') {
    const r = placeUnit(unit, before, take.place!, result, comfortable, now, take.calibrated), bpm = at(unit, before, Math.min(take.place!, topOf(unit)));
    if (r.placed) return { route, event: r.event, after: r.progress, line: `Places you at ${bpm} BPM.`, chip: `Placed at ${bpm} BPM` };
    const under = comfortable && result.trusted && take.calibrated && result.score < CLEAN;
    return { route, event: r.event, after: before, line: under ? `Not placed: ${pct} is under 80%. Nothing is recorded.` : 'Not placed. Nothing is recorded.', chip: 'Not placed · nothing recorded' };
  }
  if (route === 'free') return uncounted('free tempo');
  if (!result.trusted) return uncounted(clause(result.reason));
  if (!take.calibrated) return uncounted('timing is not calibrated');
  const change = advanceUnit(unit, before, result, comfortable, now, take.calibrated), { event, progress: after } = change;
  const r = rungOf(unit, before), bpm = at(unit, before, r);
  const under = result.score < 0.65 ? 'Under 65%, so this counts as needing more room. ' : '';
  const out = (line: string, chip: string): Outcome => ({ route, event, after, line, chip });
  const slowest = `${bpm} BPM is the slowest step, so it stays.`;
  switch (event.kind) {
    case 'review': return out('Passes the review.', `${pct} · Review passed`);
    case 'learned': return out('Clean. Certified on a second day: learned.', `${pct} · Learned`);
    case 'certified': {
      const moved = after.rung > before.rung ? ` and moves you ${upTo(unit, before)}` : '';
      return out(`Clean. Certifies ${bpm} BPM${moved}.`, `${pct} · ${event.overnight ? 'Clean: it stuck overnight' : `Certified at ${bpm} BPM`}`);
    }
    case 'climb': { const up = upTo(unit, before), chip = upTo(unit, before, true); return out(`Clean take 2 of 2. Moves you ${up}.`, `${pct} · ${event.overnight ? 'Clean: it stuck overnight' : chip[0].toUpperCase() + chip.slice(1)}`); }
    case 'fade': {
      const next = after.support === 1 ? 'notes hidden' : 'a click on each bar only';
      return out(`Clean. Next take: ${next}.`, `${pct} · ${event.overnight ? 'Clean: it stuck overnight' : `Clean: next take ${after.support === 1 ? 'hides the notes' : 'has a click on each bar only'}`}`);
    }
    case 'step-down': {
      const review = before.learned && before.due <= now, down = at(unit, after, rungOf(unit, after)), stayed = rungOf(unit, after) === rungOf(unit, before);
      const what = stayed ? (r === 0 ? slowest.replace(/\.$/, '') : `stays at ${bpm} BPM`) : down === bpm ? `one step slower (still ${bpm} BPM, the slowest allowed)` : `one step slower: ${down} BPM`;
      const line = what[0].toUpperCase() + what.slice(1);
      if (review) return out(`${under}${line}.${stayed ? '' : ' It comes back quickly.'}`, `Needs more room · ${what}${stayed ? '' : '. It comes back quickly.'}`);
      return out(`${under}${line}.`, `Needs more room twice in a row · ${what}`);
    }
    default: break;
  }
  if (event.clean) {
    const top = before.rung >= topOf(unit);
    if (top) return out(`Clean at ${bpm} BPM, the top step.`, `${pct} · ${event.overnight ? 'Clean: it stuck overnight' : `Clean at ${bpm} BPM`}`);
    return out(`Clean take 1 of 2. One more moves you ${upTo(unit, before)}.`, `${pct} · ${event.overnight ? 'Clean: it stuck overnight' : 'Clean, 1 of 2'}`);
  }
  if (after.hard === 0) return out(`Kept at ${bpm} BPM: ${pct} is under the 80% a clean take needs.`, `${pct} · Kept at ${bpm} BPM: under 80%`);
  const lower = rungOf(unit, { ...before, rung: Math.max(0, before.rung - 1) });
  const stays = r === 0 ? `Stays at ${bpm} BPM, the slowest step.` : lower === r ? `Stays at ${bpm} BPM.` : at(unit, before, lower) === bpm ? `Stays at ${bpm} BPM, the slowest allowed.` : `Stays at ${bpm} BPM. A second one in a row makes room: one step slower.`;
  return out(`${under}${stays}`, `${pct} · Needs more room: stays at ${bpm} BPM`);
}

/** The card's two consequence lines, one per answer. */
export function answerLines(unit: Unit, before: UnitProgress, take: TakeFacts, now: number): { comfortable: string; struggling: string } {
  return { comfortable: outcome(unit, before, take, true, now).line, struggling: outcome(unit, before, take, false, now).line };
}
