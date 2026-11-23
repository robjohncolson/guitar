import './journey.css';
import type { Unit } from './curriculum';
import { hasStars, starsFor, type StepStars } from './game';
import { starsHtml } from './hud';
import { HALO, HERE_RING, journeyLayout, MARK_R, NODE, type JourneyLayout, type Stop } from './journey';
import { ready, type UnitProgress } from './progress';

/**
 * The journey map in the Course panel: the layout from journey.ts drawn as inline SVG (one slice per row, so a stop's
 * list of steps can open right under it), with a real button on every stop. Everything shown is saved progress read
 * through the same rules as the List view (starsFor, ready, the List's state label). Nothing here is stored: the
 * choice of view and the open stop last only while the page is open.
 */
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Get = (id: string) => UnitProgress | undefined;

/** What the map needs from the page each time it is painted. */
export interface JourneyState {
  units: readonly Unit[];
  /** The piece's sections and bars (a Score has both). */
  score: { sections: readonly { name: string; from: number; to: number }[]; bars: readonly { number: number }[] };
  get: Get;
  now: number;
  current?: string;
  /** Steps in today's plan. */
  plan: ReadonlySet<string>;
  /** The List view's state label ("begin at 33 BPM", "review due"). */
  label: (u: Unit) => string;
}
/** Which course this is, read from its steps as the mastery map reads it: guitar plays the piece, accompaniment, piano. */
const courseOf = (units: readonly Unit[]) =>
  units.some((u) => u.id.startsWith('gp-'))
    ? 'guitar'
    : units.some((u) => u.id.startsWith('g-'))
      ? 'accompany'
      : 'piano';

/** A step's stars as every list draws them (sameAs resolved), or nothing for a step that has none. */
export function stepStarsHtml(units: readonly Unit[], u: Unit, get: Get, now: number): string {
  const stars = starsFor(units, u, get, now);
  return stars ? starsHtml(stars) : '';
}
type Row = Pick<JourneyState, 'units' | 'get' | 'now' | 'current' | 'label'>;
/** A step's row as the List view shows it: title, "later" and "optional", stars, state. Shared by both views. */
export function courseRow(u: Unit, s: Row): string {
  return `<button class="course-lesson${u.sameAs ? ' covered' : ''}" data-unit="${esc(u.id)}" aria-current="${u.id === s.current}"><span>${esc(u.title)}${!u.sameAs && !ready(u, s.get) ? ' <span class="muted">· later</span>' : ''}${u.optional ? ' <span class="muted">· optional</span>' : ''}</span><span>${stepStarsHtml(s.units, u, s.get, s.now)}${esc(s.label(u))}</span></button>`;
}
/** The List view: every step under its stage's heading, in course order. */
export function courseListHtml(stages: readonly string[], s: Row): string {
  return stages
    .map((name, i) => {
      const members = s.units.filter((u) => u.stage === i);
      if (!members.length) return '';
      return `<div class="course-stage">${i + 1} · ${esc(name)}</div>${members.map((u) => courseRow(u, s)).join('')}`;
    })
    .join('');
}

const R = 5.5;
/** A dot's ring colour: left hand (or bass) blue, right hand (or melody) green, both pale ink. */
const tone = (u: Unit) => (u.hands.length === 1 ? (u.hands[0] === 'L' ? 'l' : 'r') : 'b');
/**
 * One step as a dot: a ring in its part's colour that fills with gold from the bottom, a third per star (by area); the
 * learned seal (gold with a check) once learned, with the amber clock when a review is due. Faint when it is for later,
 * dashed when its notes are practised in another step.
 */
