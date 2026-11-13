import type { Unit } from './curriculum';
import type { Score } from './score';
import { unitState, type UnitProgress } from './progress';

/**
 * A map of the piece built only from saved progress: the written bars grouped by section, one lane per way of playing
 * them, each cell coloured by the highest tempo rung the step covering that bar has actually reached. Compact strips
 * hold the steps that are not bars of one passage (chords, changes, joins, run-throughs). Cells open their step.
 */
const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
type Get = (id: string) => UnitProgress | undefined;
interface Lane { label: string; short: string; match: (u: Unit) => boolean }

const reachedLevel = (p: UnitProgress | undefined) => (p ? Math.max(p.best, ...p.certified, 0) : 0);
/** none: no step plays this; new; begun (no rung reached yet); low (below 80%); mid (80–94%); goal (goal tempo). */
function band(unit: Unit | undefined, p: UnitProgress | undefined): string {
  if (!unit) return 'none';
  if (!p?.attempts) return 'new';
  const level = reachedLevel(p);
  return level >= 1 - 1e-9 ? 'goal' : level >= 0.8 - 1e-9 ? 'mid' : level > 0 ? 'low' : 'begun';
}
const pct = (p: UnitProgress | undefined) => (p?.attempts ? `${Math.round(reachedLevel(p) * 100)}% reached` : 'not started');

export function pieceMap(score: Score, units: Unit[], get: Get, now: number, instrument: 'piano' | 'guitar', current?: string): { headline: string; html: string } {
  const byId = new Map(units.map(u => [u.id, u])), resolve = (u: Unit) => (u.sameAs ? byId.get(u.sameAs) ?? u : u);
  const lanes: Lane[] = instrument === 'piano'
    ? [{ label: 'Left hand', short: 'L', match: u => u.kind === 'hand' && u.hands.join('') === 'L' }, { label: 'Right hand', short: 'R', match: u => u.kind === 'hand' && u.hands.join('') === 'R' }, { label: 'Hands together', short: 'LR', match: u => u.kind === 'together' }]
    : [{ label: 'Accompaniment (timing only)', short: 'G', match: u => u.kind === 'section' }];
  const cell = (u: Unit | undefined, label: string) => {
    if (!u) return `<span class="map-cell none" aria-hidden="true"></span>`;
    const r = resolve(u), p = get(r.id), state = unitState(r, p, now), due = state === 'due';
    const title = `${label} · ${r.title} · ${pct(p)}${state === 'learned' ? ' · learned' : due ? ' · review due' : ''}`;
    return `<button class="map-cell ${band(r, p)}${due ? ' due' : ''}" data-unit="${escape(r.id)}"${r.id === current ? ' aria-current="true"' : ''} title="${escape(title)}" aria-label="${escape(title)}"></button>`;
  };
  const sections = score.sections.length ? score.sections : [{ name: 'Piece', from: 0, to: score.bars.length - 1, note: '' }];
  const unitAt = (lane: Lane, bar: number) => units.find(u => lane.match(u) && u.bars.includes(bar));
  const blocks = sections.map(s => {
    const bars = Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i).filter(b => b < score.bars.length);
    const rows = lanes.map(lane => `<div class="map-lane"><span class="map-key" title="${lane.label}">${lane.short}</span>${bars.map(b => cell(unitAt(lane, b), `Bar ${score.bars[b].number} · ${lane.label}`)).join('')}</div>`).join('');
    return `<div class="map-section"><div class="map-name">${escape(s.name.replace(/(\d)$/, ' $1'))} <span class="muted">${score.bars[s.from].number}–${score.bars[s.to].number}</span></div>${rows}</div>`;
  }).join('');
  const strips: [string, (u: Unit) => boolean][] = instrument === 'piano'
    ? [['Chords', u => u.kind === 'chord'], ['Changes', u => u.kind === 'change'], ['Joins', u => u.kind === 'seam'], ['Run-throughs', u => u.kind === 'section' || u.kind === 'performance']]
    : [['Shapes', u => u.kind === 'chord'], ['Changes', u => u.kind === 'change'], ['Pattern', u => u.kind === 'hand'], ['Whole piece', u => u.kind === 'performance']];
  const stripHtml = strips.map(([name, match]) => {
    const members = units.filter(u => match(u) && !u.sameAs);
    return members.length ? `<div class="map-strip"><span class="map-strip-name">${name}</span><span class="map-cells">${members.map(u => cell(u, name.replace(/s$/, ''))).join('')}</span></div>` : '';
  }).join('');
  // Headline: bars played at the goal tempo in the way that finishes them (hands together; for guitar, the section).
  const last = lanes[lanes.length - 1], counted = score.bars.map((_, b) => unitAt(last, b)).filter((u): u is Unit => Boolean(u));
  const atGoal = counted.filter(u => band(resolve(u), get(resolve(u).id)) === 'goal').length;
  const started = counted.filter(u => get(resolve(u).id)?.attempts).length;
  const due = units.filter(u => !u.sameAs && unitState(u, get(u.id), now) === 'due').length;
  const headline = `${atGoal} of ${counted.length} bars at goal tempo${instrument === 'piano' ? ' hands together' : ''}${started > atGoal ? ` · ${started} started` : ''}${due ? ` · ${due} review${due > 1 ? 's' : ''} due` : ''}`;
  const legend = `<div class="map-legend"><span><i class="map-cell new"></i>not started</span><span><i class="map-cell begun"></i>started</span><span><i class="map-cell low"></i>50–70%</span><span><i class="map-cell mid"></i>80–94%</span><span><i class="map-cell goal"></i>goal tempo</span><span><i class="map-cell new due"></i>review due</span></div>`;
  const note = instrument === 'piano' ? '<p class="muted map-note">Colour is the fastest tempo step reached. One hand alone stops at 80%; hands together goes on to the goal tempo. Choose a cell to practise that step.</p>'
    : '<p class="muted map-note">Colour is the fastest tempo step reached. Guitar takes check timing only. Choose a cell to practise that step.</p>';
  return { headline, html: `<div class="map-sections">${blocks}</div>${stripHtml}${legend}${note}` };
}
