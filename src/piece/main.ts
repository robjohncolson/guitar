import '../styles.css';
import '../trainer/styles.css';
import './styles.css';
import './hud.css';
import './stage.css';
import { compile } from './notation';
import { buildCurriculum, exerciseFor, STAGES, type Curriculum, type Unit } from './curriculum';
import { arrange, guitarExerciseFor, guitarUnits, GUITAR_STAGES, melodyBacking, type Arrangement } from './guitar';
import { fromBars, sliceExercise, type Exercise, type XEvent } from './exercise';
import { arrangePiece, guitarPieceUnits, otherLayer, pieceExercise, PIECE_STAGES, type PieceArrangement } from './solo';
import {
  advanceUnit,
  canPlace,
  CLEAN,
  dayOf,
  initialUnit,
  logDay,
  parsePieceProgress,
  pieceProgressKey,
  placeHands,
  placeUnit,
  progressId,
  ready,
  rowDone,
  rungBpm,
  suggestToday,
  unitState,
  week,
  type AdvanceEvent,
  type PieceProgress,
  type PlanRow,
  type UnitProgress,
} from './progress';
import { pieceMap } from './map';
import { bestKey, compareTake, keyStats, pruneBests, tightness, timingSummary } from './bests';
import { PieceAudio, type PieceTake } from './audio';
import {
  celebrate,
  chordBox,
  clearMoment,
  drawKeys,
  drawStrings,
  handColour,
  keyHit,
  laneAnimating,
  laneResized,
  lightProbe,
  pieceShell,
  setLaneHeight,
  showMoment,
} from './view';
import { KeyInput, keyLabels, layoutFor, reaches } from './keys';
import { noteKey, WaitRun } from './wait';
import { chordSpans, prettyChord } from './analysis';
import {
  barAt,
  keyPerfect,
  keyReach,
  keyWindow,
  LENIENCY,
  setLeniency,
  type KeyLive,
  type Leniency,
  type PieceGrade,
} from './grade';
import { noteName, type Hand, type Score } from './score';
import { barsText, isSpotId, pickSpot, slowerBpm, spotExercise, spotId, spotOffered, type SpotPick } from './spot';
import {
  answerLines,
  capNote,
  comfortAsk,
  firstSentence,
  floorPct,
  nextLine,
  nextState,
  outcome,
  routeTake,
  takeStatus,
  type NextLine,
  type TakeFacts,
} from './loop';
import { earText, ladderHtml, metricsHtml, scoreHtml, starsHtml } from './hud';
import {
  countUp,
  keyWin,
  LiveRun,
  pieceStars,
  revealStars,
  starChip,
  starCount,
  starMoment,
  starNews,
  starsFor,
  starTitle,
  takeRun,
} from './game';
import { audioNotice, notice as noticeFor, type Notice, type NoticeDetail, type NoticeSource } from './notice';
import { keyAllowed, laneHeight, overlayOpen, statusChip, stepFinished, todayChip } from './stage';
import { saveTracked } from '../account/changes';
import { mountAddPanel } from './add-panel';
import { isDraft, pickerLabel, pieceMeta, readMine } from './mine';

pieceShell();
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
interface Pack {
  id: string;
  text: string;
  origin: 'bundled' | 'local' | 'mine';
}
const bundled = import.meta.glob('./packs/*.piece.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
// Private packs (git-ignored, often copyrighted) are read by the dev server only, so no production build can ship them.
const localFiles: Record<string, string> = import.meta.env.DEV
  ? import.meta.glob('./packs/local/*.piece.txt', { query: '?raw', import: 'default', eager: true })
  : {};
const packs = (): Pack[] => [
  ...Object.entries(bundled).map(([path, text]) => ({
    id: path.split('/').pop()!.replace('.piece.txt', ''),
    text,
    origin: 'bundled' as const,
  })),
  ...Object.entries(localFiles).map(([path, text]) => ({
    id: `local:${path.split('/').pop()!.replace('.piece.txt', '')}`,
    text,
    origin: 'local' as const,
  })),
  ...readMine().map((m) => ({ ...m, origin: 'mine' as const })),
];
const trainerCalibration = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('guitar.trainer.v1') ?? '{}');
    return {
      offset: Number(v.offset) || 0,
      calibrated: v.calibrated === true,
      calibrationKey: String(v.calibrationKey ?? ''),
    };
  } catch {
    return undefined;
  }
})();
const progress: PieceProgress = (() => {
  try {
    return parsePieceProgress(localStorage.getItem(pieceProgressKey), trainerCalibration);
  } catch {
    return parsePieceProgress(null, trainerCalibration);
  }
})();
const audio = new PieceAudio();
// Browser checks reach the audio engine in development builds only.
if (import.meta.env.DEV)
  (window as unknown as { __pieceDev: unknown }).__pieceDev = {
    audio,
    light: () => lightProbe(),
    exercise: () => exercise,
    layout: () => keyInput.layout,
    tiers: () => [...tiers],
    streak: () => streak,
    revealing: () => Boolean(reveal),
    moment: () => Boolean(after),
    pending: () => Boolean(pending),
    spot: () =>
      spot && {
        id: spot.id,
        bars: spot.exercise.bars.map((b) => b.number),
        bpm: spot.bpm,
        clean: spot.clean,
        hands: spot.hands,
      },
    choice: () => choice,
    take: (result: PieceGrade, bpm?: number) => {
      const take: PieceTake = {
        id: Date.now(),
        exercise,
        unit: spot ? spot.id : unit.id,
        bpm: bpm ?? bpmNow(),
        support: 0,
        kind: 'practice',
        offset: progress.offset,
        samples: new Float32Array(4800),
        rate: 48000,
        levelGain: 1,
        result,
      };
      audio.previous = audio.take;
      audio.take = take;
      audio.onTake(take);
    },
  };
const player = el<HTMLAudioElement>('piece-player'),
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
/** The menu (a modal dialog), the free-tempo box, and the phone layout (the take details then live in the menu). */
const drawer = el<HTMLDialogElement>('piece-drawer'),
  freePop = el('piece-free'),
  phone = matchMedia('not all and (min-width: 701px)');
const overlayNow = () => overlayOpen(drawer.open || document.querySelector('dialog[open]') !== null, !freePop.hidden);
audio.checkPitch = progress.checkPitch;
let pack: Pack,
  score: Score,
  curriculum: Curriculum,
  arrangement: Arrangement,
  gUnits: Unit[] = [],
  pieceArr: PieceArrangement,
  pUnits: Unit[] = [];
let instrument: 'piano' | 'guitar' = progress.selected.instrument,
  unit: Unit,
  exercise: Exercise,
  manualBpm: number | undefined;
/** A trouble-spot loop: bars of the step played alone, away from the tempo ladder. While it runs, `exercise` is the spot and `unit` stays the step. */
let spot:
  | {
      parent: Unit;
      from: number;
      to: number;
      lead: boolean;
      hands: Hand[];
      bpm: number;
      exercise: Exercise;
      id: string;
      clean: number;
    }
  | undefined;
let choiceAt = 0;
/** The tempo step a placement would target (default the top one), and the step a placement take in progress is aimed at. */
let placeAt: number | undefined, placing: number | undefined;
let choice: 'offer' | 'pass' | undefined, offer: { pick: SpotPick | 'choose'; bpm: number } | undefined;
let pending:
    { take: PieceTake; before: UnitProgress; entry: PieceProgress['history'][number]; place?: number } | undefined,
  wavUrl = '',
  traceUrl = '';
/** NOTICE: the one non-take message on stage (see notice.ts), and what the ladder said about the last answered take. */
let notice: Notice | undefined,
  noticeAction: Notice['action'],
  ladderSaid = '',
  placedNow = false,
  focusAnswer = false;
let noticeFrom: NoticeSource | undefined;
const say = (source: NoticeSource, detail?: NoticeDetail) => {
  const n = noticeFor(source, detail);
  if (n) {
    notice = n;
    noticeFrom = source;
  }
};
/** Clears a NOTICE that only described something now stopped (a loop, a calibration, a Wait for me run). */
const dropStale = () => {
  if (noticeFrom === 'loop' || noticeFrom === 'calibrating' || noticeFrom === 'wait-start') notice = undefined;
};
/** LAST TAKE: what the last answered take did; cleared when the step, instrument or piece changes. A clean answer pops the ladder briefly. */
let lastTake = '',
  tooLoud = false,
  pop: { kind: 'pip' | 'climb'; until: number } | undefined,
  nextAction: NextLine['action'];
// Computer keyboard and MIDI input: a per-browser preference, kept apart from practice progress.
const INPUT = 'piece.input.v1';
const inputPrefs = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(INPUT) ?? '{}');
    return {
      keys: v.keys === true,
      midiSound: v.midiSound !== false,
      calm: v.calm === true,
      piano: v.piano === 'simple' ? ('simple' as const) : ('grand' as const),
      guitar: v.guitar === 'accompany' ? ('accompany' as const) : ('piece' as const),
      leniency: (v.leniency in LENIENCY ? v.leniency : 'relaxed') as Leniency,
    };
  } catch {
    return {
      keys: false,
      midiSound: true,
      calm: false,
      piano: 'grand' as const,
      guitar: 'piece' as const,
      leniency: 'relaxed' as Leniency,
    };
  }
})();
audio.leniency = inputPrefs.leniency;
setLeniency(inputPrefs.leniency);
audio.piano = inputPrefs.piano;
const saveInput = () => {
  try {
    localStorage.setItem(INPUT, JSON.stringify(inputPrefs));
  } catch {
    /* preference lasts for this page */
  }
};
let labels = keyLabels({ lower: 48, upper: 60 });
const keyInput = new KeyInput(
  {
    down: (midi, stamp, source) => {
      const before = audio.pressCount;
      void audio.keyDown(midi, stamp, source === 'keys' || inputPrefs.midiSound);
      judgePress(midi, audio.pressCount > before);
    },
    up: (midi) => audio.keyUp(midi),
  },
  () => {
    labels = keyLabels(keyInput.layout);
    paintLaneHelp();
  },
  () => overlayNow(),
);
/** Keys mode applies to piano only; guitar always listens through the microphone. */
const usingKeys = () => inputPrefs.keys && instrument === 'piano';
/** Key presses need no sound-delay calibration: their timing is measured on the audio clock directly. */
const timed = (take?: PieceTake) => Boolean(take?.presses) || progress.calibrated;
function applyInput(): void {
  const keys = usingKeys();
  audio.input = keys ? 'keys' : 'mic';
  keyInput.enabled = keys;
  if (!keys) {
    keyInput.releaseAll();
    for (const m of [...audio.held]) audio.keyUp(m);
  }
  el('input-mic').setAttribute('aria-pressed', String(!inputPrefs.keys));
  el('input-keys').setAttribute('aria-pressed', String(inputPrefs.keys));
  el('input-toggle').hidden = instrument !== 'piano';
  if (keys) void keyInput.connectMidi();
  if (exercise) {
    keyInput.setLayout(layoutFor(exercise.events.flatMap((e) => e.notes.map((n) => n.midi))));
    labels = keyLabels(keyInput.layout);
  }
  if (unit) paintWait();
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
    mine: {
      ...ex,
      events: ex.events.map((e) => ({ ...e, notes: e.notes.filter((n) => can(n.midi)) })).filter((e) => e.notes.length),
    },
    auto: ex.events.map((e) => ({ ...e, notes: e.notes.filter((n) => !can(n.midi)) })).filter((e) => e.notes.length),
  };
}
/** Notes the app plays in this take or wait run, as lane keys; and the wait run's notes still to sound. */
let autoKeys = new Set<string>(),
  autoQueue: XEvent[] = [];
/** Wait for me is offered on keys only, on the stage and on the result card. */
function paintWait(): void {
  const off = !usingKeys() || unit.kind === 'listen';
  el('piece-wait').hidden = off;
  el('piece-card-wait').hidden = off;
}
/** The lane header's one line: the help level when some help is faded, else the start of the lane help. */
let laneLine = '';
/** Guitar is the written piece on the fretboard. Accompany is the chord course, unchanged. */
const pieceCourse = () => instrument === 'guitar' && inputPrefs.guitar !== 'accompany';
function paintLaneHelp(): void {
  if (!exercise) return;
  const out = reachSplit(exercise).auto.reduce((n, e) => n + e.notes.length, 0);
  const midi = keyInput.midiDevices
    ? `${keyInput.midiDevices} MIDI input${keyInput.midiDevices > 1 ? 's' : ''} connected`
    : keyInput.midiError || 'no MIDI keyboard connected';
  const bothLayers =
    exercise.events.some((e) => e.notes.some((n) => n.hand === 'L')) &&
    exercise.events.some((e) => e.notes.some((n) => n.hand === 'R' || n.also === 'R'));
  el('lane-help').textContent =
    instrument === 'piano'
      ? `Left hand blue · right hand green · numbers are suggested fingers${usingKeys() ? ` · your keys light amber · letters are computer keys (Z row and Q row), left/right arrows change octave · ${midi}${out ? ` · ${out} note${out > 1 ? 's' : ''} out of reach of the keys (dimmed) will be played for you` : ''}` : ''}`
      : pieceCourse() && bothLayers
        ? 'Thin string at the top · blue is bass, green is melody · numbers are frets'
        : `Thin string at the top · numbers are frets${exercise.capo ? ` from the capo at ${exercise.capo}` : ''} · brackets are strums or pinches`;
  laneLine = (el('lane-help').textContent ?? '').split(' · ').slice(0, 2).join(' · ');
}
const heard = new Set<string>(),
  session = { takes: 0, seconds: 0, notes: [] as string[] };

