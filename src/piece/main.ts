import '../styles.css';
import '../trainer/styles.css';
import './styles.css';
import { compile, type Diagnostic } from './notation';
import { buildCurriculum, exerciseFor, repeats, STAGES, type Curriculum, type Unit } from './curriculum';
import { arrange, guitarExerciseFor, guitarUnits, GUITAR_STAGES, melodyBacking, type Arrangement } from './guitar';
import { fromBars, type Exercise, type XEvent } from './exercise';
import { advanceUnit, canPlace, dayOf, initialUnit, logDay, parsePieceProgress, pieceProgressKey, placeHands, placeUnit, progressId, ready, rowDone, rungBpm, suggestToday, unitState, week, type AdvanceEvent, type PieceProgress, type PlanRow, type UnitProgress } from './progress';
import { pieceMap } from './map';
import { bestKey, compareTake, keyStats, pruneBests, tightness, timingSummary } from './bests';
import { PieceAudio, type PieceTake } from './audio';
import { celebrate, chordBox, clearMoment, drawKeys, drawStrings, handColour, keyHit, laneAnimating, laneResized, pieceShell, showMoment } from './view';
import { KeyInput, keyLabels, layoutFor, reaches } from './keys';
import { noteKey, WaitRun } from './wait';
import { chordSpans, prettyChord } from './analysis';
import { barAt, keyPerfect, keyReach, keyWindow, type KeyLive, type PieceGrade } from './grade';
import { noteName, type Hand, type Score } from './score';
import { barsText, isSpotId, pickSpot, slowerBpm, spotExercise, spotId, spotOffered, type SpotPick } from './spot';
import { saveTracked } from '../account/changes';
import { mountPieceAccount } from '../account/pieces';

