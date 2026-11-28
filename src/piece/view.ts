import { isBlack, noteName } from './score';
import type { Exercise } from './exercise';
import type { PiecePlan } from './plan';
import type { KeyLive, PieceGrade } from './grade';
import { fretList, type Shape } from './guitar';
import {
  GRAVITY,
  celebration,
  hitBurst,
  isEmpty,
  lightFrame,
  newFrame,
  particle,
  pruneBursts,
  revealBurst,
  rgb,
  type Burst,
  type LightFrame,
  type LightInput,
  type Particle,
  type Rect,
  type Rgb,
} from './light';
import { glLight, type LightLayer } from './lightgl';
import { runCounter, runPlace, type RunMemo, type RunShow } from './game';
import { siteNav } from '../ui/nav';
import { addPanelMarkup } from './add-panel';
import { accountsEnabled } from '../account/config';

const ICON_MENU =
  '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_INFO =
  '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 10v5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="11" cy="6.6" r="1.3" fill="currentColor"/></svg>';
const ICON_PEN =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 17l1-4L14.5 2.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L7 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_RING =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="#3a493c" stroke-width="3"/><circle id="piece-today-ring" cx="10" cy="10" r="7.5" fill="none" stroke="#c8d8a7" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 10 10)"/></svg>';

export function pieceShell(): void {
  document.querySelector('#app')!.innerHTML = `<main class="trainer piece">
    ${siteNav('piece')}
    <header class="trainer-header topbar"><button id="piece-menu" type="button" class="icon-btn" aria-label="Open menu" aria-haspopup="dialog">${ICON_MENU}</button><div class="brand"><h1 id="piece-title">Learn a piece</h1><span id="piece-composer" class="composer"></span></div><button id="piece-today-chip" type="button" class="chip" aria-haspopup="dialog">${ICON_RING}<span id="piece-today-long" class="long"></span><span id="piece-today-short" class="short"></span></button><button id="piece-status-chip" type="button" class="chip status-chip" aria-haspopup="dialog"><span class="dot" aria-hidden="true"></span><span id="piece-status-long" class="long"></span><span id="piece-status-short" class="short"></span></button></header>
    <section class="lesson-card stage" aria-labelledby="unit-title">
      <div class="hud">
        <div class="hud-passage"><span id="unit-stage" class="eyebrow"></span><div class="passage-row"><h2 id="unit-title"></h2><span id="unit-stars" class="unit-stars"></span><details id="piece-about-step" class="about-step"><summary aria-label="About this step">${ICON_INFO}</summary><div class="about-body"><p id="unit-goal"></p><p id="unit-why" class="unit-why"></p><div id="lane-help"></div><p id="piece-about-muted" class="about-muted"></p></div></details></div><p id="unit-caption" class="unit-caption"></p></div>
        <div class="hud-tempo" id="piece-tempo">
          <div class="readout"><span id="piece-bpm-num" class="bpm-num"></span><div class="bpm-side"><div class="side-row"><span class="bpm-unit">BPM</span><span id="piece-free-tag" class="free-tag" hidden>free</span><button id="piece-free-open" type="button" class="icon-btn pencil" aria-label="Free tempo" aria-expanded="false" aria-controls="piece-free">${ICON_PEN}</button></div><p class="goal-row"><span id="piece-tempo-help"></span><span id="piece-goal-sub" class="goal-sub"></span></p></div>
            <div id="piece-free" class="free-pop" role="group" aria-label="Free tempo" hidden><div class="stepper"><button id="piece-bpm-down" type="button" aria-label="Slower">−</button><input id="piece-bpm" type="number" min="20" max="240" step="1" inputmode="numeric" aria-label="Tempo in BPM" aria-describedby="piece-free-line piece-bpm-error"><button id="piece-bpm-up" type="button" aria-label="Faster">+</button></div><p id="piece-free-line">Free tempo: takes here do not move the ladder</p><p id="piece-bpm-error" class="free-error"></p><button id="piece-free-back" type="button" class="free-back" hidden></button><button id="piece-free-done" type="button" class="free-done">Done</button></div>
          </div>
          <div id="piece-pips"></div>
        </div>
      </div>
      <div id="piece-last-take" class="last-take" hidden><span class="loop-label">Last take</span> <span id="piece-last-text"></span></div>
      <div class="practice-state"><span id="piece-phase">Ready when you are</span><span id="piece-meter" class="meter" aria-hidden="true" hidden><i></i></span><span id="piece-lane-line" class="lane-line"></span><span id="piece-guidance" hidden></span></div>
      <div class="lane-wrap"><canvas id="piece-lane" role="img" aria-label="The notes to play, falling toward the keys" aria-describedby="unit-text"></canvas></div>
      <p id="unit-text" class="sr-only"></p><p id="piece-notice-live" class="sr-only" role="status" aria-atomic="true"></p><p id="piece-bpm-live" class="sr-only" role="status"></p><p id="piece-take-status" class="sr-only" role="status"></p><div id="unit-shapes" class="unit-shapes"></div>
      <div class="dock">
        <div id="piece-notice" class="notice" hidden><span class="notice-dot" aria-hidden="true"></span><p id="piece-feedback" class="coach"></p><button id="piece-notice-action" type="button" hidden></button></div>
        <div id="piece-spot-banner" class="spot-banner" hidden><span id="piece-spot-text"></span> <button id="piece-spot-back" data-choice="back">Back to the step</button></div>
        <div id="piece-next-take" class="next-take"><span class="loop-label">Next take</span><div class="next-body" role="status" aria-atomic="true"><p id="piece-next-text" class="next-text"></p><p id="piece-next-muted" class="next-muted"></p></div><button id="piece-next-action" type="button" class="next-action" hidden></button></div>
        <div class="trainer-actions"><button id="piece-start" class="primary">Start practice</button><button id="piece-stop" class="stop" hidden>Stop · Esc</button><div class="act-more"><button id="piece-demo">Hear it</button><button id="piece-wait" hidden title="The notes stop until you play them. Only the keys are checked, not timing.">Wait for me</button><button id="piece-next-stage" type="button" hidden>Next in today's plan</button><button id="piece-place" class="link-btn" hidden></button></div><p class="act-keys" aria-hidden="true">Space start practice · Esc stop everything</p></div>
        <div id="piece-result" class="result-card" hidden><div id="piece-score" class="take-score"></div><p id="piece-fix" class="take-fix"></p>
          <div class="answer"><p id="piece-comfort-ask" class="comfort-ask">How did that feel?</p><div class="comfort-actions"><button id="piece-comfortable" aria-describedby="piece-comfortable-note"><kbd>↑</kbd> Felt comfortable</button><button id="piece-struggling" aria-describedby="piece-struggling-note"><kbd>↓</kbd> Needs more room</button><p id="piece-comfortable-note" class="comfort-note"></p><p id="piece-struggling-note" class="comfort-note"></p></div></div>
          <div class="card-secondary"><button id="piece-card-hear" type="button" class="link-btn">Hear this take</button><button id="piece-card-demo" type="button" class="link-btn">Hear it</button><button id="piece-card-wait" type="button" class="link-btn" hidden>Wait for me</button><button id="piece-card-review" type="button" class="link-btn" aria-haspopup="dialog">Review take</button></div>
          <div id="piece-take-details" class="take-details"><div id="piece-metrics" class="grade-metrics"></div><div id="piece-callouts" class="take-callouts"><ul id="piece-wins" class="take-wins"></ul></div><div id="piece-strip" class="timing-strip"></div><div id="piece-verdicts" class="note-verdicts"></div><p id="piece-details" class="muted"></p></div></div>
      </div>
    </section>
    <dialog id="piece-drawer" class="drawer" aria-labelledby="piece-drawer-title"><div class="drawer-inner">
      <div class="drawer-head"><h2 id="piece-drawer-title">Menu</h2><button id="piece-drawer-close" type="button">Close</button></div><p id="piece-drawer-status" class="drawer-status" role="status" aria-atomic="true"></p><div id="piece-drawer-tools" class="drawer-tools"></div>
      <div class="drawer-body trainer-secondary">
      <details id="piece-today"><summary>Today's practice <span id="today-count" class="muted"></span></summary>
        <div class="today-rhythm"><div class="today-aim"><span id="today-clean"></span><span id="today-meter" class="today-meter" aria-hidden="true"><i></i></span><label class="inline-check">Daily aim <select id="piece-daily-goal"><option>3</option><option>6</option><option>10</option><option>15</option><option>20</option><option>30</option></select> clean takes</label></div><div id="today-week" class="today-week"></div></div>
        <ol id="today-list" class="today-list"></ol><p id="today-done" class="today-done" role="status" hidden></p><button id="piece-next">Next in today's plan</button>
        <p class="muted">One phrase at a time: hear the piece, warm up, review what is due, play yesterday's new steps again, then today's phrase. Short sessions on several days beat one long one. Keep going as long as you like.</p></details>
      <details id="piece-map"><summary>Your piece <span id="map-count" class="muted"></span></summary><div id="map-body"></div></details>
      <details id="piece-course"><summary>Course <span id="course-count"></span></summary><div class="instrument-toggle course-views" role="group" aria-label="Show the course as"><button id="course-view-journey" type="button" aria-pressed="true">Journey</button><button id="course-view-list" type="button" aria-pressed="false">List</button></div><div id="course-journey" class="journey"></div><div id="course-list-view" hidden><p>Each step climbs a tempo ladder: 50, 60, 70, 80, 88, 94 and 100% of the goal tempo. Two clean, comfortable takes at a step (80% or better, not necessarily in a row) move up one step. At 80% and 100% three takes fade the help: notes visible, then from memory, then a click only on each bar. Two needs-more-room takes in a row (under 65%, or answered "Needs more room") step down. Hands together, joins and sections open as their parts reach the tempo they need.</p><div id="course-list"></div></div></details>
      <details id="piece-setup" class="piece-setup"><summary>Piece &amp; input <span id="piece-setup-summary" class="muted">Piano · Microphone</span></summary>
        <div class="piece-controls"><label>Piece <select id="piece-select"></select></label><div class="instrument-toggle" role="group" aria-label="Instrument"><button id="inst-piano" aria-pressed="true">Piano</button><button id="inst-guitar" aria-pressed="false">Guitar</button><button id="inst-accompany" aria-pressed="false">Accompany</button></div><div class="instrument-toggle" id="input-toggle" role="group" aria-label="Play with"><button id="input-mic" aria-pressed="true">Microphone</button><button id="input-keys" aria-pressed="false">Keyboard · MIDI</button></div><label class="inline-check"><input type="checkbox" id="piece-backing"> <span id="piece-backing-label">Play the other hand with me</span></label></div>
      </details>
      <details id="piece-settings"><summary>Sound &amp; timing <span id="piece-setup-hint"></span></summary>
        <div class="trainer-status"><span id="piece-mic">Mic off</span><span id="piece-model"></span><span id="piece-calibration">Timing not calibrated</span><span id="piece-verified"></span></div>
        <p>Use headphones so the click and the app's notes stay out of the microphone. Put the laptop on the piano's music desk or a chair beside it, mic facing the strings, the same place every time.</p>
        <label>Goal tempo for this piece <input id="piece-goal" type="number" min="30" max="200" step="1"> <span id="piece-goal-help" class="muted"></span></label>
        <label>Input processing <select id="piece-output"><option value="headphones">Headphones · clean input</option><option value="speakers">Speakers · echo cancellation</option></select></label>
        <label>Demo &amp; take volume <input id="piece-volume" type="range" min="0" max="1" step=".01" value=".5"><output id="piece-volume-value">50%</output></label>
        <label><input id="piece-click" type="checkbox" checked> Metronome during practice</label>
        <label>Timing leniency <select id="piece-leniency"><option value="tight">Tight · about 85 ms</option><option value="standard">Standard · about 130 ms</option><option value="relaxed">Relaxed · about 210 ms</option><option value="loose">Loose · about 290 ms</option></select> <span class="muted">how far from the beat a note still counts as on time</span></label>
        <label>Piano sound <select id="piece-piano"><option value="grand">Grand piano</option><option value="simple">Simple</option></select> <span id="piece-piano-status" class="muted" role="status"></span></label>
        <label>Key feedback <select id="piece-effects"><option value="lively">Lively</option><option value="calm">Calm</option></select> <span id="piece-effects-help" class="muted"></span></label>
        <label><input id="piece-midi-sound" type="checkbox" checked> Sound for MIDI keys (turn off if your keyboard makes its own sound)</label>
        <label><input id="piece-check-pitch" type="checkbox" checked> Piano note checks (turn off for a piano far out of tune)</label>
        <div class="calibration"><p><strong>Measure your sound delay</strong></p><p>Keep the instrument quiet. Hold one headphone earcup close to the microphone so it can hear eight short clicks; without headphones, turn the volume up so the speaker reaches the microphone.</p><button id="piece-calibrate">Calibrate with 8 clicks</button><p id="piece-calibration-feedback" role="status">Practice works without it; calibration lets tempo steps count.</p><label for="piece-offset">Manual input offset (ms)</label><div class="offset-row"><input id="piece-offset" type="number" min="-300" max="500" step="1" value="0"><button id="piece-use-offset">Use this offset</button></div></div>
        <div class="honesty"><p><strong>What the microphone can and cannot tell</strong></p><p>Timing comes from each attack. For piano, a note counts as <em>heard</em> only when its own partials rise at the attack; <em>not heard</em> needs them to stay quiet. Notes doubled an octave or a twelfth above another note have no partials of their own: <em>can't check</em>. Everything else is <em>unclear</em> and counts neither way. Tested on real piano recordings, a played note was called missing or wrong about 2% of the time and an unplayed note was confirmed under 1% of the time. Your room and piano may differ; listen back to your takes.</p><p>For guitar, a single plucked string is checked for pitch; two or more strings at once, and strums, are timing only. Fingering, hand position, pedalling, tone and which strings rang stay for you to judge.</p></div>
      </details>
      <details id="piece-about"><summary>About this piece</summary><p id="piece-summary" class="intro"></p><div id="piece-about-body"></div><button id="piece-listen">Hear the whole piece</button></details>
      <details id="piece-add"><summary>Add your own piece</summary>${addPanelMarkup(accountsEnabled)}</details>
      <details id="piece-last"><summary>Last take</summary><p id="piece-last-empty" class="muted">No take yet on this page.</p><div id="piece-last-slot"></div>
        <div id="piece-review" hidden><div class="review-heading"><span>Hear yourself</span><span id="piece-take" class="muted"></span></div><audio id="piece-player" controls></audio><div class="review-actions"><button id="piece-previous">Hear previous take</button><button id="piece-latest">Hear latest take</button><button id="piece-loop">Loop latest · play along</button><a id="piece-download" download="take.wav">Download WAV</a><a id="piece-trace" download="take.json">Note details</a></div><p id="piece-review-note" class="muted">Playback stops the microphone. Takes stay in this page.</p></div></details>
      <details id="piece-journal"><summary>Your practice today</summary><div id="piece-journal-list"></div><button id="piece-finish">Finish this session</button><div id="piece-session" role="status" hidden></div><button id="piece-reset" class="text-button">Reset progress for this piece</button><p id="piece-storage" class="muted">Progress stays in this browser. Audio is never saved automatically.</p></details>
      <details id="piece-backup"><summary>Back up &amp; move progress</summary>
        <p>Download one JSON file with your guitar course progress, Pieces progress, your own pieces and input settings. Your AI reader key and sync bookkeeping are never included.</p>
        <p class="backup-actions"><button id="piece-export" type="button">Export backup</button><button id="piece-import" type="button">Import backup…</button><input id="piece-import-file" class="sr-only" type="file" accept=".json,application/json" aria-label="Import a Clean Take backup file"></p>
        <div id="piece-backup-preview" hidden><p id="piece-backup-summary"></p><p class="backup-actions"><button id="piece-backup-merge" type="button">Merge into this browser</button><button id="piece-backup-replace" type="button">Replace saved progress</button><button id="piece-backup-cancel" type="button" class="text-button">Cancel</button></p><p class="muted">Merge keeps this browser’s newer steps and adds what the file has. Replace uses the file’s copy for the parts it contains. Nothing has changed yet.</p></div>
        <p id="piece-backup-status" class="muted" role="status" aria-atomic="true"></p>
      </details>
      <details id="piece-keys"><summary>Keyboard shortcuts</summary><footer><span><kbd>Space</kbd> start practice</span><span><kbd>Esc</kbd> stop everything</span><span><kbd>↑</kbd> <kbd>↓</kbd> answer after a take</span><span>Listening happens in this browser; nothing is uploaded, except pictures of pages you send yourself to an AI from Add your own piece.</span></footer></details>
      </div>
    </div></dialog>
  </main>`;
}