const courseTag = () => (instrument === 'piano' ? '' : pieceCourse() ? '#guitar-piece' : '#guitar');
const stagesNow = () => (instrument === 'piano' ? STAGES : pieceCourse() ? PIECE_STAGES : GUITAR_STAGES);
const units = () => (instrument === 'piano' ? curriculum.units : pieceCourse() ? pUnits : gUnits);
const key = (id: string) => progressId(`${pack.id}${courseTag()}`, id);
const get = (id: string): UnitProgress | undefined => progress.units[key(id)];
const current = () => get(unit.id) ?? initialUnit();
const goal = () => progress.goals[pack.id] ?? score.tempo.bpm;
const bpmNow = () => (spot ? spot.bpm : (manualBpm ?? rungBpm(unit, current())));
const placeTarget = () => {
  const top = unit.rungs.length - 1;
  return placeAt !== undefined && placeAt > current().rung ? Math.min(placeAt, top) : top;
};
const placeBpm = () => rungBpm(unit, { ...current(), rung: placeTarget() });
const placeable = () => unit.kind !== 'listen' && !spot && !wait && canPlace(unit, current(), placeTarget());
const active = () => Boolean(wait || audio.plan || audio.busy || audio.playing || !player.paused);
// Live feedback for keys: which notes have been played (so only they glow) and when each wrong key went down.
let wait: WaitRun | undefined;
const wrong = new Map<number, number>();
/**
 * A timed keys take, live: each played note's judgement (the same rules as the grade; the take's KeyJudge keeps it up
 * to date) and on-time notes in a row (streak, which warms the hit line). runFrom: what the visible run counter is
 * read from (game.ts LiveRun gives liveRun's count of attacks, like the card's "Longest run").
 */
let tiers: ReadonlyMap<string, KeyLive> = new Map(),
  streak = 0,
  runFrom: LiveRun | undefined;
const lively = () => !inputPrefs.calm && !reduced.matches;
let lastFrame = 0;
/**
 * Judge a key press as it happens: in wait mode it moves the lane on; in a timed take the presses so far are judged by
 * the grade's own rules (judgeKeys, kept up to date press by press by KeyJudge), so the lane never says more than the
 * result will. Only a confirmed on-time key earns a flash; early or late shows calmly; a key that matches nothing
 * tints as wrong.
 */
function judgePress(midi: number, recorded: boolean): void {
  if (wait) {
    if (wait.press(midi) === 'wrong') wrong.set(midi, performance.now());
    return;
  }
  const plan = audio.plan;
  if (!plan || plan.kind !== 'practice' || audio.input !== 'keys' || !recorded) return;
  const judged = audio.judge();
  if (!judged) return;
  const { judge, diff } = judged;
  if (judge.wrong.has(audio.pressCount - 1)) {
    wrong.set(midi, performance.now());
    streak = 0;
  }
  // The notes whose tier this press set or changed, in the judgement's order; after a reset of the lane, all of them.
  const changed =
    tiers === judge.live
      ? diff.changed
      : judge.inOrder([...judge.live.keys()].filter((key) => tiers.get(key) !== judge.live.get(key)));
  for (const key of changed) {
    if (Number(key.split(':')[1]) !== midi) continue;
    const tier = judge.live.get(key)!;
    keyHit(midi, tier, handColour(exercise, midi));
    streak = tier === 'perfect' || tier === 'good' ? streak + 1 : tier === 'played' ? streak : 0;
  }
  tiers = judge.live;
  if (runFrom?.judge === judge) runFrom.update(diff);
  else runFrom = new LiveRun(judge);
}
function resetLive(): void {
  tiers = new Map();
  streak = 0;
  runFrom = undefined;
  wrong.clear();
}
function startWait(): void {
  if (active() || !usingKeys() || unit.kind === 'listen') return;
  closeOverlays();
  // A take waiting for its answer stays answerable: Wait for me grades nothing and never moves the ladder.
  player.pause();
  el('piece-session').hidden = true;
  endReveal();
  endMoment(false);
  resetLive();
  lastFrame = 0;
  const { mine, auto } = reachSplit(exercise);
  wait = new WaitRun(mine, bpmNow());
  autoQueue = auto;
  autoKeys = new Set(auto.flatMap((e) => e.notes.map((n) => noteKey(e.beat, n.midi))));
  for (const k of autoKeys) wait.hits.add(k);
  void audio.prepare().then(
    () => audio.lockPiano(),
    () => {},
  );
  say('wait-start');
}
function stopWait(said = false): void {
  if (!wait) return;
  wait = undefined;
  audio.lockPiano(false);
  if (said) say('wait-stopped');
}
function finishWait(run: WaitRun): void {
  const { notes, mistakes, seconds } = run.summary();
  wait = undefined;
  audio.lockPiano(false);
  session.seconds += seconds;
  progress.log = logDay(progress.log, Date.now(), { seconds });
  persist();
  paintToday();
  say('wait-done', { notes, mistakes, seconds });
  if (mistakes === 0) celebrate();
}
function persist(): void {
  try {
    saveTracked(pieceProgressKey, JSON.stringify(progress));
    el('piece-storage').textContent = 'Progress stays in this browser. Audio is never saved automatically.';
  } catch {
    el('piece-storage').textContent = 'Storage is unavailable: progress will last only for this page.';
  }
}
const title = (id: string) => units().find((u) => u.id === id)?.title ?? id;
function stateLabel(u: Unit): string {
  const p = get(u.id),
    state = unitState(u, p, Date.now());
  if (u.kind === 'listen') return p?.attempts ? 'heard' : 'start here';
  if (state === 'covered') return `same as ${title(u.sameAs!)}`;
  const bpm = rungBpm(u, p ?? initialUnit());
  return state === 'new'
    ? `begin at ${bpm} BPM`
    : state === 'practising'
      ? `${bpm} BPM · tempo ${Math.min(p!.rung, u.rungs.length - 1) + 1} of ${u.rungs.length}`
      : state === 'done'
        ? u.rungs[u.rungs.length - 1] < 1
          ? 'done · top for one hand'
          : 'done'
        : state === 'due'
          ? 'review due'
          : 'learned';
}

function loadPack(id: string): void {
  audio.stop();
  player.pause();
  spot = undefined;
  choice = undefined;
  offer = undefined;
  const all = packs();
  pack = all.find((p) => p.id === id) ?? all[0];
  const compiled = compile(pack.text);
  if (!compiled.score) {
    say(
      'piece-error',
      compiled.diagnostics
        .slice(0, 3)
        .map((d) => `line ${d.line}: ${d.message}`)
        .join(' '),
    );
    return;
  }
  score = compiled.score;
  {
    const midis = score.notes.map((n) => n.midi);
    if (midis.length) audio.pianoRange = [Math.min(...midis), Math.max(...midis)];
  }
  curriculum = buildCurriculum(score, goal());
  arrangement = arrange(score);
  gUnits = guitarUnits(score, arrangement, goal());
  pieceArr = arrangePiece(score);
  pUnits = guitarPieceUnits(score, pieceArr, goal());
  progress.selected.piece = pack.id;
  paintPicker(all);
  el('piece-title').textContent = score.meta.title;
  el('piece-composer').textContent = score.meta.composer;
  el('piece-summary').textContent = curriculum.summary.slice(1).join(' · ');
  paintVerified();
  el<HTMLInputElement>('piece-goal').value = String(goal());
  el('piece-goal-help').textContent = `Marked "${score.tempo.text || 'no tempo'}"; ${score.tempo.bpm} BPM suggested`;
  paintAbout();
  const wanted =
    progress.selected.unit && units().some((u) => u.id === progress.selected.unit) ? progress.selected.unit : landing();
  selectUnit(wanted);
}
/** The piece picker (pickerLabel: his own pieces say "yours", and "draft" until he has confirmed them by ear). */
function paintPicker(all = packs()): void {
  el<HTMLSelectElement>('piece-select').innerHTML = all
    .map((p) => {
      const meta = pieceMeta(p.text);
      return `<option value="${escape(p.id)}"${p.id === pack.id ? ' selected' : ''}>${escape(pickerLabel(meta.title ?? p.id, p.origin, meta.verified))}</option>`;
    })
    .join('');
}
function paintVerified(): void {
  el('piece-verified').textContent =
    pack.origin === 'mine' && isDraft(score.meta.verified)
      ? 'Draft: listen with Hear the whole piece, then confirm it under Add your own piece'
      : {
          sources: 'Notes checked against an independent source',
          owner: 'Notes confirmed by you',
          checks: 'Notes compiled and checked; listen through once',
          none: 'Notes not yet checked',
        }[score.meta.verified];
}
function paintAbout(): void {
  const spans = chordSpans(score),
    counts = new Map<string, number>();
  for (const s of spans) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  el('piece-about-body').innerHTML =
    `<p>${escape(curriculum.summary.join('. '))}.</p><p class="muted">${escape(score.meta.source)}${score.meta.licence ? ` · ${escape(score.meta.licence)}` : ''}</p>
    <h3>Sections</h3><ul class="plain">${score.sections.map((s) => `<li><strong>${escape(s.name.replace(/(\d)$/, ' $1'))}</strong> · bars ${score.bars[s.from].number}–${score.bars[s.to].number}. ${escape(s.note ?? '')}</li>`).join('')}</ul>
    <h3>Chords</h3><p>${[...counts.entries()].map(([s, n]) => `${escape(prettyChord(s))} <span class="muted">×${n}</span>`).join(' · ')}</p>
    <h3>Play it on guitar</h3><p>${pieceArr.review.map((line) => escape(line)).join(' ')}</p>
    <h3>Guitar accompaniment</h3><p>${arrangement.capo ? `Capo at fret ${arrangement.capo}. ` : 'No capo. '}Bass note on beat 1, then index, middle and ring fingers together, letting the chord ring like the piano's left hand.${arrangement.review.length ? ` Simplified: ${escape(arrangement.review.join(' '))}` : ''}</p><div class="unit-shapes">${arrangement.shapes.map((s) => chordBox(s, arrangement.capo)).join('')}</div>`;
}
/**
 * The pitch ear starts loading when a guitar step that checks pitch is opened, so its first take need not wait. The
 * step the page opens on waits for the first paint and an idle moment (as the guitar course does): fetching and
 * starting the model would otherwise slow the page as it opens.
 */
let painted = false;
function prepareEar(): void {
  if (painted) audio.prepareFor(exercise);
}
const stepExercise = () =>
  instrument === 'piano'
    ? exerciseFor(score, unit)
    : pieceCourse()
      ? pieceExercise(score, pieceArr, unit)
      : guitarExerciseFor(score, arrangement, unit);
