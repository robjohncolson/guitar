import { describe, expect, it } from 'vitest';
import gymnopedie from '../src/piece/packs/gymnopedie-1.piece.txt?raw';
import { compile } from '../src/piece/notation';
import { buildCurriculum } from '../src/piece/curriculum';
import { arrange, guitarUnits } from '../src/piece/guitar';
import {
  advanceUnit,
  DAY,
  dayOf,
  initialUnit,
  logDay,
  placeHands,
  placeUnit,
  suggestToday,
  type UnitProgress,
} from '../src/piece/progress';
import {
  finishView,
  nextDay,
  pieceCourses,
  titleIn,
  Visit,
  visitHtml,
  visitSummary,
  type VisitFacts,
} from '../src/piece/summary';

const score = compile(gymnopedie).score!;
const piano = buildCurriculum(score),
  guitar = guitarUnits(score, arrange(score));
const unit = (id: string) => [...piano.units, ...guitar].find((u) => u.id === id)!;
// 18:00 local time on a day in November.
const now = new Date(2026, 10, 23, 18).getTime();
/** Progress keys as the page makes them: piece "p", course tag, step id. */
const key = (id: string) => (id.startsWith('g-') ? `p#guitar|${id}` : `p|${id}`);
const piece = pieceCourses('p', '', piano.units, [], guitar);
const plan = (units: Record<string, UnitProgress>) => (time: number) =>
  suggestToday(piano, (id) => units[key(id)], time);

/** A visit as the page runs it: progress as saved at page load, then answers through the ladder's own rules. */
function visitOf(saved: Record<string, UnitProgress>) {
  const units: Record<string, UnitProgress> = structuredClone(saved),
    visit = new Visit(units);
  let t = now - 3 * 3600000;
  const take = (id: string, score: number, calibrated = true, comfortable = true) => {
    const k = key(id),
      change = advanceUnit(
        unit(id),
        units[k] ?? initialUnit(),
        { trusted: score >= 0, score },
        comfortable,
        t,
        calibrated,
      );
    units[k] = change.progress;
    visit.answered(change.event, k, units);
    t += 60000;
  };
  /** A placement take at tempo step `at`, as the page's placeTake does it (with the one-hand steps it raises). */
  const place = (id: string, at: number) => {
    const u = unit(id),
      k = key(id),
      r = placeUnit(u, units[k] ?? initialUnit(), at, { trusted: true, score: 0.9 }, true, t, true);
    if (r.placed) {
      units[k] = r.progress;
      for (const [other, p] of placeHands(piano.units, u, u.rungs[at], (x) => units[key(x)])) units[key(other)] = p;
    }
    visit.answered(r.event, k, units);
    t += 60000;
  };
  /** "Reset progress for this piece", as the page's reset does it: the piece's keys in all three courses go. */
  const reset = () => {
    for (const k of Object.keys(units))
      if (k.startsWith('p|') || k.startsWith('p#guitar|') || k.startsWith('p#guitar-piece|')) delete units[k];
    visit.forget('p');
  };
  /** One take on another piece ("q"), through the same ladder. */
  const takeElsewhere = (id: string, score: number) => {
    const k = `q|${id}`,
      change = advanceUnit(unit(id), units[k] ?? initialUnit(), { trusted: true, score }, true, t, true);
    units[k] = change.progress;
    visit.answered(change.event, k, units);
    t += 60000;
  };
  return { units, visit, take, place, reset, takeElsewhere };
}
const facts = (units: Record<string, UnitProgress>, visit: Visit, over: Partial<VisitFacts> = {}): VisitFacts => ({
  piece,
  visit,
  units,
  title: (pack) => ({ q: 'Second Piece' })[pack],
  clean: 3,
  aim: 6,
  tomorrow: suggestToday(piano, (id) => units[key(id)], nextDay(now)),
  now,
  ...over,
});
const card = (units: Record<string, UnitProgress>, visit: Visit, over: Partial<VisitFacts> = {}) =>
  visitHtml(visitSummary(facts(units, visit, over))!)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
const movedOf = (units: Record<string, UnitProgress>, visit: Visit) => visitSummary(facts(units, visit))!.moved;

