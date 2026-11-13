import { isBlack, noteName } from './score';
import type { Exercise } from './exercise';
import type { PiecePlan } from './plan';
import type { PieceGrade } from './grade';
import { fretList, type Shape } from './guitar';

export function pieceShell(): void {
  document.querySelector('#app')!.innerHTML = `<main class="trainer piece">
    <nav class="app-nav" aria-label="Music tools"><a href="${import.meta.env.BASE_URL}">Trainer</a><a href="${import.meta.env.BASE_URL}piece.html" aria-current="page">Pieces</a><a href="${import.meta.env.BASE_URL}play.html?mode=partner">Partner</a><a href="${import.meta.env.BASE_URL}play.html?mode=looper">Looper</a><span>One passage at a time.</span></nav>
    <header class="trainer-header"><div><span id="piece-composer" class="eyebrow"></span><h1 id="piece-title">Learn a piece</h1><p class="intro" id="piece-summary"></p></div><button id="piece-stop" disabled>Stop · Esc</button></header>
    <div class="piece-controls"><label>Piece <select id="piece-select"></select></label><div class="instrument-toggle" role="group" aria-label="Instrument"><button id="inst-piano" aria-pressed="true">Piano</button><button id="inst-guitar" aria-pressed="false">Guitar accompaniment</button></div><div class="instrument-toggle" id="input-toggle" role="group" aria-label="Play with"><button id="input-mic" aria-pressed="true">Microphone</button><button id="input-keys" aria-pressed="false">Keyboard · MIDI</button></div></div>
    <div class="trainer-status"><span id="piece-mic">Mic off</span><span id="piece-model"></span><span id="piece-calibration">Timing not calibrated</span><span id="piece-verified"></span></div>
    <section class="lesson-card" aria-labelledby="unit-title">
      <div class="lesson-heading"><div><span id="unit-stage" class="eyebrow"></span><h2 id="unit-title"></h2></div><div class="trainer-tempo"><label for="piece-bpm">BPM</label><input id="piece-bpm" type="number" min="20" max="240" step="1" inputmode="numeric"><span id="piece-tempo-help"></span></div></div>
      <p id="unit-goal"></p><p id="unit-why" class="unit-why"></p>
      <div class="practice-state"><span id="piece-phase" role="status">Ready when you are</span><span id="piece-guidance"></span></div>
      <div class="lane-wrap"><canvas id="piece-lane" role="img" aria-label="The notes to play, falling toward the keys" aria-describedby="unit-text"></canvas><div id="lane-help"></div></div>
      <p id="unit-text" class="sr-only"></p><div id="unit-shapes" class="unit-shapes"></div>
      <div class="trainer-actions"><button id="piece-start" class="primary">Start practice</button><button id="piece-demo">Hear it</button><button id="piece-wait" hidden title="The notes stop until you play them. Only the keys are checked, not timing.">Wait for me</button><label class="inline-check"><input type="checkbox" id="piece-backing"> <span id="piece-backing-label">Play the other hand with me</span></label><button id="piece-next">Next in today's plan</button></div>
      <p id="piece-feedback" class="coach" role="status"></p>
      <div id="piece-result" hidden><div id="piece-metrics" class="grade-metrics"></div><div id="piece-verdicts" class="note-verdicts"></div><p id="piece-details" class="muted"></p><div class="comfort-actions"><button id="piece-comfortable" class="primary">Felt comfortable</button><button id="piece-struggling">Needs more room</button></div></div>
      <div id="piece-review" hidden><div class="review-heading"><span>Hear yourself</span><span id="piece-take" class="muted"></span></div><audio id="piece-player" controls></audio><div class="review-actions"><button id="piece-previous">Hear previous take</button><button id="piece-latest">Hear latest take</button><button id="piece-loop">Loop latest · play along</button><a id="piece-download" download="take.wav">Download WAV</a><a id="piece-trace" download="take.json">Note details</a></div><p id="piece-review-note" class="muted">Playback stops the microphone. Takes stay in this page.</p></div>
    </section>
    <div class="trainer-secondary">
      <details id="piece-today" open><summary>Today's practice</summary><ol id="today-list" class="today-list"></ol><p class="muted">Warm up in the key, review what is due, take one or two new steps, then play something through without stopping. Short sessions on several days beat one long one.</p></details>
      <details id="piece-course"><summary>Course <span id="course-count"></span></summary><p>Each step climbs a tempo ladder: 50, 60, 70, 80, 88, 94 and 100% of the goal tempo. Two clean, comfortable takes (90% or better) move up one step. At 80% and 100% three takes fade the help: notes visible, then from memory, then a click only on each bar. Two hard takes step down. Hands together, joins and sections open as their parts reach the tempo they need.</p><div id="course-list"></div></details>
      <details id="piece-about"><summary>About this piece</summary><div id="piece-about-body"></div><button id="piece-listen">Hear the whole piece</button></details>
      <details id="piece-settings"><summary>Sound &amp; timing <span id="piece-setup-hint"></span></summary>
        <p>Use headphones so the click and the app's notes stay out of the microphone. Put the laptop on the piano's music desk or a chair beside it, mic facing the strings, the same place every time.</p>
        <label>Goal tempo for this piece <input id="piece-goal" type="number" min="30" max="200" step="1"> <span id="piece-goal-help" class="muted"></span></label>
        <label>Input processing <select id="piece-output"><option value="headphones">Headphones · clean input</option><option value="speakers">Speakers · echo cancellation</option></select></label>
        <label>Demo &amp; take volume <input id="piece-volume" type="range" min="0" max="1" step=".01" value=".5"><output id="piece-volume-value">50%</output></label>
        <label><input id="piece-click" type="checkbox" checked> Metronome during practice</label>
        <label><input id="piece-midi-sound" type="checkbox" checked> Sound for MIDI keys (turn off if your keyboard makes its own sound)</label>
        <label><input id="piece-check-pitch" type="checkbox" checked> Piano note checks (turn off for a piano far out of tune)</label>
        <div class="calibration"><p><strong>Measure your sound delay</strong></p><p>Keep the instrument quiet. Hold one headphone earcup close to the microphone so it can hear eight short clicks.</p><button id="piece-calibrate">Calibrate with 8 clicks</button><p id="piece-calibration-feedback" role="status">Practice works without it; calibration lets tempo steps count.</p><label for="piece-offset">Manual input offset (ms)</label><div class="offset-row"><input id="piece-offset" type="number" min="-300" max="500" step="1" value="0"><button id="piece-use-offset">Use this offset</button></div></div>
        <div class="honesty"><p><strong>What the microphone can and cannot tell</strong></p><p>Timing comes from each attack. For piano, a note counts as <em>heard</em> only when its own partials rise at the attack; <em>not heard</em> needs them to stay quiet. Notes doubled an octave or a twelfth above another note have no partials of their own: <em>can't check</em>. Everything else is <em>unclear</em> and counts neither way. Tested on real piano recordings, a played note was called missing or wrong about 2% of the time and an unplayed note was confirmed under 1% of the time. Your room and piano may differ; listen back to your takes.</p><p>For guitar, single plucked strings are checked for pitch; strums are timing only. Fingering, hand position, pedalling, tone and which strings rang stay for you to judge.</p></div>
      </details>
      <details id="piece-add"><summary>Add your own piece</summary><p>Pieces are plain-text files (<code>.piece.txt</code>). Give a PDF or photo of sheet music to your AI assistant with <code>PIECES.md</code> from this project; it writes the file and checks it twice. Open it here: it stays in this browser${import.meta.env.VITE_ACCOUNTS !== 'off' ? ' unless you are signed in and choose <em>Save to my account</em> (private to you)' : ' and is never uploaded'}.</p><input type="file" id="piece-file" accept=".txt,text/plain"><div id="piece-file-report" role="status"></div><div id="piece-local-list"></div><div id="piece-account-list"></div></details>
      <details id="piece-journal"><summary>Your practice today</summary><div id="piece-journal-list"></div><button id="piece-finish">Finish this session</button><div id="piece-session" role="status" hidden></div><button id="piece-reset" class="text-button">Reset progress for this piece</button><p id="piece-storage" class="muted">Progress stays in this browser. Audio is never saved automatically.</p></details>
    </div>
    <footer><span><kbd>Space</kbd> start practice</span><span><kbd>Esc</kbd> stop everything</span><span>Listening happens in this browser; nothing is uploaded.</span></footer>
  </main>`;
}