function selectUnit(id: string): void {
  const dropped = Boolean(pending);
  audio.stop();
  player.pause();
  stopWait();
  resetLive();
  endReveal();
  endMoment(false);
  pending = undefined;
  manualBpm = undefined;
  spot = undefined;
  choice = undefined;
  offer = undefined;
  placeAt = undefined;
  placing = undefined;
  lastTake = '';
  pop = undefined;
  placedNow = false;
  el<HTMLDetailsElement>('piece-about-step').open = false;
  unit = units().find((u) => u.id === id) ?? units()[0];
  exercise = stepExercise();
  prepareEar();
  progress.selected.unit = unit.id;
  progress.selected.instrument = instrument;
  const stages = stagesNow();
  el('unit-stage').textContent = `${String(unit.stage + 1).padStart(2, '0')} · ${stages[unit.stage].toUpperCase()}`;
  el('unit-title').textContent = unit.title;
  el('unit-goal').textContent = unit.goal;
  el('unit-caption').textContent = firstSentence(unit.goal);
  const missing = unit.requires.filter((r) => !ready({ ...unit, requires: [r] }, get)).map((r) => title(r.id));
  el('unit-why').textContent =
    `${unit.why}${unit.difficulty?.reasons.length ? ` Watch for: ${unit.difficulty.reasons.join(', ')}.` : ''}${missing.length ? ` Suggested first: ${missing.slice(0, 3).join('; ')}.` : ''}${capNote(unit) ? ` ${capNote(unit)}` : ''}`;
  const part = (hand: 'L' | 'R') =>
    pieceCourse() ? (hand === 'L' ? ' bass' : ' melody') : hand === 'L' ? ' left' : ' right';
  el('unit-text').textContent = exercise.events
    .map((e) => {
      const at = barAt(exercise, e.beat);
      return `Bar ${at.number}, beat ${at.beat}: ${e.notes.map((n) => `${noteName(n.midi, exercise.keySig)}${n.finger ? ` finger ${n.finger}` : ''}${part(n.hand)}`).join(', ')}`;
    })
    .join('. ');
  el('unit-shapes').innerHTML = exercise.shapes
    ? exercise.shapes
        .filter((s, i, all) => all.findIndex((x) => x.name === s.name) === i)
        .map((s) => chordBox(s, exercise.capo))
        .join('')
    : '';
  applyInput();
  const backing = el<HTMLInputElement>('piece-backing');
  const other = pieceCourse()
    ? unit.hands.length === 1 && unit.bars.length > 0 && unit.kind !== 'drill'
    : instrument === 'guitar'
      ? ['section', 'performance'].includes(unit.kind)
      : unit.hands.length === 1 && unit.bars.length > 0 && unit.kind !== 'drill';
  backing.parentElement!.hidden = !other;
  backing.checked = other && instrument === 'guitar' && !pieceCourse();
  paintWait();
  el('piece-backing-label').textContent = pieceCourse()
    ? 'Play the other part with me (headphones)'
    : instrument === 'guitar'
      ? 'Play the melody with me (headphones)'
      : 'Play the other hand with me (headphones)';
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  el('piece-start').textContent = unit.kind === 'listen' ? 'Listen' : 'Start practice';
  el('piece-result').hidden = true;
  notice = undefined;
  if (dropped) say('unanswered');
  paintCourse();
  paintToday();
  persist();
}
function paintCourse(): void {
  const list = units(),
    stages = stagesNow(),
    now = Date.now();
  const earned = pieceStars(list, get),
    stars = (u: Unit) => {
      const s = starsFor(list, u, get, now);
      return s ? starsHtml(s) : '';
    };
  el('course-count').textContent = `· all ${list.filter((u) => !u.sameAs).length} steps · ${starCount(earned)}`;
  if (unit) el('unit-stars').innerHTML = stars(unit);
  el('course-list').innerHTML = stages
    .map((name, i) => {
      const members = list.filter((u) => u.stage === i);
      if (!members.length) return '';
      return `<div class="course-stage">${i + 1} · ${escape(name)}</div>${members.map((u) => `<button class="course-lesson${u.sameAs ? ' covered' : ''}" data-unit="${escape(u.id)}" aria-current="${u.id === unit?.id}"><span>${escape(u.title)}${!u.sameAs && !ready(u, get) ? ' <span class="muted">· later</span>' : ''}${u.optional ? ' <span class="muted">· optional</span>' : ''}</span><span>${stars(u)}${escape(stateLabel(u))}</span></button>`).join('')}`;
    })
    .join('');
  // The headline progress: a map of the piece from saved progress only.
  const map = pieceMap(score, list, get, now, instrument, unit?.id);
  el('map-count').textContent = `· ${map.headline}`;
  el('map-body').innerHTML = map.html;
}
/** Today's checklist for this course, fixed the first time it is shown each day so that it has an end. */
const courseKey = () => `${pack.id}${courseTag()}`;
function todayPlan(): PlanRow[] {
  const now = Date.now(),
    day = dayOf(now),
    saved = progress.today[courseKey()];
  if (saved?.day === day)
    return saved.rows.flatMap((r) => {
      const u = units().find((x) => x.id === r.id);
      return u ? [{ unit: u, reason: r.reason, slot: r.slot }] : [];
    });
  const rows = suggestToday({ ...curriculum, units: units() }, get, now);
  for (const [k, t] of Object.entries(progress.today)) if (t.day !== day) delete progress.today[k];
  progress.today[courseKey()] = { day, rows: rows.map((r) => ({ id: r.unit.id, reason: r.reason, slot: r.slot })) };
  return rows;
}
const takesToday = (id: string) => {
  const day = dayOf(Date.now());
  return progress.history.filter((h) => h.piece === pack.id && h.unit === id && dayOf(h.date) === day);
};
const isDone = (r: PlanRow) => rowDone(r, get(r.unit.id), takesToday(r.unit.id), Date.now());
/** Where a visit lands: the first unfinished row of today's plan. */
const landing = () => {
  const plan = todayPlan();
  return (plan.find((r) => !isDone(r)) ?? plan[0])?.unit.id ?? units()[0].id;
};
/** The next step: today's first unfinished row, then fresh suggestions once the plan is done. Continuing is always allowed. */
function nextRow(): PlanRow | undefined {
  const fresh = suggestToday({ ...curriculum, units: units() }, get, Date.now());
  return (
    [...todayPlan(), ...fresh].find((r) => r.unit.id !== unit.id && !isDone(r)) ??
    fresh.find((r) => r.unit.id !== unit.id && r.slot === 'phrase') ??
    fresh.find((r) => r.unit.id !== unit.id)
  );
}
const todayLog = () => week(progress.log, Date.now()).days[6];
function paintToday(): void {
  const plan = todayPlan(),
    done = plan.map(isDone),
    finished = plan.length > 0 && done.every(Boolean);
  el('today-list').innerHTML =
    plan
      .map(
        (p, i) =>
          `<li><button class="today-step${done[i] ? ' done' : ''}" data-unit="${escape(p.unit.id)}" aria-current="${p.unit.id === unit?.id}"><span>${done[i] ? '<span class="tick" aria-hidden="true">✓</span> ' : ''}${escape(p.unit.title)}</span><span class="muted">${done[i] ? 'done today' : escape(p.reason)} · ${escape(stateLabel(p.unit))}</span></button></li>`,
      )
      .join('') ||
    '<li class="muted">Everything here is learned. Play the whole piece, or choose a review from the map.</li>';
  el('today-count').textContent = plan.length ? `· ${done.filter(Boolean).length} of ${plan.length} done` : '';
  const chip = todayChip(done.filter(Boolean).length, plan.length);
  el('piece-today-long').textContent = chip.long;
  el('piece-today-short').textContent = chip.short;
  el('piece-today-chip').setAttribute('aria-label', chip.label);
  el('piece-today-ring').setAttribute(
    'stroke-dasharray',
    `${plan.length ? Math.round((done.filter(Boolean).length / plan.length) * 100) : 0} 100`,
  );
  const log = todayLog(),
    moved = session.notes.length ? ` ${session.notes.join('. ')}.` : '';
  el('today-done').hidden = !finished;
  el('today-done').textContent = finished
    ? `Today's plan is done: ${plan.length} step${plan.length > 1 ? 's' : ''} played, ${log.clean} clean take${log.clean === 1 ? '' : 's'} today.${moved} Keep going if you like; the next step is ready.`
    : '';
  el('piece-next').textContent = el('piece-next-stage').textContent = finished ? 'Keep going' : "Next in today's plan";
  paintRhythm();
  paintJournal();
}
/** Clean work today against the learner's own aim, the last seven days and days played this week. Nothing resets. */
function paintRhythm(): void {
  const now = Date.now(),
    w = week(progress.log, now),
    today = w.days[6],
    aim = progress.dailyGoal;
  el('today-clean').textContent =
    `Clean takes today: ${today.clean} of ${aim}${today.clean >= aim ? ' · aim reached' : ''}`;
  el('today-meter').querySelector('i')!.style.width = `${Math.min(100, Math.round((today.clean / aim) * 100))}%`;
  el<HTMLSelectElement>('piece-daily-goal').value = String(aim);
  const top = Math.max(aim, ...w.days.map((d) => d.clean)),
    names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  el('today-week').innerHTML = `<span class="week-days">${w.days
    .map((d) => {
      const name = names[new Date(`${d.day}T12:00:00`).getDay()],
        label = `${d.day}: ${d.clean} clean of ${d.takes} take${d.takes === 1 ? '' : 's'}`;
      return `<span class="week-day${d.takes ? ' played' : ''}" title="${label}" aria-label="${label}"><span class="week-bar"><i style="height:${d.clean ? Math.max(12, Math.round((d.clean / top) * 100)) : 0}%"></i></span>${name}</span>`;
    })
    .join('')}</span><span class="muted">Days played this week: ${w.played}</span>`;
}
/** This piece's takes today, one line per step: takes, clean takes, best trusted score. */
function paintJournal(): void {
  const day = dayOf(Date.now()),
    rows = new Map<string, { takes: number; clean: number; best: number }>();
  for (const h of progress.history)
    if (h.piece === pack.id && dayOf(h.date) === day && units().some((u) => u.id === h.unit)) {
      const r = rows.get(h.unit) ?? { takes: 0, clean: 0, best: -1 };
      r.takes++;
      if (h.clean) r.clean++;
      if (h.trusted) r.best = Math.max(r.best, h.score);
      rows.set(h.unit, r);
    }
  el('piece-journal-list').innerHTML = rows.size
    ? [...rows]
        .map(
          ([id, r]) =>
            `<div class="journal-entry"><span>${escape(title(id))}</span><span class="muted">${r.takes} take${r.takes > 1 ? 's' : ''} · ${r.clean} clean${r.best >= 0 ? ` · best ${floorPct(r.best)}%` : ''}</span></div>`,
        )
        .join('')
    : '<p class="muted">No takes of this piece yet today.</p>';
}
function otherPart(): XEvent[] {
  if (!el<HTMLInputElement>('piece-backing').checked || audio.mode !== 'headphones') return [];
  if (pieceCourse()) {
    const hands = spot?.hands ?? unit.hands;
    if (hands.length !== 1) return [];
    return otherLayer(score, pieceArr, spot ? unit.bars.slice(spot.from, spot.to + 1) : unit.bars, hands[0]);
  }
  if (instrument === 'guitar') return melodyBacking(score, unit.bars);
  const other = unit.hands[0] === 'L' ? 'R' : 'L';
  return fromBars(score, spot ? unit.bars.slice(spot.from, spot.to + 1) : unit.bars, [other], 'backing', 'backing')
    .events;
}
/** place: a placement take aimed at that tempo step. */
async function start(kind: 'practice' | 'demo', place?: number): Promise<void> {
  if (
    place !== undefined &&
    (kind !== 'practice' || wait || spot || unit.kind === 'listen' || !canPlace(unit, current(), place))
  )
    return;
  if (place === undefined && el('piece-bpm').getAttribute('aria-invalid') === 'true') {
    say('bpm-invalid');
    return;
  }
  endReveal();
  endMoment(false);
  // A finished take is kept until it is answered (NEXT TAKE says so); hearing the demo meanwhile does not drop it.
  if (pending && kind === 'practice' && unit.kind !== 'listen') {
    el(defaultComfort() ? 'piece-comfortable' : 'piece-struggling').focus();
    return;
  }
  closeOverlays();
  notice = undefined;
  focusAnswer = false;
  if (kind === 'practice') placedNow = false;
  player.pause();
  el('piece-session').hidden = true;
  resetLive();
  if (kind === 'practice') {
    pending = undefined;
    choice = undefined;
    offer = undefined;
    el('piece-result').hidden = true;
    // The lane is sized only while nothing plays: give it back its full height before this take begins.
    document.querySelector('main.piece')!.classList.remove('slot-taken', 'card-open');
    shown.delete('stage');
    layoutLane();
  }
  if (unit.kind === 'listen') {
    listenId = key(unit.id);
    await audio.start(exercise, unit.id, goal(), 'demo');
    listenPlan = audio.plan;
    return;
  }
  // New short steps are demonstrated once before the count-in; long sections are not (use Hear it).
  const demonstrate =
    !spot && place === undefined && kind === 'practice' && !heard.has(unit.id) && !unit.sameAs && exercise.beats <= 24;
  const { mine, auto } = kind === 'practice' ? reachSplit(exercise) : { mine: exercise, auto: [] };
  autoKeys = new Set(auto.flatMap((e) => e.notes.map((n) => noteKey(e.beat, n.midi))));
  if (kind === 'practice') placing = place;
  audio.offsetLatency = progress.latency;
  await audio.start(
    mine,
    spot ? spot.id : unit.id,
    place !== undefined ? rungBpm(unit, { ...current(), rung: place }) : bpmNow(),
    kind,
    spot || place !== undefined ? 0 : current().support,
    progress.offset,
    demonstrate,
    kind === 'practice' ? [...otherPart(), ...auto] : [],
  );
  if (kind === 'demo' || demonstrate) heard.add(unit.id);
  if (
    !usingKeys() &&
    audio.deviceKey &&
    progress.calibrated &&
    progress.calibrationKey &&
    progress.calibrationKey !== audio.deviceKey
  ) {
    progress.calibrated = false;
    el('piece-calibration-feedback').textContent = 'The audio path changed. Recalibrate to count tempo steps.';
    say('path-changed');
    persist();
  }
}
/** The listen step counts as heard only after the whole piece has played to its end. */
let listenPlan: unknown,
  listenId = '';
audio.onDemoEnd = (plan) => {
  if (plan !== listenPlan) return;
  listenPlan = undefined;
  const id = listenId || progressId(pack.id, 'listen'),
    p = { ...(progress.units[id] ?? initialUnit()) };
  p.attempts++;
  p.last = Date.now();
  progress.units[id] = p;
  persist();
  paintToday();
  paintCourse();
};
function showTake(take: PieceTake): void {
  URL.revokeObjectURL(wavUrl);
  URL.revokeObjectURL(traceUrl);
  const keys = Boolean(take.presses);
  traceUrl = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            piece: pack.id,
            unit: take.unit,
            instrument,
            bpm: take.bpm,
            support: take.support,
            offset: take.offset,
            result: take.result,
            presses: take.presses,
            interruption: take.interruption,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  // Keys takes have no audio: they replay on the piano voice with the lane instead.
  for (const id of ['piece-player', 'piece-loop', 'piece-download']) el(id).hidden = keys;
  el('piece-review-note').textContent = keys
    ? 'Your keys replay on the piano sound while the notes scroll. Takes stay in this page.'
    : 'Playback stops the microphone. Takes stay in this page.';
  el<HTMLAnchorElement>('piece-trace').href = traceUrl;
  el('piece-review').hidden = false;
  el('piece-last-empty').hidden = true;
  el('piece-take').textContent = `${take.exercise.title} · ${take.bpm} BPM`;
  if (keys) return;
  wavUrl = URL.createObjectURL(new Blob([audio.wav(take)!], { type: 'audio/wav' }));
  player.src = wavUrl;
  el<HTMLAnchorElement>('piece-download').href = wavUrl;
  el<HTMLAnchorElement>('piece-trace').href = traceUrl;
  el<HTMLAnchorElement>('piece-download').download =
    `${pack.id}-${take.unit.replace(/[^\w-]+/g, '_')}-${take.bpm}bpm.wav`;
  el('piece-review').hidden = false;
  el('piece-take').textContent = `${take.exercise.title} · ${take.bpm} BPM`;
}
/**
 * The end of a take: the result is rendered at once in its final form, then revealed. Lane notes turn to their verdict
 * colours in a quick sweep while the on-time share counts up, then the callouts appear. Any key or click skips to the
 * end. Untrusted takes, the calm look and reduced motion show the final state at once and are never celebrated.
 */
let reveal:
    | { start: number; ms: number; first: number; last: number; final: number; score: number; celebrate: boolean }
    | undefined,
  revealBeat = 0;
