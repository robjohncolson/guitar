import { expect, it } from 'vitest';
import {
  ladderHtml as drawLadder,
  metricsHtml as drawMetrics,
  scoreHtml as drawScore,
  starsHtml as drawStars,
  type LadderRung,
  type LadderView,
  type MetricsView,
  type ScoreView,
} from '../src/piece/hud';
import type { StepStars } from '../src/piece/game';

// Every markup string the tests below make is kept, so the last test can check the words of all of them.
const made: string[] = [];
const ladderHtml = (v: LadderView) => {
  const html = drawLadder(v);
  made.push(html);
  return html;
};
const scoreHtml = (v: ScoreView) => {
  const html = drawScore(v);
  made.push(html);
  return html;
};
const metricsHtml = (v: MetricsView) => {
  const html = drawMetrics(v);
  made.push(html);
  return html;
};
const starsHtml = (v: StepStars) => {
  const html = drawStars(v);
  made.push(html);
  return html;
};

const BPM = [33, 40, 46, 53, 60, 66, 70],
  PCT = [50, 60, 70, 80, 88, 94, 100];
const rungs = (certify: number[] = [], certified: number[] = []): LadderRung[] =>
  BPM.map((bpm, i) => ({ bpm, pct: PCT[i], certify: certify.includes(i), certified: certified.includes(i) }));
const view = (o: Partial<LadderView> = {}): LadderView => ({ rungs: rungs(), at: 2, pick: false, target: 6, ...o });
const GEM = '<span class="gem" aria-hidden="true">◆</span>';
const times = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

it('wraps the segments in a labelled group', () => {
  const html = ladderHtml(view());
  expect(html.startsWith('<div class="ladder" role="group" aria-label="Tempo step 3 of 7">')).toBe(true);
  expect(ladderHtml(view({ at: 0 }))).toContain('aria-label="Tempo step 1 of 7"');
  expect(ladderHtml(view({ at: 6 }))).toContain('aria-label="Tempo step 7 of 7"');
  expect(ladderHtml(view({ rungs: rungs().slice(0, 4), at: 1 }))).toContain('aria-label="Tempo step 2 of 4"');
});

it('marks passed, current and ahead segments', () => {
  const html = ladderHtml(view({ at: 2 }));
  expect(html).toBe(
    '<div class="ladder" role="group" aria-label="Tempo step 3 of 7">' +
      '<span class="rung passed">33</span><span class="rung passed">40</span><span class="rung now" aria-current="step">46</span>' +
      '<span class="rung ahead">53</span><span class="rung ahead">60</span><span class="rung ahead">66</span><span class="rung ahead">70</span></div>',
  );
  expect(times(html, /aria-current/g)).toBe(1);
  expect(html).not.toContain('<button');
});

it('has no passed segments on the first rung and no ahead segments on the top one', () => {
  const first = ladderHtml(view({ at: 0 }));
  expect(first).not.toContain('passed');
  expect(first).toContain('<span class="rung now" aria-current="step">33</span>');
  expect(times(first, /rung ahead/g)).toBe(6);
  const top = ladderHtml(view({ at: 6, pick: true }));
  expect(top).not.toContain('ahead');
  expect(top).not.toContain('<button');
  expect(times(top, /rung passed/g)).toBe(6);
  expect(top).toContain('<span class="rung now" aria-current="step">70</span>');
});

it('makes every ahead segment a placement button while picking, and only those', () => {
  const html = ladderHtml(view({ at: 2, pick: true, target: 5 }));
  expect(times(html, /<button/g)).toBe(4);
  expect(html).toContain(
    '<button type="button" class="rung ahead rung-pick" data-rung="3" aria-pressed="false" aria-label="Place at 80%: 53 BPM">53</button>',
  );
  expect(html).toContain(
    '<button type="button" class="rung ahead rung-pick" data-rung="4" aria-pressed="false" aria-label="Place at 88%: 60 BPM">60</button>',
  );
  expect(html).toContain(
    '<button type="button" class="rung ahead rung-pick on" data-rung="5" aria-pressed="true" aria-label="Place at 94%: 66 BPM">66</button>',
  );
  expect(html).toContain(
    '<button type="button" class="rung ahead rung-pick" data-rung="6" aria-pressed="false" aria-label="Place at 100%: 70 BPM">70</button>',
  );
  expect(html).toContain('<span class="rung passed">40</span>');
  expect(html).toContain('<span class="rung now" aria-current="step">46</span>');
});

