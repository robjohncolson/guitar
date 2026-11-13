import '../styles.css';
import '../trainer/styles.css';
import './styles.css';
import { compile, type Diagnostic } from './notation';
import { buildCurriculum, exerciseFor, repeats, STAGES, type Curriculum, type Unit } from './curriculum';
import { arrange, guitarExerciseFor, guitarUnits, GUITAR_STAGES, melodyBacking, type Arrangement } from './guitar';
import { fromBars, type Exercise, type XEvent } from './exercise';
import { advanceUnit, initialUnit, parsePieceProgress, pieceProgressKey, progressId, ready, rungBpm, suggestToday, unitState, type PieceProgress, type UnitProgress } from './progress';
import { PieceAudio, type PieceTake } from './audio';
import { chordBox, drawKeys, drawStrings, pieceShell } from './view';
import { baseFor, KeyInput, keyLabels } from './keys';
import { chordSpans, prettyChord } from './analysis';
import { barAt } from './grade';
import { noteName, type Score } from './score';
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
const audio = new PieceAudio(), player = el<HTMLAudioElement>('piece-player'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
audio.checkPitch = progress.checkPitch;
let pack: Pack, score: Score, curriculum: Curriculum, arrangement: Arrangement, gUnits: Unit[] = [];
let instrument: 'piano' | 'guitar' = progress.selected.instrument, unit: Unit, exercise: Exercise, manualBpm: number | undefined;
let pending: { take: PieceTake; before: UnitProgress } | undefined, feedback = '', wavUrl = '', traceUrl = '';
// Computer keyboard and MIDI input: a per-browser preference, kept apart from practice progress.
const INPUT = 'piece.input.v1';
const inputPrefs = (() => { try { const v = JSON.parse(localStorage.getItem(INPUT) ?? '{}'); return { keys: v.keys === true, midiSound: v.midiSound !== false }; } catch { return { keys: false, midiSound: true }; } })();
const saveInput = () => { try { localStorage.setItem(INPUT, JSON.stringify(inputPrefs)); } catch { /* preference lasts for this page */ } };
let labels = keyLabels(48);
const keyInput = new KeyInput({
  down: (midi, stamp, source) => { void audio.keyDown(midi, stamp, source === 'keys' || inputPrefs.midiSound); },
  up: midi => audio.keyUp(midi),
}, () => { labels = keyLabels(keyInput.base); paintLaneHelp(); });
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
  if (exercise) { keyInput.setBase(baseFor(exercise.events.flatMap(e => e.notes.map(n => n.midi)))); labels = keyLabels(keyInput.base); }
  paintLaneHelp();
}
function paintLaneHelp(): void {
  if (!exercise) return;
  const midi = keyInput.midiDevices ? `${keyInput.midiDevices} MIDI input${keyInput.midiDevices > 1 ? 's' : ''} connected` : keyInput.midiError || 'no MIDI keyboard connected';
  el('lane-help').textContent = instrument === 'piano'
    ? `Left hand blue · right hand green · numbers are suggested fingers${usingKeys() ? ` · your keys light amber · letters are computer keys (Z row and Q row), left/right arrows change octave · ${midi}` : ''}`
    : `Thin string at the top · numbers are frets${exercise.capo ? ` from the capo at ${exercise.capo}` : ''} · brackets are strums or pinches`;
}
const heard = new Set<string>(), session = { takes: 0, seconds: 0, notes: [] as string[] };

const units = () => (instrument === 'piano' ? curriculum.units : gUnits);
const key = (id: string) => progressId(`${pack.id}${instrument === 'guitar' ? '#guitar' : ''}`, id);
const get = (id: string): UnitProgress | undefined => progress.units[key(id)];
const current = () => get(unit.id) ?? initialUnit();
const goal = () => progress.goals[pack.id] ?? score.tempo.bpm;
const bpmNow = () => manualBpm ?? rungBpm(unit, current());
const active = () => Boolean(audio.plan || audio.busy || audio.playing || !player.paused);
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
  return state === 'new' ? `begin at ${bpm} BPM` : state === 'practising' ? `${bpm} BPM · step ${Math.min(p!.rung, u.rungs.length - 1) + 1} of ${u.rungs.length}` : state === 'done' ? 'done' : state === 'due' ? 'review due' : 'learned';
}