pieceShell();
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
interface Pack { id: string; text: string; origin: 'bundled' | 'local' | 'mine' }
const bundled = import.meta.glob('./packs/*.piece.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// Private packs (git-ignored, often copyrighted) are read by the dev server only, so no production build can ship them.
const localFiles: Record<string, string> = import.meta.env.DEV ? import.meta.glob('./packs/local/*.piece.txt', { query: '?raw', import: 'default', eager: true }) : {};
const MINE = 'piece.imported.v1';
const readMine = (): { id: string; text: string }[] => { try { const v = JSON.parse(localStorage.getItem(MINE) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x?.id === 'string' && typeof x?.text === 'string').slice(0, 30) : []; } catch { return []; } };
const packs = (): Pack[] => [
  ...Object.entries(bundled).map(([path, text]) => ({ id: path.split('/').pop()!.replace('.piece.txt', ''), text, origin: 'bundled' as const })),
  ...Object.entries(localFiles).map(([path, text]) => ({ id: `local:${path.split('/').pop()!.replace('.piece.txt', '')}`, text, origin: 'local' as const })),
  ...readMine().map(m => ({ ...m, origin: 'mine' as const })),
];
const trainerCalibration = (() => { try { const v = JSON.parse(localStorage.getItem('guitar.trainer.v1') ?? '{}'); return { offset: Number(v.offset) || 0, calibrated: v.calibrated === true, calibrationKey: String(v.calibrationKey ?? '') }; } catch { return undefined; } })();
const progress: PieceProgress = (() => { try { return parsePieceProgress(localStorage.getItem(pieceProgressKey), trainerCalibration); } catch { return parsePieceProgress(null, trainerCalibration); } })();
const audio = new PieceAudio();
// Browser checks reach the audio engine in development builds only.
if (import.meta.env.DEV) (window as unknown as { __pieceDev: unknown }).__pieceDev = { audio, exercise: () => exercise, layout: () => keyInput.layout, tiers: () => [...tiers], streak: () => streak, revealing: () => Boolean(reveal), moment: () => Boolean(after), pending: () => Boolean(pending), spot: () => spot && { id: spot.id, bars: spot.exercise.bars.map(b => b.number), bpm: spot.bpm, clean: spot.clean, hands: spot.hands }, choice: () => choice,
  take: (result: PieceGrade, bpm?: number) => { const take: PieceTake = { id: Date.now(), exercise, unit: spot ? spot.id : unit.id, bpm: bpm ?? bpmNow(), support: 0, kind: 'practice', offset: progress.offset, samples: new Float32Array(4800), rate: 48000, levelGain: 1, result }; audio.previous = audio.take; audio.take = take; audio.onTake(take); } };
const player = el<HTMLAudioElement>('piece-player'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
audio.checkPitch = progress.checkPitch;
let pack: Pack, score: Score, curriculum: Curriculum, arrangement: Arrangement, gUnits: Unit[] = [];
let instrument: 'piano' | 'guitar' = progress.selected.instrument, unit: Unit, exercise: Exercise, manualBpm: number | undefined;
/** A trouble-spot loop: bars of the step played alone, away from the tempo ladder. While it runs, `exercise` is the spot and `unit` stays the step. */
let spot: { parent: Unit; from: number; to: number; lead: boolean; hands: Hand[]; bpm: number; exercise: Exercise; id: string; clean: number } | undefined;
let choiceAt = 0;
/** The tempo step a placement would target (default the top one), and the step a placement take in progress is aimed at. */
let placeAt: number | undefined, placing: number | undefined;
let choice: 'offer' | 'pass' | undefined, offer: { pick: SpotPick | 'choose'; bpm: number; carry: string } | undefined;
let pending: { take: PieceTake; before: UnitProgress; entry: PieceProgress['history'][number]; place?: number } | undefined, feedback = '', wavUrl = '', traceUrl = '';
// Computer keyboard and MIDI input: a per-browser preference, kept apart from practice progress.
const INPUT = 'piece.input.v1';
const inputPrefs = (() => { try { const v = JSON.parse(localStorage.getItem(INPUT) ?? '{}'); return { keys: v.keys === true, midiSound: v.midiSound !== false, calm: v.calm === true, piano: v.piano === 'simple' ? 'simple' as const : 'grand' as const }; } catch { return { keys: false, midiSound: true, calm: false, piano: 'grand' as const }; } })();
audio.piano = inputPrefs.piano;
const saveInput = () => { try { localStorage.setItem(INPUT, JSON.stringify(inputPrefs)); } catch { /* preference lasts for this page */ } };
let labels = keyLabels({ lower: 48, upper: 60 });
const keyInput = new KeyInput({
  down: (midi, stamp, source) => { const before = audio.pressCount; void audio.keyDown(midi, stamp, source === 'keys' || inputPrefs.midiSound); judgePress(midi, audio.pressCount > before); },
  up: midi => audio.keyUp(midi),
}, () => { labels = keyLabels(keyInput.layout); paintLaneHelp(); });
/** Keys mode applies to piano only; guitar always listens through the microphone. */
const usingKeys = () => inputPrefs.keys && instrument === 'piano';
/** Key presses need no sound-delay calibration: their timing is measured on the audio clock directly. */
const timed = (take?: PieceTake) => Boolean(take?.presses) || progress.calibrated;
function applyInput(): void {
  const keys = usingKeys();
  audio.input = keys ? 'keys' : 'mic'; keyInput.enabled = keys;
  if (!keys) { keyInput.releaseAll(); for (const m of [...audio.held]) audio.keyUp(m); }
  el('input-mic').setAttribute('aria-pressed', String(!inputPrefs.keys)); el('input-keys').setAttribute('aria-pressed', String(inputPrefs.keys));
  el('input-toggle').hidden = instrument !== 'piano';
  if (keys) void keyInput.connectMidi();
  if (exercise) { keyInput.setLayout(layoutFor(exercise.events.flatMap(e => e.notes.map(n => n.midi)))); labels = keyLabels(keyInput.layout); }
  if (unit) el('piece-wait').hidden = !keys || unit.kind === 'listen';
  paintLaneHelp();
}
/**
 * With computer keys, notes the two rows cannot reach are played by the app and left out of grading; with a MIDI
 * keyboard (or the microphone) every note is the player's.
 */
function reachSplit(ex: Exercise): { mine: Exercise; auto: XEvent[] } {
  if (!usingKeys() || keyInput.midiDevices) return { mine: ex, auto: [] };
  const can = (m: number) => reaches(keyInput.layout, m);
  return {
    mine: { ...ex, events: ex.events.map(e => ({ ...e, notes: e.notes.filter(n => can(n.midi)) })).filter(e => e.notes.length) },
    auto: ex.events.map(e => ({ ...e, notes: e.notes.filter(n => !can(n.midi)) })).filter(e => e.notes.length),
  };
}
/** Notes the app plays in this take or wait run, as lane keys; and the wait run's notes still to sound. */
let autoKeys = new Set<string>(), autoQueue: XEvent[] = [];
function paintLaneHelp(): void {
  if (!exercise) return;
  const out = reachSplit(exercise).auto.reduce((n, e) => n + e.notes.length, 0);
  const midi = keyInput.midiDevices ? `${keyInput.midiDevices} MIDI input${keyInput.midiDevices > 1 ? 's' : ''} connected` : keyInput.midiError || 'no MIDI keyboard connected';
  el('lane-help').textContent = instrument === 'piano'
    ? `Left hand blue · right hand green · numbers are suggested fingers${usingKeys() ? ` · your keys light amber · letters are computer keys (Z row and Q row), left/right arrows change octave · ${midi}${out ? ` · ${out} note${out > 1 ? 's' : ''} out of reach of the keys (dimmed) will be played for you` : ''}` : ''}`
    : `Thin string at the top · numbers are frets${exercise.capo ? ` from the capo at ${exercise.capo}` : ''} · brackets are strums or pinches`;
}
const heard = new Set<string>(), session = { takes: 0, seconds: 0, notes: [] as string[] };

const units = () => (instrument === 'piano' ? curriculum.units : gUnits);
const key = (id: string) => progressId(`${pack.id}${instrument === 'guitar' ? '#guitar' : ''}`, id);
const get = (id: string): UnitProgress | undefined => progress.units[key(id)];
const current = () => get(unit.id) ?? initialUnit();
const goal = () => progress.goals[pack.id] ?? score.tempo.bpm;
const bpmNow = () => spot ? spot.bpm : manualBpm ?? rungBpm(unit, current());
const placeTarget = () => { const top = unit.rungs.length - 1; return placeAt !== undefined && placeAt > current().rung ? Math.min(placeAt, top) : top; };
const placeBpm = () => rungBpm(unit, { ...current(), rung: placeTarget() });
const placeable = () => unit.kind !== 'listen' && !spot && !wait && canPlace(unit, current(), placeTarget());
const active = () => Boolean(wait || audio.plan || audio.busy || audio.playing || !player.paused);
// Live feedback for keys: which notes have been played (so only they glow) and when each wrong key went down.
let wait: WaitRun | undefined;
const wrong = new Map<number, number>();
/** A timed keys take, live: each played note's judgement (the same rules as the grade) and on-time notes in a row. */
let tiers = new Map<string, KeyLive>(), streak = 0;
const lively = () => !inputPrefs.calm && !reduced.matches;
let lastFrame = 0;
/**
 * Judge a key press as it happens: in wait mode it moves the lane on; in a timed take the presses so far are judged by
 * the grade's own rules (judgeKeys), so the lane never says more than the result will. Only a confirmed on-time key
 * earns a flash; early or late shows calmly; a key that matches nothing tints as wrong.
 */
function judgePress(midi: number, recorded: boolean): void {
  if (wait) { if (wait.press(midi) === 'wrong') wrong.set(midi, performance.now()); return; }
  const plan = audio.plan;
  if (!plan || plan.kind !== 'practice' || audio.input !== 'keys' || !recorded) return;
  const judged = audio.judge(); if (!judged) return;
  if (judged.wrong.has(audio.pressCount - 1)) { wrong.set(midi, performance.now()); streak = 0; }
  for (const [key, tier] of judged.notes) {
    if (tiers.get(key) === tier || Number(key.split(':')[1]) !== midi) continue;
    keyHit(midi, tier, handColour(exercise, midi));
    streak = tier === 'perfect' || tier === 'good' ? streak + 1 : tier === 'played' ? streak : 0;
  }
  tiers = judged.notes;
}
function resetLive(): void { tiers = new Map(); streak = 0; wrong.clear(); }
function startWait(): void {
  if (active() || !usingKeys() || unit.kind === 'listen') return;
  // A take waiting for its answer stays answerable: Wait for me grades nothing and never moves the ladder.
  player.pause(); el('piece-session').hidden = true; endReveal(); endMoment(false);
  resetLive(); lastFrame = 0;
  const { mine, auto } = reachSplit(exercise);
  wait = new WaitRun(mine, bpmNow()); autoQueue = auto; autoKeys = new Set(auto.flatMap(e => e.notes.map(n => noteKey(e.beat, n.midi))));
  for (const k of autoKeys) wait.hits.add(k);
  void audio.prepare().then(() => audio.lockPiano(), () => {});
  feedback = 'Wait for me: the notes stop at the keys until you play them. Take your time; only the keys are checked.';
}
function stopWait(message?: string): void { if (!wait) return; wait = undefined; audio.lockPiano(false); if (message) feedback = message; }
function finishWait(run: WaitRun): void {
  const { notes, mistakes, seconds } = run.summary();
  wait = undefined; audio.lockPiano(false); session.seconds += seconds; progress.log = logDay(progress.log, Date.now(), { seconds }); persist(); paintToday();
  feedback = mistakes === 0 ? `All ${notes} notes, no wrong keys, in ${Math.round(seconds)} s. Try it again, or play it in time with Start practice.`
    : `All ${notes} notes in ${Math.round(seconds)} s, with ${mistakes} wrong key${mistakes > 1 ? 's' : ''} on the way. Once there are none, play it in time with Start practice.`;
  if (mistakes === 0) celebrate();
}
function persist(): void {
  try { saveTracked(pieceProgressKey, JSON.stringify(progress)); el('piece-storage').textContent = 'Progress stays in this browser. Audio is never saved automatically.'; }
  catch { el('piece-storage').textContent = 'Storage is unavailable: progress will last only for this page.'; }
}
const title = (id: string) => units().find(u => u.id === id)?.title ?? id;
function stateLabel(u: Unit): string {
  const p = get(u.id), state = unitState(u, p, Date.now());
  if (u.kind === 'listen') return p?.attempts ? 'heard' : 'start here';
  if (state === 'covered') return `same as ${title(u.sameAs!)}`;
  const bpm = rungBpm(u, p ?? initialUnit());
  return state === 'new' ? `begin at ${bpm} BPM` : state === 'practising' ? `${bpm} BPM · tempo ${Math.min(p!.rung, u.rungs.length - 1) + 1} of ${u.rungs.length}` : state === 'done' ? (u.rungs[u.rungs.length - 1] < 1 ? 'done · top for one hand' : 'done') : state === 'due' ? 'review due' : 'learned';
}

function loadPack(id: string): void {
  audio.stop(); player.pause(); spot = undefined; choice = undefined; offer = undefined;
  const all = packs();
  pack = all.find(p => p.id === id) ?? all[0];
  const compiled = compile(pack.text);
  if (!compiled.score) { el('piece-feedback').textContent = `This piece file has errors: ${compiled.diagnostics.slice(0, 3).map(d => `line ${d.line}: ${d.message}`).join(' ')}`; return; }
  score = compiled.score;
  { const midis = score.notes.map(n => n.midi); if (midis.length) audio.pianoRange = [Math.min(...midis), Math.max(...midis)]; }
  curriculum = buildCurriculum(score, goal());
  arrangement = arrange(score);
  gUnits = guitarUnits(score, arrangement, goal());
  progress.selected.piece = pack.id;
  el<HTMLSelectElement>('piece-select').innerHTML = all.map(p => `<option value="${escape(p.id)}"${p.id === pack.id ? ' selected' : ''}>${escape(compile(p.text).score?.meta.title ?? p.id)}${p.origin === 'bundled' ? '' : ' · yours'}</option>`).join('');
  el('piece-title').textContent = score.meta.title; el('piece-composer').textContent = score.meta.composer.toUpperCase();
  el('piece-summary').textContent = curriculum.summary.slice(1).join(' · ');
  el('piece-verified').textContent = { sources: 'Notes checked against an independent source', owner: 'Notes confirmed by you', checks: 'Notes compiled and checked; listen through once', none: 'Notes not yet checked' }[score.meta.verified];
  el<HTMLInputElement>('piece-goal').value = String(goal());
  el('piece-goal-help').textContent = `Marked "${score.tempo.text || 'no tempo'}"; ${score.tempo.bpm} BPM suggested`;
  paintAbout();
  const wanted = progress.selected.unit && units().some(u => u.id === progress.selected.unit) ? progress.selected.unit : landing();
  selectUnit(wanted);
}
function paintAbout(): void {
  const spans = chordSpans(score), counts = new Map<string, number>();
  for (const s of spans) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  el('piece-about-body').innerHTML = `<p>${escape(curriculum.summary.join('. '))}.</p><p class="muted">${escape(score.meta.source)}${score.meta.licence ? ` · ${escape(score.meta.licence)}` : ''}</p>
    <h3>Sections</h3><ul class="plain">${score.sections.map(s => `<li><strong>${escape(s.name.replace(/(\d)$/, ' $1'))}</strong> · bars ${score.bars[s.from].number}–${score.bars[s.to].number}. ${escape(s.note ?? '')}</li>`).join('')}</ul>
    <h3>Chords</h3><p>${[...counts.entries()].map(([s, n]) => `${escape(prettyChord(s))} <span class="muted">×${n}</span>`).join(' · ')}</p>
    <h3>Guitar accompaniment</h3><p>${arrangement.capo ? `Capo at fret ${arrangement.capo}. ` : 'No capo. '}Bass note on beat 1, then index, middle and ring fingers together, letting the chord ring like the piano's left hand.${arrangement.review.length ? ` Simplified: ${escape(arrangement.review.join(' '))}` : ''}</p><div class="unit-shapes">${arrangement.shapes.map(s => chordBox(s, arrangement.capo)).join('')}</div>`;
}
const stepExercise = () => instrument === 'piano' ? exerciseFor(score, unit) : guitarExerciseFor(score, arrangement, unit);
function selectUnit(id: string): void {
  audio.stop(); player.pause(); stopWait(); resetLive(); endReveal(); endMoment(false); pending = undefined; manualBpm = undefined; spot = undefined; choice = undefined; offer = undefined; placeAt = undefined; placing = undefined;
  unit = units().find(u => u.id === id) ?? units()[0];
  exercise = stepExercise();
  progress.selected.unit = unit.id; progress.selected.instrument = instrument;
  const stages = instrument === 'piano' ? STAGES : GUITAR_STAGES;
  el('unit-stage').textContent = `${String(unit.stage + 1).padStart(2, '0')} · ${stages[unit.stage].toUpperCase()}`;
  el('unit-title').textContent = unit.title; el('unit-goal').textContent = unit.goal;
  const missing = unit.requires.filter(r => !ready({ ...unit, requires: [r] }, get)).map(r => title(r.id));
  el('unit-why').textContent = `${unit.why}${unit.difficulty?.reasons.length ? ` Watch for: ${unit.difficulty.reasons.join(', ')}.` : ''}${missing.length ? ` Suggested first: ${missing.slice(0, 3).join('; ')}.` : ''}`;
  el('unit-text').textContent = exercise.events.map(e => { const at = barAt(exercise, e.beat); return `Bar ${at.number}, beat ${at.beat}: ${e.notes.map(n => `${noteName(n.midi, exercise.keySig)}${n.finger ? ` finger ${n.finger}` : ''}${n.hand === 'L' ? ' left' : ' right'}`).join(', ')}`; }).join('. ');
  el('unit-shapes').innerHTML = exercise.shapes ? exercise.shapes.filter((s, i, all) => all.findIndex(x => x.name === s.name) === i).map(s => chordBox(s, exercise.capo)).join('') : '';
  applyInput();
  const backing = el<HTMLInputElement>('piece-backing');
  const other = instrument === 'guitar' ? ['section', 'performance'].includes(unit.kind) : unit.hands.length === 1 && unit.bars.length > 0 && unit.kind !== 'drill';
  backing.parentElement!.hidden = !other; backing.checked = other && instrument === 'guitar';
  el('piece-wait').hidden = !usingKeys() || unit.kind === 'listen';
  el('piece-backing-label').textContent = instrument === 'guitar' ? 'Play the melody with me (headphones)' : 'Play the other hand with me (headphones)';
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  el('piece-start').textContent = unit.kind === 'listen' ? 'Listen' : 'Start practice';
  el('piece-result').hidden = true;
  feedback = unit.sameAs ? `These notes are the same as "${title(unit.sameAs)}". Practise that step; this one follows it.` : unit.kind === 'listen' ? 'Listen first. Notice the sections and where the left hand leaps.' : 'Hear it once, then start with a one-bar count-in.';
  paintCourse(); paintToday(); persist();
}
function paintCourse(): void {
  const list = units(), stages = instrument === 'piano' ? STAGES : GUITAR_STAGES, now = Date.now();
  el('course-count').textContent = `· all ${list.filter(u => !u.sameAs).length} steps`;
  el('course-list').innerHTML = stages.map((name, i) => {
    const members = list.filter(u => u.stage === i);
    if (!members.length) return '';
    return `<div class="course-stage">${i + 1} · ${escape(name)}</div>${members.map(u => `<button class="course-lesson${u.sameAs ? ' covered' : ''}" data-unit="${escape(u.id)}" aria-current="${u.id === unit?.id}"><span>${escape(u.title)}${!u.sameAs && !ready(u, get) ? ' <span class="muted">· later</span>' : ''}${u.optional ? ' <span class="muted">· optional</span>' : ''}</span><span>${escape(stateLabel(u))}</span></button>`).join('')}`;
  }).join('');
  // The headline progress: a map of the piece from saved progress only.
  const map = pieceMap(score, list, get, now, instrument, unit?.id);
  el('map-count').textContent = `· ${map.headline}`;
  el('map-body').innerHTML = map.html;
}
/** Today's checklist for this course, fixed the first time it is shown each day so that it has an end. */
const courseKey = () => `${pack.id}${instrument === 'guitar' ? '#guitar' : ''}`;
function todayPlan(): PlanRow[] {
  const now = Date.now(), day = dayOf(now), saved = progress.today[courseKey()];
  if (saved?.day === day) return saved.rows.flatMap(r => { const u = units().find(x => x.id === r.id); return u ? [{ unit: u, reason: r.reason, slot: r.slot }] : []; });
  const rows = suggestToday({ ...curriculum, units: units() }, get, now);
  for (const [k, t] of Object.entries(progress.today)) if (t.day !== day) delete progress.today[k];
  progress.today[courseKey()] = { day, rows: rows.map(r => ({ id: r.unit.id, reason: r.reason, slot: r.slot })) };
  return rows;
}
const takesToday = (id: string) => { const day = dayOf(Date.now()); return progress.history.filter(h => h.piece === pack.id && h.unit === id && dayOf(h.date) === day); };
const isDone = (r: PlanRow) => rowDone(r, get(r.unit.id), takesToday(r.unit.id), Date.now());
/** Where a visit lands: the first unfinished row of today's plan. */
const landing = () => { const plan = todayPlan(); return (plan.find(r => !isDone(r)) ?? plan[0])?.unit.id ?? units()[0].id; };
/** The next step: today's first unfinished row, then fresh suggestions once the plan is done. Continuing is always allowed. */
function nextRow(): PlanRow | undefined {
  const fresh = suggestToday({ ...curriculum, units: units() }, get, Date.now());
  return [...todayPlan(), ...fresh].find(r => r.unit.id !== unit.id && !isDone(r)) ?? fresh.find(r => r.unit.id !== unit.id && r.slot === 'phrase') ?? fresh.find(r => r.unit.id !== unit.id);
}
const todayLog = () => week(progress.log, Date.now()).days[6];
function paintToday(): void {
  const plan = todayPlan(), done = plan.map(isDone), finished = plan.length > 0 && done.every(Boolean);
  el('today-list').innerHTML = plan.map((p, i) => `<li><button class="today-step${done[i] ? ' done' : ''}" data-unit="${escape(p.unit.id)}" aria-current="${p.unit.id === unit?.id}"><span>${done[i] ? '<span class="tick" aria-hidden="true">✓</span> ' : ''}${escape(p.unit.title)}</span><span class="muted">${done[i] ? 'done today' : escape(p.reason)} · ${escape(stateLabel(p.unit))}</span></button></li>`).join('') || '<li class="muted">Everything here is learned. Play the whole piece, or choose a review from the map.</li>';
  el('today-count').textContent = plan.length ? `· ${done.filter(Boolean).length} of ${plan.length} done` : '';
  const log = todayLog(), moved = session.notes.length ? ` ${session.notes.join('. ')}.` : '';
  el('today-done').hidden = !finished;
  el('today-done').textContent = finished ? `Today's plan is done: ${plan.length} step${plan.length > 1 ? 's' : ''} played, ${log.clean} clean take${log.clean === 1 ? '' : 's'} today.${moved} Keep going if you like; the next step is ready.` : '';
  el('piece-next').textContent = finished ? 'Keep going' : "Next in today's plan";
  paintRhythm(); paintJournal();
}
/** Clean work today against the learner's own aim, the last seven days and days played this week. Nothing resets. */
function paintRhythm(): void {
  const now = Date.now(), w = week(progress.log, now), today = w.days[6], aim = progress.dailyGoal;
  el('today-clean').textContent = `Clean takes today: ${today.clean} of ${aim}${today.clean >= aim ? ' · aim reached' : ''}`;
  el('today-meter').querySelector('i')!.style.width = `${Math.min(100, Math.round(today.clean / aim * 100))}%`;
  el<HTMLSelectElement>('piece-daily-goal').value = String(aim);
  const top = Math.max(aim, ...w.days.map(d => d.clean)), names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  el('today-week').innerHTML = `<span class="week-days">${w.days.map(d => {
    const name = names[new Date(`${d.day}T12:00:00`).getDay()], label = `${d.day}: ${d.clean} clean of ${d.takes} take${d.takes === 1 ? '' : 's'}`;
    return `<span class="week-day${d.takes ? ' played' : ''}" title="${label}" aria-label="${label}"><span class="week-bar"><i style="height:${d.clean ? Math.max(12, Math.round(d.clean / top * 100)) : 0}%"></i></span>${name}</span>`;
  }).join('')}</span><span class="muted">Days played this week: ${w.played}</span>`;
}
/** This piece's takes today, one line per step: takes, clean takes, best trusted score. */
function paintJournal(): void {
  const day = dayOf(Date.now()), rows = new Map<string, { takes: number; clean: number; best: number }>();
  for (const h of progress.history) if (h.piece === pack.id && dayOf(h.date) === day && units().some(u => u.id === h.unit)) {
    const r = rows.get(h.unit) ?? { takes: 0, clean: 0, best: -1 }; r.takes++; if (h.clean) r.clean++; if (h.trusted) r.best = Math.max(r.best, h.score); rows.set(h.unit, r);
  }
  el('piece-journal-list').innerHTML = rows.size ? [...rows].map(([id, r]) => `<div class="journal-entry"><span>${escape(title(id))}</span><span class="muted">${r.takes} take${r.takes > 1 ? 's' : ''} · ${r.clean} clean${r.best >= 0 ? ` · best ${Math.round(r.best * 100)}%` : ''}</span></div>`).join('') : '<p class="muted">No takes of this piece yet today.</p>';
}
function otherPart(): XEvent[] {
  if (!el<HTMLInputElement>('piece-backing').checked || audio.mode !== 'headphones') return [];
  if (instrument === 'guitar') return melodyBacking(score, unit.bars);
  const other = unit.hands[0] === 'L' ? 'R' : 'L';
  return fromBars(score, spot ? unit.bars.slice(spot.from, spot.to + 1) : unit.bars, [other], 'backing', 'backing').events;
}
/** carry: what the ladder just said about the answered take; it stays readable through the next count-in. */
async function start(kind: 'practice' | 'demo', carry = '', place?: number): Promise<void> {
  if (place !== undefined && (kind !== 'practice' || wait || spot || unit.kind === 'listen' || !canPlace(unit, current(), place))) return;
  if (place === undefined && el('piece-bpm').getAttribute('aria-invalid') === 'true') return;
  endReveal(); endMoment(false);
  // A finished take is kept until it is answered; hearing the demo meanwhile does not drop it.
  if (pending && kind === 'practice' && unit.kind !== 'listen') { feedback = 'First, how did the last take feel? Press ↑ (felt comfortable) or ↓ (needs more room); either starts the next take.'; el(defaultComfort() ? 'piece-comfortable' : 'piece-struggling').focus(); return; }
  player.pause(); el('piece-session').hidden = true; resetLive();
  if (kind === 'practice') { pending = undefined; choice = undefined; offer = undefined; el('piece-result').hidden = true; }
  if (unit.kind === 'listen') {
    feedback = 'Listen through. The notes fall onto the keys as they sound.';
    await audio.start(exercise, unit.id, goal(), 'demo');
    listenPlan = audio.plan;
    return;
  }
  // New short steps are demonstrated once before the count-in; long sections are not (use Hear it).
  const demonstrate = !spot && place === undefined && kind === 'practice' && !heard.has(unit.id) && !unit.sameAs && exercise.beats <= 24;
  const said = carry.trim();
  feedback = kind === 'demo' ? 'Listen to the notes and the spaces between them.' : place !== undefined ? 'Placement take: one bar to count in, then play it through once with the notes shown.' : said ? `${said}${/[.!?]$/.test(said) ? '' : '.'} One bar to count in.` : 'One bar to count in. Play as the notes reach the keys.';
  const { mine, auto } = kind === 'practice' ? reachSplit(exercise) : { mine: exercise, auto: [] };
  autoKeys = new Set(auto.flatMap(e => e.notes.map(n => noteKey(e.beat, n.midi))));
  if (kind === 'practice') placing = place;
  await audio.start(mine, spot ? spot.id : unit.id, place !== undefined ? rungBpm(unit, { ...current(), rung: place }) : bpmNow(), kind, spot || place !== undefined ? 0 : current().support, progress.offset, demonstrate, kind === 'practice' ? [...otherPart(), ...auto] : []);
  if (kind === 'demo' || demonstrate) heard.add(unit.id);
  if (!usingKeys() && audio.deviceKey && progress.calibrated && progress.calibrationKey && progress.calibrationKey !== audio.deviceKey) { progress.calibrated = false; el('piece-calibration-feedback').textContent = 'The audio path changed. Recalibrate to count tempo steps.'; persist(); }
}
/** The listen step counts as heard only after the whole piece has played to its end. */
let listenPlan: unknown;
audio.onDemoEnd = plan => {
  if (plan !== listenPlan) return;
  listenPlan = undefined;
  const id = progressId(pack.id, 'listen'), p = { ...(progress.units[id] ?? initialUnit()) };
  p.attempts++; p.last = Date.now(); progress.units[id] = p; persist(); paintToday(); paintCourse();
};
function showTake(take: PieceTake): void {
  URL.revokeObjectURL(wavUrl); URL.revokeObjectURL(traceUrl);
  const keys = Boolean(take.presses);
  traceUrl = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, piece: pack.id, unit: take.unit, instrument, bpm: take.bpm, support: take.support, offset: take.offset, result: take.result, presses: take.presses, interruption: take.interruption }, null, 2)], { type: 'application/json' }));
  // Keys takes have no audio: they replay on the piano voice with the lane instead.
  for (const id of ['piece-player', 'piece-loop', 'piece-download']) el(id).hidden = keys;
  el('piece-review-note').textContent = keys ? 'Your keys replay on the piano sound while the notes scroll. Takes stay in this page.' : 'Playback stops the microphone. Takes stay in this page.';
  el<HTMLAnchorElement>('piece-trace').href = traceUrl;
  el('piece-review').hidden = false; el('piece-take').textContent = `${take.exercise.title} · ${take.bpm} BPM`;
  if (keys) return;
  wavUrl = URL.createObjectURL(new Blob([audio.wav(take)!], { type: 'audio/wav' }));
  player.src = wavUrl; el<HTMLAnchorElement>('piece-download').href = wavUrl; el<HTMLAnchorElement>('piece-trace').href = traceUrl;
  el<HTMLAnchorElement>('piece-download').download = `${pack.id}-${take.unit.replace(/[^\w-]+/g, '_')}-${take.bpm}bpm.wav`;
  el('piece-review').hidden = false; el('piece-take').textContent = `${take.exercise.title} · ${take.bpm} BPM`;
}
/**
 * The end of a take: the result is rendered at once in its final form, then revealed. Lane notes turn to their verdict
 * colours in a quick sweep while the on-time share counts up, then the callouts appear. Any key or click skips to the
 * end. Untrusted takes, the calm look and reduced motion show the final state at once and are never celebrated.
 */