it('shows nothing but the sentence when no take was counted in this visit', () => {
  const v = visitOf({});
  // Unclear (untrusted) and uncalibrated takes are not counted, and a free-tempo take has no ladder event at all.
  v.take('R:5-8', -1);
  v.take('R:5-8', 0.95, false);
  v.visit.answered(undefined, key('R:5-8'), v.units);
  expect(v.visit.counted).toBe(0);
  expect(visitSummary(facts(v.units, v.visit))).toBeUndefined();
  const progress = { units: v.units, dailyGoal: 6, log: logDay([], now, { takes: 2 }) };
  const shown = finishView({
    progress,
    visit: v.visit,
    piece,
    title: () => undefined,
    notes: [],
    plan: plan(v.units),
    now,
  });
  const next = plan(v.units)(now).find((p) => p.slot !== 'warm' && p.slot !== 'listen')!.unit.title;
  expect(shown).toEqual({
    text: `Today: 0 clean takes of 2. Steady, deliberate practice counts even when nothing moved up today. Next time: ${next}.`,
  });
});

it("keys the piece's three courses as the page does, and Finish shows the card after a counted take", () => {
  const list = pieceCourses('p', '#guitar', piano.units, [], guitar);
  expect(list.pack).toBe('p');
  expect(list.courses.map((c) => [c.name, c.key('x'), c.current])).toEqual([
    ['piano', 'p|x', false],
    ['guitar', 'p#guitar-piece|x', false],
    ['accompaniment', 'p#guitar|x', true],
  ]);
  const v = visitOf({});
  v.take('R:5-8', 0.9);
  const progress = { units: v.units, dailyGoal: 6, log: logDay([], now, { takes: 1, clean: 1 }) };
  const shown = finishView({
    progress,
    visit: v.visit,
    piece,
    title: () => undefined,
    notes: [],
    plan: plan(v.units),
    now,
  });
  expect('html' in shown && shown.html).toContain('Bars 5–8 · right hand');
  expect('html' in shown && shown.html).toContain('Clean takes today: <strong>1 of 6</strong>');
  expect(titleIn([{ id: 'gymnopedie-1', text: gymnopedie }], 'gymnopedie-1')).toBe('Gymnopédie No. 1');
  expect(titleIn([], 'gone')).toBeUndefined();
});

it('names the stars gained in this visit, with the step, from saved progress compared with the page load', () => {
  const v = visitOf({ [key('R:5-8')]: { ...initialUnit(), attempts: 2, best: 0.5, last: now - DAY } });
  v.take('R:5-8', 0.9);
  v.take('L:1-4', 0.9);
  v.take('L:1-4', 0.5);
  const s = visitSummary(facts(v.units, v.visit))!;
  // R:5-8 had its first star before this visit: nothing new. L:1-4 earned its first star now.
  expect(s.stars.map((x) => [x.title, x.news, x.stars.stars])).toEqual([['Bars 1–4 · left hand', 'first star', 1]]);
  // A clean first take of the day on a step practised yesterday stuck overnight.
  expect(s.moved).toEqual([{ title: 'Bars 5–8 · right hand', what: ['stuck overnight'] }]);
});

it('says what moved: climbs, learned, and the course when it is not the current one', () => {
  const v = visitOf({
    [key('L:1-4')]: {
      ...initialUnit(),
      rung: 3,
      best: 0.8,
      certified: [0.8],
      attempts: 9,
      last: now - DAY,
      days: [dayOf(now - DAY)],
    },
  });
  for (let i = 0; i < 3; i++) v.take('L:1-4', 0.9);
  v.take('R:5-8', 0.9);
  v.take('R:5-8', 0.9);
  v.take('g-pattern:muted', 0.9);
  const s = visitSummary(facts(v.units, v.visit))!;
  expect(s.moved).toEqual([
    { title: 'Bars 1–4 · left hand', what: ['learned', 'stuck overnight'] },
    { title: 'Bars 5–8 · right hand', what: ['up to 60% of the goal tempo'] },
  ]);
  // Bars 1–4 left hand already had its three stars (certified at its top step, 80%): learning it adds the seal only.
  expect(s.stars.map((x) => [x.title, x.course, x.news])).toEqual([
    ['Bars 5–8 · right hand', undefined, 'first star'],
    ['Picking pattern on muted strings', 'accompaniment', 'first star'],
  ]);
  expect(JSON.stringify(s)).not.toMatch(/minute|day in a row|streak/i);
});