it('chooses the target by index: one pressed button, or none when the target is not ahead', () => {
  const top = ladderHtml(view({ at: 2, pick: true, target: 6 }));
  expect(times(top, /aria-pressed="true"/g)).toBe(1);
  expect(top).toContain('data-rung="6" aria-pressed="true"');
  expect(times(top, /rung-pick on/g)).toBe(1);
  const behind = ladderHtml(view({ at: 2, pick: true, target: 1 }));
  expect(behind).not.toContain('aria-pressed="true"');
  expect(behind).not.toContain('rung-pick on');
});

it('turns the buttons into plain ahead segments when picking is off', () => {
  const html = ladderHtml(view({ at: 1, pick: false, target: 4 }));
  expect(html).not.toContain('<button');
  expect(html).not.toContain('rung-pick');
  expect(html).not.toContain('aria-pressed');
  expect(times(html, /<span class="rung ahead">/g)).toBe(5);
});

it('puts a gold gem inside certification rungs only', () => {
  const html = ladderHtml(view({ rungs: rungs([3, 6]), at: 1 }));
  expect(times(html, /class="gem"/g)).toBe(2);
  expect(html).toContain(`<span class="rung ahead certify">53${GEM}</span>`);
  expect(html).toContain(`<span class="rung ahead certify">70${GEM}</span>`);
  expect(html).toContain('<span class="rung ahead">60</span>');
  expect(html).not.toContain('certified');
  const current = ladderHtml(view({ rungs: rungs([2]), at: 2 }));
  expect(current).toContain(`<span class="rung now certify" aria-current="step">46${GEM}</span>`);
  const passed = ladderHtml(view({ rungs: rungs([0]), at: 3 }));
  expect(passed).toContain(`<span class="rung passed certify">33${GEM}</span>`);
});

it('adds certified to a certified rung', () => {
  const passed = ladderHtml(view({ rungs: rungs([1, 3], [1]), at: 3 }));
  expect(passed).toContain(`<span class="rung passed certify certified">40${GEM}</span>`);
  expect(passed).toContain(`<span class="rung now certify" aria-current="step">53${GEM}</span>`);
  expect(times(passed, /certified/g)).toBe(1);
  const current = ladderHtml(view({ rungs: rungs([2], [2]), at: 2, pop: 'climb' }));
  expect(current).toContain(`<span class="rung now slide certify certified" aria-current="step">46${GEM}</span>`);
  const pick = ladderHtml(view({ rungs: rungs([5, 6], [6]), at: 2, pick: true, target: 6 }));
  expect(pick).toContain(
    `<button type="button" class="rung ahead rung-pick on certify certified" data-rung="6" aria-pressed="true" aria-label="Place at 100%: 70 BPM">70${GEM}</button>`,
  );
  expect(pick).toContain(
    `<button type="button" class="rung ahead rung-pick certify" data-rung="5" aria-pressed="false" aria-label="Place at 94%: 66 BPM">66${GEM}</button>`,
  );
});

it('dims the ladder on request', () => {
  expect(ladderHtml(view({ dim: true }))).toContain('<div class="ladder dim" role="group"');
  expect(ladderHtml(view({ dim: false }))).toContain('<div class="ladder" role="group"');
  expect(ladderHtml(view())).not.toContain('dim');
});

it('slides the current segment on a climb and nothing else', () => {
  const climb = ladderHtml(view({ pop: 'climb', pips: { kind: 'plain', clean: 1 } }));
  expect(climb).toContain('<span class="rung now slide" aria-current="step">46</span>');
  expect(times(climb, /slide/g)).toBe(1);
  expect(climb).not.toContain('pop');
  for (const pop of ['pip', undefined] as const) expect(ladderHtml(view({ pop }))).not.toContain('slide');
});

it('has no pip row without pips', () => {
  expect(ladderHtml(view())).not.toContain('pip');
  expect(ladderHtml(view({ pips: undefined, pop: 'pip' }))).not.toContain('pip');
  expect(ladderHtml(view({ pips: undefined })).endsWith('</div>')).toBe(true);
});