function dot(x: number, y: number, r: number, s: StepStars | undefined, cls: string): string {
  const inner = r - 1.3;
  let fill = '';
  if (s?.learned)
    fill = s.due
      ? `<circle cx="${x}" cy="${y}" r="${r + 0.6}" class="jd-due"/><path d="M${x} ${y - inner * 0.62}V${y}l${inner * 0.5} ${inner * 0.32}" class="jd-mark"/>`
      : `<circle cx="${x}" cy="${y}" r="${r + 0.6}" class="jd-seal"/><path d="M${x - inner * 0.55} ${y + 0.1}l${inner * 0.38} ${inner * 0.4}l${inner * 0.75} -${inner * 0.82}" class="jd-mark"/>`;
  else if (s?.stars === 3) fill = `<circle cx="${x}" cy="${y}" r="${inner}" class="jd-gold"/>`;
  else if (s && s.stars > 0) {
    // The heights at which a circle's lower part holds a third and two thirds of its area.
    const level = y + inner - inner * 2 * (s.stars === 1 ? 0.3735 : 0.6265),
      w = Math.sqrt(Math.max(0, inner * inner - (level - y) ** 2));
    fill = `<path d="M${round(x - w)} ${round(level)}A${inner} ${inner} 0 ${s.stars === 2 ? 1 : 0} 0 ${round(x + w)} ${round(level)}Z" class="jd-gold"/>`;
  }
  return `<g class="jd ${cls}"><circle cx="${x}" cy="${y}" r="${r}" class="jd-ring"/>${fill}</g>`;
}
const round = (n: number) => Math.round(n * 10) / 10;

interface Look {
  stars: (id: string) => StepStars | undefined;
  unit: (id: string) => Unit | undefined;
  later: (id: string) => boolean;
  started: (stop: Stop) => boolean;
}
function dotFor(look: Look, id: string, x: number, y: number, r: number, mark = false): string {
  const u = look.unit(id);
  if (!u) return '';
  const cls = `${mark ? 'm' : tone(u)}${look.later(id) ? ' later' : ''}${u.sameAs ? ' covered' : ''}`;
  return dot(x, y, r, look.stars(id), cls);
}

/** The stop's own picture: a ring for a phrase, an arch for a gate, a flag, a tent or a peak. */
function stopArt(stop: Stop, look: Look, state: JourneyState): string {
  const { x, y } = stop,
    here = stop.steps.includes(state.current ?? ''),
    planned = stop.steps.some((id) => state.plan.has(id)),
    graded = stop.steps.filter((id) => look.stars(id) !== undefined && !look.unit(id)?.sameAs);
  const later = graded.length > 0 && graded.every((id) => look.later(id));
  const own = stop.dots.filter((id) => !look.unit(id)?.sameAs),
    full = own.length > 0 && own.every((id) => look.stars(id)?.stars === 3);
  const tone = `${look.started(stop) ? ' begun' : ''}${full ? ' full' : ''}${later ? ' later' : ''}`;
  // The rings keep clear of the stop's label and marks: the layout places those by the ring rule (journey.ts).
  let art = planned ? `<circle cx="${x}" cy="${y}" r="${HALO}" class="j-plan"/>` : '';
  if (here) art += `<circle cx="${x}" cy="${y}" r="${HERE_RING}" class="j-here"/>`;
  const dots = (cy: number) => {
    const n = stop.dots.length,
      per = Math.min(3, n),
      rows = Math.ceil(n / per) || 1;
    return stop.dots
      .map((id, i) => {
        const row = Math.floor(i / per),
          inRow = Math.min(per, n - row * per),
          col = i % per;
        return dotFor(look, id, round(x + (col - (inRow - 1) / 2) * 12), round(cy + (row - (rows - 1) / 2) * 12), R);
      })
      .join('');
  };
  if (stop.kind === 'phrase') art += `<circle cx="${x}" cy="${y}" r="20.5" class="j-node${tone}"/>${dots(y)}`;
  else if (stop.kind === 'gate')
    art += `<path d="M${x - 15} ${y + 15}V${y - 3}a15 15 0 0 1 30 0V${y + 15}" class="j-gate${tone}"/><path d="M${x - 19} ${y + 15}h38" class="j-ground"/>${dots(y + 4)}`;
  else if (stop.kind === 'summit')
    art += `<path d="M${x - 30} ${y + 17}L${x - 13} ${y - 3}L${x - 6} ${y + 4}L${x + 6} ${y - 14}L${x + 30} ${y + 17}Z" class="j-peak${tone}"/><path d="M${x + 1} ${y - 7}l5 3l5 -3" class="j-flag${tone}"/><path d="M${x + 6} ${y - 14}v-12l9 3.5l-9 3.5" class="j-flag${tone}"/>${dots(y + 7)}`;
  else if (stop.kind === 'camp')
    art += `<path d="M${x - 15} ${y + 12}L${x} ${y - 12}L${x + 15} ${y + 12}Z" class="j-tent${tone}"/><path d="M${x} ${y - 12}L${x - 4} ${y + 12}M${x} ${y - 12}L${x + 4} ${y + 12}" class="j-door${tone}"/>`;
  else {
    const heard = Boolean(state.get(stop.dots[0] ?? '')?.attempts);
    art += `<path d="M${x - 6} ${y + 15}V${y - 15}" class="j-post"/><path d="M${x - 6} ${y - 15}L${x + 12} ${y - 9}L${x - 6} ${y - 3}Z" class="j-pennant${heard ? ' heard' : ''}"/>`;
  }
  // Marks: chords and changes (the camp's drills), where the layout put them; the rest counted by "+n".
  art += stop.markAt.map((at, i) => dotFor(look, stop.marks[i], at.x, at.y, MARK_R, true)).join('');
  if (stop.more) art += `<text x="${stop.more.x}" y="${stop.more.y}" class="j-more">+${stop.more.n}</text>`;
  // The label where the layout put it: under the stop (nudged in at the edges), or beside the trailhead's flag.
  art += `<text x="${stop.labelX}" y="${stop.labelY}" class="j-label${later ? ' later' : ''}${stop.labelAnchor === 'start' ? ' start' : ''}">${esc(stop.label.toUpperCase())}</text>`;
  return art;
}