let reveal: { start: number; ms: number; first: number; last: number; final: number; celebrate: boolean } | undefined, revealBeat = 0;
const defaultComfort = () => { const r = pending?.take.result; return !r || !r.trusted || r.score >= 0.65; };
/** Personal bests for a step at this tempo and input; only trusted, timed takes count. Returns what the take beat. */
function recordBest(take: PieceTake, trusted: boolean, now: number): string[] {
  const result = take.result!, keys = Boolean(take.presses), id = bestKey(key(take.unit), take.bpm, keys);
  const compared = compareTake(progress.bests[id], { score: result.score, timing: result.timing, tight: tightness(result.events, !keys), support: take.support, date: now }, trusted, !keys);
  if (compared.after) { progress.bests[id] = compared.after; pruneBests(progress.bests); }
  return compared.wins;
}
audio.onTake = take => {
  const played = take.presses ? take.exercise.beats * 60 / take.bpm : take.samples.length / take.rate;
  session.takes++; session.seconds += played; take.calibrated = timed(take);
  const place = placing; placing = undefined;
  // The day log counts every take and its seconds; clean takes are added only when the answer confirms one.
  progress.log = logDay(progress.log, Date.now(), { takes: 1, seconds: played });
  showTake(take);
  const result = take.result;
  if (!result) return;
  endMoment(false);
  const keys = Boolean(take.presses), trusted = result.trusted && timed(take), now = Date.now();
  const wins: string[] = [], isSpot = Boolean(spot && take.unit === spot.id);
  if (isSpotId(take.unit) && !isSpot) return;
  if (!isSpot) {
    const entry = { date: now, piece: pack.id, unit: take.unit, bpm: take.bpm, score: result.score, trusted };
    pending = { take, before: current(), entry, place };
    if (place === undefined) {
      progress.history.push(entry);
      progress.history = progress.history.slice(-200);
      wins.push(...recordBest(take, trusted, now));
    }
  }
  const autoCount = take.presses ? autoKeys.size : 0, period = 60 / take.bpm;
  if (keys && trusted) { const k = keyStats(result.events); if (k.run > 1 || k.perfect) wins.push(`Longest on-time run: ${k.run} in a row${k.perfect ? ` · ${k.perfect} note${k.perfect > 1 ? 's' : ''} within ${Math.round(keyPerfect(period) * 1000)} ms of the beat` : ''}.`); }
  const placed = result.events.filter(e => e.mark === 'good').length;
  if (trusted && !wins.length) wins.push(`${placed} of ${result.events.length} attacks on time.`);
  const clean = result.events.every(e => e.mark === 'good' && e.notes.every(n => n.verdict === 'heard' || n.verdict === 'unchecked' || n.verdict === 'cannot-check' || n.verdict === 'unclear')) && !result.extras && !result.extraNotes.length;
  el('piece-wins').innerHTML = wins.map(w => `<li>${escape(w)}</li>`).join('');
  // The top line carries the take's own feedback; the question is asked once, above the answer buttons.
  el('piece-fix').textContent = '';
  feedback = (!result.trusted ? result.reason : clean ? result.feedback : `One thing to try: ${result.feedback}`)
    + (timed(take) ? '' : ' Timing is an estimate until you calibrate; tempo steps wait for calibration.')
    + (autoCount ? ` ${autoCount} note${autoCount > 1 ? 's' : ''} out of reach of the computer keys ${autoCount > 1 ? 'were' : 'was'} played for you and not graded.` : '');
  el('piece-comfort-ask').hidden = isSpot; el('piece-comfortable').parentElement!.hidden = isSpot;
  for (const [id, yes] of isSpot ? [] : [['piece-comfortable', defaultComfort()], ['piece-struggling', !defaultComfort()]] as const) {
    el(id).classList.toggle('primary', yes);
    el(id).innerHTML = `<kbd>${id === 'piece-comfortable' ? '↑' : '↓'}</kbd> ${id === 'piece-comfortable' ? 'Felt comfortable' : 'Needs more room'}${yes ? ' <span class="kbd-or">or <kbd>Space</kbd></span>' : ''}`;
  }
  if (!isSpot && place !== undefined) el('piece-comfort-ask').textContent = 'How did that feel? ↑ felt comfortable · ↓ needs more room. A clean, comfortable take places the step at this tempo; otherwise nothing is recorded and no take starts by itself.';
  else if (!isSpot) el('piece-comfort-ask').textContent = `How did that feel? ↑ felt comfortable · ↓ needs more room · Space answers "${defaultComfort() ? 'felt comfortable' : 'needs more room'}". Your answer, with the score, decides the next tempo and starts the next take.`;
  paintToday();
  const notes = result.events.flatMap(e => e.notes), count = (v: string) => notes.filter(n => n.verdict === v).length;
  const marks = result.events.map(e => e.mark), mark = (m: string) => marks.filter(x => x === m).length;
  const final = Math.round(result.timing * 100);
  el('piece-metrics').innerHTML = `<span><strong id="piece-count">${final}%</strong> on time${timed(take) ? '' : ' · estimate'}</span>${result.pitch === null ? `<span>${instrument === 'piano' ? 'Notes mostly unchecked' : 'Timing only'}</span>` : `<span><strong>${Math.round(result.pitch * 100)}%</strong> ${take.presses ? 'right keys' : 'notes heard right'}</span>`}${result.trusted ? '' : '<span>Not scored</span>'}`;
  el('piece-verdicts').innerHTML = [['heard', 'heard', count('heard')], ['wrong', 'wrong or missing', count('wrong') + count('not-heard')], ['unclear', 'unclear', count('unclear')], ['cannot', "can't check", count('cannot-check')], ['missed', 'attacks missed', mark('missed')], ['unsure', 'attacks unsure', mark('unsure')]]
    .filter(([, , n]) => Number(n) > 0).map(([cls, label, n]) => `<span class="verdict ${cls}">${n} ${n === 1 ? String(label).replace('attacks', 'attack') : label}</span>`).join('');
  el('piece-strip').innerHTML = timed(take) ? timingStrip(result, period, !keys) : '';
  const problems = result.events.filter(e => e.mark !== 'good' || e.notes.some(n => n.verdict === 'wrong' || n.verdict === 'not-heard')).slice(0, 8).map(e => {
    const at = barAt(take.exercise, e.beat), wrong = e.notes.filter(n => n.verdict === 'wrong' || n.verdict === 'not-heard').map(n => n.verdict === 'wrong' ? `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'played' : 'sounded'} as ${noteName(n.heardAs!, take.exercise.keySig)}` : `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'missing' : 'not heard'}`);
    return `bar ${at.number} beat ${at.beat}: ${e.mark}${e.offset !== undefined && e.mark !== 'good' ? ` (${e.offset > 0 ? '+' : ''}${Math.round(e.offset * 1000)} ms)` : ''}${wrong.length ? `, ${wrong.join(', ')}` : ''}`;
  });
  el('piece-details').textContent = `${problems.join(' · ')}${result.extraNotes.length ? ` · possible extra note${result.extraNotes.length > 1 ? 's' : ''} near ${[...new Set(result.extraNotes.map(x => noteName(x.midi, take.exercise.keySig)))].join(', ')}` : ''}${result.trusted ? '' : ` · ${result.reason}`}${Math.abs(result.tuning) >= 8 ? ` · your piano reads about ${Math.round(result.tuning)} cents from A440; checks allowed for it` : ''}`;
  const hint = !isSpot && spotOffered(instrument, unit) ? pickSpot(take.exercise, result, timed(take)) : undefined;
  el('piece-spot-hint').hidden = !hint || hint === 'choose';
  if (hint && hint !== 'choose') el('piece-spot-hint').textContent = `Practise ${barsText(problemNumbers(unit, hint))}: that is where this take's confirmed problems are.`;
  if (isSpot) { spot!.clean = trusted && clean ? spot!.clean + 1 : 0; choice = 'pass'; paintChoices(); }
  el('piece-result').hidden = false; persist();
  const beats = result.events.map(e => e.beat), first = Math.min(...beats, 0), last = Math.max(...beats, 0);
  reveal = { start: performance.now(), ms: Math.min(1200, 400 + 45 * result.events.length), first, last, final, celebrate: trusted && result.score >= 0.9 };
  el('piece-result').classList.add('revealing');
  if (!trusted || !lively()) endReveal(); else stepReveal();
};
/** The per-attack timing strip: early above the line, late below, the on-time band shaded. Unsure attacks stay neutral. */
function timingStrip(result: PieceGrade, period: number, approx: boolean): string {
  const events = result.events, n = events.length; if (!n) return '';
  const reach = keyReach(period), band = keyWindow(period), W = 520, H = 60, mid = H / 2, y = (o: number) => mid + Math.max(-1, Math.min(1, o / reach)) * (mid - 6);
  const x = (i: number) => n === 1 ? W / 2 : 10 + i * (W - 20) / (n - 1);
  const dots = events.map((e, i) => e.offset !== undefined
    ? `<circle data-beat="${e.beat}" cx="${x(i).toFixed(1)}" cy="${y(e.offset).toFixed(1)}" r="3.4" class="dot ${e.mark === 'good' ? 'good' : 'off'}"/>`
    : `<circle data-beat="${e.beat}" cx="${x(i).toFixed(1)}" cy="${mid}" r="3" class="dot ${e.mark === 'unsure' ? 'unsure' : 'missed'}"/>`).join('');
  const summary = timingSummary(events, approx);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timing of each attack. ${escape(summary)}"><rect x="0" y="${(mid - (band / reach) * (mid - 6)).toFixed(1)}" width="${W}" height="${(2 * (band / reach) * (mid - 6)).toFixed(1)}" class="band"/><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="beat"/>${dots}</svg><div class="strip-legend"><span>early ↑ · late ↓</span><span>${escape(summary)}</span></div>`;
}
function stepReveal(): void {
  if (!reveal) return;
  const t = (performance.now() - reveal.start) / reveal.ms;
  if (t >= 1) { endReveal(); return; }
  revealBeat = reveal.first + (reveal.last - reveal.first + 0.001) * t;
  const count = document.getElementById('piece-count'), shownCount = `${Math.round(reveal.final * (1 - (1 - t) * (1 - t)))}%`;
  if (count && count.textContent !== shownCount) count.textContent = shownCount;
  const hidden = shown.get('strip-beat'), at = String(Math.floor(revealBeat * 4));
  if (hidden !== at) { shown.set('strip-beat', at); for (const c of el('piece-strip').querySelectorAll<SVGElement>('[data-beat]')) c.classList.toggle('later', Number(c.dataset.beat) > revealBeat); }
}
/** Jumps a reveal to its end state: final number, every dot, the callouts, and the small spark for a clean take. */
function endReveal(): void {
  const r = reveal; if (!r) return;
  reveal = undefined; if (choice) choiceAt = performance.now();
  shown.delete('strip-beat');
  const count = document.getElementById('piece-count'); if (count) count.textContent = `${r.final}%`;
  for (const c of el('piece-strip').querySelectorAll('.later')) c.classList.remove('later');
  el('piece-result').classList.remove('revealing');
  if (r.celebrate && lively()) celebrate('small');
}
/** A milestone moment after an answer, then (unless the step is now learned or reviewed) the next take. */
let after: { until: number; next: boolean; carry: string } | undefined;
function endMoment(startNext: boolean): void {
  const a = after; if (!a) return;
  after = undefined; clearMoment();
  if (startNext && a.next) void start('practice', a.carry);
}
audio.onCalibration = result => {
  el('piece-calibration-feedback').textContent = result.message; feedback = result.message;
  if (result.ok) { progress.offset = result.offset; progress.calibrated = true; progress.calibrationKey = audio.deviceKey; el<HTMLInputElement>('piece-offset').value = String(Math.round(result.offset * 1000)); persist(); }
};
/** A placement take's answer: placed moves the step (and its one-hand steps) and records the take as clean; otherwise nothing is recorded. */
function placeTake(u: Unit, done: NonNullable<typeof pending>, comfortable: boolean): AdvanceEvent {
  const now = Date.now(), t = done.place!, result = done.take.result!, r = placeUnit(u, done.before, t, result, comfortable, now, timed(done.take));
  placeAt = undefined; feedback = r.message;
  if (r.placed) {
    done.entry.clean = true;
    progress.history.push(done.entry); progress.history = progress.history.slice(-200);
    recordBest(done.take, result.trusted && timed(done.take), now);
    progress.log = logDay(progress.log, now, { clean: 1 });
    progress.units[key(u.id)] = r.progress;
    for (const [id, p] of placeHands(units(), u, u.rungs[t], get)) progress.units[key(id)] = p;
    session.notes.push(`${u.title}: placed at ${done.take.bpm} BPM`);
  }
  manualBpm = undefined; el<HTMLInputElement>('piece-bpm').value = String(bpmNow()); paintCourse(); paintToday(); persist();
  return r.event;
}
function nextTake(comfortable: boolean): AdvanceEvent | undefined {
  const done = pending; if (!done?.take.result) return;
  pending = undefined; el('piece-result').hidden = true;
  const u = units().find(x => x.id === done.take.unit); if (!u) return;
  if (done.place !== undefined) return placeTake(u, done, comfortable);
  if (done.take.bpm !== rungBpm(u, done.before)) { done.entry.clean = false; persist(); paintToday(); feedback = `Free tempo: tempo steps count at ${rungBpm(u, done.before)} BPM, the tempo you are on.`; return; }
  const change = advanceUnit(u, done.before, done.take.result, comfortable, Date.now(), timed(done.take));
  // Clean is the ladder's own judgement: trusted, calibrated, 90% or better and comfortable.
  done.entry.clean = change.event.clean;
  if (change.event.clean) progress.log = logDay(progress.log, Date.now(), { clean: 1 });
  progress.units[key(u.id)] = change.progress; feedback = change.message;
  if (change.event.overnight) session.notes.push(`${u.title}: stuck overnight`);
  if (change.progress.learned && !done.before.learned) session.notes.push(`${u.title}: learned`);
  else if (change.progress.certified.length > done.before.certified.length) session.notes.push(`${u.title}: certified at ${Math.round(change.progress.certified[change.progress.certified.length - 1] * 100)}%`);
  manualBpm = undefined; el<HTMLInputElement>('piece-bpm').value = String(bpmNow()); paintCourse(); paintToday(); persist();
  return change.event;
}
/**
 * The learner's own comfort answer, then the next take. Confirmed progress gets a moment scaled by how rare it is:
 * learned, a review passed and a clean first take on a new day are the biggest; a step up or a certification is
 * medium; a fade step is small; holding or stepping down gets none. Learned and review leave the next choice to the learner.
 */