const defaultComfort = () => {
  const r = pending?.take.result;
  return !r || !r.trusted || r.score >= 0.65;
};
/** Personal bests for a step at this tempo and input; only trusted, timed takes count. Returns what the take beat. */
function recordBest(take: PieceTake, trusted: boolean, now: number): string[] {
  const result = take.result!,
    keys = Boolean(take.presses),
    id = bestKey(key(take.unit), take.bpm, keys);
  const compared = compareTake(
    progress.bests[id],
    {
      score: result.score,
      timing: result.timing,
      tight: tightness(result.events, !keys),
      support: take.support,
      date: now,
    },
    trusted,
    !keys,
  );
  if (compared.after) {
    progress.bests[id] = compared.after;
    pruneBests(progress.bests);
  }
  return compared.wins;
}
audio.onTake = (take) => {
  const played = take.presses ? (take.exercise.beats * 60) / take.bpm : take.samples.length / take.rate;
  session.takes++;
  session.seconds += played;
  take.calibrated = timed(take);
  const place = placing;
  placing = undefined;
  // The day log counts every take and its seconds; clean takes are added only when the answer confirms one.
  progress.log = logDay(progress.log, Date.now(), { takes: 1, seconds: played });
  showTake(take);
  const result = take.result;
  if (!result) return;
  endMoment(false);
  const keys = Boolean(take.presses),
    trusted = result.trusted && timed(take),
    now = Date.now();
  const wins: string[] = [],
    isSpot = Boolean(spot && take.unit === spot.id);
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
  const autoCount = take.presses ? autoKeys.size : 0,
    period = 60 / take.bpm;
  if (keys && trusted) {
    const line = keyWin(keyStats(result.events).perfect, Math.round(keyPerfect(period) * 1000));
    if (line) wins.push(line);
  }
  // The card's longest run is the live counter's own count at the end of the take, so the two always agree.
  const run = keys && trusted && take.presses ? takeRun(take.exercise, take.bpm, take.presses) : undefined;
  const placed = result.events.filter((e) => e.mark === 'good').length;
  if (trusted && !wins.length) wins.push(`${placed} of ${result.events.length} attacks on time.`);
  const clean =
    result.events.every(
      (e) =>
        e.mark === 'good' &&
        e.notes.every(
          (n) =>
            n.verdict === 'heard' ||
            n.verdict === 'unchecked' ||
            n.verdict === 'cannot-check' ||
            n.verdict === 'unclear',
        ),
    ) &&
    !result.extras &&
    !result.extraNotes.length;
  el('piece-wins').innerHTML = wins.map((w) => `<li>${escape(w)}</li>`).join('');
  // The take's own coaching line stays on the card (an untrusted take's reason is already on its score); the question is asked once, above the answer buttons.
  el('piece-fix').textContent = (
    (!result.trusted ? '' : clean ? result.feedback : `One thing to try: ${result.feedback}`) +
    (timed(take) ? '' : ' Timing is an estimate until you calibrate; tempo steps wait for calibration.') +
    (autoCount
      ? ` ${autoCount} note${autoCount > 1 ? 's' : ''} out of reach of the computer keys ${autoCount > 1 ? 'were' : 'was'} played for you and not graded.`
      : '')
  ).trim();
  el('piece-comfort-ask').hidden = isSpot;
  el('piece-comfortable').parentElement!.hidden = isSpot;
  for (const [id, yes] of isSpot
    ? []
    : ([
        ['piece-comfortable', defaultComfort()],
        ['piece-struggling', !defaultComfort()],
      ] as const)) {
    el(id).classList.toggle('primary', yes);
    el(id).innerHTML =
      `<kbd>${id === 'piece-comfortable' ? '↑' : '↓'}</kbd> ${id === 'piece-comfortable' ? 'Felt comfortable' : 'Needs more room'}${yes ? ' <span class="kbd-or">or <kbd>Space</kbd></span>' : ''}`;
  }
  if (!isSpot) {
    const [ask, space] = comfortAsk(defaultComfort()).split(/(?=Space = )/);
    el('piece-comfort-ask').innerHTML =
      `${escape(ask.trim())} <span class="comfort-default">${escape(space ?? '')}</span>`;
    const owner = units().find((x) => x.id === take.unit),
      lines = owner && pending ? answerLines(owner, pending.before, takeFacts(pending), now) : undefined;
    el('piece-comfortable-note').textContent = lines?.comfortable ?? '';
    el('piece-struggling-note').textContent = lines?.struggling ?? '';
  }
  el('piece-score').hidden = isSpot;
  el('piece-take-status').textContent = isSpot ? '' : takeStatus(result);
  el('piece-score').innerHTML = scoreHtml({
    trusted: result.trusted,
    reason: result.reason,
    score: result.score,
    timing: result.timing,
    pitch: result.pitch,
    keys,
    estimate: !timed(take),
    run,
  });
  paintToday();
  const notes = result.events.flatMap((e) => e.notes),
    count = (v: string) => notes.filter((n) => n.verdict === v).length;
  const marks = result.events.map((e) => e.mark),
    mark = (m: string) => marks.filter((x) => x === m).length;
  const final = floorPct(result.timing);
  el('piece-metrics').innerHTML = metricsHtml({
    trusted: result.trusted,
    timing: result.timing,
    pitch: result.pitch,
    keys,
    timed: timed(take),
    piano: instrument === 'piano',
  });
  el('piece-verdicts').innerHTML = [
    ['heard', 'heard', count('heard')],
    ['wrong', 'wrong or missing', count('wrong') + count('not-heard')],
    ['unclear', 'unclear', count('unclear')],
    ['cannot', "can't check", count('cannot-check')],
    ['missed', 'attacks missed', mark('missed')],
    ['unsure', 'attacks unsure', mark('unsure')],
  ]
    .filter(([, , n]) => Number(n) > 0)
    .map(
      ([cls, label, n]) =>
        `<span class="verdict ${cls}">${n} ${n === 1 ? String(label).replace('attacks', 'attack') : label}</span>`,
    )
    .join('');
  el('piece-strip').innerHTML = timed(take) ? timingStrip(result, period, !keys) : '';
  const problems = result.events
    .filter((e) => e.mark !== 'good' || e.notes.some((n) => n.verdict === 'wrong' || n.verdict === 'not-heard'))
    .slice(0, 8)
    .map((e) => {
      const at = barAt(take.exercise, e.beat),
        wrong = e.notes
          .filter((n) => n.verdict === 'wrong' || n.verdict === 'not-heard')
          .map((n) =>
            n.verdict === 'wrong'
              ? `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'played' : 'sounded'} as ${noteName(n.heardAs!, take.exercise.keySig)}`
              : `${noteName(n.midi, take.exercise.keySig)} ${take.presses ? 'missing' : 'not heard'}`,
          );
      return `bar ${at.number} beat ${at.beat}: ${e.mark}${e.offset !== undefined && e.mark !== 'good' ? ` (${e.offset > 0 ? '+' : ''}${Math.round(e.offset * 1000)} ms)` : ''}${wrong.length ? `, ${wrong.join(', ')}` : ''}`;
    });
  el('piece-details').textContent =
    `${problems.join(' · ')}${result.extraNotes.length ? ` · possible extra note${result.extraNotes.length > 1 ? 's' : ''} near ${[...new Set(result.extraNotes.map((x) => noteName(x.midi, take.exercise.keySig)))].join(', ')}` : ''}${result.trusted ? '' : ` · ${result.reason}`}${Math.abs(result.tuning) >= 8 ? ` · your piano reads about ${Math.round(result.tuning)} cents from A440; checks allowed for it` : ''}`;
  const hint = !isSpot && spotOffered(instrument, unit) ? pickSpot(take.exercise, result, timed(take)) : undefined;
  el('piece-spot-hint').hidden = !hint || hint === 'choose';
  if (hint && hint !== 'choose')
    el('piece-spot-hint').textContent =
      `Practise ${barsText(problemNumbers(unit, hint))}: that is where this take's confirmed problems are.`;
  if (isSpot) {
    spot!.clean = trusted && clean ? spot!.clean + 1 : 0;
    choice = 'pass';
    paintChoices();
  }
  el('piece-result').hidden = false;
  persist();
  focusAnswer = !isSpot;
  const beats = result.events.map((e) => e.beat),
    first = Math.min(...beats, 0),
    last = Math.max(...beats, 0);
  reveal = {
    start: performance.now(),
    ms: Math.min(1200, 400 + 45 * result.events.length),
    first,
    last,
    final,
    score: result.score,
    celebrate: trusted && result.score >= CLEAN,
  };
  el('piece-result').classList.add('revealing');
  if (!trusted || !lively()) endReveal();
  else {
    // Lively: the stars fill one by one as the count rises (stepReveal); calm and reduced motion show them filled.
    el('piece-score').querySelector('.take-stars')?.classList.add('filling');
    stepReveal();
  }
};
/** The per-attack timing strip: early above the line, late below, the on-time band shaded. Unsure attacks stay neutral. */
function timingStrip(result: PieceGrade, period: number, approx: boolean): string {
  const events = result.events,
    n = events.length;
  if (!n) return '';
  const reach = keyReach(period),
    band = keyWindow(period),
    W = 520,
    H = 60,
    mid = H / 2,
    y = (o: number) => mid + Math.max(-1, Math.min(1, o / reach)) * (mid - 6);
  const x = (i: number) => (n === 1 ? W / 2 : 10 + (i * (W - 20)) / (n - 1));
  const dots = events
    .map((e, i) =>
      e.offset !== undefined
        ? `<circle data-beat="${e.beat}" cx="${x(i).toFixed(1)}" cy="${y(e.offset).toFixed(1)}" r="3.4" class="dot ${e.mark === 'good' ? 'good' : 'off'}"/>`
        : `<circle data-beat="${e.beat}" cx="${x(i).toFixed(1)}" cy="${mid}" r="3" class="dot ${e.mark === 'unsure' ? 'unsure' : 'missed'}"/>`,
    )
    .join('');
  const summary = timingSummary(events, approx);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timing of each attack. ${escape(summary)}"><rect x="0" y="${(mid - (band / reach) * (mid - 6)).toFixed(1)}" width="${W}" height="${(2 * (band / reach) * (mid - 6)).toFixed(1)}" class="band"/><line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="beat"/>${dots}</svg><div class="strip-legend"><span>early ↑ · late ↓</span><span>${escape(summary)}</span></div>`;
}
function stepReveal(): void {
  if (!reveal) return;
  const t = (performance.now() - reveal.start) / reveal.ms;
  if (t >= 1) {
    endReveal();
    return;
  }
  revealBeat = reveal.first + (reveal.last - reveal.first + 0.001) * t;
  const count = document.getElementById('piece-count'),
    shownCount = `${Math.floor(reveal.final * countUp(t))}%`;
  if (count && count.textContent !== shownCount) count.textContent = shownCount;
  const filled = revealStars(reveal.score, t);
  el('piece-score')
    .querySelectorAll('.take-stars .star.on')
    .forEach((star, i) => star.classList.toggle('later', i >= filled));
  const hidden = shown.get('strip-beat'),
    at = String(Math.floor(revealBeat * 4));
  if (hidden !== at) {
    shown.set('strip-beat', at);
    for (const c of el('piece-strip').querySelectorAll<SVGElement>('[data-beat]'))
      c.classList.toggle('later', Number(c.dataset.beat) > revealBeat);
  }
}
/** Jumps a reveal to its end state: final number, every dot, the callouts, and the small spark for a clean take. */
function endReveal(): void {
  const r = reveal;
  if (!r) return;
  reveal = undefined;
  if (choice) choiceAt = performance.now();
  shown.delete('strip-beat');
  const count = document.getElementById('piece-count');
  if (count) count.textContent = `${r.final}%`;
  for (const c of el('piece-strip').querySelectorAll('.later')) c.classList.remove('later');
  for (const star of el('piece-score').querySelectorAll('.star.later')) star.classList.remove('later');
  el('piece-result').classList.remove('revealing');
  layoutDirty = true;
  if (r.celebrate && lively()) celebrate('small');
}
/** A milestone moment after an answer, then (unless the step is now learned or reviewed) the next take. */
let after: { until: number; next: boolean } | undefined;
function endMoment(startNext: boolean): void {
  const a = after;
  if (!a) return;
  after = undefined;
  clearMoment();
  if (startNext && a.next) void start('practice');
}
audio.onCalibration = (result) => {
  el('piece-calibration-feedback').textContent = result.message;
  say('calibration', { ok: result.ok, message: result.message });
  if (result.ok) {
    progress.offset = result.offset;
    progress.latency = result.latency;
    progress.calibrated = true;
    progress.calibrationKey = audio.deviceKey;
    el<HTMLInputElement>('piece-offset').value = String(Math.round(result.offset * 1000));
    persist();
  }
};
/** A placement take's answer: placed moves the step (and its one-hand steps) and records the take as clean; otherwise nothing is recorded. */
function placeTake(u: Unit, done: NonNullable<typeof pending>, comfortable: boolean): AdvanceEvent {
  const now = Date.now(),
    t = done.place!,
    result = done.take.result!,
    r = placeUnit(u, done.before, t, result, comfortable, now, timed(done.take));
  placeAt = undefined;
  ladderSaid = r.message;
  if (r.placed) {
    done.entry.clean = true;
    progress.history.push(done.entry);
    progress.history = progress.history.slice(-200);
    recordBest(done.take, result.trusted && timed(done.take), now);
    progress.log = logDay(progress.log, now, { clean: 1 });
    progress.units[key(u.id)] = r.progress;
    for (const [id, p] of placeHands(units(), u, u.rungs[t], get)) progress.units[key(id)] = p;
    session.notes.push(`${u.title}: placed at ${done.take.bpm} BPM`);
  }
  manualBpm = undefined;
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  paintCourse();
  paintToday();
  persist();
  return r.event;
}
/** The answered take as the ladder sees it, for the card's consequence lines and LAST TAKE. */
const takeFacts = (done: NonNullable<typeof pending>): TakeFacts => ({
  bpm: done.take.bpm,
  place: done.place,
  result: done.take.result!,
  calibrated: timed(done.take),
});
function nextTake(comfortable: boolean): AdvanceEvent | undefined {
  const done = pending;
  if (!done?.take.result) return;
  pending = undefined;
  el('piece-result').hidden = true;
  const u = units().find((x) => x.id === done.take.unit);
  if (!u) return;
  const route = routeTake(u, done.before, { bpm: done.take.bpm, place: done.place });
  if (route === 'place') return placeTake(u, done, comfortable);
  if (route === 'free') {
    done.entry.clean = false;
    persist();
    paintToday();
    ladderSaid = `Free tempo: tempo steps count at ${rungBpm(u, done.before)} BPM, the tempo you are on.`;
    return;
  }
  const change = advanceUnit(u, done.before, done.take.result, comfortable, Date.now(), timed(done.take));
  // Clean is the ladder's own judgement: trusted, calibrated, 80% or better and comfortable.
  done.entry.clean = change.event.clean;
  if (change.event.clean) progress.log = logDay(progress.log, Date.now(), { clean: 1 });
  progress.units[key(u.id)] = change.progress;
  ladderSaid = change.message;
  if (change.event.overnight) session.notes.push(`${u.title}: stuck overnight`);
  if (change.progress.learned && !done.before.learned) session.notes.push(`${u.title}: learned`);
  else if (change.progress.certified.length > done.before.certified.length)
    session.notes.push(
      `${u.title}: certified at ${Math.round(change.progress.certified[change.progress.certified.length - 1] * 100)}%`,
    );
  manualBpm = undefined;
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  paintCourse();
  paintToday();
  persist();
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
  const taken = pending?.take,
    place = pending?.place,
    before = current(),
    owner = units().find((x) => x.id === pending!.take.unit);
  const chip =
    owner && pending!.take.result
      ? outcome(owner, pending!.before, takeFacts(pending!), comfortable, Date.now()).chip
      : '';
  ladderSaid = '';
  notice = undefined;
  placedNow = false;
  const starsBefore = pending!.before;
  const event = nextTake(comfortable),
    message = ladderSaid;
  // A new star is named only when the saved progress (a counted, confirmed answer) earned it.
  const news = owner && event ? starNews(owner, starsBefore, get(owner.id) ?? starsBefore) : undefined;
  if (event?.kind === 'placed') placedNow = true;
  // Every look names the new star on the Last take line, and a screen reader hears it; the lively look also shows it below.
  if (chip) lastTake = starChip(chip, news);
  if (news) el('piece-take-status').textContent = starTitle(undefined, news);
  (document.activeElement as HTMLElement | null)?.blur();
  const pct = (f: number) => `${Math.round(f * 100)}%`,
    last = current().certified[current().certified.length - 1];
  const earlier = !event
    ? undefined
    : event.kind === 'learned'
      ? {
          title: event.overnight ? 'Learned. It stuck overnight.' : 'Learned',
          ms: 3500,
          size: 'big' as const,
          next: false,
        }
      : event.kind === 'review'
        ? { title: 'It stuck: review passed', ms: 3500, size: 'big' as const, next: false }
        : event.kind === 'placed'
          ? { title: `Placed at ${taken!.bpm} BPM`, ms: 1800, size: 'medium' as const, next: false }
          : event.overnight
            ? { title: 'It stuck overnight', ms: 3500, size: 'big' as const, next: true }
            : event.kind === 'certified'
              ? {
                  title: `Certified at ${pct(last ?? unit.rungs[Math.min(before.rung, unit.rungs.length - 1)])}`,
                  ms: 2200,
                  size: 'medium' as const,
                  next: true,
                }
              : event.kind === 'climb'
                ? { title: 'Up a step', ms: 1600, size: 'medium' as const, next: true }
                : event.kind === 'fade'
                  ? { title: 'Less help next take', ms: 1200, size: 'small' as const, next: true }
                  : undefined;
  const moment = starMoment(earlier, news);
  // No reward effect in a microphone take: a mic take's count-in starts at once unless a milestone moment holds it.
  pop =
    event?.clean && lively() && (usingKeys() || moment)
      ? { kind: current().rung !== before.rung ? 'climb' : 'pip', until: performance.now() + 700 }
      : undefined;
  if (!moment) {
    if (place !== undefined) return;
    const result = taken?.result,
      pick =
        result && (!comfortable || (result.trusted && result.score < 0.65)) && spotOffered(instrument, unit)
          ? pickSpot(taken.exercise, result, timed(taken))
          : undefined;
    if (pick) {
      choice = 'offer';
      offer = { pick, bpm: taken.bpm };
      paintChoices();
      return;
    }
    void start('practice');
    return;
  }
  const placed = event!.kind === 'placed',
    sub = placed
      ? message.replace(/^Placed at [^.]*\.\s*/, '')
      : event!.overnight && event!.kind !== 'learned'
        ? `Clean on today's first take. ${message}`
        : message;
  if (!lively()) {
    if (moment.next) void start('practice');
    return;
  }
  showMoment(moment.title, sub, moment.ms, moment.size === 'big');
  celebrate(moment.size);
  after = { until: performance.now() + moment.ms, next: moment.next };
}

