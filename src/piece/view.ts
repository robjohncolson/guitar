import { isBlack, noteName } from './score';
import type { Exercise } from './exercise';
import type { PiecePlan } from './plan';
import type { PieceGrade } from './grade';
import { fretList, type Shape } from './guitar';

export function pieceShell(): void {
  document.querySelector('#app')!.innerHTML = `<main class="trainer piece">
    <nav class="app-nav" aria-label="Music tools"><a href="${import.meta.env.BASE_URL}">Trainer</a><a href="${import.meta.env.BASE_URL}piece.html" aria-current="page">Pieces</a><a href="${import.meta.env.BASE_URL}play.html?mode=partner">Partner</a><a href="${import.meta.env.BASE_URL}play.html?mode=looper">Looper</a><span>One passage at a time.</span></nav>
    <header class="trainer-header"><div><span id="piece-composer" class="eyebrow"></span><h1 id="piece-title">Learn a piece</h1><p class="intro" id="piece-summary"></p></div><button id="piece-stop" disabled>Stop · Esc</button></header>
    <div class="piece-controls"><label>Piece <select id="piece-select"></select></label><div class="instrument-toggle" role="group" aria-label="Instrument"><button id="inst-piano" aria-pressed="true">Piano</button><button id="inst-guitar" aria-pressed="false">Guitar accompaniment</button></div></div>
    <div class="trainer-status"><span id="piece-mic">Mic off</span><span id="piece-model"></span><span id="piece-calibration">Timing not calibrated</span><span id="piece-verified"></span></div>
    <section class="lesson-card" aria-labelledby="unit-title">
      <div class="lesson-heading"><div><span id="unit-stage" class="eyebrow"></span><h2 id="unit-title"></h2></div><div class="trainer-tempo"><label for="piece-bpm">BPM</label><input id="piece-bpm" type="number" min="20" max="240" step="1" inputmode="numeric"><span id="piece-tempo-help"></span></div></div>
      <p id="unit-goal"></p><p id="unit-why" class="unit-why"></p>
      <div class="practice-state"><span id="piece-phase" role="status">Ready when you are</span><span id="piece-guidance"></span></div>
      <div class="lane-wrap"><canvas id="piece-lane" role="img" aria-label="The notes to play, falling toward the keys" aria-describedby="unit-text"></canvas><div id="lane-help"></div></div>
      <p id="unit-text" class="sr-only"></p><div id="unit-shapes" class="unit-shapes"></div>
      <div class="trainer-actions"><button id="piece-start" class="primary">Start practice</button><button id="piece-demo">Hear it</button><label class="inline-check"><input type="checkbox" id="piece-backing"> <span id="piece-backing-label">Play the other hand with me</span></label><button id="piece-next">Next in today's plan</button></div>
      <p id="piece-feedback" class="coach" role="status"></p>
      <div id="piece-result" hidden><div id="piece-metrics" class="grade-metrics"></div><div id="piece-verdicts" class="note-verdicts"></div><p id="piece-details" class="muted"></p><div class="comfort-actions"><button id="piece-comfortable" class="primary">Felt comfortable</button><button id="piece-struggling">Needs more room</button></div></div>
      <div id="piece-review" hidden><div class="review-heading"><span>Hear yourself</span><span id="piece-take" class="muted"></span></div><audio id="piece-player" controls></audio><div class="review-actions"><button id="piece-previous">Hear previous take</button><button id="piece-latest">Hear latest take</button><button id="piece-loop">Loop latest · play along</button><a id="piece-download" download="take.wav">Download WAV</a><a id="piece-trace" download="take.json">Note details</a></div><p class="muted">Playback stops the microphone. Takes stay in this page.</p></div>
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
        <label><input id="piece-check-pitch" type="checkbox" checked> Piano note checks (turn off for a piano far out of tune)</label>
        <div class="calibration"><p><strong>Measure your sound delay</strong></p><p>Keep the instrument quiet. Hold one headphone earcup close to the microphone so it can hear eight short clicks.</p><button id="piece-calibrate">Calibrate with 8 clicks</button><p id="piece-calibration-feedback" role="status">Practice works without it; calibration lets tempo steps count.</p><label for="piece-offset">Manual input offset (ms)</label><div class="offset-row"><input id="piece-offset" type="number" min="-300" max="500" step="1" value="0"><button id="piece-use-offset">Use this offset</button></div></div>
        <div class="honesty"><p><strong>What the microphone can and cannot tell</strong></p><p>Timing comes from each attack. For piano, a note counts as <em>heard</em> only when its own partials rise at the attack; <em>not heard</em> needs them to stay quiet. Notes doubled an octave or a twelfth above another note have no partials of their own: <em>can't check</em>. Everything else is <em>unclear</em> and counts neither way. Tested on real piano recordings, a played note was called missing or wrong about 2% of the time and an unplayed note was confirmed under 1% of the time. Your room and piano may differ; listen back to your takes.</p><p>For guitar, single plucked strings are checked for pitch; strums are timing only. Fingering, hand position, pedalling, tone and which strings rang stay for you to judge.</p></div>
      </details>
      <details id="piece-add"><summary>Add your own piece</summary><p>Pieces are plain-text files (<code>.piece.txt</code>). Give a PDF or photo of sheet music to your AI assistant with <code>PIECES.md</code> from this project; it writes the file and checks it twice. Open it here: it stays in this browser${import.meta.env.VITE_ACCOUNTS !== 'off' ? ' unless you are signed in and choose <em>Save to my account</em> (private to you)' : ' and is never uploaded'}.</p><input type="file" id="piece-file" accept=".txt,text/plain"><div id="piece-file-report" role="status"></div><div id="piece-local-list"></div><div id="piece-account-list"></div></details>
      <details id="piece-journal"><summary>Your practice today</summary><div id="piece-journal-list"></div><button id="piece-finish">Finish this session</button><div id="piece-session" role="status" hidden></div><button id="piece-reset" class="text-button">Reset progress for this piece</button><p id="piece-storage" class="muted">Progress stays in this browser. Audio is never saved automatically.</p></details>
    </div>
    <footer><span><kbd>Esc</kbd> stop everything</span><span>Listening happens in this browser; nothing is uploaded.</span></footer>
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

/** Falling notes onto a keyboard: left hand blue, right hand green, finger numbers inside. After a take, colours show the verdicts. */
export function drawKeys(canvas: HTMLCanvasElement, ex: Exercise, plan: PiecePlan | undefined, now: number, support: number, result: PieceGrade | undefined, reduced: boolean, hideWhilePlaying: boolean): void {
  const small = canvas.clientWidth < 600, height = small ? 260 : 340, p = prepare(canvas, height), w = Math.max(280, Math.round(canvas.clientWidth));
  const midis = ex.events.flatMap(e => e.notes.map(n => n.midi));
  let lo = Math.min(...midis) - 2, hi = Math.max(...midis) + 2;
  lo -= ((lo % 12) + 12) % 12; hi += 11 - (((hi % 12) + 12) % 12);
  const whites: number[] = [];
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const keyW = w / whites.length, kbH = small ? 44 : 56, hitY = height - kbH;
  const xOf = (m: number) => { if (!isBlack(m)) return { x: whites.indexOf(m) * keyW, width: keyW }; const left = whites.indexOf(m - 1); return { x: (left + 1) * keyW - keyW * 0.3, width: keyW * 0.6 }; };
  const { beat, moving, playing } = position(ex, plan, now);
  const visible = Math.max(4, ex.beatsPerBar * (small ? 1.3 : 2)), scale = (hitY - 18) / visible;
  const yOf = (b: number) => hitY - (b - (moving && !reduced ? beat : 0)) * scale;
  // Bar lines and chord names.
  p.font = `${small ? 10 : 11}px Segoe UI`; p.textBaseline = 'middle';
  for (const bar of ex.bars) { const y = yOf(bar.beat); if (y < 8 || y > hitY) continue; p.strokeStyle = '#2f3d33'; p.beginPath(); p.moveTo(0, y); p.lineTo(w, y); p.stroke(); p.fillStyle = '#7f927b'; p.fillText(`bar ${bar.number}`, 6, y - 7); }
  for (const c of ex.chords) { const y = yOf(c.beat); if (y < 8 || y > hitY) continue; p.fillStyle = '#b4c6a2'; p.textAlign = 'right'; p.fillText(c.symbol, w - 6, y - 7); p.textAlign = 'left'; }
  const hide = hideWhilePlaying && playing;
  const verdicts = result ? new Map(result.events.flatMap(e => e.notes.map(n => [`${ex.events[e.index]?.beat}:${n.midi}`, n.verdict]))) : undefined;
  const sounding = new Set<number>();
  if (!hide) for (const e of ex.events) for (const n of e.notes) {
    const top = yOf(e.beat + n.dur), bottom = yOf(e.beat);
    if (bottom < 0 || top > hitY) continue;
    if (moving && beat >= e.beat && beat < e.beat + n.dur) sounding.add(n.midi);
    const { x, width } = xOf(n.midi), verdict = verdicts?.get(`${e.beat}:${n.midi}`);
    const colour = verdict ? VERDICT[verdict] : HAND[n.hand];
    p.fillStyle = colour; p.globalAlpha = verdict === 'cannot-check' || verdict === 'unchecked' ? 0.45 : 0.9;
    const y0 = Math.max(0, top), y1 = Math.min(hitY, bottom - 1);
    p.beginPath(); p.roundRect(x + 2, y0, Math.max(3, width - 4), Math.max(4, y1 - y0), 4); p.fill(); p.globalAlpha = 1;
    if (verdict === 'wrong' || verdict === 'not-heard') { p.strokeStyle = '#f2c3a3'; p.lineWidth = 2; p.stroke(); p.lineWidth = 1; }
    if (n.finger && width > 11 && bottom - Math.max(0, top) > 14) { p.fillStyle = '#172018'; p.font = `bold ${small ? 10 : 12}px Segoe UI`; p.textAlign = 'center'; p.fillText(String(n.finger), x + width / 2, bottom - 9); p.textAlign = 'left'; }
  }
  if (hide) { p.fillStyle = '#c8d8a7'; p.font = `${small ? 15 : 20}px Segoe UI`; p.textAlign = 'center'; p.fillText(support >= 2 ? 'Carry the pulse.' : 'From memory, or from your music.', w / 2, hitY / 2); p.textAlign = 'left'; }
  // Keyboard.
  for (const m of whites) { const { x, width } = xOf(m); p.fillStyle = sounding.has(m) ? '#dfe9cf' : '#e9ece4'; p.fillRect(x + 0.5, hitY, width - 1, kbH); if (m % 12 === 0) { p.fillStyle = '#5d6b5f'; p.font = `${small ? 8 : 9}px Segoe UI`; p.fillText(noteName(m), x + 2, height - 8); } }
  for (let m = lo; m <= hi; m++) if (isBlack(m)) { const { x, width } = xOf(m); p.fillStyle = sounding.has(m) ? '#7c9a5f' : '#1d221e'; p.fillRect(x, hitY, width, kbH * 0.62); }
  if (moving && !reduced) { p.strokeStyle = '#d8e4c5'; p.lineWidth = 2; p.beginPath(); p.moveTo(0, hitY); p.lineTo(w, hitY); p.stroke(); p.lineWidth = 1; }
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