/** A join: two short rails across the path with the join's own dot between them. */
function bridgeArt(b: JourneyLayout['bridges'][number], look: Look): string {
  return `<g transform="translate(${b.x} ${b.y}) rotate(${b.angle})"><path d="M-7 -5.5Q0 -3.6 7 -5.5M-7 5.5Q0 3.6 7 5.5" class="j-rail"/>${dotFor(look, b.unit, 0, 0, 2.8, true)}</g>`;
}

function spoken(stop: Stop, look: Look, state: JourneyState): string {
  if (stop.kind === 'trailhead')
    return `${stop.name}: ${state.get(stop.dots[0] ?? '')?.attempts ? 'heard' : 'not heard yet'}`;
  const graded = stop.steps.filter((id) => look.stars(id) !== undefined && !look.unit(id)?.sameAs),
    starred = graded.filter((id) => (look.stars(id)?.stars ?? 0) > 0).length,
    due = graded.filter((id) => look.stars(id)?.due).length,
    learned = graded.filter((id) => look.stars(id)?.learned).length;
  const words = graded.length
    ? `${starred} of ${graded.length} step${graded.length === 1 ? ' has' : 's have'} stars`
    : 'the same notes as an earlier passage';
  const later = graded.length > 0 && graded.every((id) => look.later(id));
  return `${stop.name}: ${words}${learned ? `, ${learned} learned` : ''}${due ? `, ${due} review${due === 1 ? '' : 's'} due` : ''}${stop.steps.some((id) => state.plan.has(id)) ? ", in today's plan" : ''}${later ? ', for later' : ''}${stop.steps.includes(state.current ?? '') ? ', you are here' : ''}`;
}