const HAND = { L: '#8fb9d9', R: '#c8d8a7' };
const VERDICT: Record<string, string> = {
  heard: '#c8d8a7',
  'not-heard': '#e1ad88',
  wrong: '#e1ad88',
  unclear: '#9ea79b',
  'cannot-check': '#6f7d72',
  unchecked: '#6f7d72',
};
/** Early or late: the same calm amber the result uses for timing marks. */
const OFF_TIME = '#e1ad88';

// Canvas width comes from a ResizeObserver, so drawing never reads layout.
const widths = new WeakMap<HTMLCanvasElement, number>(),
  heights = new WeakMap<HTMLCanvasElement, number>();
let observer: ResizeObserver | undefined,
  resized = true;
function widthOf(canvas: HTMLCanvasElement): number {
  let w = widths.get(canvas);
  if (w === undefined) {
    w = canvas.clientWidth;
    widths.set(canvas, w);
    observer ??=
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              widths.set(e.target as HTMLCanvasElement, e.contentRect.width);
              resized = true;
            }
          });
    observer?.observe(canvas);
  }
  return w;
}
/** The lane's height in CSS pixels, chosen by the page from the viewport (stage.ts laneHeight); undefined: the old fixed sizes. */
let laneTall: number | undefined;
export function setLaneHeight(height: number): void {
  if (height !== laneTall) {
    laneTall = height;
    resized = true;
  }
}
/** True once after the lane changed size, so a static lane knows to redraw. */
export function laneResized(): boolean {
  const r = resized;
  resized = false;
  return r;
}
function prepare(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D {
  const w = Math.max(280, Math.round(widthOf(canvas))),
    dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
  }
  if (heights.get(canvas) !== height) {
    canvas.style.height = `${height}px`;
    heights.set(canvas, height);
  }
  const p = canvas.getContext('2d')!;
  p.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.clearRect(0, 0, w, height);
  p.fillStyle = '#171f1b';
  p.fillRect(0, 0, w, height);
  return p;
}
/** Where the take is in beats, and whether notes are moving. */
function position(
  ex: Exercise,
  plan: PiecePlan | undefined,
  now: number,
): { beat: number; moving: boolean; playing: boolean } {
  if (!plan || plan.kind === 'calibration') return { beat: 0, moving: false, playing: false };
  if (plan.kind === 'demo') return { beat: (now - plan.start) / plan.period, moving: true, playing: false };
  const demoEnd = plan.playAt - plan.beatsPerBar * plan.period - 1.5 * plan.period;
  if (plan.sounds.some((s) => s.kind === 'note' && s.at < demoEnd + 0.01) && now < demoEnd)
    return { beat: (now - plan.start) / plan.period, moving: true, playing: false };
  return { beat: (now - plan.playAt) / plan.period, moving: true, playing: now >= plan.playAt && now < plan.end };
}