const HAND = { L: '#8fb9d9', R: '#c8d8a7' };
const VERDICT: Record<string, string> = { heard: '#c8d8a7', 'not-heard': '#e1ad88', wrong: '#e1ad88', unclear: '#9ea79b', 'cannot-check': '#6f7d72', unchecked: '#6f7d72' };
function prepare(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D {
  const w = Math.max(280, Math.round(canvas.clientWidth)), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr); }
  canvas.style.height = `${height}px`;
  const p = canvas.getContext('2d')!;
  p.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.clearRect(0, 0, w, height); p.fillStyle = '#171f1b'; p.fillRect(0, 0, w, height);
  return p;
}
/** Where the take is in beats, and whether notes are moving. */
function position(ex: Exercise, plan: PiecePlan | undefined, now: number): { beat: number; moving: boolean; playing: boolean } {
  if (!plan || plan.kind === 'calibration') return { beat: 0, moving: false, playing: false };
  if (plan.kind === 'demo') return { beat: (now - plan.start) / plan.period, moving: true, playing: false };
  const demoEnd = plan.playAt - plan.beatsPerBar * plan.period - 1.5 * plan.period;
  if (plan.sounds.some(s => s.kind === 'note' && s.at < demoEnd + 0.01) && now < demoEnd) return { beat: (now - plan.start) / plan.period, moving: true, playing: false };
  return { beat: (now - plan.playAt) / plan.period, moving: true, playing: now >= plan.playAt && now < plan.end };
}

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; colour: string; size: number };
const sparks: Spark[] = [];
let lastFrame = 0;
const channels = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** Blend a colour toward white (to = 255) or black (to = 0). */
const mix = (hex: string, to: number, t: number) => { const c = channels(hex).map(v => Math.round(v + (to - v) * t)); return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`; };
const alpha = (hex: string, a: number) => `rgba(${channels(hex).join(',')},${a})`;

/**
 * Falling notes onto a keyboard, like a piano video: left hand blue, right hand green, finger numbers at the foot of
 * each note. A note glows and its key presses down while it sounds. After a take, colours show the verdicts.
 */
/**
 * Keys and MIDI input on the lane. held: keys down now. labels: computer-key letters. hits: notes the player has
 * pressed (noteKey), so only those glow and notes that pass unplayed fade. wrong: when each wrong key was pressed
 * (performance.now ms). expect: keys to press now, pulsing. beat: a lane position that overrides the plan (wait mode).
 */
export interface LiveKeys { held: ReadonlySet<number>; labels?: ReadonlyMap<number, string>; hits?: ReadonlySet<string>; auto?: ReadonlySet<string>; wrong?: ReadonlyMap<number, number>; expect?: readonly number[]; beat?: number; message?: string }
const PLAYED = '#e1c48f', WRONG = '#e07a6a';
let lastLane = { w: 0, hitY: 0 };
/** A burst of sparks across the keyboard after a clean take. */
export function celebrate(): void {
  const { w, hitY } = lastLane, colours = [HAND.L, HAND.R, PLAYED];
  for (let i = 0; i < 160; i++) sparks.push({ x: Math.random() * w, y: hitY - 2, vx: (Math.random() - 0.5) * 140, vy: -120 - Math.random() * 260, life: 0, max: 0.8 + Math.random() * 0.9, colour: mix(colours[i % 3], 255, 0.3), size: 1 + Math.random() * 2.2 });
}
export function drawKeys(canvas: HTMLCanvasElement, ex: Exercise, plan: PiecePlan | undefined, now: number, support: number, result: PieceGrade | undefined, reduced: boolean, hideWhilePlaying: boolean, live?: LiveKeys): void {
  const small = canvas.clientWidth < 600, height = small ? 300 : 440, p = prepare(canvas, height), w = Math.max(280, Math.round(canvas.clientWidth));
  const clock = performance.now(), dt = lastFrame ? Math.min(0.05, (clock - lastFrame) / 1000) : 0; lastFrame = clock;
  const midis = ex.events.flatMap(e => e.notes.map(n => n.midi));
  let lo = Math.min(...midis) - 2, hi = Math.max(...midis) + 2;
  lo -= ((lo % 12) + 12) % 12; hi += 11 - (((hi % 12) + 12) % 12);
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const keyW = w / whites.length, kbH = small ? 72 : 104, felt = small ? 5 : 7, kbTop = height - kbH, hitY = kbTop - felt;
  const xOf = (m: number) => { if (!isBlack(m)) return { x: whites.indexOf(m) * keyW, width: keyW }; const left = whites.indexOf(m - 1); return { x: (left + 1) * keyW - keyW * 0.29, width: keyW * 0.58 }; };
  const { beat, moving, playing } = live?.beat !== undefined ? { beat: live.beat, moving: true, playing: false } : position(ex, plan, now), animate = moving && !reduced;
  lastLane = { w, hitY };
  const visible = Math.max(4, ex.beatsPerBar * (small ? 1.3 : 2)), scale = (hitY - 18) / visible;
  const yOf = (b: number) => hitY - (b - (animate ? beat : 0)) * scale;

  // Stage: dark gradient, darker lanes under the black keys, faint guides at each C and F.
  const bg = p.createLinearGradient(0, 0, 0, hitY); bg.addColorStop(0, '#0b0f0d'); bg.addColorStop(1, '#17201b');
  p.fillStyle = bg; p.fillRect(0, 0, w, hitY);
  p.fillStyle = 'rgba(0,0,0,.22)';
  for (let m = lo; m <= hi; m++) if (isBlack(m)) { const { x, width } = xOf(m); p.fillRect(x, 0, width, hitY); }
  for (const m of whites) if (m % 12 === 0 || m % 12 === 5) { const x = Math.round(xOf(m).x) + 0.5; p.strokeStyle = m % 12 === 0 ? 'rgba(220,235,210,.09)' : 'rgba(220,235,210,.045)'; p.beginPath(); p.moveTo(x, 0); p.lineTo(x, hitY); p.stroke(); }
  // Bar lines and chord names.
  p.font = `${small ? 10 : 11}px Segoe UI`; p.textBaseline = 'middle';
  for (const bar of ex.bars) { const y = Math.round(yOf(bar.beat)) + 0.5; if (y < 8 || y > hitY) continue; p.strokeStyle = 'rgba(200,216,167,.16)'; p.beginPath(); p.moveTo(0, y); p.lineTo(w, y); p.stroke(); p.fillStyle = '#7f927b'; p.fillText(`bar ${bar.number}`, 6, y - 7); }
  for (const c of ex.chords) { const y = yOf(c.beat); if (y < 8 || y > hitY) continue; p.fillStyle = '#b4c6a2'; p.textAlign = 'right'; p.fillText(c.symbol, w - 6, y - 7); p.textAlign = 'left'; }

  // Notes: white-key notes first so black-key notes sit on top, as the keys do.
  const hide = hideWhilePlaying && playing;
  const verdicts = result ? new Map(result.events.flatMap(e => e.notes.map(n => [`${e.beat}:${n.midi}`, n.verdict]))) : undefined;
  const sounding = new Map<number, { colour: string; flash: number }>();
  const notes = hide ? [] : ex.events.flatMap(e => e.notes.map(n => ({ e, n }))).sort((a, b) => Number(isBlack(a.n.midi)) - Number(isBlack(b.n.midi)));
  for (const { e, n } of notes) {
    const top = yOf(e.beat + n.dur), bottom = yOf(e.beat);
    if (bottom < 0 || top > hitY) continue;
    const verdict = verdicts?.get(`${e.beat}:${n.midi}`), black = isBlack(n.midi);
    const base = mix(verdict ? VERDICT[verdict] : HAND[n.hand], 0, black ? 0.2 : 0);
    const hit = !live?.hits || live.hits.has(`${e.beat}:${n.midi}`), passed = Boolean(live?.hits) && !hit && moving && beat > e.beat + 0.5;
    const active = moving && hit && beat >= e.beat && beat < e.beat + n.dur;
    if (active) sounding.set(n.midi, { colour: base, flash: Math.max(0, 1 - (beat - e.beat) * 3) });
    const { x, width } = xOf(n.midi), nx = x + (black ? 1 : 2), nw = Math.max(3, width - (black ? 2 : 4));
    const y0 = Math.max(0, top), y1 = Math.min(hitY, bottom - 1), nh = Math.max(4, y1 - y0), r = Math.min(6, nw / 2, nh / 2);
    const fill = p.createLinearGradient(0, y0, 0, y0 + nh);
    fill.addColorStop(0, mix(base, 0, 0.28)); fill.addColorStop(1, active ? mix(base, 255, 0.35) : base);
    const auto = live?.auto?.has(`${e.beat}:${n.midi}`);
    p.globalAlpha = verdict === 'cannot-check' || verdict === 'unchecked' || passed ? 0.4 : auto ? 0.5 : 1;
    if (active && animate) { p.shadowColor = base; p.shadowBlur = small ? 12 : 20; }
    p.fillStyle = fill; p.beginPath(); p.roundRect(nx, y0, nw, nh, r); p.fill();
    p.shadowBlur = 0;
    const flagged = verdict === 'wrong' || verdict === 'not-heard';
    p.strokeStyle = flagged ? '#f2c3a3' : black ? 'rgba(0,0,0,.55)' : alpha(mix(base, 255, 0.5), 0.55);
    p.lineWidth = flagged ? 2 : 1; p.stroke(); p.lineWidth = 1; p.globalAlpha = 1;
    if (n.finger && !auto && nw > 10 && bottom - y0 > 16) {
      const radius = Math.min(small ? 7 : 9, nw / 2 - 1), cy = Math.min(hitY, bottom) - radius - 3;
      p.fillStyle = 'rgba(10,14,12,.5)'; p.beginPath(); p.arc(x + width / 2, cy, radius, 0, Math.PI * 2); p.fill();
      p.fillStyle = mix(base, 255, 0.65); p.font = `bold ${small ? 10 : 12}px Segoe UI`; p.textAlign = 'center'; p.fillText(String(n.finger), x + width / 2, cy + 0.5); p.textAlign = 'left';
    }
  }
  if (hide) { p.fillStyle = '#c8d8a7'; p.font = `${small ? 15 : 20}px Segoe UI`; p.textAlign = 'center'; p.fillText(support >= 2 ? 'Carry the pulse.' : 'From memory, or from your music.', w / 2, hitY / 2); p.textAlign = 'left'; }

  // Hit line, a glow where each sounding note meets its key, and sparks rising from it.
  if (animate) {
    const haze = p.createLinearGradient(0, hitY - 28, 0, hitY); haze.addColorStop(0, 'rgba(216,228,197,0)'); haze.addColorStop(1, 'rgba(216,228,197,.1)');
    p.fillStyle = haze; p.fillRect(0, hitY - 28, w, 28);
    p.globalCompositeOperation = 'lighter';
    for (const [m, { colour, flash }] of sounding) {
      const { x, width } = xOf(m), cx = x + width / 2, radius = keyW * 1.3 + flash * keyW * 1.4;
      const glow = p.createRadialGradient(cx, hitY, 0, cx, hitY, radius); glow.addColorStop(0, alpha(colour, 0.5 + flash * 0.4)); glow.addColorStop(1, alpha(colour, 0));
      p.fillStyle = glow; p.fillRect(cx - radius, hitY - radius, radius * 2, radius + felt);
      for (let k = (18 + flash * 120) * dt; k > 0; k--) if (k >= 1 || Math.random() < k) sparks.push({ x: cx + (Math.random() - 0.5) * width * 0.8, y: hitY - 1, vx: (Math.random() - 0.5) * 50, vy: -50 - Math.random() * 110 - flash * 80, life: 0, max: 0.35 + Math.random() * 0.5, colour: mix(colour, 255, 0.35), size: 0.8 + Math.random() * (small ? 1.2 : 1.8) });
    }
    p.globalCompositeOperation = 'source-over';
    p.strokeStyle = 'rgba(232,240,220,.85)'; p.lineWidth = 2; p.beginPath(); p.moveTo(0, hitY); p.lineTo(w, hitY); p.stroke(); p.lineWidth = 1;
  }
  // Sparks keep falling after the notes stop, so a celebration can finish; reduced motion shows none.
  if (reduced) sparks.length = 0;
  if (sparks.length > 500) sparks.splice(0, sparks.length - 500);
  p.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life += dt; if (s.life >= s.max) { sparks.splice(i, 1); continue; }
    s.vy += 90 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
    p.fillStyle = alpha(s.colour, 1 - s.life / s.max); p.beginPath(); p.arc(s.x, s.y, s.size, 0, Math.PI * 2); p.fill();
  }
  p.globalCompositeOperation = 'source-over';
  if (live?.message) {
    p.font = `${small ? 13 : 15}px Segoe UI`; const tw = p.measureText(live.message).width + 28, th = small ? 28 : 32;
    p.fillStyle = 'rgba(12,16,14,.85)'; p.strokeStyle = 'rgba(200,216,167,.35)'; p.beginPath(); p.roundRect(w / 2 - tw / 2, 10, tw, th, th / 2); p.fill(); p.stroke();
    p.fillStyle = '#e8efd9'; p.textAlign = 'center'; p.fillText(live.message, w / 2, 10 + th / 2 + 1); p.textAlign = 'left';
  }

  // Keys to press now pulse, so the next move is easy to find.
  const expect = new Set(live?.expect ?? []), pulse = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(clock / 160);
  const hint = (m: number, x: number, width: number, h: number) => {
    if (!expect.has(m)) return;
    const colour = HAND[ex.events.flatMap(e => e.notes).find(n => n.midi === m)?.hand ?? 'R'];
    p.beginPath(); p.roundRect(x + 2, kbTop + 2, width - 4, h - 5, 4);
    p.fillStyle = alpha(colour, 0.35 + 0.35 * pulse); p.fill();
    p.strokeStyle = alpha(mix(colour, 0, 0.35), pulse); p.lineWidth = 3; p.stroke(); p.lineWidth = 1;
  };
  // Felt strip and keyboard. A sounding key takes its note's colour and sinks a little; a wrong key flashes red.
  const keyColour = (m: number): { colour: string } | undefined => {
    const wrongAt = live?.wrong?.get(m);
    if (wrongAt !== undefined && clock - wrongAt < 500) return { colour: WRONG };
    return sounding.get(m) ?? (live?.held.has(m) ? { colour: PLAYED } : undefined);
  };
  const strip = p.createLinearGradient(0, hitY, 0, kbTop); strip.addColorStop(0, '#2b3a30'); strip.addColorStop(1, '#141b16');
  p.fillStyle = strip; p.fillRect(0, hitY, w, felt);
  p.fillStyle = '#0a0d0b'; p.fillRect(0, kbTop, w, kbH);
  for (const m of whites) {
    const { x, width } = xOf(m), on = keyColour(m), dip = on ? 2 : 0;
    const face = p.createLinearGradient(0, kbTop, 0, height);
    if (on) { face.addColorStop(0, mix(on.colour, 0, 0.15)); face.addColorStop(1, mix(on.colour, 255, 0.2)); } else { face.addColorStop(0, '#dfe2d8'); face.addColorStop(0.85, '#f4f5ef'); face.addColorStop(1, '#e3e6dc'); }
    p.fillStyle = face; p.beginPath(); p.roundRect(x + 0.75, kbTop + dip, width - 1.5, kbH - dip - 1, [0, 0, 4, 4]); p.fill();
    hint(m, x, width, kbH);
    if (m % 12 === 0) { p.fillStyle = on ? '#1d2a20' : '#6d7a6f'; p.font = `${small ? 8 : 10}px Segoe UI`; p.textAlign = 'center'; p.fillText(noteName(m), x + width / 2, height - (small ? 9 : 12)); p.textAlign = 'left'; }
    const label = live?.labels?.get(m);
    if (label && width >= 12) { p.fillStyle = on ? '#1d2a20' : '#4f5c51'; p.font = `bold ${small ? 9 : 12}px Segoe UI`; p.textAlign = 'center'; p.fillText(label, x + width / 2, height - (small ? 24 : 32)); p.textAlign = 'left'; }
  }
  const bh = kbH * 0.62;
  for (let m = lo; m <= hi; m++) if (isBlack(m)) {
    const { x, width } = xOf(m), on = keyColour(m), dip = on ? 2 : 0;
    p.fillStyle = 'rgba(0,0,0,.35)'; p.fillRect(x + 1.5, kbTop, width, bh + 4);
    const face = p.createLinearGradient(0, kbTop, 0, kbTop + bh);
    if (on) { face.addColorStop(0, mix(on.colour, 0, 0.35)); face.addColorStop(1, on.colour); } else { face.addColorStop(0, '#0e110f'); face.addColorStop(1, '#2a302c'); }
    p.fillStyle = face; p.beginPath(); p.roundRect(x, kbTop, width, bh + dip, [0, 0, 3, 3]); p.fill();
    hint(m, x, width, bh + 4);
    p.fillStyle = on ? alpha(mix(on.colour, 255, 0.4), 0.8) : 'rgba(255,255,255,.1)'; p.fillRect(x + width * 0.18, kbTop + bh + dip - (small ? 5 : 7), width * 0.64, 2);
    const label = live?.labels?.get(m);
    if (label && width >= 9) { p.fillStyle = on ? '#1d2a20' : '#aab5a8'; p.font = `bold ${small ? 8 : 11}px Segoe UI`; p.textAlign = 'center'; p.fillText(label, x + width / 2, kbTop + bh - (small ? 13 : 18)); p.textAlign = 'left'; }
  }
  const shade = p.createLinearGradient(0, kbTop, 0, kbTop + 10); shade.addColorStop(0, 'rgba(0,0,0,.4)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
  p.fillStyle = shade; p.fillRect(0, kbTop, w, 10);
  if (reduced && playing) { p.fillStyle = '#c8d8a7'; p.font = '16px Segoe UI'; p.fillText(`Beat ${Math.floor(beat) % ex.beatsPerBar + 1}`, w - 80, 14); }
}

/** Guitar: thin string on top, fret numbers on the strings, strums as a bracket with its direction. */
export function drawStrings(canvas: HTMLCanvasElement, ex: Exercise, plan: PiecePlan | undefined, now: number, support: number, result: PieceGrade | undefined, reduced: boolean, hideWhilePlaying: boolean): void {
  const small = canvas.clientWidth < 600, height = small ? 230 : 300, p = prepare(canvas, height), w = Math.max(280, Math.round(canvas.clientWidth));
  const row = (height - 70) / 6, yOf = (string: number) => 40 + (string - 1) * row, hit = small ? 80 : 150, scale = small ? 70 : 120;
  const { beat, moving, playing } = position(ex, plan, now), origin = moving && !reduced ? beat : 0;
  const xOf = (b: number) => (moving && !reduced ? hit : 70) + (b - origin) * (moving && !reduced ? scale : (w - 90) / Math.max(4, Math.min(ex.beats, small ? 6 : 12)));
  p.font = '12px Segoe UI'; p.textBaseline = 'middle';
  for (let s = 1; s <= 6; s++) { const y = yOf(s); p.strokeStyle = '#536550'; p.lineWidth = 1 + (s - 1) * 0.18; p.beginPath(); p.moveTo(50, y); p.lineTo(w - 10, y); p.stroke(); p.fillStyle = '#a9b6a6'; p.fillText(`${s} ${['E', 'B', 'G', 'D', 'A', 'E'][s - 1]}`, 8, y); }
  p.lineWidth = 1;
  for (const bar of ex.bars) { const x = xOf(bar.beat); if (x < 55 || x > w - 10) continue; p.strokeStyle = '#3d4c3f'; p.beginPath(); p.moveTo(x, 26); p.lineTo(x, height - 22); p.stroke(); }
  for (const c of ex.chords) { const x = xOf(c.beat); if (x < 55 || x > w - 30) continue; p.fillStyle = '#c8d8a7'; p.font = 'bold 13px Segoe UI'; p.fillText(c.symbol, x + 4, 14); p.font = '12px Segoe UI'; }
  const marks = result ? new Map(result.events.map(e => [ex.events[e.index]?.beat, e.mark])) : undefined;
  if (!(hideWhilePlaying && playing)) for (const e of ex.events) {
    const x = xOf(e.beat); if (x < 55 || x > w - 12) continue;
    const mark = marks?.get(e.beat), colour = mark ? (mark === 'good' ? '#c8d8a7' : mark === 'unsure' ? '#9ea79b' : '#e1ad88') : '#c8d8a7';
    if (e.strum || e.notes.length > 1) {
      const ys = e.notes.map(n => yOf(n.string ?? 1)), top = Math.min(...ys) - 9, bottom = Math.max(...ys) + 9;
      p.strokeStyle = colour; p.lineWidth = 3; p.beginPath(); p.moveTo(x, top); p.lineTo(x, bottom); p.stroke(); p.lineWidth = 1;
      if (e.strum) { p.fillStyle = colour; p.beginPath(); const tip = e.strum === 'D' ? bottom + 7 : top - 7; p.moveTo(x - 6, e.strum === 'D' ? bottom : top); p.lineTo(x + 6, e.strum === 'D' ? bottom : top); p.lineTo(x, tip); p.fill(); }
    }
    for (const n of e.notes) {
      const y = yOf(n.string ?? 1);
      p.fillStyle = colour; p.beginPath(); p.arc(x, y, small ? 9 : 11, 0, Math.PI * 2); p.fill();
      p.fillStyle = '#172018'; p.font = `bold ${small ? 11 : 12}px Segoe UI`; p.textAlign = 'center'; p.fillText(String(n.fret ?? 0), x, y); p.textAlign = 'left'; p.font = '12px Segoe UI';
    }
    if (e.label && !small) { p.fillStyle = '#91a48d'; p.font = '10px Segoe UI'; p.fillText(e.label, x - 8, height - 12); p.font = '12px Segoe UI'; }
  }
  if (hideWhilePlaying && playing) { p.fillStyle = '#c8d8a7'; p.font = `${small ? 15 : 20}px Segoe UI`; p.textAlign = 'center'; p.fillText(support >= 2 ? 'Carry the pulse.' : 'You know the pattern.', w * 0.6, height / 2); p.textAlign = 'left'; }
  if (moving && !reduced) { p.strokeStyle = '#d8e4c5'; p.lineWidth = 2; p.beginPath(); p.moveTo(hit, 26); p.lineTo(hit, height - 22); p.stroke(); p.lineWidth = 1; }
  if (ex.capo) { p.fillStyle = '#e1c48f'; p.font = '11px Segoe UI'; p.fillText(`Capo ${ex.capo}`, w - 70, height - 10); }
}

/** A chord box: strings low E to high E left to right, nut at the top, finger numbers in the dots. */
export function chordBox(shape: Pick<Shape, 'name' | 'frets' | 'fingers'>, capo = 0): string {
  const frets = fretList(shape as Shape), fingers = [...shape.fingers], played = frets.filter(f => f > 0), base = played.length && Math.max(...played) > 4 ? Math.min(...played) : 1;
  const x = (s: number) => 16 + s * 16, y = (f: number) => 26 + (f - base + 0.5) * 18;
  const strings = Array.from({ length: 6 }, (_, s) => `<line x1="${x(s)}" x2="${x(s)}" y1="26" y2="116" stroke="#8a9a86"/>`).join('');
  const frets5 = Array.from({ length: 6 }, (_, i) => `<line x1="16" x2="96" y1="${26 + i * 18}" y2="${26 + i * 18}" stroke="#8a9a86" stroke-width="${i === 0 && base === 1 ? 4 : 1}"/>`).join('');
  const marks = frets.map((f, s) => f < 0 ? `<text x="${x(s)}" y="19" text-anchor="middle" font-size="11" fill="#e1ad88">×</text>` : f === 0 ? `<circle cx="${x(s)}" cy="15" r="4" fill="none" stroke="#c8d8a7"/>` : `<circle cx="${x(s)}" cy="${y(f)}" r="7" fill="#c8d8a7"/><text x="${x(s)}" y="${y(f) + 4}" text-anchor="middle" font-size="10" fill="#172018">${fingers[s] === '0' || fingers[s] === 'x' ? '' : fingers[s]}</text>`).join('');
  return `<figure class="chord-box"><svg viewBox="0 0 112 128" role="img" aria-label="${shape.name}: ${shape.frets}">${strings}${frets5}${marks}${base > 1 ? `<text x="100" y="${y(base) + 4}" font-size="10" fill="#a9b6a6">${base}</text>` : ''}</svg><figcaption>${shape.name}${capo ? ` · capo ${capo}` : ''}</figcaption></figure>`;
}