/** The whole map as HTML for a measured width. open: the stop whose list is open. */
export function journeyHtml(layout: JourneyLayout, state: JourneyState, open?: string): string {
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const stars = new Map<string, StepStars | undefined>();
  const look: Look = {
    unit: (id) => byId.get(id),
    stars: (id) => {
      if (!stars.has(id)) {
        const u = byId.get(id);
        stars.set(id, u && hasStars(u) ? starsFor(state.units, u, state.get, state.now) : undefined);
      }
      return stars.get(id);
    },
    later: (id) => {
      const u = byId.get(id);
      return Boolean(u && !u.sameAs && !ready(u, state.get));
    },
    started: (stop) =>
      stop.kind === 'trailhead'
        ? Boolean(state.get(stop.dots[0] ?? '')?.attempts)
        : stop.steps.some((id) => (look.stars(id)?.stars ?? 0) > 0),
  };
  // Marks per row: as many as fit between two neighbouring stops, so the marks of neighbours never meet.
  const W = layout.width,
    walked = layout.stops.map((s) => look.started(s));
  const startArt =
    layout.stops[0]?.kind === 'trailhead'
      ? ''
      : `<circle cx="${layout.start.x}" cy="${layout.start.y}" r="4" class="j-start"/><text x="${layout.start.x + 12}" y="${layout.start.y + 4}" class="j-label start">START</text>`;
  const html = layout.slices.map((slice, n) => {
    const h = slice.bottom - slice.top,
      inside = (y0: number, y1: number) => y1 >= slice.top - 3 && y0 <= slice.bottom + 3;
    let art = layout.regions
      .map((r, i) =>
        inside(r.top, r.bottom)
          ? `<rect x="0" y="${r.top}" width="${W}" height="${r.bottom - r.top}" class="j-band${i % 2 ? ' odd' : ''}"/>`
          : '',
      )
      .join('');
    const region = layout.regions.find((r) => r.top === slice.top);
    if (region) {
      const text = `${region.name} · ${region.bars}`.toUpperCase(),
        at = region.align === 'left' ? 16 : W - 16;
      art += `<text x="${at}" y="${region.headY}" class="j-region ${region.align}">${esc(text)}</text>`;
    }
    for (const piece of layout.path)
      if (inside(piece.y0, piece.y1))
        art += `<path d="${piece.d}" class="j-path"/>${piece.toStop >= 0 && walked[piece.toStop] ? `<path d="${piece.d}" class="j-walked"/>` : ''}`;
    if (n === 0) {
      if (layout.spur) {
        const camp = layout.stops.find((s) => s.kind === 'camp');
        art += `<path d="${layout.spur}" class="j-spur${camp && walked[layout.stops.indexOf(camp)] ? ' walked' : ''}"/>`;
      }
      art += startArt;
    }
    for (const b of layout.bridges) if (inside(b.y - 8, b.y + 8)) art += bridgeArt(b, look);
    let buttons = '';
    for (const i of slice.stops) {
      const stop = layout.stops[i];
      art += stopArt(stop, look, state);
      const isOpen = stop.id === open,
        here = stop.steps.includes(state.current ?? '');
      buttons += `<button type="button" class="jr-stop" data-stop="${i}" style="left:${round(stop.x - NODE / 2)}px;top:${round(stop.y - slice.top - NODE / 2)}px" aria-expanded="${isOpen}"${here ? ' aria-current="location"' : ''} aria-label="${esc(spoken(stop, look, state))}"></button>`;
      if (isOpen) buttons += listHtml(stop, state, stop.x);
    }
    return `<div class="jr-slice" style="contain-intrinsic-block-size:${h}px"><svg class="jr-art" width="${W}" height="${h}" viewBox="0 ${slice.top} ${W} ${h}" aria-hidden="true" focusable="false">${art}</svg>${buttons}</div>`;
  });
  return `<div class="jr-map" style="width:${W}px">${html.join('')}</div>${legendHtml(courseOf(state.units))}`;
}
/** A stop's steps, right under its row: each opens exactly as it does in the List view. */
export function listHtml(stop: Stop, state: JourneyState, x: number): string {
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const rows = stop.steps
    .map((id) => byId.get(id))
    .filter((u): u is Unit => Boolean(u))
    .map((u) => courseRow(u, state))
    .join('');
  return `<div class="jr-list" role="group" aria-label="${esc(stop.name)}" style="--x:${round(x)}px">${rows}</div>`;
}

const sample = (stars: 0 | 1 | 2 | 3, cls: string, learned = false) =>
  `<svg class="jr-sample" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">${dot(0, 0, R, { stars, learned, due: false }, cls)}</svg>`;
function legendHtml(course: ReturnType<typeof courseOf>): string {
  const parts =
    course === 'piano'
      ? [
          [sample(0, 'l'), 'left hand'],
          [sample(0, 'r'), 'right hand'],
          [sample(0, 'b'), 'hands together'],
        ]
      : course === 'guitar'
        ? [
            [sample(0, 'l'), 'bass and chords'],
            [sample(0, 'r'), 'melody'],
            [sample(0, 'b'), 'together'],
          ]
        : [[sample(0, 'r'), 'a step']];
  const fills = `${sample(1, 'b')}${sample(2, 'b')}${sample(3, 'b')}`;
  return `<div class="jr-legend"><span>${parts.map(([art, words]) => `<span class="jr-key">${art}${words}</span>`).join('')}</span><span class="jr-key">${fills}a third of gold per star</span><span class="jr-key">${sample(3, 'b', true)}learned</span><p class="muted">${
    course === 'accompany'
      ? 'The pattern comes first; each section is a gate, with the chord shapes and changes it brings as small dots above it. The whole piece is the summit.'
      : `Each stop is a phrase on the way through the piece; the small dots above it are its ${course === 'guitar' ? 'bars note by note' : 'chords'} and changes, and the short rails on the path are joins. A section ends at its gate; the whole piece is the summit.`
  } Faint steps are for later, and every stop opens.</p></div>`;
}