function loadPack(id: string): void {
  audio.stop(); player.pause();
  const all = packs();
  pack = all.find(p => p.id === id) ?? all[0];
  const compiled = compile(pack.text);
  if (!compiled.score) { el('piece-feedback').textContent = `This piece file has errors: ${compiled.diagnostics.slice(0, 3).map(d => `line ${d.line}: ${d.message}`).join(' ')}`; return; }
  score = compiled.score;
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
  const wanted = progress.selected.unit && units().some(u => u.id === progress.selected.unit) ? progress.selected.unit : (suggestToday({ ...curriculum, units: units() }, get, Date.now())[0]?.unit.id ?? units()[0].id);
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
function selectUnit(id: string): void {
  audio.stop(); player.pause(); pending = undefined; manualBpm = undefined;
  unit = units().find(u => u.id === id) ?? units()[0];
  exercise = instrument === 'piano' ? exerciseFor(score, unit) : guitarExerciseFor(score, arrangement, unit);
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
  el('piece-backing-label').textContent = instrument === 'guitar' ? 'Play the melody with me (headphones)' : 'Play the other hand with me (headphones)';
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  el('piece-start').textContent = unit.kind === 'listen' ? 'Listen' : 'Start practice';
  el('piece-result').hidden = true;
  feedback = unit.sameAs ? `These notes are the same as "${title(unit.sameAs)}". Practise that step; this one follows it.` : unit.kind === 'listen' ? 'Listen first. Notice the sections and where the left hand leaps.' : 'Hear it once, then start with a one-bar count-in.';
  paintCourse(); paintToday(); persist();
}
function paintCourse(): void {
  const list = units(), stages = instrument === 'piano' ? STAGES : GUITAR_STAGES, now = Date.now();
  const done = list.filter(u => ['done', 'learned', 'due'].includes(unitState(u, get(u.id), now))).length, real = list.filter(u => !u.sameAs).length;
  el('course-count').textContent = `· ${done} / ${real} steps done`;
  el('course-list').innerHTML = stages.map((name, i) => {
    const members = list.filter(u => u.stage === i);
    if (!members.length) return '';
    return `<div class="course-stage">${i + 1} · ${escape(name)}</div>${members.map(u => `<button class="course-lesson${u.sameAs ? ' covered' : ''}" data-unit="${escape(u.id)}" aria-current="${u.id === unit?.id}"><span>${escape(u.title)}${!u.sameAs && !ready(u, get) ? ' <span class="muted">· later</span>' : ''}${u.optional ? ' <span class="muted">· optional</span>' : ''}</span><span>${escape(stateLabel(u))}</span></button>`).join('')}`;
  }).join('');
}
function paintToday(): void {
  const plan = suggestToday({ ...curriculum, units: units() }, get, Date.now());
  el('today-list').innerHTML = plan.map(p => `<li><button class="today-step" data-unit="${escape(p.unit.id)}" aria-current="${p.unit.id === unit?.id}"><span>${escape(p.unit.title)}</span><span class="muted">${escape(p.reason)} · ${escape(stateLabel(p.unit))}</span></button></li>`).join('') || '<li class="muted">Everything here is learned. Play the whole piece, or choose a review from the course.</li>';
}
function otherPart(): XEvent[] {
  if (!el<HTMLInputElement>('piece-backing').checked || audio.mode !== 'headphones') return [];
  if (instrument === 'guitar') return melodyBacking(score, unit.bars);
  const other = unit.hands[0] === 'L' ? 'R' : 'L';
  return fromBars(score, unit.bars, [other], 'backing', 'backing').events;
}
async function start(kind: 'practice' | 'demo'): Promise<void> {
  if (el('piece-bpm').getAttribute('aria-invalid') === 'true') return;
  player.pause(); pending = undefined; el('piece-result').hidden = true; el('piece-session').hidden = true;
  if (unit.kind === 'listen') {
    feedback = 'Listen through. The notes fall onto the keys as they sound.';
    await audio.start(exercise, unit.id, goal(), 'demo');
    const p = { ...current() }; p.attempts++; p.last = Date.now(); progress.units[key(unit.id)] = p; persist(); paintToday(); paintCourse();
    return;
  }
  // New short steps are demonstrated once before the count-in; long sections are not (use Hear it).
  const demonstrate = kind === 'practice' && !heard.has(unit.id) && !unit.sameAs && exercise.beats <= 24;
  feedback = kind === 'demo' ? 'Listen to the notes and the spaces between them.' : 'One bar to count in. Play as the notes reach the keys.';
  await audio.start(exercise, unit.id, bpmNow(), kind, current().support, progress.offset, demonstrate, kind === 'practice' ? otherPart() : []);
  if (kind === 'demo' || demonstrate) heard.add(unit.id);
  if (!usingKeys() && audio.deviceKey && progress.calibrated && progress.calibrationKey && progress.calibrationKey !== audio.deviceKey) { progress.calibrated = false; el('piece-calibration-feedback').textContent = 'The audio path changed. Recalibrate to count tempo steps.'; persist(); }
}
function showTake(take: PieceTake): void {
  URL.revokeObjectURL(wavUrl); URL.revokeObjectURL(traceUrl);
  wavUrl = URL.createObjectURL(new Blob([audio.wav(take)!], { type: 'audio/wav' }));
  traceUrl = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, piece: pack.id, unit: take.unit, instrument, bpm: take.bpm, support: take.support, offset: take.offset, result: take.result }, null, 2)], { type: 'application/json' }));
  player.src = wavUrl; el<HTMLAnchorElement>('piece-download').href = wavUrl; el<HTMLAnchorElement>('piece-trace').href = traceUrl;
  el<HTMLAnchorElement>('piece-download').download = `${pack.id}-${take.unit.replace(/[^\w-]+/g, '_')}-${take.bpm}bpm.wav`;
  el('piece-review').hidden = false; el('piece-take').textContent = `${take.exercise.title} · ${take.bpm} BPM`;
}
audio.onTake = take => {
  session.takes++; session.seconds += take.presses ? take.exercise.beats * 60 / take.bpm : take.samples.length / take.rate; take.calibrated = timed(take);
  if (take.presses) el('piece-review').hidden = true; else showTake(take);
  const result = take.result;
  if (!result) return;
  pending = { take, before: current() };
  progress.history.push({ date: Date.now(), piece: pack.id, unit: take.unit, bpm: take.bpm, score: result.score, trusted: result.trusted && timed(take) });
  progress.history = progress.history.slice(-200);
  feedback = result.feedback + (timed(take) ? '' : ' Timing is an estimate until you calibrate; tempo steps wait for calibration.');
  const notes = result.events.flatMap(e => e.notes), count = (v: string) => notes.filter(n => n.verdict === v).length;
  const marks = result.events.map(e => e.mark), mark = (m: string) => marks.filter(x => x === m).length;
  el('piece-metrics').innerHTML = `<span><strong>${Math.round(result.timing * 100)}%</strong> on time${timed(take) ? '' : ' · estimate'}</span>${result.pitch === null ? `<span>${instrument === 'piano' ? 'Notes mostly unchecked' : 'Timing only'}</span>` : `<span><strong>${Math.round(result.pitch * 100)}%</strong> ${take.presses ? 'right keys' : 'notes heard right'}</span>`}${result.trusted ? '' : '<span>Not scored</span>'}`;
  el('piece-verdicts').innerHTML = [['heard', 'heard', count('heard')], ['wrong', 'wrong or missing', count('wrong') + count('not-heard')], ['unclear', 'unclear', count('unclear')], ['cannot', "can't check", count('cannot-check')], ['missed', 'attacks missed', mark('missed')], ['unsure', 'attacks unsure', mark('unsure')]]
    .filter(([, , n]) => Number(n) > 0).map(([cls, label, n]) => `<span class="verdict ${cls}">${n} ${label}</span>`).join('');
  const problems = result.events.filter(e => e.mark !== 'good' || e.notes.some(n => n.verdict === 'wrong' || n.verdict === 'not-heard')).slice(0, 8).map(e => {
    const at = barAt(take.exercise, e.beat), wrong = e.notes.filter(n => n.verdict === 'wrong' || n.verdict === 'not-heard').map(n => n.verdict === 'wrong' ? `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'played' : 'sounded'} as ${noteName(n.heardAs!, take.exercise.keySig)}` : `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'missing' : 'not heard'}`);
    return `bar ${at.number} beat ${at.beat}: ${e.mark}${e.offset !== undefined && e.mark !== 'good' ? ` (${e.offset > 0 ? '+' : ''}${Math.round(e.offset * 1000)} ms)` : ''}${wrong.length ? `, ${wrong.join(', ')}` : ''}`;
  });
  el('piece-details').textContent = `${problems.join(' · ')}${result.extraNotes.length ? ` · possible extra note${result.extraNotes.length > 1 ? 's' : ''} near ${[...new Set(result.extraNotes.map(x => noteName(x.midi, take.exercise.keySig)))].join(', ')}` : ''}${result.trusted ? '' : ` · ${result.reason}`}${Math.abs(result.tuning) >= 8 ? ` · your piano reads about ${Math.round(result.tuning)} cents from A440; checks allowed for it` : ''}`;
  el('piece-result').hidden = false; persist();
};
audio.onCalibration = result => {
  el('piece-calibration-feedback').textContent = result.message; feedback = result.message;
  if (result.ok) { progress.offset = result.offset; progress.calibrated = true; progress.calibrationKey = audio.deviceKey; el<HTMLInputElement>('piece-offset').value = String(Math.round(result.offset * 1000)); persist(); }
};
function nextTake(comfortable: boolean): void {
  const done = pending; if (!done?.take.result) return;
  pending = undefined; el('piece-result').hidden = true;
  const u = units().find(x => x.id === done.take.unit); if (!u) return;
  if (done.take.bpm !== rungBpm(u, done.before)) { feedback = `Free tempo: steps count at ${rungBpm(u, done.before)} BPM, the step you are on.`; return; }
  const change = advanceUnit(u, done.before, done.take.result, comfortable, Date.now(), timed(done.take));
  progress.units[key(u.id)] = change.progress; feedback = change.message;
  if (change.progress.learned && !done.before.learned) session.notes.push(`${u.title}: learned`);
  else if (change.progress.certified.length > done.before.certified.length) session.notes.push(`${u.title}: certified at ${Math.round(change.progress.certified[change.progress.certified.length - 1] * 100)}%`);
  manualBpm = undefined; el<HTMLInputElement>('piece-bpm').value = String(bpmNow()); paintCourse(); paintToday(); persist();
}