describe('stars and resets', () => {
  it('a first star on another piece is named, and the card does not say nothing ended higher', () => {
    // One clean take on another piece's fresh D major scale (its first star: best 0 to 0.5, same tempo step), then this
    // piece is opened and Finish pressed.
    const v = visitOf({});
    v.takeElsewhere('drill:2:major:scale:R:1', 0.95);
    expect(v.units['q|drill:2:major:scale:R:1']).toMatchObject({ rung: 0, best: 0.5 });
    const text = card(v.units, v.visit);
    expect(text).toContain('Also in this visit: 1 step made progress in Second Piece.');
    expect(text).not.toContain('No step ended');
  });

  it('a better best at the same tempo step in this piece adds no line, and no sentence either', () => {
    // On its 70% step with one star, earlier today: one more clean take there raises best to 0.7, no new star, no climb.
    const v = visitOf({
      [key('R:5-8')]: { ...initialUnit(), rung: 2, best: 0.6, attempts: 6, last: now - 4 * 3600000 },
    });
    v.take('R:5-8', 0.9);
    expect(v.units[key('R:5-8')]).toMatchObject({ rung: 2, best: 0.7 });
    const s = visitSummary(facts(v.units, v.visit))!;
    expect([s.stars, s.moved, s.others, s.level]).toEqual([[], [], [], false]);
    expect(card(v.units, v.visit)).not.toMatch(/No step|Also in this visit|What moved|Stars this visit/);
  });

  it('after a reset, a placement is told as it happened after it, with no trace of the erased one', () => {
    const v = visitOf({});
    v.place('LR:5-8', 3);
    expect(v.units[key('R:5-8')].rung).toBe(3);
    v.reset();
    v.place('LR:5-8', 2);
    const s = visitSummary(facts(v.units, v.visit))!;
    expect(s.moved).toEqual([
      { title: 'Bars 5–8 · hands together', what: ['placed at 70%'] },
      { title: 'Bars 1–4 · left hand', what: ['placed at 70% with Bars 5–8 · hands together'] },
      { title: 'Bars 5–8 · right hand', what: ['placed at 70% with Bars 5–8 · hands together'] },
    ]);
    expect(card(v.units, v.visit)).not.toContain('80%');
  });

  it('a step with stars at page load, reset, then one clean take: its first star is named', () => {
    const v = visitOf({
      [key('R:5-8')]: { ...initialUnit(), rung: 2, best: 0.7, certified: [], attempts: 8, last: now - DAY },
    });
    v.reset();
    v.take('R:5-8', 0.9);
    const s = visitSummary(facts(v.units, v.visit))!;
    expect(s.stars.map((x) => [x.title, x.news])).toEqual([['Bars 5–8 · right hand', 'first star']]);
    expect(card(v.units, v.visit)).not.toContain('No step ended');
  });

  it('a reset with nothing played after it lists nothing for the piece, and the sentence is true', () => {
    const v = visitOf({ [key('R:5-8')]: { ...initialUnit(), rung: 2, best: 0.7, attempts: 8, last: now - DAY } });
    v.take('R:5-8', 0.9);
    v.take('R:5-8', 0.9);
    expect(v.units[key('R:5-8')].rung).toBe(3);
    v.reset();
    const s = visitSummary(facts(v.units, v.visit))!;
    expect([s.stars, s.moved, s.others, s.level]).toEqual([[], [], [], true]);
    expect(card(v.units, v.visit)).toContain('No step ended this visit higher than it started.');
  });

  it("resetting the open piece leaves another piece's progress in this visit alone", () => {
    const v = visitOf({});
    v.takeElsewhere('drill:2:major:scale:R:1', 0.95);
    v.take('R:5-8', 0.9);
    v.reset();
    const text = card(v.units, v.visit);
    expect(text).toContain('Also in this visit: 1 step made progress in Second Piece.');
    expect(text).not.toContain('Bars 5–8');
  });
});