/**
 * The two views of the Course panel (Journey first, then List; the choice is not saved) and the map's own clicks. The
 * page calls paint with a way to read its state wherever it repaints the List; the map is drawn only while it can be
 * seen, and again when the panel opens, the view changes or the panel's width changes. A step in a stop's list opens
 * by clicking that step's own row in the List, so it opens exactly as the List opens it.
 */
export function mountJourney(): { paint: (state: () => JourneyState) => void } {
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const m = {
    panel: el('piece-course') as HTMLDetailsElement,
    map: el('course-journey'),
    list: el('course-list-view'),
    journeyButton: el('course-view-journey'),
    listButton: el('course-view-list'),
    state: (): JourneyState | undefined => undefined,
    open: (id: string) =>
      el('course-list')
        .querySelector<HTMLElement>(`[data-unit="${CSS.escape(id)}"]`)
        ?.click(),
  };
  let view: 'journey' | 'list' = 'journey',
    dirty = true,
    width = 0,
    open: string | undefined,
    layout: JourneyLayout | undefined;
  const visible = () => m.panel.open && view === 'journey' && m.map.clientWidth > 0;
  const draw = (state: JourneyState) => {
    width = m.map.clientWidth;
    layout = journeyLayout({ units: state.units, sections: state.score.sections, bars: state.score.bars, width });
    if (open && !layout.stops.some((s) => s.id === open)) open = undefined;
    m.map.innerHTML = journeyHtml(layout, state, open);
  };
  const render = () => {
    const state = m.state();
    if (!state) return;
    const started = performance.now();
    draw(state);
    // If drawing it brought in the menu's scroll bar (a narrower panel), it is drawn again at once, so the map never
    // stands wider than the panel, not even for a frame.
    if (m.map.clientWidth !== width && m.map.clientWidth > 0) draw(state);
    dirty = false;
    performance.measure('journey-paint', { start: started });
  };
  const paint = (state: () => JourneyState) => {
    m.state = state;
    dirty = true;
    if (visible()) render();
  };
  const showHere = () => {
    const here = m.map.querySelector<HTMLElement>('.jr-stop[aria-current]');
    here?.scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  const setView = (next: 'journey' | 'list') => {
    view = next;
    m.journeyButton.setAttribute('aria-pressed', String(view === 'journey'));
    m.listButton.setAttribute('aria-pressed', String(view === 'list'));
    m.map.hidden = view !== 'journey';
    m.list.hidden = view !== 'list';
    if (view === 'journey' && dirty) render();
  };
  m.journeyButton.onclick = () => {
    setView('journey');
    showHere();
  };
  m.listButton.onclick = () => setView('list');
  m.panel.addEventListener('toggle', () => {
    if (!m.panel.open || view !== 'journey') return;
    if (dirty || m.map.clientWidth !== width) render();
    showHere();
  });
  // A change of the panel's width (a phone turned, a window resized) draws the map again on the next frame; drawing it
  // inside the observer would resize what it observes.
  let pending = 0;
  new ResizeObserver(() => {
    if (pending || !visible() || m.map.clientWidth === width) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      if (visible() && m.map.clientWidth !== width) render();
    });
  }).observe(m.map);
  m.map.addEventListener('click', (event) => {
    const target = event.target as HTMLElement,
      step = target.closest<HTMLElement>('[data-unit]');
    if (step) {
      // Opening a step closes the stop's list: the map is folded again when the panel comes back.
      open = undefined;
      dirty = true;
      m.open(step.dataset.unit!);
      return;
    }
    const button = target.closest<HTMLButtonElement>('.jr-stop');
    if (!button || !layout) return;
    const stop = layout.stops[Number(button.dataset.stop)],
      state = m.state();
    if (!stop || !state) return;
    m.map.querySelector('.jr-list')?.remove();
    for (const b of m.map.querySelectorAll('.jr-stop[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
    if (open === stop.id) {
      open = undefined;
      return;
    }
    open = stop.id;
    button.setAttribute('aria-expanded', 'true');
    button.insertAdjacentHTML('afterend', listHtml(stop, state, stop.x));
  });
  setView('journey');
  return { paint };
}