function answer(comfortable: boolean): void {
  if (!pending || active() || after) return;
  endReveal();
  const taken = pending?.take, place = pending?.place, prior = feedback, before = current(), event = nextTake(comfortable), message = feedback, said = message !== prior ? message : '';
  (document.activeElement as HTMLElement | null)?.blur();
  const pct = (f: number) => `${Math.round(f * 100)}%`, last = current().certified[current().certified.length - 1];
  const moment = !event ? undefined
    : event.kind === 'learned' ? { title: event.overnight ? 'Learned. It stuck overnight.' : 'Learned', ms: 3500, size: 'big' as const, next: false }
      : event.kind === 'review' ? { title: 'It stuck: review passed', ms: 3500, size: 'big' as const, next: false }
        : event.kind === 'placed' ? { title: `Placed at ${taken!.bpm} BPM`, ms: 1800, size: 'medium' as const, next: false }
        : event.overnight ? { title: 'It stuck overnight', ms: 3500, size: 'big' as const, next: true }
          : event.kind === 'certified' ? { title: `Certified at ${pct(last ?? unit.rungs[Math.min(before.rung, unit.rungs.length - 1)])}`, ms: 2200, size: 'medium' as const, next: true }
            : event.kind === 'climb' ? { title: 'Up a step', ms: 1600, size: 'medium' as const, next: true }
              : event.kind === 'fade' ? { title: 'Less help next take', ms: 1200, size: 'small' as const, next: true } : undefined;
  if (!moment) {
    if (place !== undefined) return;
    const result = taken?.result, pick = result && (!comfortable || (result.trusted && result.score < 0.65)) && spotOffered(instrument, unit) ? pickSpot(taken.exercise, result, timed(taken)) : undefined;
    if (pick) { choice = 'offer'; offer = { pick, bpm: taken.bpm, carry: said }; paintChoices(); return; }
    void start('practice', said); return;
  }
  const placed = event!.kind === 'placed', sub = placed ? message.replace(/^Placed at [^.]*\.\s*/, '') : event!.overnight && event!.kind !== 'learned' ? `Clean on today's first take. ${message}` : message;
  feedback = placed ? message : `${moment.title}. ${sub}`;
  if (!lively()) { if (moment.next) void start('practice', feedback); return; }
  showMoment(moment.title, sub, moment.ms, moment.size === 'big'); celebrate(moment.size);
  after = { until: performance.now() + moment.ms, next: moment.next, carry: feedback };
}