it('shows the clean takes as two pips with a caption that carries the words', () => {
  const row = (filled: string[], caption: string) =>
    `<div class="pip-row"><span class="pip-group" aria-hidden="true">${filled.map((c) => `<span class="${c}"></span>`).join('')}</span><span class="pip-caption">${caption}</span></div>`;
  const after = (clean: number, o: Partial<LadderView> = {}) =>
    ladderHtml(view({ pips: { kind: 'plain', clean }, ...o })).split('</div>')[1] + '</div>';
  expect(after(0)).toBe(row(['pip', 'pip'], '0 of 2 clean takes'));
  expect(after(1)).toBe(row(['pip on', 'pip'], '1 of 2 clean takes'));
  expect(after(2)).toBe(row(['pip on', 'pip on'], '2 of 2 clean takes'));
  expect(after(3)).toBe(row(['pip on', 'pip on'], '2 of 2 clean takes'));
  expect(after(-1)).toBe(row(['pip', 'pip'], '0 of 2 clean takes'));
});

it('lists the pip row after the ladder, outside it', () => {
  const html = ladderHtml(view({ pips: { kind: 'plain', clean: 1 } }));
  expect(html.indexOf('<div class="pip-row">')).toBeGreaterThan(html.indexOf('</div>'));
  expect(times(html, /<div class="ladder/g)).toBe(1);
  expect(html.endsWith('</span></div>')).toBe(true);
});

it('pops the newest filled pip on a confirmed clean answer', () => {
  const pips = (clean: number, pop?: 'pip' | 'climb') => ladderHtml(view({ pips: { kind: 'plain', clean }, pop }));
  expect(pips(1, 'pip')).toContain('<span class="pip on pop"></span><span class="pip"></span>');
  expect(pips(2, 'pip')).toContain('<span class="pip on"></span><span class="pip on pop"></span>');
  expect(times(pips(2, 'pip'), /pop/g)).toBe(1);
  expect(pips(0, 'pip')).not.toContain('pop');
  expect(pips(2)).not.toContain('pop');
  expect(pips(2, 'climb')).not.toContain('pip on pop');
});

it('shows fading help on a certification rung as three labelled pips', () => {
  const cert = (support: number, pop?: 'pip' | 'climb') =>
    ladderHtml(view({ pips: { kind: 'cert', support }, pop })).split('</div>')[1] + '</div>';
  const item = (cls: string, name: string) => `<span class="pip-item"><span class="${cls}"></span>${name}</span>`;
  const row = (a: string, b: string, c: string, level: number) =>
    `<div class="pip-row"><span class="pip-group" aria-hidden="true">${item(a, 'Notes')}${item(b, 'Memory')}${item(c, 'Click')}</span><span class="pip-caption">Help level ${level} of 3</span></div>`;
  expect(cert(0)).toBe(row('pip', 'pip', 'pip', 1));
  expect(cert(1)).toBe(row('pip on', 'pip', 'pip', 2));
  expect(cert(2)).toBe(row('pip on', 'pip on', 'pip', 3));
  expect(cert(2, 'pip')).toBe(row('pip on', 'pip on pop', 'pip', 3));
  expect(cert(1, 'pip')).toBe(row('pip on pop', 'pip', 'pip', 2));
  expect(cert(0, 'pip')).toBe(row('pip', 'pip', 'pip', 1));
  expect(cert(2, 'climb')).toBe(row('pip on', 'pip on', 'pip', 3));
});

const take = (o: Partial<ScoreView> = {}): ScoreView => ({
  trusted: true,
  reason: '',
  score: 0.92,
  timing: 0.94,
  pitch: 0.92,
  keys: false,
  estimate: false,
  ...o,
});
const BAR_TICKS =
  '<span class="score-tick" style="left:65%"></span><span class="score-tick clean" style="left:80%"></span></div>' +
  '<div class="score-ticks" aria-hidden="true"><span style="left:65%">65%</span><span style="left:80%">80%</span></div><p class="score-rule">80% counts as clean</p>';

const STAR = (on: boolean) => `<span class="star${on ? ' on' : ''}" aria-hidden="true"></span>`;
const STARS = (n: number, label = `${n} of 3 stars`, cls = '') =>
  `<span class="stars take-stars${cls}" role="img" aria-label="${label}">${[0, 1, 2].map((i) => STAR(i < n)).join('')}</span>`;

it('shows a scored take as stars first, the percentage beside them, the lower of two, and a bar', () => {
  expect(scoreHtml(take())).toBe(
    `<div class="score-head scored"><div class="score-top">${STARS(2)}<strong class="score-num">92%</strong></div><div class="score-meta">` +
      '<p class="score-label">Score: the lower of the two</p><p class="score-split">94% on time · <strong class="lower">92% notes heard</strong></p></div></div>' +
      '<div class="score-bar" role="img" aria-label="92%, with marks at 65% and 80%. 80% counts as clean."><span class="score-fill" style="width:92%"></span>' +
      BAR_TICKS,
  );
});

it('marks the lower of the two, timing when they are equal', () => {
  const timing = scoreHtml(take({ score: 0.88, timing: 0.88, pitch: 0.93 }));
  expect(timing).toContain('<p class="score-split"><strong class="lower">88% on time</strong> · 93% notes heard</p>');
  const pitch = scoreHtml(take({ score: 0.81, timing: 0.95, pitch: 0.81 }));
  expect(pitch).toContain('<p class="score-split">95% on time · <strong class="lower">81% notes heard</strong></p>');
  const equal = scoreHtml(take({ score: 0.9, timing: 0.9, pitch: 0.9 }));
  expect(equal).toContain('<p class="score-split"><strong class="lower">90% on time</strong> · 90% notes heard</p>');
  for (const html of [timing, pitch, equal]) expect(times(html, /class="lower"/g)).toBe(1);
});

it('says right keys instead of notes heard for keys takes', () => {
  const html = scoreHtml(take({ keys: true }));
  expect(html).toContain('94% on time · <strong class="lower">92% right keys</strong>');
  expect(html).not.toContain('notes heard');
  expect(scoreHtml(take({ keys: false }))).not.toContain('right keys');
});

it('scores timing alone when the notes were not checked', () => {
  const html = scoreHtml(take({ score: 0.87, timing: 0.87, pitch: null }));
  expect(html).toContain('<strong class="score-num">87%</strong>');
  expect(html).toContain('<p class="score-label">Score: on time. Notes were not checked.</p>');
  expect(html).not.toContain('lower');
  expect(html).not.toContain('score-split');
  expect(html).not.toContain('notes heard');
  expect(html).toContain('<div class="score-bar"');
  expect(html.endsWith('<p class="score-rule">80% counts as clean</p>')).toBe(true);
});

it('gives stars at 65%, 80% and 95% as the card prints them (rounded down)', () => {
  const stars = (score: number) =>
    scoreHtml(take({ score, timing: score, pitch: null })).match(/aria-label="(\d) of 3 stars/)![1];
  expect([0, 0.3, 0.6499, 0.65, 0.7999, 0.8, 0.9499, 0.95, 1].map(stars)).toEqual([
    '0',
    '0',
    '0',
    '1',
    '1',
    '2',
    '2',
    '3',
    '3',
  ]);
  // A take shown as 79% never has two stars, and one shown as 94% never has three.
  const shown79 = scoreHtml(take({ score: 0.7999, timing: 0.7999, pitch: null }));
  expect(shown79).toContain(`${STARS(1)}<strong class="score-num">79%</strong>`);
  const shown94 = scoreHtml(take({ score: 0.9499, timing: 0.9499, pitch: null }));
  expect(shown94).toContain(`${STARS(2)}<strong class="score-num">94%</strong>`);
});

it('shows a low take as empty stars and its plain percentage', () => {
  const html = scoreHtml(take({ score: 0.31, timing: 0.31, pitch: null }));
  expect(html).toContain(`${STARS(0)}<strong class="score-num">31%</strong>`);
});

it('labels the stars of an uncalibrated take as an estimate', () => {
  expect(scoreHtml(take({ estimate: true }))).toContain(STARS(2, '2 of 3 stars, estimate', ' estimate'));
});

it('adds the longest run for a keys take from 5 up, and never for a microphone take', () => {
  expect(scoreHtml(take({ keys: true, run: 12 }))).toContain('<p class="score-run">Longest run: 12</p>');
  expect(scoreHtml(take({ keys: true, run: 5 }))).toContain('<p class="score-run">Longest run: 5</p>');
  expect(scoreHtml(take({ keys: true, run: 4 }))).not.toContain('score-run');
  expect(scoreHtml(take({ keys: false, run: 12 }))).not.toContain('score-run');
  expect(scoreHtml(take({ keys: true, trusted: false, run: 12 }))).not.toContain('Longest run');
});

it('does not score a take that could not be judged', () => {
  const html = scoreHtml(
    take({ trusted: false, reason: 'The microphone recording had gaps. This take could not be judged.', score: 0.7 }),
  );
  expect(html).toBe(
    '<div class="score-head"><strong class="score-num">Not scored</strong><p class="score-why">The microphone recording had gaps. This take could not be judged.</p></div>',
  );
  for (const part of ['score-bar', 'score-tick', 'score-rule', '70%', 'lower of the two', 'star', '%'])
    expect(html).not.toContain(part);
  expect(scoreHtml(take({ trusted: false, reason: 'Gaps.', estimate: true }))).not.toContain('estimate');
});

it('escapes the reason', () => {
  const html = scoreHtml(take({ trusted: false, reason: `Tom & "Jerry" <b>loud</b> it's` }));
  expect(html).toContain('<p class="score-why">Tom &#38; &#34;Jerry&#34; &#60;b&#62;loud&#60;/b&#62; it&#39;s</p>');
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('"Jerry"');
});

it('adds a muted estimate to the label line for an uncalibrated take', () => {
  expect(scoreHtml(take({ estimate: true }))).toContain(
    '<p class="score-label">Score: the lower of the two<span class="score-est"> · estimate</span></p>',
  );
  expect(scoreHtml(take({ pitch: null, estimate: true }))).toContain(
    '<p class="score-label">Score: on time. Notes were not checked.<span class="score-est"> · estimate</span></p>',
  );
  expect(scoreHtml(take())).not.toContain('estimate');
  expect(scoreHtml(take({ pitch: null }))).not.toContain('estimate');
});

it('rounds every percentage down', () => {
  const html = scoreHtml(take({ score: 0.896, timing: 0.899, pitch: 0.896 }));
  expect(html).toContain('<strong class="score-num">89%</strong>');
  expect(html).toContain('89% on time · <strong class="lower">89% notes heard</strong>');
  expect(html).toContain('style="width:89%"');
  expect(html).toContain('aria-label="89%, with marks');
  expect(scoreHtml(take({ score: 0.9, timing: 0.9, pitch: 0.95 }))).toContain('<strong class="score-num">90%</strong>');
  expect(scoreHtml(take({ score: 0.29, timing: 0.29, pitch: null }))).toContain(
    '<strong class="score-num">29%</strong>',
  );
  expect(scoreHtml(take({ score: 0.999, timing: 0.999, pitch: 1 }))).toContain(
    '<strong class="score-num">99%</strong>',
  );
});

it('fills the bar to the score and never past the end', () => {
  const width = (s: number) =>
    scoreHtml(take({ score: s, timing: s, pitch: null })).match(/class="score-fill" style="width:([\d.]+)%"/)![1];
  expect(width(0.5)).toBe('50');
  expect(width(0)).toBe('0');
  expect(width(1)).toBe('100');
  expect(width(1.05)).toBe('100');
  expect(width(7)).toBe('100');
});

it('marks 65% and 90% on the bar and spells the rule out', () => {
  const html = scoreHtml(take());
  expect(html).toContain(BAR_TICKS);
  expect(html).toContain('role="img" aria-label="92%, with marks at 65% and 80%. 80% counts as clean."');
  expect(scoreHtml(take({ score: 0.5, timing: 0.5, pitch: 0.7 }))).toContain(
    'aria-label="50%, with marks at 65% and 80%. 80% counts as clean."',
  );
});

it('keeps the big number readable, because no other line states it', () => {
  for (const html of [
    scoreHtml(take()),
    scoreHtml(take({ pitch: null })),
    scoreHtml(take({ trusted: false, reason: 'x' })),
  ])
    expect(html).not.toMatch(/<strong class="score-num"[^>]*aria-hidden/);
});

it('shows no percentage in the metrics of an unscored take', () => {
  const v: MetricsView = { trusted: true, timing: 0.876, pitch: 0.92, keys: false, timed: true, piano: true };
  expect(metricsHtml(v)).toBe(
    '<span><strong id="piece-count" aria-hidden="true">87%</strong><span class="sr-only">87%</span> on time</span><span><strong>92%</strong> notes heard right</span>',
  );
  expect(metricsHtml({ ...v, keys: true })).toContain('<strong>92%</strong> right keys');
  expect(metricsHtml({ ...v, timed: false })).toContain(' on time · estimate</span>');
  expect(metricsHtml({ ...v, pitch: null })).toContain('<span>Notes mostly unchecked</span>');
  expect(metricsHtml({ ...v, pitch: null, piano: false })).toContain('<span>Timing only</span>');
  expect(metricsHtml({ ...v, trusted: false })).toBe('<span>Not scored</span>');
});

it('lists a step with its stars and, once learned, a seal that a due review puts a clock on', () => {
  const html = starsHtml({ stars: 2, learned: false, due: false });
  expect(html).toBe(
    `<span class="stars step-stars" role="img" aria-label="2 of 3 stars">${STAR(true)}${STAR(true)}${STAR(false)}</span>`,
  );
  const learned = starsHtml({ stars: 3, learned: true, due: false });
  expect(learned).toContain('aria-label="3 of 3 stars, learned"');
  expect(learned).toContain('<svg class="seal"');
  expect(times(learned, /class="star on"/g)).toBe(3);
  const due = starsHtml({ stars: 3, learned: true, due: true });
  expect(due).toContain('aria-label="3 of 3 stars, learned, review due"');
  expect(due).toContain('<svg class="seal due"');
  // A due review never dims or hides a star.
  expect(times(due, /class="star on"/g)).toBe(3);
  expect(starsHtml({ stars: 0, learned: false, due: false })).not.toContain('star on');
});

// ---- wording rules: the same words as tests/piece-loop.test.ts ----

const BANNED = [/\b(lost|reset|failed|streaks?|combos?|points?|badges?|xp|notifications?)\b/i, /hard take/i];
/** What a learner reads: the text between the tags, and the spoken labels inside them. Class names and styles are not words. */
const words = (html: string) => [
  html.replace(/<[^>]*>/g, ' '),
  ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
];
const toneErrors = (htmls: string[]) =>
  htmls
    .flatMap(words)
    .flatMap((text) => BANNED.filter((banned) => banned.test(text)).map((banned) => `${banned}: ${text}`));

it('uses no banned word in anything the ladder or the score card shows', () => {
  // Make every shape of view here too, so this does not depend on which tests ran before it.
  for (const at of [0, 1, 3, 6])
    for (const pick of [false, true])
      for (const pop of [undefined, 'pip', 'climb'] as const) {
        for (const pips of [
          undefined,
          ...[0, 1, 2, 3].flatMap((n) => [
            { kind: 'plain' as const, clean: n },
            { kind: 'cert' as const, support: n },
          ]),
        ]) {
          ladderHtml(view({ at, pick, pop, pips, target: 5, dim: pick, rungs: rungs([3, 6], [3]) }));
        }
      }
  const reasons = [
    '',
    'The microphone recording had gaps. This take could not be judged.',
    'Audio timing was interrupted. This take will not change your progress.',
    `Tom & "Jerry" <b>loud</b> it's`,
  ];
  for (const trusted of [true, false])
    for (const pitch of [null, 0.4, 0.92])
      for (const keys of [false, true])
        for (const estimate of [false, true])
          for (const score of [0, 0.5, 0.896, 1]) {
            for (const reason of reasons)
              scoreHtml(take({ trusted, pitch, keys, estimate, score, timing: score, reason, run: 12 }));
            metricsHtml({ trusted, timing: score, pitch, keys, timed: !estimate, piano: !keys });
          }
  for (const stars of [0, 1, 2, 3] as const)
    for (const [learned, due] of [
      [false, false],
      [true, false],
      [true, true],
    ])
      starsHtml({ stars, learned, due });
  expect(made.length).toBeGreaterThan(500);
  expect(toneErrors(made)).toEqual([]);
  // The check itself bites, on the text between tags and on spoken labels, and not on class names.
  for (const html of [
    '<p>Your streak is lost</p>',
    '<span aria-label="Badges: 3 points">x</span>',
    '<b>Reset</b>',
    '<i>That was a hard take</i>',
    '<p>You earned XP</p>',
    '<p>3 notifications</p>',
    '<p class="x">You failed</p>',
  ])
    expect(toneErrors([html]), html).not.toEqual([]);
  expect(toneErrors(['<span class="badge points reset streak">9 BPM</span>'])).toEqual([]);
});