el<HTMLSelectElement>('piece-select').onchange = () => { progress.selected.unit = ''; loadPack(el<HTMLSelectElement>('piece-select').value); };
for (const which of ['piano', 'guitar'] as const) el(`inst-${which}`).onclick = () => {
  if (active() || instrument === which) return;
  instrument = which; progress.selected.unit = ''; el('inst-piano').setAttribute('aria-pressed', String(which === 'piano')); el('inst-guitar').setAttribute('aria-pressed', String(which === 'guitar'));
  selectUnit((suggestToday({ ...curriculum, units: units() }, get, Date.now())[0]?.unit ?? units()[0]).id);
};
el('piece-start').onclick = () => { void start('practice'); };
for (const keys of [false, true]) el(keys ? 'input-keys' : 'input-mic').onclick = () => {
  if (active() || inputPrefs.keys === keys) return;
  inputPrefs.keys = keys; saveInput(); applyInput();
  feedback = keys ? 'Play on the computer keyboard or a MIDI keyboard. Notes are graded from the keys you press; the microphone stays off.' : 'Back to listening through the microphone.';
};
el<HTMLInputElement>('piece-midi-sound').checked = inputPrefs.midiSound;
el<HTMLInputElement>('piece-midi-sound').onchange = () => { inputPrefs.midiSound = el<HTMLInputElement>('piece-midi-sound').checked; saveInput(); };
el('piece-demo').onclick = () => { void start('demo'); };
el('piece-listen').onclick = () => { const listen = curriculum.units.find(u => u.kind === 'listen')!; audio.stop(); void audio.start(exerciseFor(score, listen), 'listen', goal(), 'demo'); feedback = repeats(score) ? 'The whole piece, with the repeats.' : 'The whole piece.'; };
el('piece-next').onclick = () => { const next = suggestToday({ ...curriculum, units: units() }, get, Date.now()).find(p => p.unit.id !== unit.id); if (next) selectUnit(next.unit.id); };
el('piece-stop').onclick = () => { audio.stop(); player.pause(); feedback = 'Stopped. Your last completed take is still available below.'; };
player.onplay = () => audio.stop();
el('piece-comfortable').onclick = () => nextTake(true);
el('piece-struggling').onclick = () => nextTake(false);
el('piece-latest').onclick = () => { if (audio.take) { showTake(audio.take); player.play().catch(e => audio.error = String(e)); } };
el('piece-previous').onclick = () => { if (audio.previous) { showTake(audio.previous); player.play().catch(e => audio.error = String(e)); } };
el('piece-loop').onclick = () => { player.pause(); feedback = 'Your take is looping. Play along freely; nothing is graded.'; void audio.playTake(audio.take, true); };
el('course-list').onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]'); if (b && !active()) selectUnit(b.dataset.unit!); };
el('today-list').onclick = event => { const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]'); if (b && !active()) selectUnit(b.dataset.unit!); };
el<HTMLInputElement>('piece-bpm').oninput = () => {
  const input = el<HTMLInputElement>('piece-bpm'), value = input.valueAsNumber;
  if (active()) { input.value = String(bpmNow()); return; }
  if (!Number.isFinite(value) || value < 20 || value > 240) { input.setAttribute('aria-invalid', 'true'); return; }
  input.removeAttribute('aria-invalid'); manualBpm = Math.round(value) === rungBpm(unit, current()) ? undefined : Math.round(value);
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
el('piece-calibrate').onclick = () => { player.pause(); pending = undefined; progress.calibrated = false; persist(); feedback = 'Keep the instrument quiet. Let the microphone hear the eight clicks.'; void audio.start(exercise, 'calibration', 60, 'calibration'); };
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
  const next = suggestToday({ ...curriculum, units: units() }, get, Date.now()).find(p => p.reason !== 'Warm up in the key');
  el('piece-session').hidden = false;
  el('piece-session').textContent = `${session.takes} takes · ${(session.seconds / 60).toFixed(1)} minutes of playing. ${session.notes.length ? session.notes.join('. ') + '. ' : 'Steady, deliberate practice counts even when nothing moved up today. '}${next ? `Next time: ${next.unit.title}.` : ''}`;
};
let resetArmed = false;
el('piece-reset').onclick = () => {
  if (!resetArmed) { resetArmed = true; el('piece-reset').textContent = 'Click again to clear this piece’s progress'; return; }
  resetArmed = false; el('piece-reset').textContent = 'Reset progress for this piece';
  for (const id of Object.keys(progress.units)) if (id.startsWith(`${pack.id}|`) || id.startsWith(`${pack.id}#guitar|`)) delete progress.units[id];
  persist(); selectUnit(unit.id); feedback = 'Progress for this piece cleared. Calibration is kept.';
};
navigator.mediaDevices?.addEventListener('devicechange', () => { progress.calibrated = false; persist(); el('piece-calibration-feedback').textContent = 'Audio devices changed. Recalibrate timing.'; });
window.addEventListener('keydown', event => { if (event.code === 'Escape') { audio.stop(); player.pause(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && active()) { audio.stop(); player.pause(); feedback = 'Practice paused while the page was hidden.'; } });
const timer = window.setInterval(() => audio.tick(), 10);
window.addEventListener('pagehide', () => { clearInterval(timer); audio.dispose(); player.pause(); URL.revokeObjectURL(wavUrl); URL.revokeObjectURL(traceUrl); });

function paint(): void {
  requestAnimationFrame(paint);
  if (!exercise) return;
  const plan = audio.plan, now = audio.now, running = active(), p = current();
  el<HTMLButtonElement>('piece-stop').disabled = !running;
  for (const id of ['piece-start', 'piece-demo', 'piece-calibrate', 'piece-output', 'piece-use-offset', 'piece-next', 'piece-listen', 'piece-select', 'inst-piano', 'inst-guitar', 'piece-goal', 'input-mic', 'input-keys']) el<HTMLButtonElement>(id).disabled = running;
  el<HTMLInputElement>('piece-bpm').disabled = running;
  el<HTMLButtonElement>('piece-comfortable').disabled = el<HTMLButtonElement>('piece-struggling').disabled = !pending || running;
  for (const id of ['piece-latest', 'piece-loop']) el<HTMLButtonElement>(id).disabled = !audio.take || Boolean(plan || audio.busy);
  el<HTMLButtonElement>('piece-previous').disabled = !audio.previous || Boolean(plan || audio.busy);
  el('piece-mic').textContent = usingKeys() ? `Keys${keyInput.midiDevices ? ' · MIDI' : ''} · mic off` : audio.busy ? audio.analysis ? 'Mic off · listening back' : 'Preparing audio' : audio.micActive ? `Mic listening${audio.level > 0.9 ? ' · too loud' : ''}` : 'Mic off';
  el('piece-model').textContent = instrument === 'guitar' && exercise.events.some(e => e.grade === 'pitch') ? (audio.model === 'not needed' ? 'CREPE loads for plucked-note checks' : audio.model) : 'Piano listening: on this device';
  el('piece-calibration').textContent = usingKeys() ? 'Key timing needs no calibration' : progress.calibrated ? `Timing offset ${Math.round(progress.offset * 1000)} ms` : 'Timing not calibrated';
  el('piece-calibration').classList.toggle('needs-attention', !usingKeys() && !progress.calibrated);
  el('piece-setup-hint').textContent = progress.calibrated ? '· calibrated' : '· start here for tempo steps';
  const rung = rungBpm(unit, p), fraction = unit.rungs[Math.min(p.rung, unit.rungs.length - 1)];
  el('piece-tempo-help').textContent = running ? 'Fixed for this take' : manualBpm ? `Free tempo · step is ${rung}` : unit.kind === 'listen' ? 'Goal tempo' : `${Math.round(fraction * 100)}% of ${unit.goalBpm} goal`;
  let phase = audio.busy ? audio.analysis || 'Preparing audio…' : audio.playing || !player.paused ? 'Listen or play along' : 'Ready when you are';
  if (plan) {
    const countAt = plan.playAt - plan.beatsPerBar * plan.period;
    phase = plan.kind === 'calibration' ? 'Measuring sound delay…' : plan.kind === 'demo' || now < countAt ? 'Listen' : now < plan.playAt ? `Count in · ${Math.min(plan.beatsPerBar, Math.max(1, Math.ceil((plan.playAt - now) / plan.period)))}` : now < plan.end ? `Play · bar ${barAt(exercise, (now - plan.playAt) / plan.period).number}` : 'Listening to the ending…';
  }
  el('piece-phase').textContent = phase;
  el('piece-guidance').textContent = unit.kind === 'listen' ? '' : ['Notes shown', 'From memory', 'Click on each bar'][p.support] ?? '';
  el('piece-feedback').textContent = audio.error || feedback;
  const result = !plan && audio.take?.unit === unit.id ? audio.take.result : undefined, hide = p.support > 0 && unit.kind !== 'listen';
  (instrument === 'piano' ? drawKeys : drawStrings)(el<HTMLCanvasElement>('piece-lane'), exercise, plan?.kind === 'calibration' ? undefined : plan, now, p.support, result, reduced.matches, hide, usingKeys() ? { held: audio.held, labels } : undefined);
}
paintLocal();
loadPack(progress.selected.piece || packs()[0].id);
if (instrument === 'guitar') { el('inst-piano').setAttribute('aria-pressed', 'false'); el('inst-guitar').setAttribute('aria-pressed', 'true'); }
paint();