const bursts: Burst[] = [];
let lastFrame = 0;
const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const mixed = new Map<string, string>(),
  alphas = new Map<string, string>();
/** Blend a colour toward white (to = 255) or black (to = 0). Memoised: the lane asks for the same few colours every frame. */
const mix = (hex: string, to: number, t: number) => {
  const key = `${hex}${to}${t}`;
  let v = mixed.get(key);
  if (!v) {
    const c = channels(hex).map((x) => Math.round(x + (to - x) * t));
    v = `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    mixed.set(key, v);
  }
  return v;
};
const alpha = (hex: string, a: number) => {
  const q = Math.round(a * 100) / 100,
    key = hex + q;
  let v = alphas.get(key);
  if (!v) {
    v = `rgba(${channels(hex).join(',')},${q})`;
    alphas.set(key, v);
  }
  return v;
};
// Gradients and glow sprites are built once per size and colour, never per frame.
const gradients = new Map<string, CanvasGradient>();
function gradient(
  p: CanvasRenderingContext2D,
  key: string,
  y0: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  let g = gradients.get(key);
  if (!g) {
    g = p.createLinearGradient(0, y0, 0, y1);
    for (const [at, c] of stops) g.addColorStop(at, c);
    gradients.set(key, g);
    if (gradients.size > 64) gradients.delete(gradients.keys().next().value!);
  }
  return g;
}
const sprites = new Map<string, HTMLCanvasElement>();
/** A soft round glow in one colour, 64 px, drawn scaled. */
function glow(colour: string): HTMLCanvasElement {
  let s = sprites.get(colour);
  if (!s) {
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const c = s.getContext('2d')!,
      g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, alpha(colour, 1));
    g.addColorStop(0.45, alpha(colour, 0.45));
    g.addColorStop(1, alpha(colour, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    sprites.set(colour, s);
  }
  return s;
}
// Colours cross between the light list (0..1 channels) and canvas strings; both ways are memoised per colour.
const hexes = new WeakMap<Rgb, string>(),
  rgbs = new Map<string, Rgb>();
const hexOf = (c: Rgb) => {
  let v = hexes.get(c);
  if (!v) {
    v = `#${c
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    hexes.set(c, v);
  }
  return v;
};
const rgbOf = (hex: string) => {
  let v = rgbs.get(hex);
  if (!v) {
    v = rgb(hex);
    rgbs.set(hex, v);
  }
  return v;
};
const scratch: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0 };
/**
 * The 2D stand-in for the WebGL light layer: the same frame, drawn additively. It is drawn under the felt and keys,
 * which cover anything below the clip, so it needs no clip of its own. Nothing at all happens while there is no light.
 */