const problemNumbers = (u: Unit, p: { from: number; to: number; lead: boolean }) => u.bars.slice(p.from + (p.lead ? 1 : 0), p.to + 1).map(i => score.bars[i].number);
const barNumber = (u: Unit, position: number) => score.bars[u.bars[position]].number;
el('piece-details').insertAdjacentHTML('afterend', '<p id="piece-spot-hint" class="muted spot-hint" hidden></p>');
el('piece-result').insertAdjacentHTML('afterend', '<div id="piece-choices" class="spot-choices" hidden><p id="piece-choices-ask" class="comfort-ask"></p><div id="piece-choices-actions" class="comfort-actions"></div></div>');
el('piece-feedback').insertAdjacentHTML('afterend', '<div id="piece-spot-banner" class="spot-banner" hidden><span id="piece-spot-text"></span> <button id="piece-spot-back" data-choice="back">Back to the step</button></div>');
/** The choices after a take: practise a trouble spot or carry on (offer), or what to do after a spot pass. */
function paintChoices(): void {
  const actions = el('piece-choices-actions'), button = (what: string, label: string, primary: boolean, keyName = '', off = false) =>
    `<button data-choice="${what}"${keyName ? ` data-key="${keyName}"` : ''}${primary ? ' class="primary"' : ''}${off ? ' data-off="1"' : ''}>${label}</button>`;
  const space = '<kbd>Space</kbd> ', up = '<kbd>↑</kbd> ', down = '<kbd>↓</kbd> ';
  if (choice === 'offer' && offer) {
    const { pick, bpm } = offer, slower = slowerBpm(unit, bpm);
    const text = pick === 'choose' ? '' : barsText(problemNumbers(unit, pick));
    el('piece-choices-ask').textContent = pick === 'choose' ? 'Too much of that take was unclear to pick the bars. Choose the bars to practise.' : 'Practise the trouble spot, or carry on.';
    const options = (at: number) => unit.bars.map((_, i) => `<option value="${i}"${i === at ? ' selected' : ''}>${barNumber(unit, i)}</option>`).join('');
    actions.innerHTML = (pick === 'choose' ? `<label class="inline-check">From bar <select id="piece-spot-from">${options(0)}</select></label> <label class="inline-check">to bar <select id="piece-spot-to">${options(1)}</select></label> ` : '')
      + button('spot', `${space}${pick === 'choose' ? 'Practise these bars' : `Practise ${text}`} at ${slower} BPM`, true, 'Space')
      + (usingKeys() ? button('wait', `${down}Wait for me${pick === 'choose' ? '' : ` on ${text}`}`, false, 'ArrowDown') : '')
      + (pick !== 'choose' && unit.hands.length === 2 ? button('hand', `${pick.hand === 'L' ? 'Left' : 'Right'} hand only, ${text}`, false) : '')
      + button('next', `${up}Next take as usual`, false, 'ArrowUp');
  } else if (choice === 'pass' && spot) {
    const slower = slowerBpm(spot.parent, spot.bpm), canSlow = slower < spot.bpm, first = barNumber(spot.parent, 0), last = barNumber(spot.parent, spot.parent.bars.length - 1), twice = spot.clean >= 2;
    el('piece-choices-ask').textContent = twice ? 'Two clean passes in a row. Put them back in context.' : spot.clean === 1 ? 'Clean pass. One more in a row, then back to the step.' : 'Again until it comes out clean, or slow it down.';
    const slowBtn = button('slower', `${down}Slower (${slower} BPM)`, false, 'ArrowDown', !canSlow);
    actions.innerHTML = twice ? button('back', `${space}Back to ${first === last ? `bar ${first}` : `bars ${first}–${last}`}`, true, 'Space') + button('again', `${up}Again`, false, 'ArrowUp') + slowBtn
      : button('again', `${space}Again`, true, 'Space') + slowBtn + button('back', `${up}Back to the step`, false, 'ArrowUp');
  }
  shown.delete('choices:disabled');
}
function enterSpot(pick: { from: number; to: number; lead: boolean }, hands: Hand[], bpm: number): void {
  spot = { parent: unit, from: pick.from, to: pick.to, lead: pick.lead, hands, bpm, exercise: spotExercise(score, unit, pick.from, pick.to, hands), id: spotId(unit.id, pick.from, pick.to, hands), clean: 0 };
  exercise = spot.exercise; manualBpm = undefined; choice = undefined; offer = undefined;
  el<HTMLInputElement>('piece-bpm').value = String(bpm); el<HTMLInputElement>('piece-bpm').removeAttribute('aria-invalid'); applyInput();
}
function leaveSpot(): void {
  spot = undefined; choice = undefined; offer = undefined; manualBpm = undefined;
  exercise = stepExercise(); el<HTMLInputElement>('piece-bpm').value = String(bpmNow()); el<HTMLInputElement>('piece-bpm').removeAttribute('aria-invalid'); applyInput();
}
function choose(what: string): void {
  if (active()) return;
  if (what === 'back') { if (!spot) return; leaveSpot(); void start('practice'); return; }
  if (what === 'next') { if (choice !== 'offer' || !offer) return; const carry = offer.carry; choice = undefined; offer = undefined; void start('practice', carry); return; }
  if (what === 'again' || what === 'slower') {
    if (!spot) return;
    if (what === 'slower') { const slower = slowerBpm(spot.parent, spot.bpm); if (slower >= spot.bpm) return; spot.bpm = slower; spot.clean = 0; el<HTMLInputElement>('piece-bpm').value = String(slower); }
    void start('practice'); return;
  }
  if (choice !== 'offer' || !offer) return;
  const { pick, bpm } = offer, slower = slowerBpm(unit, bpm);
  const at = pick === 'choose' ? [Number(el<HTMLSelectElement>('piece-spot-from').value), Number(el<HTMLSelectElement>('piece-spot-to').value)].sort((a, b) => a - b) : [];
  const where = pick === 'choose' ? { from: at[0], to: at[1], lead: false } : pick;
  if (what === 'spot') { enterSpot(where, unit.hands, slower); void start('practice'); }
  else if (what === 'wait') { enterSpot(where, unit.hands, slower); startWait(); }
  else if (what === 'hand' && pick !== 'choose') { enterSpot(where, [pick.hand], slower); void start('practice'); }
}
for (const id of ['piece-choices', 'piece-spot-banner']) el(id).onclick = event => { const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-choice]'); if (b && !b.disabled) choose(b.dataset.choice!); };
el<HTMLSelectElement>('piece-select').onchange = () => { progress.selected.unit = ''; loadPack(el<HTMLSelectElement>('piece-select').value); };
for (const which of ['piano', 'guitar'] as const) el(`inst-${which}`).onclick = () => {
  if (active() || instrument === which) return;
  instrument = which; progress.selected.unit = ''; el('inst-piano').setAttribute('aria-pressed', String(which === 'piano')); el('inst-guitar').setAttribute('aria-pressed', String(which === 'guitar'));
  selectUnit(landing());
};
el('piece-start').onclick = () => { void start('practice'); };
el('piece-place').onclick = () => { if (placeable() && !active()) void start('practice', '', placeTarget()); };
el('piece-pips').onclick = event => {
  const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-rung]');
  if (b && !active() && placeable()) placeAt = Number(b.dataset.rung);
};
for (const keys of [false, true]) el(keys ? 'input-keys' : 'input-mic').onclick = () => {
  if (active() || inputPrefs.keys === keys) return;
  inputPrefs.keys = keys; saveInput(); if (spot) leaveSpot(); choice = undefined; offer = undefined; applyInput();
  feedback = keys ? 'Play on the computer keyboard or a MIDI keyboard. Notes are graded from the keys you press; the microphone stays off.' : 'Back to listening through the microphone.';
};
el<HTMLInputElement>('piece-midi-sound').checked = inputPrefs.midiSound;
function paintEffects(): void {
  const select = el<HTMLSelectElement>('piece-effects');
  select.value = lively() ? 'lively' : 'calm'; select.disabled = reduced.matches;
  el('piece-effects-help').textContent = reduced.matches ? 'Calm, because this device asks for reduced motion.' : 'Lively adds a short flash and sparks for on-time keys. Calm changes colours only.';
}
el<HTMLSelectElement>('piece-effects').onchange = () => { inputPrefs.calm = el<HTMLSelectElement>('piece-effects').value === 'calm'; saveInput(); paintEffects(); };
reduced.addEventListener?.('change', paintEffects);
paintEffects();
// Start the audio clock and voice on the first gesture, so the first note and the first take do not wait for them.
const warm = () => { window.removeEventListener('pointerdown', warm, true); window.removeEventListener('keydown', warm, true); void audio.prepare().catch(() => {}); };
window.addEventListener('pointerdown', warm, true); window.addEventListener('keydown', warm, true);
el<HTMLSelectElement>('piece-piano').value = inputPrefs.piano;
el<HTMLSelectElement>('piece-piano').onchange = () => { inputPrefs.piano = el<HTMLSelectElement>('piece-piano').value === 'simple' ? 'simple' : 'grand'; audio.piano = inputPrefs.piano; saveInput(); };
el<HTMLInputElement>('piece-midi-sound').onchange = () => { inputPrefs.midiSound = el<HTMLInputElement>('piece-midi-sound').checked; saveInput(); };
el('piece-demo').onclick = () => { void start('demo'); };
el('piece-listen').onclick = () => { const listen = curriculum.units.find(u => u.kind === 'listen')!; audio.stop(); void audio.start(exerciseFor(score, listen), 'listen', goal(), 'demo').then(() => { listenPlan = audio.plan; }); feedback = repeats(score) ? 'The whole piece, with the repeats.' : 'The whole piece.'; };
el('piece-next').onclick = () => { const next = nextRow(); if (next) selectUnit(next.unit.id); };
el('map-body').onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]'); if (b && !active()) selectUnit(b.dataset.unit!); };
el<HTMLSelectElement>('piece-daily-goal').onchange = () => { const v = Number(el<HTMLSelectElement>('piece-daily-goal').value); if (Number.isFinite(v) && v > 0) { progress.dailyGoal = v; persist(); paintRhythm(); } };
el('piece-wait').onclick = startWait;
el('piece-stop').onclick = () => { stopWait(); audio.stop(); player.pause(); feedback = 'Stopped. Your last completed take is still available below.'; };
player.onplay = () => audio.stop();
el('piece-comfortable').onclick = () => answer(true);
el('piece-struggling').onclick = () => answer(false);
const hear = (take?: PieceTake) => {
  if (!take) return;
  showTake(take);
  if (take.presses) { player.pause(); feedback = 'Your take, replayed. Watch where the notes and your keys part company.'; void audio.replayKeys(take); }
  else player.play().catch(e => audio.error = String(e));
};
el('piece-latest').onclick = () => hear(audio.take);
el('piece-previous').onclick = () => hear(audio.previous);
el('piece-loop').onclick = () => { player.pause(); feedback = 'Your take is looping. Play along freely; nothing is graded.'; void audio.playTake(audio.take, true); };
el('course-list').onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]'); if (b && !active()) selectUnit(b.dataset.unit!); };
el('today-list').onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]'); if (b && !active()) selectUnit(b.dataset.unit!); };
el<HTMLInputElement>('piece-bpm').oninput = () => {
  const input = el<HTMLInputElement>('piece-bpm'), value = input.valueAsNumber;
  if (active()) { input.value = String(bpmNow()); return; }
  if (!Number.isFinite(value) || value < 20 || value > 240) { input.setAttribute('aria-invalid', 'true'); return; }
  input.removeAttribute('aria-invalid');
  if (spot) { spot.bpm = Math.round(value); return; }
  manualBpm = Math.round(value) === rungBpm(unit, current()) ? undefined : Math.round(value);
};
el<HTMLInputElement>('piece-goal').onchange = () => {
  const value = Math.round(el<HTMLInputElement>('piece-goal').valueAsNumber);
  if (!Number.isFinite(value) || value < 30 || value > 200 || active()) { el<HTMLInputElement>('piece-goal').value = String(goal()); return; }
  progress.goals[pack.id] = value; curriculum = buildCurriculum(score, value); gUnits = guitarUnits(score, arrangement, value); selectUnit(unit.id);
};
el<HTMLSelectElement>('piece-output').onchange = () => { audio.stop(); audio.mode = el<HTMLSelectElement>('piece-output').value === 'speakers' ? 'speakers' : 'headphones'; progress.calibrated = false; persist(); feedback = 'Input processing changed. Recalibrate before tempo steps count.'; };
el<HTMLInputElement>('piece-volume').oninput = () => { const v = el<HTMLInputElement>('piece-volume').valueAsNumber; audio.setVolume(v); player.volume = v; el('piece-volume-value').textContent = `${Math.round(v * 100)}%`; };
player.volume = 0.5;
el<HTMLInputElement>('piece-click').onchange = () => { audio.click = el<HTMLInputElement>('piece-click').checked; };
el<HTMLInputElement>('piece-check-pitch').checked = progress.checkPitch;
el<HTMLInputElement>('piece-check-pitch').onchange = () => { progress.checkPitch = audio.checkPitch = el<HTMLInputElement>('piece-check-pitch').checked; persist(); };
el<HTMLInputElement>('piece-offset').value = String(Math.round(progress.offset * 1000));
el('piece-use-offset').onclick = () => {
  if (active()) return;
  const v = el<HTMLInputElement>('piece-offset').valueAsNumber;
  if (!Number.isFinite(v) || v < -300 || v > 500) { el('piece-calibration-feedback').textContent = 'Enter an offset between -300 and 500 ms.'; return; }
  progress.offset = v / 1000; progress.calibrated = true; progress.calibrationKey = audio.deviceKey; persist(); el('piece-calibration-feedback').textContent = `Using your manual ${v} ms offset.`;
};
el('piece-calibrate').onclick = () => { player.pause(); endReveal(); endMoment(false); pending = undefined; progress.calibrated = false; persist(); feedback = 'Keep the instrument quiet. Let the microphone hear the eight clicks.'; void audio.start(exercise, 'calibration', 60, 'calibration'); };
el<HTMLInputElement>('piece-file').onchange = async () => {
  const file = el<HTMLInputElement>('piece-file').files?.[0];
  if (!file) return;
  if (file.size > 300000) { el('piece-file-report').textContent = 'That file is too large for a piece file.'; return; }
  const text = await file.text(), result = compile(text), report = (d: Diagnostic) => `<li>line ${d.line}: ${escape(d.message)}</li>`;
  if (!result.score) { el('piece-file-report').innerHTML = `<p>It did not compile:</p><ul>${result.diagnostics.filter(d => d.level === 'error').slice(0, 12).map(report).join('')}</ul>`; return; }
  const id = `mine:${file.name.replace(/\.piece\.txt$|\.txt$/, '').replace(/[^\w-]+/g, '-').slice(0, 60)}`;
  try { localStorage.setItem(MINE, JSON.stringify([...readMine().filter(m => m.id !== id), { id, text }])); } catch { el('piece-file-report').textContent = 'Browser storage is full or unavailable.'; return; }
  el('piece-file-report').innerHTML = `<p>Added "${escape(result.score.meta.title)}": ${result.score.bars.length} bars, ${result.score.notes.length} notes.</p>${result.diagnostics.length ? `<p>Please check:</p><ul>${result.diagnostics.slice(0, 12).map(report).join('')}</ul>` : ''}`;
  progress.selected.unit = ''; loadPack(id); paintLocal();
};
let accountPieces: { paint: () => void } | undefined;
function paintLocal(): void {
  accountPieces?.paint();
  const mine = readMine();
  el('piece-local-list').innerHTML = mine.length ? `<p>Your pieces in this browser:</p>${mine.map(m => `<div class="journal-entry"><span>${escape(compile(m.text).score?.meta.title ?? m.id)}</span><button class="text-button" data-remove="${escape(m.id)}">Remove</button></div>`).join('')}` : '';
}
accountPieces = mountPieceAccount({
  container: el('piece-account-list'), readMine, titleOf: text => compile(text).score?.meta.title ?? 'Untitled piece', refresh: () => paintLocal(),
  addMine: m => {
    const mine = readMine();
    if (mine.length >= 30 && !mine.some(x => x.id === m.id)) return false;
    try { localStorage.setItem(MINE, JSON.stringify([...mine.filter(x => x.id !== m.id), m])); return true; } catch { return false; }
  },
});
el('piece-local-list').onclick = event => {
  const b = (event.target as HTMLElement).closest<HTMLElement>('[data-remove]'); if (!b) return;
  localStorage.setItem(MINE, JSON.stringify(readMine().filter(m => m.id !== b.dataset.remove))); paintLocal(); if (pack.id === b.dataset.remove) loadPack(packs()[0].id);
};
el('piece-finish').onclick = () => {
  audio.stop(); player.pause();
  const next = suggestToday({ ...curriculum, units: units() }, get, Date.now()).find(p => p.slot !== 'warm' && p.slot !== 'listen'), log = todayLog();
  el('piece-session').hidden = false;
  el('piece-session').textContent = `Today: ${log.clean} clean take${log.clean === 1 ? '' : 's'} of ${log.takes}. ${session.notes.length ? session.notes.join('. ') + '. ' : 'Steady, deliberate practice counts even when nothing moved up today. '}${next ? `Next time: ${next.unit.title}.` : ''}`;
};
let resetArmed = false;
el('piece-reset').onclick = () => {
  if (!resetArmed) { resetArmed = true; el('piece-reset').textContent = 'Click again to clear this piece’s progress'; return; }
  resetArmed = false; el('piece-reset').textContent = 'Reset progress for this piece';
  for (const id of Object.keys(progress.units)) if (id.startsWith(`${pack.id}|`) || id.startsWith(`${pack.id}#guitar|`)) delete progress.units[id];
  delete progress.today[pack.id]; delete progress.today[`${pack.id}#guitar`];
  persist(); selectUnit(unit.id); feedback = 'Progress for this piece cleared. Calibration is kept.';
};
navigator.mediaDevices?.addEventListener('devicechange', () => { progress.calibrated = false; persist(); el('piece-calibration-feedback').textContent = 'Audio devices changed. Recalibrate timing.'; });
/**
 * Before anything else sees a key: a reveal or a milestone moment is skipped by any key or click (the skipping key
 * does nothing more), and a waiting take is answered by ArrowUp (felt comfortable), ArrowDown (needs more room) or
 * Space (the highlighted answer). No piano key ever answers. While an answer waits, the arrows never scroll the page.
 */