const problemNumbers = (u: Unit, p: { from: number; to: number; lead: boolean }) =>
  u.bars.slice(p.from + (p.lead ? 1 : 0), p.to + 1).map((i) => score.bars[i].number);
const barNumber = (u: Unit, position: number) => score.bars[u.bars[position]].number;
el('piece-fix').insertAdjacentHTML('afterend', '<p id="piece-spot-hint" class="muted spot-hint" hidden></p>');
el('piece-result').insertAdjacentHTML(
  'afterend',
  '<div id="piece-choices" class="spot-choices" hidden><p id="piece-choices-ask" class="comfort-ask"></p><div id="piece-choices-actions" class="comfort-actions"></div></div>',
);
/** The choices after a take: practise a trouble spot or carry on (offer), or what to do after a spot pass. */
function paintChoices(): void {
  const actions = el('piece-choices-actions'),
    button = (what: string, label: string, primary: boolean, keyName = '', off = false) =>
      `<button data-choice="${what}"${keyName ? ` data-key="${keyName}"` : ''}${primary ? ' class="primary"' : ''}${off ? ' data-off="1"' : ''}>${label}</button>`;
  const space = '<kbd>Space</kbd> ',
    up = '<kbd>↑</kbd> ',
    down = '<kbd>↓</kbd> ';
  if (choice === 'offer' && offer) {
    const { pick, bpm } = offer,
      slower = slowerBpm(unit, bpm);
    const text = pick === 'choose' ? '' : barsText(problemNumbers(unit, pick));
    el('piece-choices-ask').textContent =
      pick === 'choose'
        ? 'Too much of that take was unclear to pick the bars. Choose the bars to practise.'
        : 'Practise the trouble spot, or carry on.';
    const options = (at: number) =>
      unit.bars
        .map((_, i) => `<option value="${i}"${i === at ? ' selected' : ''}>${barNumber(unit, i)}</option>`)
        .join('');
    actions.innerHTML =
      (pick === 'choose'
        ? `<label class="inline-check">From bar <select id="piece-spot-from">${options(0)}</select></label> <label class="inline-check">to bar <select id="piece-spot-to">${options(1)}</select></label> `
        : '') +
      button(
        'spot',
        `${space}${pick === 'choose' ? 'Practise these bars' : `Practise ${text}`} at ${slower} BPM`,
        true,
        'Space',
      ) +
      (usingKeys()
        ? button('wait', `${down}Wait for me${pick === 'choose' ? '' : ` on ${text}`}`, false, 'ArrowDown')
        : '') +
      (pick !== 'choose' && unit.hands.length === 2
        ? button(
            'hand',
            `${pieceCourse() ? (pick.hand === 'L' ? 'Bass and chords only' : 'Melody only') : `${pick.hand === 'L' ? 'Left' : 'Right'} hand only`}, ${text}`,
            false,
          )
        : '') +
      button('next', `${up}Next take as usual`, false, 'ArrowUp');
  } else if (choice === 'pass' && spot) {
    const slower = slowerBpm(spot.parent, spot.bpm),
      canSlow = slower < spot.bpm,
      first = barNumber(spot.parent, 0),
      last = barNumber(spot.parent, spot.parent.bars.length - 1),
      twice = spot.clean >= 2;
    el('piece-choices-ask').textContent = twice
      ? 'Two clean passes in a row. Put them back in context.'
      : spot.clean === 1
        ? 'Clean pass. One more in a row, then back to the step.'
        : 'Again until it comes out clean, or slow it down.';
    const slowBtn = button('slower', `${down}Slower (${slower} BPM)`, false, 'ArrowDown', !canSlow);
    actions.innerHTML = twice
      ? button('back', `${space}Back to ${first === last ? `bar ${first}` : `bars ${first}–${last}`}`, true, 'Space') +
        button('again', `${up}Again`, false, 'ArrowUp') +
        slowBtn
      : button('again', `${space}Again`, true, 'Space') +
        slowBtn +
        button('back', `${up}Back to the step`, false, 'ArrowUp');
  }
  shown.delete('choices:disabled');
}
function enterSpot(pick: { from: number; to: number; lead: boolean }, hands: Hand[], bpm: number): void {
  const id = spotId(unit.id, pick.from, pick.to, hands);
  const title = `${unit.title}: ${barsText(unit.bars.slice(pick.from, pick.to + 1).map((i) => score.bars[i].number))}`;
  const built = pieceCourse()
    ? sliceExercise(stepExercise(), pick.from, pick.to, hands, id, title)
    : spotExercise(score, unit, pick.from, pick.to, hands);
  spot = { parent: unit, from: pick.from, to: pick.to, lead: pick.lead, hands, bpm, exercise: built, id, clean: 0 };
  exercise = spot.exercise;
  manualBpm = undefined;
  choice = undefined;
  offer = undefined;
  el<HTMLInputElement>('piece-bpm').value = String(bpm);
  el<HTMLInputElement>('piece-bpm').removeAttribute('aria-invalid');
  applyInput();
}
function leaveSpot(): void {
  spot = undefined;
  choice = undefined;
  offer = undefined;
  manualBpm = undefined;
  if (!pending) el('piece-result').hidden = true;
  exercise = stepExercise();
  el<HTMLInputElement>('piece-bpm').value = String(bpmNow());
  el<HTMLInputElement>('piece-bpm').removeAttribute('aria-invalid');
  applyInput();
}
function choose(what: string): void {
  if (active()) return;
  if (what === 'back') {
    if (!spot) return;
    leaveSpot();
    void start('practice');
    return;
  }
  if (what === 'next') {
    if (choice !== 'offer' || !offer) return;
    choice = undefined;
    offer = undefined;
    void start('practice');
    return;
  }
  if (what === 'again' || what === 'slower') {
    if (!spot) return;
    if (what === 'slower') {
      const slower = slowerBpm(spot.parent, spot.bpm);
      if (slower >= spot.bpm) return;
      spot.bpm = slower;
      spot.clean = 0;
      el<HTMLInputElement>('piece-bpm').value = String(slower);
    }
    void start('practice');
    return;
  }
  if (choice !== 'offer' || !offer) return;
  const { pick, bpm } = offer,
    slower = slowerBpm(unit, bpm);
  const at =
    pick === 'choose'
      ? [
          Number(el<HTMLSelectElement>('piece-spot-from').value),
          Number(el<HTMLSelectElement>('piece-spot-to').value),
        ].sort((a, b) => a - b)
      : [];
  const where = pick === 'choose' ? { from: at[0], to: at[1], lead: false } : pick;
  if (what === 'spot') {
    enterSpot(where, unit.hands, slower);
    void start('practice');
  } else if (what === 'wait') {
    enterSpot(where, unit.hands, slower);
    startWait();
  } else if (what === 'hand' && pick !== 'choose') {
    enterSpot(where, [pick.hand], slower);
    void start('practice');
  }
}
for (const id of ['piece-choices', 'piece-spot-banner'])
  el(id).onclick = (event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-choice]');
    if (b && !b.disabled) choose(b.dataset.choice!);
  };
el<HTMLSelectElement>('piece-select').onchange = () => {
  progress.selected.unit = '';
  loadPack(el<HTMLSelectElement>('piece-select').value);
};
const pressCourse = () => {
  el('inst-piano').setAttribute('aria-pressed', String(instrument === 'piano'));
  el('inst-guitar').setAttribute('aria-pressed', String(pieceCourse()));
  el('inst-accompany').setAttribute('aria-pressed', String(instrument === 'guitar' && !pieceCourse()));
};
const chooseCourse = (next: 'piano' | 'piece' | 'accompany') => {
  if (active()) return;
  const same =
    next === 'piano' ? instrument === 'piano' : instrument === 'guitar' && (next === 'piece') === pieceCourse();
  if (same) return;
  instrument = next === 'piano' ? 'piano' : 'guitar';
  if (next !== 'piano') inputPrefs.guitar = next;
  saveInput();
  progress.selected.instrument = instrument;
  progress.selected.unit = '';
  pressCourse();
  selectUnit(landing());
};
el('inst-piano').onclick = () => chooseCourse('piano');
el('inst-guitar').onclick = () => chooseCourse('piece');
el('inst-accompany').onclick = () => chooseCourse('accompany');
el('piece-start').onclick = () => {
  void start('practice');
};
el('piece-place').onclick = () => {
  if (placeable() && !active()) void start('practice', placeTarget());
};
el('piece-pips').onclick = (event) => {
  const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-rung]');
  if (b && !active() && placeable()) placeAt = Number(b.dataset.rung);
};
for (const keys of [false, true])
  el(keys ? 'input-keys' : 'input-mic').onclick = () => {
    if (active() || inputPrefs.keys === keys) return;
    inputPrefs.keys = keys;
    saveInput();
    if (spot) leaveSpot();
    choice = undefined;
    offer = undefined;
    if (!pending) el('piece-result').hidden = true;
    applyInput();
    audio.error = '';
    if (keys) say('keys-on');
    else notice = undefined;
  };
el<HTMLInputElement>('piece-midi-sound').checked = inputPrefs.midiSound;
function paintEffects(): void {
  const select = el<HTMLSelectElement>('piece-effects');
  select.value = lively() ? 'lively' : 'calm';
  select.disabled = reduced.matches;
  el('piece-effects-help').textContent = reduced.matches
    ? 'Calm, because this device asks for reduced motion.'
    : 'Lively adds a short flash and sparks for on-time keys. Calm changes colours only.';
}
el<HTMLSelectElement>('piece-effects').onchange = () => {
  inputPrefs.calm = el<HTMLSelectElement>('piece-effects').value === 'calm';
  saveInput();
  paintEffects();
};
reduced.addEventListener?.('change', paintEffects);
paintEffects();
// Start the audio clock and voice on the first gesture, so the first note and the first take do not wait for them.
const warm = () => {
  window.removeEventListener('pointerdown', warm, true);
  window.removeEventListener('keydown', warm, true);
  void audio.prepare().catch(() => {});
};
window.addEventListener('pointerdown', warm, true);
window.addEventListener('keydown', warm, true);
el<HTMLSelectElement>('piece-piano').value = inputPrefs.piano;
el<HTMLSelectElement>('piece-piano').onchange = () => {
  inputPrefs.piano = el<HTMLSelectElement>('piece-piano').value === 'simple' ? 'simple' : 'grand';
  audio.piano = inputPrefs.piano;
  saveInput();
};
el<HTMLSelectElement>('piece-leniency').value = inputPrefs.leniency;
el<HTMLSelectElement>('piece-leniency').onchange = () => {
  const v = el<HTMLSelectElement>('piece-leniency').value;
  if (!(v in LENIENCY) || active()) {
    el<HTMLSelectElement>('piece-leniency').value = inputPrefs.leniency;
    return;
  }
  inputPrefs.leniency = v as Leniency;
  audio.leniency = inputPrefs.leniency;
  setLeniency(inputPrefs.leniency);
  saveInput();
};
el<HTMLInputElement>('piece-midi-sound').onchange = () => {
  inputPrefs.midiSound = el<HTMLInputElement>('piece-midi-sound').checked;
  saveInput();
};
el('piece-demo').onclick = () => {
  void start('demo');
};
el('piece-listen').onclick = () => {
  const piece = pieceCourse(),
    listen = (piece ? pUnits : curriculum.units).find((u) => u.kind === 'listen')!;
  const ex = piece ? pieceExercise(score, pieceArr, listen) : exerciseFor(score, listen);
  listenId = progressId(`${pack.id}${piece ? '#guitar-piece' : ''}`, listen.id);
  audio.stop();
  closeOverlays();
  void audio.start(ex, listen.id, goal(), 'demo').then(() => {
    listenPlan = audio.plan;
  });
};
for (const id of ['piece-next', 'piece-next-stage'])
  el(id).onclick = () => {
    if (active()) return;
    const next = nextRow();
    if (next) {
      closeOverlays();
      selectUnit(next.unit.id);
    }
  };