function drawLight2d(p: CanvasRenderingContext2D, f: LightFrame): void {
  if (isEmpty(f)) return;
  p.globalCompositeOperation = 'lighter';
  for (const s of f.shapes) {
    const hex = hexOf(s.colour);
    if (s.kind === 'glow') {
      p.globalAlpha = s.a;
      p.drawImage(glow(hex), s.x, s.y, s.w, s.h);
    } else if (s.kind === 'ring') {
      p.strokeStyle = alpha(hex, s.a);
      p.lineWidth = 2;
      p.beginPath();
      p.arc(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, Math.PI, 2 * Math.PI);
      p.stroke();
    } else if (s.kind === 'band') {
      p.globalAlpha = s.a;
      p.fillStyle = gradient(p, `lb${hex}`, 0, 1, [
        [0, alpha(hex, 0)],
        [1, alpha(hex, 1)],
      ]);
      p.save();
      p.translate(0, s.y);
      p.scale(1, s.h);
      p.fillRect(s.x, 0, s.w, 1);
      p.restore();
    } else {
      p.globalAlpha = s.a;
      p.fillStyle = hex;
      p.fillRect(s.x, s.y + s.h / 2 - 1, s.w, 2);
    }
  }
  for (const b of f.bursts) {
    if (f.now < b.at) continue;
    const hex = hexOf(b.colour),
      t = (f.now - b.at) / 1000;
    if (!b.soft) p.fillStyle = hex;
    for (let i = 0; i < b.count; i++) {
      const q = particle(b, i, scratch);
      if (t >= q.life) continue;
      const x = q.x + q.vx * t,
        y = q.y + q.vy * t + (GRAVITY * t * t) / 2,
        a = 1 - t / q.life,
        r = q.size;
      if (b.soft) {
        p.globalAlpha = 0.5 * a;
        p.drawImage(glow(hex), x - r, y - r, 2 * r, 2 * r);
      } else {
        p.globalAlpha = a;
        p.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    }
  }
  p.globalAlpha = 1;
  p.globalCompositeOperation = 'source-over';
}
// The light is drawn by a WebGL overlay when one can be made, else by drawLight2d; never both in one frame.
let layer: LightLayer | undefined,
  layerTried = false,
  lastLight: LightFrame | undefined;
// One frame, one input and a pool of judged-key entries, reused every frame so the lane allocates nothing for its light.
const frame = newFrame(),
  lightIn: LightInput = {
    now: 0,
    lively: false,
    quiet: false,
    inTake: false,
    w: 0,
    hitY: 0,
    effects: [],
    bursts: [],
    warm: 0,
    haze: 0,
    pulse: 0,
  };
/** Development check: which backend drew the last frame and how much light it held. */
export function lightProbe(): { backend: 'gl' | '2d'; shapes: number; particles: number; alpha: number } {
  const f = lastLight;
  return {
    backend: layer?.ready() ? 'gl' : '2d',
    shapes: f?.shapes.length ?? 0,
    particles: f ? f.bursts.reduce((n, b) => n + (f.now >= b.at ? b.count : 0), 0) : 0,
    alpha: layer ? layer.alpha() : 0,
  };
}

/**
 * Keys and MIDI input on the lane. held: keys down now. labels: computer-key letters. tiers: during a timed keys take,
 * each played note's live judgement (judgeKeys), the same rules as the final grade. hits: notes played in Wait for me
 * or a replay. auto: notes the app plays. wrong: when each wrong key was pressed (performance.now ms). expect: keys to
 * press now, pulsing. beat: a lane position that overrides the plan (wait mode). streak: on-time notes in a row (it
 * warms the hit line). run: right, on-time attacks in a row by the card's rule (game.ts liveRun), for the run counter.
 */
export interface LiveKeys {
  held: ReadonlySet<number>;
  labels?: ReadonlyMap<number, string>;
  tiers?: ReadonlyMap<string, KeyLive>;
  hits?: ReadonlySet<string>;
  auto?: ReadonlySet<string>;
  wrong?: ReadonlyMap<number, number>;
  expect?: readonly number[];
  beat?: number;
  message?: string;
  streak?: number;
  run?: number;
}
/** lively: flashes, pops and sparks; calm: colour changes only. level: microphone level, for a neutral ring that is no verdict. */
/** quiet: a microphone take or a demo is playing, so no reward light at all. */
export interface LaneLook {
  lively: boolean;
  level?: number;
  quiet?: boolean;
}
const PLAYED = '#e1c48f',
  WRONG = '#b98a80';
let lastLane = { w: 0, hitY: 0 },
  look: LaneLook = { lively: true },
  haze = 28,
  revealed = -Infinity;
/**
 * A burst of sparks across the keyboard (lively look only). small: a clean take; medium: a step up; big: learned,
 * a review passed or a clean first take on a new day, in three waves.
 */
export function celebrate(size: 'small' | 'medium' | 'big' = 'small'): void {
  if (!look.lively) return;
  bursts.push(
    ...celebration(
      performance.now(),
      size,
      lastLane.w,
      lastLane.hitY,
      [HAND.L, HAND.R, PLAYED].map((c) => rgb(c)),
    ),
  );
}
/** A confirmed live judgement of one key, for its brief flash, pop, ring or early/late tick. Only keys/MIDI takes call this. */
type Effect = { midi: number; tier: KeyLive; colour: string; at: number; burst: boolean };
type LightFx = { cx: number; width: number; tier: string; colour: Rgb; at: number };
const effects: Effect[] = [],
  lightFx: LightFx[] = [],
  fxPool: LightFx[] = [];
export function keyHit(midi: number, tier: KeyLive, colour: string): void {
  effects.push({ midi, tier, colour, at: performance.now(), burst: false });
  if (effects.length > 24) effects.shift();
}
/** A milestone banner over the lane: a title and a line under it, shown for ms (performance.now clock). */
let moment: { title: string; sub: string; at: number; ms: number; big: boolean } | undefined;
export function showMoment(title: string, sub: string, ms: number, big: boolean): void {
  moment = { title, sub, at: performance.now(), ms, big };
}
export function clearMoment(): void {
  moment = undefined;
}
let momentBox: Rect | undefined;
/** The banner's box, from the same numbers it is drawn with; leaves the title font set. */
function momentGeom(
  p: CanvasRenderingContext2D,
  m: NonNullable<typeof moment>,
  w: number,
  h: number,
  small: boolean,
  motion: boolean,
  age: number,
) {
  // Fades in over 180 ms and out over the last 300 ms; with no motion it simply stands.
  const a = motion ? Math.min(1, age / 180, (m.ms - age) / 300) : 1,
    rise = motion ? 8 * (1 - ease(Math.min(1, age / 300))) : 0;
  const size = (small ? 18 : 24) + (m.big ? 4 : 0),
    subSize = small ? 12 : 14,
    cy = h * 0.4 + rise;
  p.font = `${subSize}px Segoe UI`;
  const subW = p.measureText(m.sub).width;
  p.font = `600 ${size}px Segoe UI`;
  const tw = Math.min(w - 16, Math.max(p.measureText(m.title).width, subW) + 48),
    th = size + (m.sub ? subSize + 30 : 22);
  return { a, size, subSize, cy, tw, th, box: { x: w / 2 - tw / 2, y: cy - th / 2, w: tw, h: th } };
}
function drawMoment(p: CanvasRenderingContext2D, w: number, h: number, small: boolean, motion: boolean): void {
  momentBox = undefined;
  if (!moment) return;
  const age = performance.now() - moment.at;
  if (age > moment.ms) {
    moment = undefined;
    return;
  }
  const { a, size, subSize, cy, tw, th, box } = momentGeom(p, moment, w, h, small, motion, age);
  momentBox = box;
  p.globalAlpha = Math.max(0, a);
  p.fillStyle = 'rgba(12,16,14,.9)';
  p.strokeStyle = moment.big ? 'rgba(225,196,143,.75)' : 'rgba(200,216,167,.45)';
  p.lineWidth = moment.big ? 2 : 1;
  p.beginPath();
  p.roundRect(w / 2 - tw / 2, cy - th / 2, tw, th, 12);
  p.fill();
  p.stroke();
  p.lineWidth = 1;
  p.textAlign = 'center';
  p.textBaseline = 'middle';
  p.fillStyle = moment.big ? '#f0dcb0' : '#e8efd9';
  p.fillText(moment.title, w / 2, moment.sub ? cy - th / 2 + 11 + size / 2 : cy, w - 32);
  if (moment.sub) {
    p.font = `${subSize}px Segoe UI`;
    p.fillStyle = '#c4d1b9';
    p.fillText(moment.sub, w / 2, cy + th / 2 - 11 - subSize / 2, w - 32);
  }
  p.textAlign = 'left';
  p.globalAlpha = 1;
}
/** Whether the lane still has something moving on its own (sparks, a flash fading, a banner), so a static lane must keep drawing. */
export const laneAnimating = () =>
  bursts.length > 0 || effects.length > 0 || Math.abs(haze - 28) > 0.5 || moment !== undefined || runMoving;
/** The run counter between frames (game.ts decides what it shows). */
let runMemo: RunMemo = { last: 0 },
  runMoving = false;
/**
 * The run counter: a small ink label at the top left of the lane (runPlace), past the gutter where the bar labels
 * scroll (left), where the notes are still beats away from the hit line, on a dark backing so the light never washes
 * it out. Returns its box so the WebGL light keeps off it.
 */
function drawRun(
  p: CanvasRenderingContext2D,
  show: RunShow,
  small: boolean,
  avoid: readonly Rect[],
  left: number,
): Rect {
  const size = (small ? 14 : 16) * show.scale;
  p.font = `600 ${size}px Segoe UI`;
  const { x, y, w: tw, h: th } = runPlace(p.measureText(show.text).width + 20, size + 12, avoid, left);
  p.globalAlpha = show.alpha;
  p.fillStyle = 'rgba(12,16,14,.62)';
  p.beginPath();
  p.roundRect(x, y, tw, th, th / 2);
  p.fill();
  p.fillStyle = '#e8efd9';
  p.textAlign = 'center';
  p.textBaseline = 'middle';
  p.fillText(show.text, x + tw / 2, y + th / 2 + 1);
  p.textAlign = 'left';
  p.globalAlpha = 1;
  return { x, y, w: tw, h: th };
}
const ease = (t: number) => 1 - (1 - t) * (1 - t);
type Note = Exercise['events'][number]['notes'][number];
const ranges = new WeakMap<
  Exercise,
  {
    lo: number;
    hi: number;
    whites: number[];
    hand: Map<number, 'L' | 'R'>;
    sorted: { e: Exercise['events'][number]; n: Note }[];
  }
>();
function rangeOf(ex: Exercise) {
  let r = ranges.get(ex);
  if (!r) {
    const midis = ex.events.flatMap((e) => e.notes.map((n) => n.midi));
    let lo = Math.min(...midis) - 2,
      hi = Math.max(...midis) + 2;
    lo -= ((lo % 12) + 12) % 12;
    hi += 11 - (((hi % 12) + 12) % 12);
    const whites: number[] = [],
      hand = new Map<number, 'L' | 'R'>();
    for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    for (const e of ex.events) for (const n of e.notes) if (!hand.has(n.midi)) hand.set(n.midi, n.hand);
    // White-key notes first so black-key notes sit on top, as the keys do.
    const sorted = ex.events
      .flatMap((e) => e.notes.map((n) => ({ e, n })))
      .sort((a, b) => Number(isBlack(a.n.midi)) - Number(isBlack(b.n.midi)));
    r = { lo, hi, whites, hand, sorted };
    ranges.set(ex, r);
  }
  return r;
}
/** The hand colour of a pitch in this exercise, for hit effects. */
export const handColour = (ex: Exercise, midi: number) => HAND[rangeOf(ex).hand.get(midi) ?? 'R'];

/**
 * Falling notes onto a keyboard, like a piano video: left hand blue, right hand green, finger numbers at the foot of
 * each note. As a note crosses the hit line it brightens and its key tints: a calm guide, not a verdict. Reward
 * (flash, pop, sparks) comes only from keyHit, for confirmed on-time keys. After a take, colours show the verdicts.
 */
export function drawKeys(
  canvas: HTMLCanvasElement,
  ex: Exercise,
  plan: PiecePlan | undefined,
  now: number,
  support: number,
  result: PieceGrade | undefined,
  reduced: boolean,
  hideWhilePlaying: boolean,
  live?: LiveKeys,
  lookNow: LaneLook = { lively: !reduced },
  reveal?: number,
): void {
  look = { ...lookNow, lively: lookNow.lively && !reduced };
  if (!layerTried) {
    layerTried = true;
    const mode = new URLSearchParams(location.search).get('light');
    if (mode !== '2d')
      layer = glLight(
        canvas.parentElement!,
        () => {
          if (layer) layer.canvas.hidden = true;
          layer = undefined;
        },
        mode === 'gl',
      );
  }
  // Until its shaders are ready the layer draws nothing and the 2D light stands in.
  const gl = layer?.ready() ? layer : undefined;
  const lively = look.lively,
    w = Math.max(280, Math.round(widthOf(canvas))),
    small = w < 600,
    height = laneTall ?? (small ? 300 : 440),
    p = prepare(canvas, height);
  const clock = performance.now(),
    dt = lastFrame ? Math.min(0.05, (clock - lastFrame) / 1000) : 0;
  lastFrame = clock;
  const { lo, hi, whites, sorted } = rangeOf(ex);
  const keyW = w / whites.length,
    kbH = small ? 72 : 104,
    felt = small ? 5 : 7,
    kbTop = height - kbH,
    hitY = kbTop - felt;
  const xOf = (m: number) => {
    if (!isBlack(m)) return { x: whites.indexOf(m) * keyW, width: keyW };
    const left = whites.indexOf(m - 1);
    return { x: (left + 1) * keyW - keyW * 0.29, width: keyW * 0.58 };
  };
  const { beat, moving, playing } =
      live?.beat !== undefined ? { beat: live.beat, moving: true, playing: false } : position(ex, plan, now),
    animate = moving;
  lastLane = { w, hitY };
  // A result on a still lane fits up to twice the usual span, so more of the take's verdicts are in view.
  const usual = Math.max(4, ex.beatsPerBar * (small ? 1.3 : 2)),
    visible = result && !animate ? Math.min(usual * 2, Math.max(usual, ex.beats)) : usual,
    scale = (hitY - 18) / visible;
  const yOf = (b: number) => hitY - (b - (animate ? beat : 0)) * scale;

  // Stage: dark gradient, darker lanes under the black keys, faint guides at each C and F.
  p.fillStyle = gradient(p, `bg${hitY}`, 0, hitY, [
    [0, '#0b0f0d'],
    [1, '#17201b'],
  ]);
  p.fillRect(0, 0, w, hitY);
  p.fillStyle = 'rgba(0,0,0,.22)';
  for (let m = lo; m <= hi; m++)
    if (isBlack(m)) {
      const { x, width } = xOf(m);
      p.fillRect(x, 0, width, hitY);
    }
  for (const m of whites)
    if (m % 12 === 0 || m % 12 === 5) {
      const x = Math.round(xOf(m).x) + 0.5;
      p.strokeStyle = m % 12 === 0 ? 'rgba(220,235,210,.09)' : 'rgba(220,235,210,.045)';
      p.beginPath();
      p.moveTo(x, 0);
      p.lineTo(x, hitY);
      p.stroke();
    }
  // Bar lines and chord names. The "bar N" labels scroll down a gutter at the left; the run counter starts past it.
  p.font = `${small ? 10 : 11}px Segoe UI`;
  p.textBaseline = 'middle';
  const gutter = ex.bars.length ? 6 + p.measureText(`bar ${Math.max(...ex.bars.map((b) => b.number))}`).width + 8 : 8;
  for (const bar of ex.bars) {
    const y = Math.round(yOf(bar.beat)) + 0.5;
    if (y < 8 || y > hitY) continue;
    p.strokeStyle = 'rgba(200,216,167,.16)';
    p.beginPath();
    p.moveTo(0, y);
    p.lineTo(w, y);
    p.stroke();
    p.fillStyle = '#7f927b';
    p.fillText(`bar ${bar.number}`, 6, y - 7);
  }
  for (const c of ex.chords) {
    const y = yOf(c.beat);
    if (y < 8 || y > hitY) continue;
    p.fillStyle = '#b4c6a2';
    p.textAlign = 'right';
    p.fillText(c.symbol, w - 6, y - 7);
    p.textAlign = 'left';
  }

  // Notes: white-key notes first so black-key notes sit on top, as the keys do.
  const hide = hideWhilePlaying && playing;
  // During a reveal, verdicts appear up to the sweep's beat; later notes keep their hand colour until it reaches them.
  const verdicts = result
    ? new Map(
        result.events
          .filter((e) => reveal === undefined || e.beat <= reveal)
          .flatMap((e) => e.notes.map((n) => [`${e.beat}:${n.midi}`, n.verdict])),
      )
    : undefined;
  const onTime =
    result && reveal !== undefined
      ? new Set(
          result.events
            .filter((e) => e.mark === 'good' && e.notes.every((n) => n.verdict === 'heard'))
            .map((e) => e.beat),
        )
      : undefined;
  if (reveal === undefined || reveal < revealed) revealed = -Infinity;
  const sounding = new Map<number, { colour: string }>(),
    judged = Boolean(live?.hits || live?.tiers);
  const notes = hide ? [] : sorted;
  for (const { e, n } of notes) {
    const top = yOf(e.beat + n.dur),
      bottom = yOf(e.beat);
    if (bottom < 0 || top > hitY) continue;
    const key = `${e.beat}:${n.midi}`,
      verdict = verdicts?.get(key),
      black = isBlack(n.midi),
      tier = live?.tiers?.get(key),
      auto = live?.auto?.has(key);
    const offTime = tier === 'early' || tier === 'late';
    const base = mix(verdict ? VERDICT[verdict] : offTime ? OFF_TIME : HAND[n.hand], 0, black ? 0.2 : 0);
    const hit = !judged || auto || tier !== undefined || Boolean(live?.hits?.has(key)),
      passed = judged && !hit && moving && beat > e.beat + 0.5;
    const active = moving && hit && beat >= e.beat && beat < e.beat + n.dur;
    if (active) sounding.set(n.midi, { colour: base });
    const { x, width } = xOf(n.midi),
      nx = x + (black ? 1 : 2),
      nw = Math.max(3, width - (black ? 2 : 4));
    const y0 = Math.max(0, top),
      y1 = Math.min(hitY, bottom - 1),
      nh = Math.max(4, y1 - y0),
      r = Math.min(6, nw / 2, nh / 2);
    p.globalAlpha = verdict === 'cannot-check' || verdict === 'unchecked' || passed ? 0.4 : auto ? 0.5 : 1;
    // A note just reached by the reveal swells a little and, when it was on time with the right key, sheds a few sparks.
    const fresh = reveal !== undefined && verdict ? reveal - e.beat : Infinity,
      swell = lively && fresh < 0.6 ? 1 + 0.12 * Math.sin((Math.PI * fresh) / 0.6) : 1;
    if (lively && onTime?.has(e.beat) && e.beat > revealed && e.beat <= reveal!)
      bursts.push(revealBurst(clock, nx, nw, bottom - 2, rgbOf(base)));
    const sx = nx - (nw * (swell - 1)) / 2,
      sw = nw * swell;
    p.fillStyle = active || swell > 1.02 ? mix(base, 255, 0.2) : base;
    p.beginPath();
    p.roundRect(sx, y0, sw, nh, r);
    p.fill();
    if (nh > 10) {
      p.fillStyle = 'rgba(0,0,0,.18)';
      p.fillRect(nx + 1, y0 + 1, nw - 2, Math.min(6, nh / 3));
    }
    const flagged = verdict === 'wrong' || verdict === 'not-heard';
    p.strokeStyle = flagged ? '#f2c3a3' : black ? 'rgba(0,0,0,.55)' : alpha(mix(base, 255, 0.5), 0.55);
    p.lineWidth = flagged ? 2 : 1;
    p.stroke();
    p.lineWidth = 1;
    p.globalAlpha = 1;
    if (n.finger && !auto && nw > 10 && bottom - y0 > 16) {
      const radius = Math.min(small ? 7 : 9, nw / 2 - 1),
        cy = Math.min(hitY, bottom) - radius - 3;
      p.fillStyle = 'rgba(10,14,12,.5)';
      p.beginPath();
      p.arc(x + width / 2, cy, radius, 0, Math.PI * 2);
      p.fill();
      p.fillStyle = mix(base, 255, 0.65);
      p.font = `bold ${small ? 10 : 12}px Segoe UI`;
      p.textAlign = 'center';
      p.fillText(String(n.finger), x + width / 2, cy + 0.5);
      p.textAlign = 'left';
    }
  }
  if (reveal !== undefined) revealed = reveal;
  if (hide) {
    p.fillStyle = '#c8d8a7';
    p.font = `${small ? 15 : 20}px Segoe UI`;
    p.textAlign = 'center';
    p.fillText(support >= 2 ? 'Carry the pulse.' : 'From memory, or from your music.', w / 2, hitY / 2);
    p.textAlign = 'left';
  }

  // Hit line: a haze that a run of on-time keys warms a little, a small pulse on each beat, and (microphone) a level ring.
  const streak = live?.streak ?? 0,
    target = lively ? (streak >= 30 ? 64 : streak >= 20 ? 52 : streak >= 10 ? 40 : 28) : 28;
  haze += (target - haze) * Math.min(1, dt * (target > haze ? 6 : 4));
  const warm = animate ? Math.min(1, (haze - 28) / 36) : 0;
  // The beat cue: the line itself brightens for a moment on each beat, count-in included. Nothing larger flashes.
  const beatPulse = animate && live?.beat === undefined && plan ? Math.max(0, 1 - (beat - Math.floor(beat)) / 0.18) : 0;
  if (animate) {
    p.fillStyle = gradient(p, `haze${hitY}`, hitY - 28, hitY, [
      [0, 'rgba(216,228,197,0)'],
      [1, 'rgba(216,228,197,.1)'],
    ]);
    p.fillRect(0, hitY - 28, w, 28);
    if (look.level !== undefined) {
      p.fillStyle = alpha('#d8e4c5', 0.04 + 0.22 * Math.min(1, look.level));
      p.fillRect(0, hitY - 4, w, 8);
    }
    p.strokeStyle = alpha('#e8f0dc', 0.6 + 0.35 * beatPulse);
    p.lineWidth = 2;
    p.beginPath();
    p.moveTo(0, hitY);
    p.lineTo(w, hitY);
    p.stroke();
    p.lineWidth = 1;
  }
  // Reward: a pop for confirmed on-time keys and a small tick for early or late. Lively only. The light itself comes from lightFrame.
  const pops = new Map<number, number>();
  if (!lively) {
    effects.length = 0;
    bursts.length = 0;
  }
  lightFx.length = 0;
  for (let i = effects.length - 1; i >= 0; i--) {
    const f = effects[i],
      age = clock - f.at,
      { x, width } = xOf(f.midi),
      cx = x + width / 2;
    if (age > 800) {
      effects.splice(i, 1);
      continue;
    }
    if (f.tier === 'perfect' || f.tier === 'good') {
      if (!f.burst) {
        f.burst = true;
        bursts.push(...hitBurst(clock, f.tier, cx, width, hitY - 1, rgbOf(f.colour), small));
      }
      const fx =
        fxPool[lightFx.length] ??
        (fxPool[lightFx.length] = { cx: 0, width: 0, tier: '', colour: rgbOf(f.colour), at: 0 });
      fx.cx = cx;
      fx.width = width;
      fx.tier = f.tier;
      fx.colour = rgbOf(f.colour);
      fx.at = f.at;
      lightFx.push(fx);
      if (age < 100) pops.set(f.midi, 1 + 0.08 * Math.sin((Math.PI * age) / 100));
    } else if (f.tier === 'early' || f.tier === 'late') {
      const dir = f.tier === 'early' ? -1 : 1,
        tx = cx + dir * (width / 2 + 5),
        ty = hitY - 10;
      p.strokeStyle = alpha(OFF_TIME, 1 - age / 800);
      p.lineWidth = 2;
      p.beginPath();
      p.moveTo(tx - dir * 3, ty - 4);
      p.lineTo(tx + dir, ty);
      p.lineTo(tx - dir * 3, ty + 4);
      p.stroke();
      p.lineWidth = 1;
    } else effects.splice(i, 1);
  }
  pruneBursts(bursts, clock);
  const li = lightIn;
  li.now = clock;
  li.lively = lively;
  li.quiet = look.quiet === true;
  li.inTake = Boolean(plan) || live?.beat !== undefined;
  li.w = w;
  li.hitY = hitY;
  li.effects = lightFx;
  li.bursts = bursts;
  li.warm = warm;
  li.haze = haze;
  li.pulse = lively && animate ? beatPulse : 0;
  li.sweepY = lively && reveal !== undefined ? yOf(reveal) : undefined;
  lightFrame(li, frame);
  lastLight = frame;
  if (!gl) drawLight2d(p, frame);
  if (live?.message) {
    const { x: bx, w: tw, h: th } = pillBox(p, live.message, w, small);
    p.fillStyle = 'rgba(12,16,14,.85)';
    p.strokeStyle = 'rgba(200,216,167,.35)';
    p.beginPath();
    p.roundRect(bx, 10, tw, th, th / 2);
    p.fill();
    p.stroke();
    p.fillStyle = '#e8efd9';
    p.textAlign = 'center';
    p.fillText(live.message, w / 2, 10 + th / 2 + 1);
    p.textAlign = 'left';
  }

  // Keys to press now pulse, so the next move is easy to find.
  const expect = new Set(live?.expect ?? []),
    pulse = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(clock / 160);
  const hint = (m: number, x: number, width: number, h: number) => {
    if (!expect.has(m)) return;
    const colour = handColour(ex, m);
    p.beginPath();
    p.roundRect(x + 2, kbTop + 2, width - 4, h - 5, 4);
    p.fillStyle = alpha(colour, 0.35 + 0.35 * pulse);
    p.fill();
    p.strokeStyle = alpha(mix(colour, 0, 0.35), pulse);
    p.lineWidth = 3;
    p.stroke();
    p.lineWidth = 1;
  };
  // Felt strip and keyboard. A sounding key takes its note's colour and sinks a little; a wrong key tints muted red.
  const keyColour = (m: number): { colour: string } | undefined => {
    const wrongAt = live?.wrong?.get(m);
    if (wrongAt !== undefined && clock - wrongAt < 500) return { colour: WRONG };
    return sounding.get(m) ?? (live?.held.has(m) ? { colour: PLAYED } : undefined);
  };
  p.fillStyle = gradient(p, `strip${hitY}`, hitY, kbTop, [
    [0, '#2b3a30'],
    [1, '#141b16'],
  ]);
  p.fillRect(0, hitY, w, felt);
  p.fillStyle = '#0a0d0b';
  p.fillRect(0, kbTop, w, kbH);
  const bh = kbH * 0.62,
    whiteFace = gradient(p, `white${kbTop}`, kbTop, height, [
      [0, '#dfe2d8'],
      [0.85, '#f4f5ef'],
      [1, '#e3e6dc'],
    ]);
  const blackFace = gradient(p, `black${kbTop}`, kbTop, kbTop + bh, [
    [0, '#0e110f'],
    [1, '#2a302c'],
  ]);
  const grow = (m: number, x: number, width: number) => {
    const s = pops.get(m) ?? 1;
    return { x: x - (width * (s - 1)) / 2, width: width * s };
  };
  for (const m of whites) {
    const { x, width } = xOf(m),
      on = keyColour(m),
      dip = on ? 2 : 0,
      g = grow(m, x, width);
    p.fillStyle = on ? mix(on.colour, 255, 0.1) : whiteFace;
    p.beginPath();
    p.roundRect(g.x + 0.75, kbTop + dip, g.width - 1.5, kbH - dip - 1, [0, 0, 4, 4]);
    p.fill();
    hint(m, x, width, kbH);
    if (m % 12 === 0) {
      p.fillStyle = on ? '#1d2a20' : '#6d7a6f';
      p.font = `${small ? 8 : 10}px Segoe UI`;
      p.textAlign = 'center';
      p.fillText(noteName(m), x + width / 2, height - (small ? 9 : 12));
      p.textAlign = 'left';
    }
    const label = live?.labels?.get(m);
    if (label && width >= 12) {
      p.fillStyle = on ? '#1d2a20' : '#4f5c51';
      p.font = `bold ${small ? 9 : 12}px Segoe UI`;
      p.textAlign = 'center';
      p.fillText(label, x + width / 2, height - (small ? 24 : 32));
      p.textAlign = 'left';
    }
  }
  for (let m = lo; m <= hi; m++)
    if (isBlack(m)) {
      const { x, width } = xOf(m),
        on = keyColour(m),
        dip = on ? 2 : 0,
        g = grow(m, x, width);
      p.fillStyle = 'rgba(0,0,0,.35)';
      p.fillRect(x + 1.5, kbTop, width, bh + 4);
      p.fillStyle = on ? mix(on.colour, 0, 0.15) : blackFace;
      p.beginPath();
      p.roundRect(g.x, kbTop, g.width, bh + dip, [0, 0, 3, 3]);
      p.fill();
      hint(m, x, width, bh + 4);
      p.fillStyle = on ? alpha(mix(on.colour, 255, 0.4), 0.8) : 'rgba(255,255,255,.1)';
      p.fillRect(x + width * 0.18, kbTop + bh + dip - (small ? 5 : 7), width * 0.64, 2);
      const label = live?.labels?.get(m);
      if (label && width >= 9) {
        p.fillStyle = on ? '#1d2a20' : '#aab5a8';
        p.font = `bold ${small ? 8 : 11}px Segoe UI`;
        p.textAlign = 'center';
        p.fillText(label, x + width / 2, kbTop + bh - (small ? 13 : 18));
        p.textAlign = 'left';
      }
    }
  p.fillStyle = gradient(p, `shade${kbTop}`, kbTop, kbTop + 10, [
    [0, 'rgba(0,0,0,.4)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  p.fillRect(0, kbTop, w, 10);
  drawMoment(p, w, hitY, small, lively);
  // The run counter: keys and MIDI timed takes only (the run is 0 otherwise), never in a microphone take or a demo.
  // Drawn last, so it can keep clear of the message pill and the moment as they are this frame.
  const run = runCounter(runMemo, look.quiet ? 0 : (live?.run ?? 0), clock, lively);
  runMemo = look.quiet ? { last: 0 } : run.memo;
  runMoving = run.moving && !look.quiet;
  const runBox =
    run.show && !look.quiet
      ? drawRun(
          p,
          run.show,
          small,
          [...(live?.message ? [pillBox(p, live.message, w, small)] : []), ...(momentBox ? [momentBox] : [])],
          gutter,
        )
      : undefined;
  if (gl) {
    if (live?.message) frame.keepOut.push(pillBox(p, live.message, w, small));
    if (momentBox) frame.keepOut.push(momentBox);
    if (runBox) frame.keepOut.push(runBox);
    gl.draw(frame, w, height);
  }
}
/** The live message pill's box, from the numbers it is drawn with; leaves the pill font set. */
function pillBox(p: CanvasRenderingContext2D, message: string, w: number, small: boolean): Rect {
  p.font = `${small ? 13 : 15}px Segoe UI`;
  const tw = p.measureText(message).width + 28;
  return { x: w / 2 - tw / 2, y: 10, w: tw, h: small ? 28 : 32 };
}

/** Guitar: thin string on top, fret numbers on the strings, strums as a bracket with its direction. Bass is blue, melody green, until a verdict replaces the colour. */
export function drawStrings(
  canvas: HTMLCanvasElement,
  ex: Exercise,
  plan: PiecePlan | undefined,
  now: number,
  support: number,
  result: PieceGrade | undefined,
  reduced: boolean,
  hideWhilePlaying: boolean,
  reveal?: number,
  lively = !reduced,
  quiet = false,
): void {
  look = { lively: lively && !reduced, quiet };
  if (!layerTried) {
    layerTried = true;
    const mode = new URLSearchParams(location.search).get('light');
    if (mode !== '2d')
      layer = glLight(
        canvas.parentElement!,
        () => {
          if (layer) layer.canvas.hidden = true;
          layer = undefined;
        },
        mode === 'gl',
      );
  }
  const gl = layer?.ready() ? layer : undefined;
  const w = Math.max(280, Math.round(widthOf(canvas))),
    small = w < 600,
    height = laneTall ?? (small ? 230 : 300),
    p = prepare(canvas, height);
  const clock = performance.now();
  // Sparks land in the lane. The light's clip is the whole canvas: there is no keyboard under it to hide them.
  lastLane = { w, hitY: height * 0.62 };
  const row = (height - 70) / 6,
    yOf = (string: number) => 40 + (string - 1) * row,
    hit = small ? 80 : 150,
    scale = small ? 70 : 120;
  const { beat, moving, playing } = position(ex, plan, now),
    origin = moving ? beat : 0;
  const xOf = (b: number) =>
    (moving ? hit : 70) + (b - origin) * (moving ? scale : (w - 90) / Math.max(4, Math.min(ex.beats, small ? 6 : 12)));
  p.font = '12px Segoe UI';
  p.textBaseline = 'middle';
  for (let s = 1; s <= 6; s++) {
    const y = yOf(s);
    p.strokeStyle = '#536550';
    p.lineWidth = 1 + (s - 1) * 0.18;
    p.beginPath();
    p.moveTo(50, y);
    p.lineTo(w - 10, y);
    p.stroke();
    p.fillStyle = '#a9b6a6';
    p.fillText(`${s} ${['E', 'B', 'G', 'D', 'A', 'E'][s - 1]}`, 8, y);
  }
  p.lineWidth = 1;
  for (const bar of ex.bars) {
    const x = xOf(bar.beat);
    if (x < 55 || x > w - 10) continue;
    p.strokeStyle = '#3d4c3f';
    p.beginPath();
    p.moveTo(x, 26);
    p.lineTo(x, height - 22);
    p.stroke();
  }
  for (const c of ex.chords) {
    const x = xOf(c.beat);
    if (x < 55 || x > w - 30) continue;
    p.fillStyle = '#c8d8a7';
    p.font = 'bold 13px Segoe UI';
    p.fillText(c.symbol, x + 4, 14);
    p.font = '12px Segoe UI';
  }
  const marks = result
    ? new Map(
        result.events
          .filter((e) => reveal === undefined || e.beat <= reveal)
          .map((e) => [ex.events[e.index]?.beat, e.mark]),
      )
    : undefined;
  if (reveal === undefined || reveal < revealed) revealed = -Infinity;
  if (!(hideWhilePlaying && playing))
    for (const e of ex.events) {
      const x = xOf(e.beat);
      if (x < 55 || x > w - 12) continue;
      const mark = marks?.get(e.beat),
        markColour = mark === 'good' ? '#c8d8a7' : mark === 'unsure' ? '#9ea79b' : mark ? '#e1ad88' : undefined,
        bracket = markColour ?? '#c8d8a7';
      if (e.strum || e.notes.length > 1) {
        const ys = e.notes.map((n) => yOf(n.string ?? 1)),
          top = Math.min(...ys) - 9,
          bottom = Math.max(...ys) + 9;
        p.strokeStyle = bracket;
        p.lineWidth = 3;
        p.beginPath();
        p.moveTo(x, top);
        p.lineTo(x, bottom);
        p.stroke();
        p.lineWidth = 1;
        if (e.strum) {
          p.fillStyle = bracket;
          p.beginPath();
          const tip = e.strum === 'D' ? bottom + 7 : top - 7;
          p.moveTo(x - 6, e.strum === 'D' ? bottom : top);
          p.lineTo(x + 6, e.strum === 'D' ? bottom : top);
          p.lineTo(x, tip);
          p.fill();
        }
      }
      for (const n of e.notes) {
        const y = yOf(n.string ?? 1);
        p.fillStyle = markColour ?? HAND[n.hand];
        p.beginPath();
        p.arc(x, y, small ? 9 : 11, 0, Math.PI * 2);
        p.fill();
        p.fillStyle = '#172018';
        p.font = `bold ${small ? 11 : 12}px Segoe UI`;
        p.textAlign = 'center';
        p.fillText(String(n.fret ?? 0), x, y);
        p.textAlign = 'left';
        p.font = '12px Segoe UI';
      }
      const lead = e.notes[0];
      if (
        look.lively &&
        !quiet &&
        mark === 'good' &&
        reveal !== undefined &&
        e.beat > revealed &&
        e.beat <= reveal &&
        lead
      )
        bursts.push(revealBurst(clock, x, small ? 18 : 22, yOf(lead.string ?? 1), rgbOf(HAND[lead.hand])));
      if (e.label && !small) {
        p.fillStyle = '#91a48d';
        p.font = '10px Segoe UI';
        p.fillText(e.label, x - 8, height - 12);
        p.font = '12px Segoe UI';
      }
    }
  if (reveal !== undefined) revealed = reveal;
  if (hideWhilePlaying && playing) {
    p.fillStyle = '#c8d8a7';
    p.font = `${small ? 15 : 20}px Segoe UI`;
    p.textAlign = 'center';
    p.fillText(support >= 2 ? 'Carry the pulse.' : 'You know the pattern.', w * 0.6, height / 2);
    p.textAlign = 'left';
  }
  if (moving) {
    p.strokeStyle = '#d8e4c5';
    p.lineWidth = 2;
    p.beginPath();
    p.moveTo(hit, 26);
    p.lineTo(hit, height - 22);
    p.stroke();
    p.lineWidth = 1;
  }
  if (ex.capo) {
    p.fillStyle = '#e1c48f';
    p.font = '11px Segoe UI';
    p.fillText(`Capo ${ex.capo}`, w - 70, height - 10);
  }
  if (!look.lively) bursts.length = 0;
  pruneBursts(bursts, clock);
  const li = lightIn;
  li.now = clock;
  li.lively = look.lively;
  li.quiet = quiet;
  li.inTake = Boolean(plan);
  li.w = w;
  li.hitY = height;
  lightFx.length = 0;
  li.effects = lightFx;
  li.bursts = bursts;
  li.warm = 0;
  li.haze = 0;
  li.pulse = 0;
  li.sweepY = undefined;
  lightFrame(li, frame);
  lastLight = frame;
  if (!gl) drawLight2d(p, frame);
  drawMoment(p, w, height, small, look.lively);
  if (gl) {
    if (momentBox) frame.keepOut.push(momentBox);
    gl.draw(frame, w, height);
  }
}

/** A chord box: strings low E to high E left to right, nut at the top, finger numbers in the dots. */
export function chordBox(shape: Pick<Shape, 'name' | 'frets' | 'fingers'>, capo = 0): string {
  const frets = fretList(shape as Shape),
    fingers = [...shape.fingers],
    played = frets.filter((f) => f > 0),
    base = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1;
  const x = (s: number) => 16 + s * 16,
    y = (f: number) => 26 + (f - base + 0.5) * 18;
  const strings = Array.from(
    { length: 6 },
    (_, s) => `<line x1="${x(s)}" x2="${x(s)}" y1="26" y2="116" stroke="#8a9a86"/>`,
  ).join('');
  const frets5 = Array.from(
    { length: 6 },
    (_, i) =>
      `<line x1="16" x2="96" y1="${26 + i * 18}" y2="${26 + i * 18}" stroke="#8a9a86" stroke-width="${i === 0 && base === 1 ? 4 : 1}"/>`,
  ).join('');
  const marks = frets
    .map((f, s) =>
      f < 0
        ? `<text x="${x(s)}" y="19" text-anchor="middle" font-size="12" fill="#e1ad88">×</text>`
        : f === 0
          ? `<circle cx="${x(s)}" cy="15" r="4" fill="none" stroke="#c8d8a7"/>`
          : `<circle cx="${x(s)}" cy="${y(f)}" r="7" fill="#c8d8a7"/><text x="${x(s)}" y="${y(f) + 4}" text-anchor="middle" font-size="12" fill="#172018">${fingers[s] === '0' || fingers[s] === 'x' ? '' : fingers[s]}</text>`,
    )
    .join('');
  return `<figure class="chord-box"><svg viewBox="0 0 112 128" role="img" aria-label="${shape.name}: ${shape.frets}">${strings}${frets5}${marks}${base > 1 ? `<text x="100" y="${y(base) + 4}" font-size="12" fill="#a9b6a6">${base}</text>` : ''}</svg><figcaption>${shape.name}${capo ? ` · capo ${capo}` : ''}</figcaption></figure>`;
}