const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
const answerKeys = new Set(['Space', 'ArrowUp', 'ArrowDown']);
window.addEventListener('pointerdown', event => { endReveal(); endMoment(!(event.target instanceof Element && event.target.closest('button, a, input, select, summary, label'))); }, true);
window.addEventListener('keydown', event => {
  if (event.repeat && (reveal || after)) { swallow(event); return; }
  if (reveal) { endReveal(); if (answerKeys.has(event.code)) swallow(event); return; }
  if (after) { endMoment(event.code !== 'Escape'); if (event.code !== 'Escape') swallow(event); return; }
  const target = event.target instanceof Element ? event.target : null;
  if (choice && !el('piece-choices').hidden && !active() && !event.ctrlKey && !event.metaKey && !event.altKey && !target?.closest('input, select, textarea, [contenteditable=true]')) {
    if (answerKeys.has(event.code) && (event.repeat || performance.now() - choiceAt < 350)) { swallow(event); return; }
    if (event.repeat) { if (event.code.startsWith('Arrow')) event.preventDefault(); return; }
    if (event.code === 'Space' && target?.closest('button, a, summary, audio')) return;
    if (!answerKeys.has(event.code)) return;
    swallow(event);
    el('piece-choices-actions').querySelector<HTMLButtonElement>(`button[data-key="${event.code}"]:not(:disabled)`)?.click();
    return;
  }
  if (!pending || el('piece-result').hidden || active() || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, select, textarea, [contenteditable=true]')) return;
  if (event.repeat) { if (event.code.startsWith('Arrow')) event.preventDefault(); return; }
  if (event.code === 'Space' && target?.closest('button, a, summary, audio')) return;
  if (!answerKeys.has(event.code)) return;
  swallow(event);
  answer(event.code === 'Space' ? defaultComfort() : event.code === 'ArrowUp');
}, true);
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { stopWait('Stopped.'); audio.stop(); player.pause(); return; }
  // Space starts a take from anywhere except a control that uses Space itself.
  const target = event.target instanceof Element ? event.target : null;
  if (event.code === 'Space' && !event.repeat && !target?.closest('button, input, select, textarea, a, summary, audio, [contenteditable=true]') && !active() && !choice) {
    event.preventDefault();
    void start('practice');
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && active()) { audio.stop(); player.pause(); feedback = 'Practice paused while the page was hidden.'; } });
const timer = window.setInterval(() => audio.tick(), 10);
window.addEventListener('pagehide', () => { clearInterval(timer); audio.dispose(); player.pause(); URL.revokeObjectURL(wavUrl); URL.revokeObjectURL(traceUrl); });