el('map-body').onclick = (event) => {
  const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]');
  if (b && !active()) {
    closeOverlays();
    selectUnit(b.dataset.unit!);
  }
};
el<HTMLSelectElement>('piece-daily-goal').onchange = () => {
  const v = Number(el<HTMLSelectElement>('piece-daily-goal').value);
  if (Number.isFinite(v) && v > 0) {
    progress.dailyGoal = v;
    persist();
    paintRhythm();
  }
};
el('piece-wait').onclick = startWait;
/** Stop everything (Stop, Esc). A take stopped before its end says it was not recorded; a stopped calibration drops its instructions. */
function stopAll(): void {
  stopEverything('stopped');
}
/** A take (or its analysis) stopped says so; a Wait for me run says it stopped; anything else drops a NOTICE it made obsolete. */
function stopEverything(said: 'stopped' | 'hidden'): void {
  const take = audio.plan?.kind === 'practice' || (audio.busy && Boolean(audio.analysis)),
    waiting = Boolean(wait);
  stopWait();
  audio.stop();
  player.pause();
  if (take) say(said);
  else if (waiting) say('wait-stopped');
  else dropStale();
}
el('piece-stop').onclick = stopAll;
player.onplay = () => {
  audio.stop();
  closeOverlays();
};
el('piece-comfortable').onclick = () => answer(true);
el('piece-struggling').onclick = () => answer(false);
const hear = (take?: PieceTake) => {
  if (!take || active()) return;
  closeOverlays();
  showTake(take);
  if (take.presses) {
    player.pause();
    void audio.replayKeys(take);
  } else
    player.play().catch((e) => {
      if ((e as Error)?.name !== 'AbortError') audio.error = String(e);
    });
};
el('piece-latest').onclick = () => hear(audio.take);
el('piece-previous').onclick = () => hear(audio.previous);
el('piece-loop').onclick = () => {
  if (!audio.take) return;
  closeOverlays();
  player.pause();
  say('loop');
  void audio.playTake(audio.take, true);
};
el('piece-card-hear').onclick = () => hear(audio.take);
el('piece-card-demo').onclick = () => {
  void start('demo');
};
el('piece-card-wait').onclick = startWait;
el('course-list').onclick = (event) => {
  const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]');
  if (b && !active()) {
    closeOverlays();
    selectUnit(b.dataset.unit!);
  }
};
el('today-list').onclick = (event) => {
  const b = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]');
  if (b && !active()) {
    closeOverlays();
    selectUnit(b.dataset.unit!);
  }
};
function clearBpmError(): void {
  el('piece-bpm-error').textContent = el('piece-bpm-live').textContent = '';
}
el<HTMLInputElement>('piece-bpm').oninput = () => {
  const input = el<HTMLInputElement>('piece-bpm'),
    value = input.valueAsNumber;
  if (active()) {
    input.value = String(bpmNow());
    return;
  }
  if (!Number.isFinite(value) || value < 20 || value > 240) {
    input.setAttribute('aria-invalid', 'true');
    el('piece-bpm-error').textContent = el('piece-bpm-live').textContent = 'Enter a tempo from 20 to 240';
    return;
  }
  input.removeAttribute('aria-invalid');
  clearBpmError();
  if (noticeFrom === 'bpm-invalid') notice = undefined;
  if (spot) {
    spot.bpm = Math.round(value);
    return;
  }
  manualBpm = Math.round(value) === rungBpm(unit, current()) ? undefined : Math.round(value);
};
/** Back from a free tempo to the step's own, exactly as typing the step's tempo does. */
const freeBack = () => {
  if (active() || spot) return;
  manualBpm = undefined;
  const input = el<HTMLInputElement>('piece-bpm');
  input.value = String(bpmNow());
  input.removeAttribute('aria-invalid');
  clearBpmError();
};
/** Keeps keyboard focus on the page when the button that had it disappears: it moves to the free-tempo pencil. */
const toBpm = (button: string, act: () => void) => {
  const had = document.activeElement === el(button);
  act();
  if (had) el('piece-free-open').focus();
};
el('piece-free-back').onclick = () => {
  freeBack();
  closeFree(true);
};
el('piece-next-action').onclick = () => {
  const action = nextAction;
  if (active() || !action) return;
  toBpm('piece-next-action', () => {
    if (action.kind === 'calibrate') el('piece-calibrate').click();
    else if (action.kind === 'free-back') freeBack();
    else if (unit.sameAs) selectUnit(unit.sameAs);
  });
};
el('piece-notice-action').onclick = () => {
  const action = noticeAction;
  if (active() || !action) return;
  if (action.kind === 'calibrate') el('piece-calibrate').click();
  else if (instrument === 'piano') {
    audio.error = '';
    el('input-keys').click();
  }
};
/**
 * The menu: one modal dialog whose sections all start closed; the chip that opened it opens its own section. It cannot
 * open while anything plays, and closing it returns focus to the button that opened it.
 */
let opener: HTMLElement | undefined;
function openDrawer(section: string | undefined, from: HTMLElement): void {
  if (active() || drawer.open) return;
  closeFree(false);
  endReveal();
  endMoment(false);
  el<HTMLDetailsElement>('piece-about-step').open = false;
  for (const d of drawer.querySelectorAll('details')) d.open = false;
  opener = from;
  keyInput.releaseAll();
  drawer.showModal();
  if (section) {
    el<HTMLDetailsElement>(section).open = true;
    el(section).querySelector('summary')?.focus();
  }
}
/** True while the element takes up room on the page (not display:none, itself or through a parent). */
const rendered = (e: Element) => e.getClientRects().length > 0;
/** Focus on the stage: the default answer while one is owed, else Start or Stop. */
function focusStage(): void {
  const target =
    pending && !el('piece-result').hidden
      ? el(defaultComfort() ? 'piece-comfortable' : 'piece-struggling')
      : el(el('piece-start').hidden ? 'piece-stop' : 'piece-start');
  if (rendered(target)) target.focus();
}
drawer.addEventListener('close', () => {
  const back = opener;
  opener = undefined;
  if (back && rendered(back)) back.focus();
  else focusStage();
});
let downOnBackdrop = false;
drawer.addEventListener('pointerdown', (event) => {
  downOnBackdrop = event.target === drawer;
});
drawer.addEventListener('click', (event) => {
  if (event.target === drawer && downOnBackdrop) drawer.close();
  downOnBackdrop = false;
});
el('piece-drawer-close').onclick = () => drawer.close();
for (const [id, section] of [
  ['piece-menu', undefined],
  ['piece-today-chip', 'piece-today'],
  ['piece-status-chip', 'piece-settings'],
  ['piece-card-review', 'piece-last'],
] as const)
  el(id).onclick = () => openDrawer(section, el(id));
/** The free-tempo box under the pencil: the BPM input with a stepper, and the way back to the step's own tempo. */
function openFree(): void {
  if (active() || !freePop.hidden) return;
  freePop.hidden = false;
  el('piece-free-open').setAttribute('aria-expanded', 'true');
  keyInput.releaseAll();
  const input = el<HTMLInputElement>('piece-bpm');
  input.focus();
  input.select();
}
function closeFree(focus: boolean): void {
  if (freePop.hidden) return;
  freePop.hidden = true;
  el('piece-free-open').setAttribute('aria-expanded', 'false');
  const input = el<HTMLInputElement>('piece-bpm');
  if (input.getAttribute('aria-invalid') === 'true') {
    input.value = String(bpmNow());
    input.removeAttribute('aria-invalid');
    clearBpmError();
  }
  if (focus) el('piece-free-open').focus();
}
function closeOverlays(): void {
  if (drawer.open) drawer.close();
  closeFree(false);
  el<HTMLDetailsElement>('piece-about-step').open = false;
}
el('piece-free-open').onclick = () => {
  if (freePop.hidden) openFree();
  else closeFree(true);
};
el('piece-free-done').onclick = () => closeFree(true);
freePop.addEventListener('focusout', (event) => {
  const to = event.relatedTarget as Node | null;
  if (to && !freePop.contains(to) && to !== el('piece-free-open')) closeFree(false);
});
const nudge = (by: number) => {
  const input = el<HTMLInputElement>('piece-bpm'),
    from = Number.isFinite(input.valueAsNumber) ? Math.round(input.valueAsNumber) : bpmNow();
  input.value = String(Math.max(20, Math.min(240, from + by)));
  input.dispatchEvent(new Event('input'));
};
el('piece-bpm-down').onclick = () => nudge(-1);
el('piece-bpm-up').onclick = () => nudge(1);
/** On a phone the timing strip, verdicts and take details move into the menu's Last take section; on a desktop they stay on the card. */
function placeDetails(): void {
  const details = el('piece-take-details');
  (phone.matches ? el('piece-last-slot') : el('piece-result')).append(details);
}
/**
 * A phone keeps only the menu and the piece in its top bar: the tool links (and the account button that account code adds to
 * them) move to the top of the menu, and the phase chip moves into the top bar, shown only while something plays.
 */
function placeChrome(): void {
  const main = document.querySelector<HTMLElement>('main.piece')!,
    nav = main.querySelector('.app-nav'),
    phase = el('piece-phase');
  if (phone.matches) {
    if (nav) el('piece-drawer-tools').append(nav);
    main.querySelector('.topbar .brand')!.after(phase);
    phase.after(el('piece-meter'));
  } else {
    if (nav) {
      main.prepend(nav);
      const card = drawer.querySelector('.welcome-card');
      if (card) nav.after(card);
    }
    main.querySelector('.practice-state')!.prepend(phase);
    phase.after(el('piece-meter'));
  }
}
placeDetails();
placeChrome();
phone.addEventListener?.('change', () => {
  placeDetails();
  placeChrome();
  layoutDirty = true;
});
/**
 * The lane's height (stage.ts laneHeight), measured when nothing plays so the lane never changes size during a take.
 * Phones: the room above the sticky block (measured while no result card is open). Desktop: the room above Start, or
 * above the answer buttons while a card is open.
 */
let layoutDirty = true,
  layoutNow = false,
  dockHeight = 0,
  laneSet = 0;
function layoutLane(): void {
  const wrap = el('piece-lane').parentElement!,
    box = wrap.getBoundingClientRect(),
    card = !el('piece-result').hidden,
    small = phone.matches;
  let below: number;
  if (small) {
    if (!card || !dockHeight) dockHeight = document.querySelector('main.piece .dock')!.getBoundingClientRect().height;
    below = dockHeight;
  } else {
    const answers = el('piece-comfortable').parentElement!,
      choices = el('piece-choices');
    const target =
      choice !== undefined && !choices.hidden
        ? choices
        : card && !answers.hidden
          ? answers
          : el(active() ? 'piece-stop' : 'piece-start');
    below = Math.max(0, target.getBoundingClientRect().bottom - box.bottom);
  }
  const h = laneHeight({
    phone: small,
    vh: innerHeight,
    laneTop: box.top + scrollY,
    below,
    card: (card || (!small && choice !== undefined)) && (!small || !reveal),
    notice: !el('piece-notice').hidden,
    running: small && active(),
  });
  if (h !== laneSet) {
    laneSet = h;
    wrap.style.height = `${h}px`;
    setLaneHeight(h);
  }
}
if (typeof ResizeObserver !== 'undefined') {
  const watch = new ResizeObserver(() => {
    layoutDirty = true;
  });
  watch.observe(document.querySelector('main.piece')!);
  watch.observe(document.querySelector('main.piece .dock')!);
}
window.addEventListener('resize', () => {
  layoutDirty = true;
});
el<HTMLInputElement>('piece-goal').onchange = () => {
  const value = Math.round(el<HTMLInputElement>('piece-goal').valueAsNumber);
  if (!Number.isFinite(value) || value < 30 || value > 200 || active()) {
    el<HTMLInputElement>('piece-goal').value = String(goal());
    return;
  }
  progress.goals[pack.id] = value;
  curriculum = buildCurriculum(score, value);
  gUnits = guitarUnits(score, arrangement, value);
  pUnits = guitarPieceUnits(score, pieceArr, value);
  selectUnit(unit.id);
};
el<HTMLSelectElement>('piece-output').onchange = () => {
  audio.stop();
  audio.mode = el<HTMLSelectElement>('piece-output').value === 'speakers' ? 'speakers' : 'headphones';
  progress.calibrated = false;
  persist();
  if (!usingKeys()) say('output-changed');
};
el<HTMLInputElement>('piece-volume').oninput = () => {
  const v = el<HTMLInputElement>('piece-volume').valueAsNumber;
  audio.setVolume(v);
  player.volume = v;
  el('piece-volume-value').textContent = `${Math.round(v * 100)}%`;
};
player.volume = 0.5;
el<HTMLInputElement>('piece-click').onchange = () => {
  audio.click = el<HTMLInputElement>('piece-click').checked;
};
el<HTMLInputElement>('piece-check-pitch').checked = progress.checkPitch;
el<HTMLInputElement>('piece-check-pitch').onchange = () => {
  progress.checkPitch = audio.checkPitch = el<HTMLInputElement>('piece-check-pitch').checked;
  persist();
};
el<HTMLInputElement>('piece-offset').value = String(Math.round(progress.offset * 1000));
el('piece-use-offset').onclick = () => {
  if (active()) return;
  const v = el<HTMLInputElement>('piece-offset').valueAsNumber;
  if (!Number.isFinite(v) || v < -300 || v > 500) {
    el('piece-calibration-feedback').textContent = 'Enter an offset between -300 and 500 ms.';
    return;
  }
  progress.offset = v / 1000;
  progress.latency = undefined;
  progress.calibrated = true;
  progress.calibrationKey = audio.deviceKey;
  persist();
  el('piece-calibration-feedback').textContent = `Using your manual ${v} ms offset.`;
};
el('piece-calibrate').onclick = () => {
  if (active()) return;
  const dropped = Boolean(pending);
  closeOverlays();
  player.pause();
  endReveal();
  endMoment(false);
  pending = undefined;
  if (dropped) el('piece-result').hidden = true;
  progress.calibrated = false;
  persist();
  say('calibrating', { dropped });
  void audio.start(exercise, 'calibration', 60, 'calibration');
};
// Add your own piece (add-panel.ts): it stores his pieces itself and asks the page only to open, relabel or close one.
mountAddPanel({
  open: (id) => {
    progress.selected.unit = '';
    loadPack(id);
  },
  current: () => pack,
  relabel: (id) => {
    const fresh = packs().find((p) => p.id === id);
    if (fresh && pack.id === id) {
      pack = fresh;
      const verified = pieceMeta(fresh.text).verified;
      if (verified) score.meta.verified = verified;
      paintVerified();
    }
    paintPicker();
  },
  removed: (id) => {
    if (pack.id === id) loadPack(packs()[0].id);
    else paintPicker();
  },
});
el('piece-finish').onclick = () => {
  audio.stop();
  player.pause();
  const next = suggestToday({ ...curriculum, units: units() }, get, Date.now()).find(
      (p) => p.slot !== 'warm' && p.slot !== 'listen',
    ),
    log = todayLog();
  el('piece-session').hidden = false;
  el('piece-session').textContent =
    `Today: ${log.clean} clean take${log.clean === 1 ? '' : 's'} of ${log.takes}. ${session.notes.length ? session.notes.join('. ') + '. ' : 'Steady, deliberate practice counts even when nothing moved up today. '}${next ? `Next time: ${next.unit.title}.` : ''}`;
};
let resetArmed = false;
el('piece-reset').onclick = () => {
  if (!resetArmed) {
    resetArmed = true;
    el('piece-reset').textContent = 'Click again to clear this piece’s progress';
    return;
  }
  resetArmed = false;
  el('piece-reset').textContent = 'Reset progress for this piece';
  for (const id of Object.keys(progress.units))
    if (
      id.startsWith(`${pack.id}|`) ||
      id.startsWith(`${pack.id}#guitar|`) ||
      id.startsWith(`${pack.id}#guitar-piece|`)
    )
      delete progress.units[id];
  delete progress.today[pack.id];
  delete progress.today[`${pack.id}#guitar`];
  delete progress.today[`${pack.id}#guitar-piece`];
  persist();
  selectUnit(unit.id);
  say('reset');
};
navigator.mediaDevices?.addEventListener('devicechange', () => {
  progress.calibrated = false;
  persist();
  el('piece-calibration-feedback').textContent = 'Audio devices changed. Recalibrate timing.';
  if (!usingKeys()) say('devices-changed');
});
/**
 * Before anything else sees a key: a reveal or a milestone moment is skipped by any key or click (the skipping key
 * does nothing more), and a waiting take is answered by ArrowUp (felt comfortable), ArrowDown (needs more room) or
 * Space (the highlighted answer). No piano key ever answers. While an answer waits, the arrows never scroll the page.
 */