describe('true for the whole visit', () => {
  it('names the other pieces whose steps made progress, and says no step ended higher only when none did', () => {
    // Two clean takes on another piece ("q"), then the learner opened this one ("p") and pressed Finish.
    const v = visitOf({
      'q|R:1-8': { ...initialUnit(), rung: 1, attempts: 4, last: now - DAY },
      'q#guitar-piece|gp-R:1-8': { ...initialUnit(), rung: 0, attempts: 1, last: now - DAY },
      'gone|L:1-4': { ...initialUnit(), rung: 0, attempts: 1, last: now - DAY },
    });
    v.units['q|R:1-8'] = { ...v.units['q|R:1-8'], rung: 2, best: 0.6 };
    v.units['q#guitar-piece|gp-R:1-8'] = { ...v.units['q#guitar-piece|gp-R:1-8'], certified: [0.5] };
    v.units['gone|L:1-4'] = { ...v.units['gone|L:1-4'], rung: 1 };
    v.visit.counted = 3;
    const text = card(v.units, v.visit);
    expect(text).toContain('Also in this visit: 1 step made progress in another piece.');
    expect(text).toContain('Also in this visit: 2 steps made progress in Second Piece.');
    expect(text).not.toContain('No step ended');
    // Progress in another piece that did not move up (a take that only counted) names nothing.
    const w = visitOf({ 'q|R:1-8': { ...initialUnit(), rung: 2, attempts: 4 } });
    w.units['q|R:1-8'] = { ...w.units['q|R:1-8'], attempts: 6, clean: 1 };
    w.visit.counted = 2;
    expect(card(w.units, w.visit)).toContain('No step ended this visit higher than it started.');
  });

  it('a step down is never told, and the card says only that no step ended higher', () => {
    const v = visitOf({ [key('R:5-8')]: { ...initialUnit(), rung: 3, best: 0.7, attempts: 6, last: now - 3600000 } });
    v.take('R:5-8', 0, true, false);
    v.take('R:5-8', 0, true, false);
    expect(v.units[key('R:5-8')].rung).toBe(2);
    const text = card(v.units, v.visit);
    expect(text).toContain('No step ended this visit higher than it started.');
    expect(text).not.toMatch(/down|slower|back|moved up/i);
  });

  it('a step that went up and came back down in the same visit ends where it started, and the card says so', () => {
    // Bars 5–8 right hand starts the visit on its 70% step (earlier today). Two clean takes climb it to 80% (the page
    // says "Two clean takes. Next: 80% of the goal tempo."); two takes that need more room step it back to 70%.
    const v = visitOf({
      [key('R:5-8')]: { ...initialUnit(), rung: 2, best: 0.7, attempts: 6, last: now - 4 * 3600000 },
    });
    const trail: string[] = [];
    for (const score of [0.9, 0.9, 0.5, 0.5]) {
      const before = v.units[key('R:5-8')].rung;
      v.take('R:5-8', score);
      const after = v.units[key('R:5-8')].rung;
      trail.push(`${after > before ? 'up' : after < before ? 'down' : 'same'}@${after}`);
    }
    expect(trail).toEqual(['same@2', 'up@3', 'same@3', 'down@2']);
    const text = card(v.units, v.visit);
    expect(text).toContain('No step ended this visit higher than it started.');
    expect(text).not.toMatch(/down|slower|back/i);
  });

  it('says nothing of where things stand when a step ended higher without being listed', () => {
    // A saved step of the open piece that no listed course holds (an older step id) ended higher: nothing above names
    // it, so the card has no sentence at all rather than a false one.
    const v = visitOf({ 'p|old-step': { ...initialUnit(), rung: 1, attempts: 3, last: now - DAY } });
    v.units['p|old-step'] = { ...v.units['p|old-step'], rung: 2 };
    v.visit.counted = 1;
    const s = visitSummary(facts(v.units, v.visit))!;
    expect([s.stars, s.moved, s.others, s.level]).toEqual([[], [], [], false]);
    expect(card(v.units, v.visit)).not.toMatch(/No step/);
  });

  it('a placement is told where it placed the step, then how far it climbed after', () => {
    // Placement alone.
    let v = visitOf({});
    v.place('LR:5-8', 2);
    expect(movedOf(v.units, v.visit)[0]).toEqual({ title: 'Bars 5–8 · hands together', what: ['placed at 70%'] });
    // Placement, then a clean take: two clean takes at 70% climb to 80%.
    v = visitOf({});
    v.place('LR:5-8', 2);
    v.take('LR:5-8', 0.9);
    expect(v.units[key('LR:5-8')].rung).toBe(3);
    expect(movedOf(v.units, v.visit)[0].what).toEqual(['placed at 70%', 'then up to 80% of the goal tempo']);
    // Placement at 80%, then the fading takes certify it there and it climbs to 88%.
    v = visitOf({});
    v.place('LR:5-8', 3);
    v.take('LR:5-8', 0.9);
    v.take('LR:5-8', 0.9);
    expect(v.units[key('LR:5-8')].certified).toEqual([0.8]);
    expect(movedOf(v.units, v.visit)[0].what).toEqual([
      'placed at 80%',
      'certified at 80%',
      'then up to 88% of the goal tempo',
    ]);
  });

  it('steps a placement raised are named with the step that was placed, right after it', () => {
    const v = visitOf({});
    v.place('LR:5-8', 2);
    // The hands-together placement also raised the one-hand steps for the same bars (the left hand through the
    // earlier passage it shares its notes with).
    expect(movedOf(v.units, v.visit)).toEqual([
      { title: 'Bars 5–8 · hands together', what: ['placed at 70%'] },
      { title: 'Bars 1–4 · left hand', what: ['placed at 70% with Bars 5–8 · hands together'] },
      { title: 'Bars 5–8 · right hand', what: ['placed at 70% with Bars 5–8 · hands together'] },
    ]);
    // Their stars are saved progress and stay under Stars this visit.
    expect(visitSummary(facts(v.units, v.visit))!.stars.map((s) => s.title)).toContain('Bars 1–4 · left hand');
    // A raised step that then climbs on its own says both.
    v.take('R:5-8', 0.9);
    v.take('R:5-8', 0.9);
    expect(movedOf(v.units, v.visit)[2].what).toEqual([
      'placed at 70% with Bars 5–8 · hands together',
      'then up to 80% of the goal tempo',
    ]);
  });

  it('tomorrow is read at the start of tomorrow, so what it names is in the plan all day', () => {
    const learned = (due: number): UnitProgress => ({
      ...initialUnit(),
      rung: 6,
      best: 1,
      certified: [0.8, 1],
      attempts: 20,
      learned: true,
      interval: 1,
      due,
      last: now - DAY,
      days: ['2026-11-21', '2026-11-22'],
    });
    const next = (saved: Record<string, UnitProgress>) => {
      const v = visitOf(saved);
      v.take('R:5-8', 0.9);
      const progress = { units: v.units, dailyGoal: 6, log: logDay([], now, { takes: 1, clean: 1 }) };
      const shown = finishView({
        progress,
        visit: v.visit,
        piece,
        title: () => undefined,
        notes: [],
        plan: plan(v.units),
        now,
      });
      return 'html' in shown ? shown.html.replace(/&#39;/g, "'") : '';
    };
    // Due tomorrow evening (learned at 19:00 today, due a day later): tomorrow morning's plan does not have it yet.
    const evening = next({ [key('chord:Gmaj7')]: learned(now + DAY + 3600000) });
    expect(evening).not.toContain('Gmaj7 chord comes back for review');
    expect(evening).toContain("Tomorrow's plan: Dmaj7 chord is the next chord the music needs.");
    // Due before tomorrow starts: it is in tomorrow's plan from the first minute.
    expect(next({ [key('chord:Gmaj7')]: learned(now + 5 * 3600000) })).toContain(
      "Tomorrow's plan: Gmaj7 chord comes back for review.",
    );
    // Certified at its top step today and not yet learned: tomorrow is its second day.
    const today: UnitProgress = {
      ...initialUnit(),
      rung: 3,
      best: 0.8,
      certified: [0.8],
      attempts: 9,
      last: now - 60000,
      days: [dayOf(now)],
    };
    expect(next({ [key('L:1-4')]: today })).toContain(
      "Tomorrow's plan: Bars 1–4 · left hand comes back for its second day.",
    );
    expect(nextDay(now)).toBe(new Date(2026, 10, 24).getTime());
  });

  it('with no clean take the ring has no fill at all', () => {
    const v = visitOf({});
    v.take('R:5-8', 0.5);
    const html = visitHtml(visitSummary(facts(v.units, v.visit, { clean: 0 }))!);
    expect(html).toContain('class="track"');
    expect(html).not.toContain('class="fill"');
    expect(visitHtml(visitSummary(facts(v.units, v.visit, { clean: 3 }))!)).toContain('stroke-dasharray="50 100"');
    expect(visitHtml(visitSummary(facts(v.units, v.visit, { clean: 7 }))!)).toContain('aim reached');
  });
});

it('never warns of loss, and keeps its copy of the page load apart from later changes', () => {
  const v = visitOf({});
  v.take('R:5-8', 0.9);
  expect(visitHtml(visitSummary(facts(v.units, v.visit))!)).not.toMatch(/lose|lost|miss|break|streak|hurry|don't/i);
  const saved: Record<string, UnitProgress> = { a: { ...initialUnit(), certified: [0.8], days: ['2026-11-22'] } };
  const visit = new Visit(saved);
  saved.a.certified.push(1);
  saved.a.days.push('2026-11-23');
  saved.a.rung = 4;
  expect(visit.before.get('a')).toMatchObject({ certified: [0.8], days: ['2026-11-22'], rung: 0 });
});