// The frame loop writes text and states only when they change, and finds each element once.
const elements = new Map<string, HTMLElement>(), shown = new Map<string, string>();
const node = (id: string) => { let e = elements.get(id); if (!e) { e = el(id); elements.set(id, e); } return e; };
const text = (id: string, value: string) => { if (shown.get(id) !== value) { shown.set(id, value); node(id).textContent = value; } };
const disable = (id: string, value: boolean) => { const key = `${id}:disabled`; if (shown.get(key) !== String(value)) { shown.set(key, String(value)); (node(id) as HTMLButtonElement).disabled = value; } };
let frameNow = 0, laneSignature = '', laneExercise: Exercise | undefined;
function paint(): void {
  requestAnimationFrame(paint);
  if (!exercise) return;
  const plan = audio.plan, now = audio.now, running = active(), p = spot ? { ...current(), support: 0 as const } : current();
  frameNow = audio.laneNow;
  disable('piece-stop', !running);
  for (const id of ['piece-start', 'piece-demo', 'piece-calibrate', 'piece-output', 'piece-use-offset', 'piece-next', 'piece-listen', 'piece-select', 'inst-piano', 'inst-guitar', 'piece-goal', 'input-mic', 'input-keys', 'piece-wait', 'piece-bpm']) disable(id, running);
  const choiceKey = `${choice !== undefined}${running}`;
  if (shown.get('choices:disabled') !== choiceKey) {
    shown.set('choices:disabled', choiceKey); { const was = el('piece-choices').hidden; el('piece-choices').hidden = choice === undefined; if (was && !el('piece-choices').hidden) choiceAt = performance.now(); }
    for (const b of el('piece-choices').querySelectorAll<HTMLButtonElement>('button')) b.disabled = running || b.dataset.off === '1';
  }
  disable('piece-spot-back', running);
  if (spot) {
    const lead = spot.lead ? barNumber(spot.parent, spot.from) : 0, only = spot.hands.length === 1 ? (spot.hands[0] === 'R' ? ' · right hand only' : ' · left hand only') : '';
    text('piece-spot-text', `Practising ${barsText(problemNumbers(spot.parent, spot))}${spot.lead ? `, with bar ${lead} to lead in` : ''}, at ${spot.bpm} BPM${only}. Spot practice does not count for tempo steps.`);
  }
  if (shown.get('spot:banner') !== String(Boolean(spot))) { shown.set('spot:banner', String(Boolean(spot))); el('piece-spot-banner').hidden = !spot; }
  disable('piece-comfortable', !pending || running); disable('piece-struggling', !pending || running);
  for (const id of ['piece-latest', 'piece-loop']) disable(id, !audio.take || Boolean(plan || audio.busy));
  disable('piece-previous', !audio.previous || Boolean(plan || audio.busy));
  text('piece-piano-status', { '': '', loading: 'Loading piano…', failed: 'Grand piano could not load; using the simple piano.' }[audio.pianoStatus]);
  text('piece-mic', usingKeys() ? `Keys${keyInput.midiDevices ? ' · MIDI' : ''} · mic off` : audio.busy ? audio.analysis ? 'Mic off · listening back' : 'Preparing audio' : audio.micActive ? `Mic listening${audio.level > 0.9 ? ' · too loud' : ''}` : 'Mic off');
  text('piece-model', instrument === 'guitar' && exercise.events.some(e => e.grade === 'pitch') ? (audio.model === 'not needed' ? 'CREPE loads for plucked-note checks' : audio.model) : 'Piano listening: on this device');
  text('piece-calibration', usingKeys() ? 'Key timing needs no calibration' : progress.calibrated ? `Timing offset ${Math.round(progress.offset * 1000)} ms` : 'Timing not calibrated');
  const attention = !usingKeys() && !progress.calibrated; if (shown.get('attention') !== String(attention)) { shown.set('attention', String(attention)); el('piece-calibration').classList.toggle('needs-attention', attention); }
  text('piece-setup-hint', progress.calibrated ? '· calibrated' : '· start here for tempo steps');
  const rung = rungBpm(unit, p), fraction = unit.rungs[Math.min(p.rung, unit.rungs.length - 1)];
  const offered = placeable() && !running; if (shown.get('place:hidden') !== String(!offered)) { shown.set('place:hidden', String(!offered)); el('piece-place').hidden = !offered; }
  if (offered) text('piece-place', `Already know this? Try it at ${placeBpm()} BPM`);
  text('piece-tempo-help', spot ? 'Spot practice tempo' : running && placing !== undefined ? 'Placement take' : running ? 'Fixed for this take' : manualBpm ? `Free tempo · step is ${rung}` : unit.kind === 'listen' ? 'Goal tempo' : `${Math.round(fraction * 100)}% of ${unit.goalBpm} goal`);
  let phase = audio.busy ? audio.analysis || 'Preparing audio…' : audio.playing || !player.paused ? 'Listen or play along' : 'Ready when you are';
  if (plan) {
    const countAt = plan.playAt - plan.beatsPerBar * plan.period;
    phase = plan.kind === 'calibration' ? 'Measuring sound delay…' : plan.kind === 'demo' || now < countAt ? 'Listen' : now < plan.playAt ? `Count in · ${Math.min(plan.beatsPerBar, Math.max(1, Math.ceil((plan.playAt - now) / plan.period)))}` : now < plan.end ? `Play · bar ${barAt(exercise, (now - plan.playAt) / plan.period).number}` : 'Listening to the ending…';
  }
  const clock = performance.now(), dt = lastFrame ? Math.min(0.25, (clock - lastFrame) / 1000) : 0; lastFrame = clock;
  if (wait) {
    wait.step(dt);
    while (autoQueue.length && autoQueue[0].beat <= wait.beat + 1e-6) { const e = autoQueue.shift()!; for (const n of e.notes) audio.playNote(n.midi, n.dur * 60 / wait.bpm); }
    phase = `Wait for me · bar ${barAt(exercise, Math.max(0, wait.beat)).number}`;
    if (wait.done) finishWait(wait);
  }
  text('piece-phase', phase);
  text('piece-guidance', unit.kind === 'listen' ? '' : ['Notes shown', 'From memory', 'Click on each bar'][p.support] ?? '');
  text('piece-feedback', audio.error || feedback);
  if (reveal) stepReveal();
  if (after && performance.now() >= after.until) endMoment(true);
  paintPips(p);
  const result = !plan && !wait && audio.take?.unit === (spot ? spot.id : unit.id) ? audio.take.result : undefined, hide = p.support > 0 && unit.kind !== 'listen';
  const sweep = reveal && result ? revealBeat : undefined;
  // A lane where nothing moves is drawn again only when something it shows has changed.
  const clockMs = performance.now(), moving = Boolean(plan || wait || sweep !== undefined || laneAnimating() || laneResized() || [...wrong.values()].some(t => clockMs - t < 600));
  const look = { lively: lively(), level: plan?.kind === 'practice' && audio.micActive ? audio.level : undefined };
  const signature = `${spot ? spot.id : unit.id}|${instrument}|${p.support}|${hide}|${result ? audio.take?.id : ''}|${[...audio.held].join()}|${keyInput.layout.lower},${keyInput.layout.upper}|${usingKeys()}|${reduced.matches}|${look.lively}`;
  if (!moving && laneExercise === exercise && signature === laneSignature) return;
  laneExercise = exercise; laneSignature = signature;
  const lane = el<HTMLCanvasElement>('piece-lane'), shownPlan = plan?.kind === 'calibration' ? undefined : plan;
  if (instrument === 'piano') drawKeys(lane, exercise, shownPlan, frameNow, p.support, result, reduced.matches, hide, usingKeys() ? live() : undefined, look, sweep);
  else drawStrings(lane, exercise, shownPlan, frameNow, p.support, result, reduced.matches, hide, sweep, look.lively);
}
const html = (id: string, value: string) => { const k = `${id}:html`; if (shown.get(k) !== value) { shown.set(k, value); node(id).innerHTML = value; } };
/**
 * Near goals beside the BPM box: pips for clean takes toward the next step (two) or, on a certification step, for the
 * fading help (three), and a strip of the step's tempo rungs. Clean takes in a row are not saved, so pips start empty after a reload.
 */