const swallow = (event: Event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
};
const answerKeys = new Set(['Space', 'ArrowUp', 'ArrowDown']);
window.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!freePop.hidden && !target?.closest('#piece-free, #piece-free-open')) closeFree(false);
    if (!target?.closest('#piece-about-step')) el<HTMLDetailsElement>('piece-about-step').open = false;
    if (overlayNow()) return;
    endReveal();
    endMoment(!target?.closest('button, a, input, select, summary, label'));
  },
  true,
);
window.addEventListener(
  'keydown',
  (event) => {
    if (!keyAllowed(overlayNow(), event.code)) return;
    if (event.repeat && (reveal || after)) {
      swallow(event);
      return;
    }
    if (reveal) {
      endReveal();
      if (answerKeys.has(event.code)) swallow(event);
      return;
    }
    if (after) {
      endMoment(event.code !== 'Escape');
      if (event.code !== 'Escape') swallow(event);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (
      choice &&
      !el('piece-choices').hidden &&
      !active() &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !target?.closest('input, select, textarea, [contenteditable=true]')
    ) {
      if (answerKeys.has(event.code) && (event.repeat || performance.now() - choiceAt < 350)) {
        swallow(event);
        return;
      }
      if (event.repeat) {
        if (event.code.startsWith('Arrow')) event.preventDefault();
        return;
      }
      if (event.code === 'Space' && target?.closest('button, a, summary, audio')) return;
      if (!answerKeys.has(event.code)) return;
      swallow(event);
      el('piece-choices-actions')
        .querySelector<HTMLButtonElement>(`button[data-key="${event.code}"]:not(:disabled)`)
        ?.click();
      return;
    }
    if (
      !pending ||
      el('piece-result').hidden ||
      active() ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      target?.closest('input, select, textarea, [contenteditable=true]')
    )
      return;
    if (event.repeat) {
      if (event.code.startsWith('Arrow')) event.preventDefault();
      return;
    }
    if (event.code === 'Space' && target?.closest('button, a, summary, audio')) return;
    if (!answerKeys.has(event.code)) return;
    swallow(event);
    answer(event.code === 'Space' ? defaultComfort() : event.code === 'ArrowUp');
  },
  true,
);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    const free = !freePop.hidden;
    stopAll();
    if (drawer.open) drawer.close();
    closeFree(free);
    el<HTMLDetailsElement>('piece-about-step').open = false;
    return;
  }
  if (!keyAllowed(overlayNow(), event.code)) return;
  // Space starts a take from anywhere except a control that uses Space itself.
  const target = event.target instanceof Element ? event.target : null;
  if (
    event.code === 'Space' &&
    !event.repeat &&
    !target?.closest('button, input, select, textarea, a, summary, audio, [contenteditable=true]') &&
    !active() &&
    !choice
  ) {
    event.preventDefault();
    void start('practice');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active()) stopEverything('hidden');
});
const timer = window.setInterval(() => audio.tick(), 10);
window.addEventListener('pagehide', () => {
  clearInterval(timer);
  audio.dispose();
  player.pause();
  URL.revokeObjectURL(wavUrl);
  URL.revokeObjectURL(traceUrl);
});

// The frame loop writes text and states only when they change, and finds each element once.
const elements = new Map<string, HTMLElement>(),
  shown = new Map<string, string>();
const node = (id: string) => {
  let e = elements.get(id);
  if (!e) {
    e = el(id);
    elements.set(id, e);
  }
  return e;
};
const text = (id: string, value: string) => {
  if (shown.get(id) !== value) {
    shown.set(id, value);
    node(id).textContent = value;
  }
};
const disable = (id: string, value: boolean) => {
  const key = `${id}:disabled`;
  if (shown.get(key) !== String(value)) {
    shown.set(key, String(value));
    (node(id) as HTMLButtonElement).disabled = value;
  }
};
let frameNow = 0,
  laneSignature = '',
  laneExercise: Exercise | undefined;
function paint(): void {
  requestAnimationFrame(paint);
  paintNotice();
  if (!exercise) return;
  const plan = audio.plan,
    now = audio.now,
    running = active(),
    p = spot ? { ...current(), support: 0 as const } : current();
  frameNow = audio.laneNow;
  disable('piece-stop', !running);
  for (const id of [
    'piece-start',
    'piece-demo',
    'piece-calibrate',
    'piece-output',
    'piece-use-offset',
    'piece-next',
    'piece-next-stage',
    'piece-listen',
    'piece-select',
    'inst-piano',
    'inst-guitar',
    'inst-accompany',
    'piece-goal',
    'input-mic',
    'input-keys',
    'piece-wait',
    'piece-bpm',
    'piece-menu',
    'piece-today-chip',
    'piece-status-chip',
    'piece-free-open',
    'piece-card-review',
    'piece-card-demo',
    'piece-card-wait',
    'piece-bpm-down',
    'piece-bpm-up',
  ])
    disable(id, running);
  disable('piece-card-hear', !audio.take || running);
  if (!el('piece-result').hidden && !pending && choice === undefined && !running && !reveal)
    el('piece-result').hidden = true;
  const card = !el('piece-result').hidden,
    slot = ((Boolean(pending) && card) || choice !== undefined) && !running;
  const stageKey = `${running}|${slot}|${card}|${lively()}`;
  if (shown.get('stage') !== stageKey) {
    shown.set('stage', stageKey);
    const focus = document.activeElement,
      swap = running ? ['piece-start', 'piece-stop'] : ['piece-stop', 'piece-start'];
    el('piece-start').hidden = running;
    el('piece-stop').hidden = !running;
    if (focus === el(swap[0])) el(swap[1]).focus();
    const main = document.querySelector('main.piece')!;
    main.classList.toggle('slot-taken', slot);
    main.classList.toggle('card-open', card);
    main.classList.toggle('calm', !lively());
    main.classList.toggle('running', running);
    layoutNow = true;
    layoutDirty = true;
  }
  // The lane is sized while nothing plays, and once when something starts or stops (a phone folds the HUD away then).
  if (layoutDirty && (!running || layoutNow)) {
    layoutDirty = false;
    layoutNow = false;
    layoutLane();
  }
  const status = statusChip({
    keys: usingKeys(),
    midi: keyInput.midiDevices > 0,
    tooLoud,
    calibrated: progress.calibrated,
  });
  text('piece-status-long', status.long);
  text('piece-status-short', status.short);
  if (shown.get('status:warn') !== String(status.warn)) {
    shown.set('status:warn', String(status.warn));
    el('piece-status-chip').classList.toggle('warn', status.warn);
  }
  const finished =
    !running &&
    !pending &&
    !choice &&
    !spot &&
    unit.kind !== 'listen' &&
    stepFinished(unitState(unit, get(unit.id), Date.now()), placedNow);
  if (shown.get('next:stage') !== String(finished)) {
    shown.set('next:stage', String(finished));
    el('piece-next-stage').hidden = !finished;
  }
  const choiceKey = `${choice !== undefined}${running}`;
  if (shown.get('choices:disabled') !== choiceKey) {
    shown.set('choices:disabled', choiceKey);
    {
      const was = el('piece-choices').hidden;
      el('piece-choices').hidden = choice === undefined;
      if (was && !el('piece-choices').hidden) choiceAt = performance.now();
    }
    for (const b of el('piece-choices').querySelectorAll<HTMLButtonElement>('button'))
      b.disabled = running || b.dataset.off === '1';
  }
  disable('piece-spot-back', running);
  if (spot) {
    const lead = spot.lead ? barNumber(spot.parent, spot.from) : 0,
      only =
        spot.hands.length === 1
          ? pieceCourse()
            ? spot.hands[0] === 'R'
              ? ' · melody only'
              : ' · bass and chords only'
            : spot.hands[0] === 'R'
              ? ' · right hand only'
              : ' · left hand only'
          : '';
    text(
      'piece-spot-text',
      `Practising ${barsText(problemNumbers(spot.parent, spot))}${spot.lead ? `, with bar ${lead} to lead in` : ''}, at ${spot.bpm} BPM${only}. Spot practice does not count for tempo steps.`,
    );
  }
  if (shown.get('spot:banner') !== String(Boolean(spot))) {
    shown.set('spot:banner', String(Boolean(spot)));
    el('piece-spot-banner').hidden = !spot;
  }
  disable('piece-comfortable', !pending || running);
  disable('piece-struggling', !pending || running);
  // A finished take asks for focus here, once its answer buttons are enabled (they are enabled by this frame, not by the take handler).
  if (focusAnswer) {
    focusAnswer = false;
    if (pending && !running && !overlayNow()) focusStage();
  }
  for (const id of ['piece-latest', 'piece-loop']) disable(id, !audio.take || Boolean(plan || audio.busy));
  disable('piece-previous', !audio.previous || Boolean(plan || audio.busy));
  text(
    'piece-piano-status',
    { '': '', loading: 'Loading piano…', failed: 'Grand piano could not load; using the simple piano.' }[
      audio.pianoStatus
    ],
  );
  text(
    'piece-mic',
    usingKeys()
      ? `Keys${keyInput.midiDevices ? ' · MIDI' : ''} · mic off`
      : audio.busy
        ? audio.analysis
          ? 'Mic off · listening back'
          : 'Preparing audio'
        : audio.micActive
          ? `Mic listening${audio.level > 0.9 ? ' · too loud' : ''}`
          : 'Mic off',
  );
  text(
    'piece-model',
    instrument === 'guitar' && exercise.events.some((e) => e.grade === 'pitch')
      ? earText(audio.model)
      : 'Piano listening: on this device',
  );
  text(
    'piece-calibration',
    usingKeys()
      ? 'Key timing needs no calibration'
      : progress.calibrated
        ? `Timing offset ${Math.round(progress.offset * 1000)} ms${progress.latency !== undefined ? ` · output delay ${Math.round(progress.latency * 1000)} ms when measured${audio.latencyNow ? `, ${Math.round(audio.latencyNow * 1000)} ms now` : ''}` : ''}`
        : 'Timing not calibrated',
  );
  const attention = !usingKeys() && !progress.calibrated;
  if (shown.get('attention') !== String(attention)) {
    shown.set('attention', String(attention));
    el('piece-calibration').classList.toggle('needs-attention', attention);
  }
  text('piece-setup-hint', progress.calibrated ? '· calibrated' : '· start here for tempo steps');
  const rung = rungBpm(unit, p);
  const offered = placeable() && !running;
  if (shown.get('place:hidden') !== String(!offered)) {
    shown.set('place:hidden', String(!offered));
    el('piece-place').hidden = !offered;
  }
  if (offered) text('piece-place', `Already know this? Try it at ${placeBpm()} BPM`);
  const topBpm = rungBpm(unit, { ...p, rung: unit.rungs.length - 1 }),
    oneHand = unit.rungs[unit.rungs.length - 1] < 1 - 1e-9;
  const placingNow = running && audio.plan?.kind === 'practice' && placing !== undefined;
  text(
    'piece-tempo-help',
    spot
      ? 'Spot practice tempo'
      : placingNow
        ? 'Placement take'
        : running
          ? 'Fixed for this take'
          : manualBpm
            ? `Free tempo · step is ${rung}`
            : unit.kind === 'listen'
              ? 'Goal tempo'
              : oneHand
                ? `top ${topBpm} · one hand`
                : `goal ${unit.goalBpm}`,
  );
  text(
    'piece-goal-sub',
    !spot && !running && !manualBpm && unit.kind !== 'listen' && oneHand ? `piece goal ${unit.goalBpm}` : '',
  );
  const shownBpm = String(placingNow ? rungBpm(unit, { ...p, rung: placing! }) : bpmNow());
  text('piece-bpm-num', shownBpm);

  const free = manualBpm !== undefined && !spot;
  if (shown.get('free') !== String(free)) {
    shown.set('free', String(free));
    el('piece-tempo').classList.toggle('free', free);
    el('piece-free-tag').hidden = !free;
    el('piece-free-back').hidden = !free;
  }
  if (free) text('piece-free-back', `Back to ${rung} BPM`);
  disable('piece-free-back', running);
  paintLoop(p, running);
  if (audio.micActive && audio.level > 0.9) tooLoud = true;
  else if (!running) tooLoud = false;
  const digits = String(Math.min(3, Math.max(2, shownBpm.length)));
  if (shown.get('bpm:digits') !== digits) {
    shown.set('bpm:digits', digits);
    node('piece-bpm-num').style.setProperty('--digits', digits);
  }
  const worst = usingKeys()
    ? ''
    : tooLoud
      ? 'Mic too loud'
      : progress.calibrated
        ? 'Timing calibrated'
        : 'Timing not calibrated';
  text(
    'piece-setup-summary',
    `${instrument === 'piano' ? 'Piano' : pieceCourse() ? 'Guitar' : 'Guitar chords'} · ${usingKeys() ? `Keyboard${keyInput.midiDevices ? ' · MIDI' : ''}` : 'Microphone'}${worst ? ` · ${worst}` : ''}`,
  );
  let phase = audio.busy
    ? audio.analysis || 'Preparing audio…'
    : audio.playing || !player.paused
      ? 'Listen or play along'
      : 'Ready when you are';
  if (plan) {
    const countAt = plan.playAt - plan.beatsPerBar * plan.period;
    phase =
      plan.kind === 'calibration'
        ? 'Measuring sound delay…'
        : plan.kind === 'demo' || now < countAt
          ? 'Listen'
          : now < plan.playAt
            ? `Count in · ${Math.min(plan.beatsPerBar, Math.max(1, Math.ceil((plan.playAt - now) / plan.period)))}`
            : now < plan.end
              ? `Play · bar ${barAt(exercise, (now - plan.playAt) / plan.period).number}`
              : 'Listening to the ending…';
  }
  const clock = performance.now(),
    dt = lastFrame ? Math.min(0.25, (clock - lastFrame) / 1000) : 0;
  lastFrame = clock;
  if (wait) {
    wait.step(dt);
    while (autoQueue.length && autoQueue[0].beat <= wait.beat + 1e-6) {
      const e = autoQueue.shift()!;
      for (const n of e.notes) audio.playNote(n.midi, (n.dur * 60) / wait.bpm);
    }
    phase = `Wait for me · bar ${barAt(exercise, Math.max(0, wait.beat)).number}`;
    if (wait.done) finishWait(wait);
  }
  text('piece-phase', phase);
  // While the microphone listens, a small meter shows what it hears.
  const hearing = running && audio.micActive;
  if (shown.get('meter') !== String(hearing)) {
    shown.set('meter', String(hearing));
    el('piece-meter').hidden = !hearing;
  }
  if (hearing) node('piece-meter').style.setProperty('--level', Math.min(1, Math.sqrt(audio.level) * 1.5).toFixed(2));
  const guidance = unit.kind === 'listen' ? '' : (['Notes shown', 'From memory', 'Click on each bar'][p.support] ?? '');
  text('piece-guidance', guidance);
  text('piece-lane-line', p.support > 0 && guidance ? guidance : laneLine);
  if (reveal) stepReveal();
  if (after && performance.now() >= after.until) endMoment(true);
  paintPips(p);
  const result = !plan && !wait && audio.take?.unit === (spot ? spot.id : unit.id) ? audio.take.result : undefined,
    hide = p.support > 0 && unit.kind !== 'listen';
  const sweep = reveal && result ? revealBeat : undefined;
  // A lane where nothing moves is drawn again only when something it shows has changed.
  const clockMs = performance.now(),
    moving = Boolean(
      plan ||
      wait ||
      sweep !== undefined ||
      laneAnimating() ||
      laneResized() ||
      [...wrong.values()].some((t) => clockMs - t < 600),
    );
  const look = {
    lively: lively(),
    level: plan?.kind === 'practice' && audio.micActive ? audio.level : undefined,
    quiet: Boolean(plan) && (plan!.kind !== 'practice' || audio.input !== 'keys'),
  };
  const signature = `${spot ? spot.id : unit.id}|${instrument}|${p.support}|${hide}|${result ? audio.take?.id : ''}|${[...audio.held].join()}|${keyInput.layout.lower},${keyInput.layout.upper}|${usingKeys()}|${reduced.matches}|${look.lively}`;
  if (!moving && laneExercise === exercise && signature === laneSignature) return;
  laneExercise = exercise;
  laneSignature = signature;
  const lane = el<HTMLCanvasElement>('piece-lane'),
    shownPlan = plan?.kind === 'calibration' ? undefined : plan;
  if (instrument === 'piano')
    drawKeys(
      lane,
      exercise,
      shownPlan,
      frameNow,
      p.support,
      result,
      reduced.matches,
      hide,
      usingKeys() ? live() : undefined,
      look,
      sweep,
    );
  else
    drawStrings(
      lane,
      exercise,
      shownPlan,
      frameNow,
      p.support,
      result,
      reduced.matches,
      hide,
      sweep,
      look.lively,
      look.quiet === true,
    );
}
/**
 * NOTICE: an audio error first, then the last message, then a grand piano that could not load. The visible line has no
 * role; an always-present live region speaks it, and a copy shows in the menu while the menu covers the stage.
 * While an answer is owed no action is offered that would drop it.
 */
function paintNotice(): void {
  const running = active();
  const said = audio.error
    ? audioNotice(audio.error, instrument === 'piano')
    : (notice ?? (audio.pianoStatus === 'failed' && !running ? noticeFor('piano-failed') : undefined));
  noticeAction = pending && said?.action?.kind === 'calibrate' ? undefined : said?.action;
  text('piece-feedback', said?.text ?? '');
  text('piece-notice-action', noticeAction?.label ?? '');
  text('piece-notice-live', said?.text ?? '');
  text('piece-drawer-status', drawer.open ? (said?.text ?? '') : '');
  const noticeKey = `${Boolean(said)}${said?.warn}${Boolean(noticeAction)}`;
  if (shown.get('notice') !== noticeKey) {
    shown.set('notice', noticeKey);
    el('piece-notice').hidden = !said;
    el('piece-notice').classList.toggle('warn', Boolean(said?.warn));
    el('piece-notice-action').hidden = !noticeAction;
    const stage = document.querySelector('main.piece')!;
    stage.classList.toggle('notice-on', Boolean(said));
    stage.classList.toggle('notice-act', Boolean(noticeAction));
  }
  disable('piece-notice-action', running);
}
const html = (id: string, value: string) => {
  const k = `${id}:html`;
  if (shown.get(k) !== value) {
    shown.set(k, value);
    node(id).innerHTML = value;
  }
};
/**
 * The tempo ladder beside the BPM readout: one segment per rung (ahead ones pick a placement target), and pips for clean
 * takes at this tempo toward the next step (two, not necessarily in a row) or, on a certification step, for the fading help (three). Both counts are
 * saved with progress. Free tempo and spot practice dim the ladder and hide the pips.
 */
function paintPips(p: UnitProgress): void {
  if (unit.kind === 'listen' || unit.sameAs) {
    html('piece-pips', '');
    return;
  }
  const rungs = unit.rungs,
    at = Math.min(p.rung, rungs.length - 1),
    fraction = rungs[at],
    top = p.rung >= rungs.length - 1,
    same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const certify = unit.certify.some((c) => same(c, fraction)),
    done = p.certified.some((c) => same(c, fraction)) && top,
    away = manualBpm !== undefined || Boolean(spot);
  const pips =
    away || (done && p.learned)
      ? undefined
      : certify
        ? { kind: 'cert' as const, support: p.support }
        : top
          ? undefined
          : { kind: 'plain' as const, clean: Math.min(2, p.clean) };
  const focused = (document.activeElement as HTMLElement | null)
    ?.closest?.('#piece-pips [data-rung]')
    ?.getAttribute('data-rung');
  html(
    'piece-pips',
    ladderHtml({
      rungs: rungs.map((r, i) => ({
        bpm: rungBpm(unit, { ...p, rung: i }),
        pct: Math.round(r * 100),
        certify: unit.certify.some((c) => same(c, r)),
        certified: p.certified.some((c) => same(c, r)),
      })),
      at,
      pick: !active() && !spot && canPlace(unit, p, rungs.length - 1),
      target: placeTarget(),
      pips,
      dim: away,
      pop: pop && performance.now() < pop.until ? pop.kind : undefined,
    }),
  );
  if (focused != null && !el('piece-pips').contains(document.activeElement))
    el('piece-pips').querySelector<HTMLElement>(`[data-rung="${focused}"]`)?.focus();
}
/** NEXT TAKE and LAST TAKE. Written through text(), so a frame that changes nothing writes nothing and the status region stays quiet. */
function paintLoop(p: UnitProgress, running: boolean): void {
  const step = spot ? current() : p,
    card = !el('piece-result').hidden;
  const next = nextLine(
    nextState({
      unit,
      p: step,
      now: Date.now(),
      sameAsTitle: unit.sameAs ? title(unit.sameAs) : undefined,
      pending: Boolean(pending),
      running,
      practice: audio.plan?.kind === 'practice',
      wait: Boolean(wait),
      keys: usingKeys(),
      calibrated: progress.calibrated,
      placing: placing !== undefined ? rungBpm(unit, { ...step, rung: placing }) : undefined,
      free: manualBpm,
      offer:
        choice === 'offer' && offer
          ? offer.pick === 'choose'
            ? 'choose'
            : { bars: barsText(problemNumbers(unit, offer.pick)), bpm: slowerBpm(unit, offer.bpm) }
          : undefined,
      pass: choice === 'pass' && spot ? spot.clean : undefined,
      spot: spot ? { bars: barsText(problemNumbers(spot.parent, spot)), bpm: spot.bpm } : undefined,
    }),
  );
  nextAction = next.action;
  text('piece-next-text', next.text);
  text('piece-next-muted', next.muted);
  text('piece-about-muted', next.muted);
  text('piece-next-action', next.action?.label ?? '');
  // One button per action on screen: the open free-tempo box has its own Back button, and a NOTICE may already offer Calibrate.
  const noticeCalibrates = noticeAction?.kind === 'calibrate' && !el('piece-notice').hidden;
  const actionOn =
    Boolean(next.action) &&
    !(next.action?.kind === 'free-back' && !freePop.hidden) &&
    !(next.action?.kind === 'calibrate' && noticeCalibrates);
  if (shown.get('next:action') !== String(actionOn)) {
    shown.set('next:action', String(actionOn));
    el('piece-next-action').hidden = !actionOn;
  }
  disable('piece-next-action', running);
  text('piece-last-text', lastTake);
  const lastKey = `${Boolean(lastTake)}${card}`;
  if (shown.get('last') !== lastKey) {
    shown.set('last', lastKey);
    el('piece-last-take').hidden = !lastTake;
    el('piece-last-take').classList.toggle('stale', card);
  }
}
function live(): Parameters<typeof drawKeys>[8] {
  if (wait)
    return {
      held: audio.held,
      labels,
      hits: wait.hits,
      auto: autoKeys,
      wrong,
      beat: wait.beat,
      expect: wait.current && wait.current.beat - wait.beat <= 0.5 ? wait.needed : [],
      message: wait.waiting ? 'Waiting for you: play the glowing keys' : '',
    };
  // Replaying a keys take: light the keys that were pressed, and fade the notes that were not played right.
  const replay = audio.replaying;
  if (replay?.presses && audio.plan) {
    const t = frameNow - audio.plan.playAt,
      presses = replay.presses;
    const heldNow = new Set(presses.filter((x) => t >= x.t && t < x.t + (x.dur ?? 0.6)).map((x) => x.midi));
    const right = new Set(
      replay.result?.events.flatMap((e) =>
        e.notes.filter((n) => n.verdict === 'heard').map((n) => noteKey(e.beat, n.midi)),
      ) ?? [],
    );
    for (const k of autoKeys) right.add(k);
    return { held: heldNow, labels, hits: right, auto: autoKeys, wrong };
  }
  const plan = audio.plan,
    scoring =
      plan?.kind === 'practice' && audio.input === 'keys' && audio.now >= plan.playAt - plan.beatsPerBar * plan.period;
  return {
    held: audio.held,
    labels,
    tiers: scoring ? tiers : undefined,
    auto: scoring ? autoKeys : undefined,
    wrong,
    streak: scoring ? streak : 0,
    run: scoring && runFrom && plan ? runFrom.now(audio.now - plan.playAt).run : 0,
  };
}
loadPack(progress.selected.piece || packs()[0].id);
pressCourse();
paint();
// The opening step's pitch ear, if it needs one, loads once the page has painted and gone idle, and not while
// something plays (the model's warm-up can hold the main thread for a moment). Steps opened after the first paint
// load it at once (prepareEar).
const whenIdle = (run: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 500);
function prefetchEar(): void {
  if (active()) setTimeout(() => whenIdle(prefetchEar), 2000);
  else audio.prepareFor(exercise);
}
const afterPaint = () => {
  if (!painted) whenIdle(prefetchEar);
  painted = true;
};
try {
  // A paint entry arrives only after the first contentful frame is on screen.
  new PerformanceObserver((list, observer) => {
    if (list.getEntriesByName('first-contentful-paint').length) {
      observer.disconnect();
      afterPaint();
    }
  }).observe({ type: 'paint', buffered: true });
} catch {
  /* No paint timing: the timer below starts it. */
}
setTimeout(afterPaint, 4000);