function paintPips(p: UnitProgress): void {
  if (unit.kind === 'listen' || unit.sameAs) { html('piece-pips', ''); return; }
  const rungs = unit.rungs, at = Math.min(p.rung, rungs.length - 1), fraction = rungs[at], top = p.rung >= rungs.length - 1;
  const certify = unit.certify.some(c => Math.abs(c - fraction) < 1e-9), done = p.certified.some(c => Math.abs(c - fraction) < 1e-9) && top;
  const [filled, total, label] = certify ? [p.support, 3, `${p.support} of 3 clean takes with fading help toward certifying ${Math.round(fraction * 100)}%`]
    : top ? [0, 0, ''] : [Math.min(2, p.clean), 2, `${Math.min(2, p.clean)} of 2 clean takes toward the next step`];
  const pips = total && !(done && p.learned) ? `<span class="pips${certify ? ' fade' : ''}" title="${label}" aria-label="${label}">${Array.from({ length: total }, (_, i) => `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const pick = !active() && canPlace(unit, p, rungs.length - 1), target = placeTarget();
  const strip = `<span class="rungs" title="Step ${at + 1} of ${rungs.length}" aria-label="Tempo step ${at + 1} of ${rungs.length}">${rungs.map((r, i) => {
    const cls = `${i < at ? 'done' : i === at ? 'now' : ''}${p.certified.some(c => Math.abs(c - r) < 1e-9) ? ' cert' : ''}`;
    return pick && i > at ? `<button type="button" class="rung-pick${i === target ? ' on' : ''}" data-rung="${i}" aria-pressed="${i === target}" aria-label="Place at ${Math.round(r * 100)}%: ${rungBpm(unit, { ...p, rung: i })} BPM"><i class="${cls}"></i></button>` : `<i class="${cls}"></i>`;
  }).join('')}</span>`;
  html('piece-pips', manualBpm || spot ? '' : pips + strip);
}
function live(): Parameters<typeof drawKeys>[8] {
  if (wait) return { held: audio.held, labels, hits: wait.hits, auto: autoKeys, wrong, beat: wait.beat, expect: wait.current && wait.current.beat - wait.beat <= 0.5 ? wait.needed : [], message: wait.waiting ? 'Waiting for you: play the glowing keys' : '' };
  // Replaying a keys take: light the keys that were pressed, and fade the notes that were not played right.
  const replay = audio.replaying;
  if (replay?.presses && audio.plan) {
    const t = frameNow - audio.plan.playAt, presses = replay.presses;
    const heldNow = new Set(presses.filter(x => t >= x.t && t < x.t + (x.dur ?? 0.6)).map(x => x.midi));
    const right = new Set(replay.result?.events.flatMap(e => e.notes.filter(n => n.verdict === 'heard').map(n => noteKey(e.beat, n.midi))) ?? []);
    for (const k of autoKeys) right.add(k);
    return { held: heldNow, labels, hits: right, auto: autoKeys, wrong };
  }
  const plan = audio.plan, scoring = plan?.kind === 'practice' && audio.input === 'keys' && audio.now >= plan.playAt - plan.beatsPerBar * plan.period;
  return { held: audio.held, labels, tiers: scoring ? tiers : undefined, auto: scoring ? autoKeys : undefined, wrong, streak: scoring ? streak : 0 };
}
paintLocal();
loadPack(progress.selected.piece || packs()[0].id);
if (instrument === 'guitar') { el('inst-piano').setAttribute('aria-pressed', 'false'); el('inst-guitar').setAttribute('aria-pressed', 'true'); }
paint();
