// Real Chrome against a build of the Pieces page: the "Add your own piece" panel from end to end, with real clicks, real
// key presses and the real clipboard. No audio is needed. Expected texts come from the app's own modules (the guide, the
// problems and differences messages), so this checks the page's wiring, not the wording.
//   SMOKE_ORIGIN=http://127.0.0.1:4173 [SMOKE_SIZE=390x844] node scripts/import-smoke.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runnerImport } from 'vite';
import { chromeSession, pause } from './chrome-session.mjs';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4173';
const [width, height] = (process.env.SMOKE_SIZE || '1280x800').split('x').map(Number);
const root = fileURLToPath(new URL('..', import.meta.url));
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const guide = await load('/src/piece/import-guide.ts'),
  { checkAnswer, problemsMessage } = await load('/src/piece/import.ts'),
  { compareReadings, comparisonLines, differencesMessage } = await load('/src/piece/compare.ts'),
  { compile } = await load('/src/piece/notation.ts');

// Readings made from the guide's own original example tune.
const tune = (title, mode = 'printed') =>
  guide.exampleTune(mode).replace('title: Little Morning Tune', `title: ${title}`);
const fenced = (text) => `\`\`\`text\n${text}\`\`\``;
const GOOD = tune('Smoke Tune'),
  BROKEN = GOOD.replace('pitch-mode: printed\n', '')
    .replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 f#4:4')
    .replace('rh: d5:2~ d5:8 r:8 b4:4', 'rh: d5:2~ d5:8 r:8 h4:4'),
  SECOND = tune('Smoke Tune', 'sounding')
    .replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 g4:4 a4:4')
    .replace('== 4\nharmony: C', '== 4\nharmony: Am'),
  PARTS = tune('Parts Tune'),
  [P1, P2] = [PARTS.slice(0, PARTS.indexOf('== 3')), PARTS.slice(PARTS.indexOf('== 3'))];

const artifacts = new URL('../smoke-artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromeSession(),
  { send, evaluate, until } = browser,
  phases = [];
const phase = (name, facts = {}) => {
  phases.push(name);
  console.log(JSON.stringify({ phase: name, width, ...facts }));
};
try {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__smoke = { errors: [], starts: 0, copied: undefined };
      const error = console.error.bind(console);
      console.error = (...a) => { __smoke.errors.push(a.map(String).join(' ')); error(...a); };
      window.addEventListener('error', (e) => __smoke.errors.push('error: ' + e.message));
      window.addEventListener('unhandledrejection', (e) => __smoke.errors.push('rejection: ' + e.reason));
      // Every way a sound starts (oscillators and buffer sources), to prove that typing in a box plays nothing.
      for (const C of [AudioScheduledSourceNode, AudioBufferSourceNode, OscillatorNode, ConstantSourceNode])
        if (Object.prototype.hasOwnProperty.call(C.prototype, 'start')) {
          const start = C.prototype.start;
          C.prototype.start = function (...a) { __smoke.starts++; return start.apply(this, a); };
        }
      // Record exactly what the page hands to the clipboard, then pass it on.
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => { __smoke.copied = text; return write(text); };
    `,
  });
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: `${origin}/piece.html` });
  await until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'", 30000);

  const q = (s) => JSON.stringify(s);
  // Clicks are real mouse events, once the menu's slide-in (a finite animation) has finished.
  const click = async (selector) => {
    await until(
      "document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)",
      5000,
    );
    const at = await evaluate(
      `(() => { const e = document.querySelector(${q(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
    );
    assert.ok(at, `no element ${selector}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };
  const key = async (key, code, vk, modifiers = 0, commands) => {
    const text = key.length === 1 && !modifiers ? key : undefined;
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      text,
      unmodifiedText: text,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
      commands,
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const fill = async (id, text) => {
    await evaluate(`(() => { const e = document.getElementById(${q(id)}); e.focus(); e.select(); })()`);
    if (text) await send('Input.insertText', { text });
    else await key('Delete', 'Delete', 46);
    await until(`document.getElementById(${q(id)}).value === ${q(text)}`, 10000);
  };
  const report = () =>
    evaluate(
      "({ ok: document.querySelector('#add-report .add-ok')?.textContent ?? '', bad: [...document.querySelectorAll('#add-report .add-bad')].map((p) => p.textContent).join(' '), tidied: document.querySelector('#add-report .add-tidied')?.textContent ?? '', buttons: [...document.querySelectorAll('#add-report button')].map((b) => b.dataset.act) })",
    );
  const check = async (text) => {
    if (text !== undefined) await fill('add-answer', text);
    await click('#add-check');
    await until("document.querySelector('#add-report .add-ok, #add-report .add-bad')");
    return report();
  };
  // The text the page handed to the clipboard, and the system clipboard (Windows keeps CRLF line ends there).
  const copied = async (expected) => {
    const handed = await evaluate('__smoke.copied'),
      system = await evaluate('navigator.clipboard.readText()');
    return handed === expected && system.replace(/\r\n/g, '\n') === expected;
  };
  const copyNote = (selector) =>
    until(
      `document.querySelector(${q(selector)}).closest('.add-row').nextElementSibling.textContent.startsWith('Copied')`,
    );
  const focus = () =>
    evaluate(
      "(() => { const e = document.activeElement; return { act: e?.dataset?.act ?? '', id: e?.id ?? '', inPanel: Boolean(e?.closest('#piece-add')), inReport: Boolean(e?.closest('#add-report')) }; })()",
    );
  const stored = () => evaluate("JSON.parse(localStorage.getItem('piece.imported.v1') ?? '[]')");
  const shot = async (name, selector) => {
    if (selector) await evaluate(`document.querySelector(${q(selector)})?.scrollIntoView({ block: 'start' })`);
    await browser.screenshot(fileURLToPath(new URL(`import-${width}-${name}.png`, artifacts)));
  };

  // Open the menu with a real click (the first gesture also warms the audio and loads piano samples; wait until the
  // network is quiet), then the panel.
  await click('#piece-menu');
  await until("document.getElementById('piece-drawer').open");
  // Quiet means the request count has not changed over two seconds of polling.
  for (let last = -1, same = 0, tries = 0; same < 8 && tries < 200; tries++) {
    same = browser.requests.length === last ? same + 1 : 0;
    last = browser.requests.length;
    await pause(250);
  }
  const quietRequests = browser.requests.length;
  await click('#piece-add > summary');
  await until("document.getElementById('piece-add').open");
  assert.ok(await evaluate("document.getElementById('add-compare').hidden"), 'step 3 starts collapsed');
  phase('open');

  // Copy instructions: exactly the guide, for each reading.
  await click('#add-copy-guide');
  await copyNote('#add-copy-guide');
  assert.ok(await copied(guide.importGuide('first')), 'copied instructions equal the guide');
  phase('copy instructions', { characters: guide.importGuide('first').length });

  // Check and Add: it opens as a draft in the picker, the list and Sound & timing; focus moves to Hear the whole piece.
  let r = await check(fenced(GOOD));
  assert.ok(r.ok.startsWith('Smoke Tune by Example Composer: read and checked. 4 bars, 22 notes'), r.ok);
  await click('#add-report [data-act=add]');
  await until("document.getElementById('piece-title').textContent === 'Smoke Tune'");
  let f = await focus();
  assert.ok(f.act === 'hear' && f.inReport, 'focus after Add is on Hear the whole piece');
  const draft = await evaluate(`({
    option: document.querySelector('#piece-select option:checked').textContent,
    list: document.getElementById('add-list').textContent,
    verified: document.getElementById('piece-verified').textContent,
  })`);
  assert.equal(draft.option, 'Smoke Tune · yours · draft');
  assert.ok(/Draft/.test(draft.list) && /It sounds right/.test(draft.list), draft.list);
  assert.ok(draft.verified.startsWith('Draft'), draft.verified);
  assert.deepEqual(
    (await stored()).map((m) => m.id),
    ['mine:Smoke-Tune'],
  );
  await shot('added', '#add-h2');
  phase('check and add', draft);

  // Confirm: the draft marks go, only the verified line changes, and focus stays on that piece.
  await click('#add-list [data-act=confirm]');
  await until("!document.getElementById('add-list').textContent.includes('Draft')");
  const confirmed = await evaluate(`({
    option: document.querySelector('#piece-select option:checked').textContent,
    verified: document.getElementById('piece-verified').textContent,
  })`);
  assert.equal(confirmed.option, 'Smoke Tune · yours');
  assert.equal(confirmed.verified, 'Notes confirmed by you');
  assert.equal((await stored())[0].text, GOOD.replace('verified: none', 'verified: owner'));
  f = await focus();
  assert.ok(f.act === 'copy-text' && f.inPanel, 'focus after confirming is on the piece');
  phase('confirm', confirmed);

  // A broken reading: its problems with their quoted lines, and the message for the AI.
  r = await check(fenced(BROKEN));
  const expected = checkAnswer(fenced(BROKEN));
  const quotes = await evaluate("[...document.querySelectorAll('#add-report .add-quote')].map((c) => c.textContent)");
  assert.deepEqual(
    quotes,
    expected.errors.filter((e) => e.line).map((e) => e.quote),
  );
  await click('#add-report [data-act=copy-problems]');
  await copyNote('#add-report [data-act=copy-problems]');
  assert.ok(await copied(problemsMessage(expected)), 'copied problems message');
  await shot('broken', '#add-report');
  phase('broken reading', { problems: expected.errors.length });

  // Parts pasted behind each other: Ctrl+V behind an answer that ends without a line break starts on a new line.
  await fill('add-answer', fenced(P1));
  await evaluate(`navigator.clipboard.writeText(${q(`Here is part 2 of 2.\n${fenced(P2)}`)})`);
  await evaluate(
    "(() => { const b = document.getElementById('add-answer'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); })()",
  );
  await key('v', 'KeyV', 86, 2, ['paste']);
  await until("document.getElementById('add-answer').value.includes('Here is part 2')");
  assert.ok(await evaluate("document.getElementById('add-answer').value.includes('```\\nHere is part 2')"));
  r = await check();
  assert.ok(r.ok.includes('4 bars, 22 notes') && r.buttons.includes('add'), JSON.stringify(r));
  phase('parts pasted behind each other');

  // A file opened while the box holds text is added after it; Clear empties the box.
  const file = path.join(browser.directory, 'part-2.txt');
  await writeFile(file, P2);
  await fill('add-answer', fenced(P1));
  const { root: doc } = await send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#add-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await until(`document.getElementById('add-answer').value === ${q(`${fenced(P1)}\n${P2}`)}`);
  r = await check();
  assert.ok(r.ok.includes('4 bars, 22 notes'), JSON.stringify(r));
  await click('[data-act=clear][data-box=add-answer]');
  await until(
    "document.getElementById('add-answer').value === '' && document.getElementById('add-report').innerHTML === ''",
  );
  phase('file appends, Clear empties');

  // Compare: the open piece as the first reading, the second-reading instructions, exactly the differing bars.
  await click('#add-compare-toggle');
  await until("!document.getElementById('add-compare').hidden && !document.getElementById('add-use-open').hidden");
  await click('#add-use-open-button');
  const first = (await stored())[0].text;
  await until(`document.getElementById('add-answer').value === ${q(first)}`);
  await click('#add-copy-second');
  await copyNote('#add-copy-second');
  assert.ok(await copied(guide.importGuide('second')), 'copied second-reading instructions equal the guide');
  await fill('add-second', SECOND);
  await click('#add-compare-go');
  await until("document.querySelector('#add-compare-report [data-act=copy-differences]')");
  const comparison = compareReadings(compile(first).score, compile(SECOND).score);
  const lines = await evaluate(
    "[...document.querySelectorAll('#add-compare-report .add-diffs li')].map((li) => li.textContent)",
  );
  assert.deepEqual(lines, comparisonLines(comparison));
  assert.equal(lines.length, 2);
  await click('#add-compare-report [data-act=copy-differences]');
  await copyNote('#add-compare-report [data-act=copy-differences]');
  assert.ok(await copied(differencesMessage(comparison)), 'copied differences message');
  await shot('compare', '#add-compare-report');
  await evaluate(
    "(() => { const b = document.getElementById('add-second'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); })()",
  );
  await send('Input.insertText', { text: ' ' });
  await until("document.getElementById('add-compare-report').innerHTML === ''");
  assert.equal((await stored())[0].text, first, 'comparing changed nothing');
  phase('compare', { differences: lines.length });

  // The same title by another composer: a question that names the piece, the safe choice focused, then Replace.
  await fill('add-answer', '');
  r = await check(fenced(GOOD.replace('composer: Example Composer', 'composer: Someone Else')));
  await click('#add-report [data-act=add]');
  await until("document.querySelector('#add-report [data-act=add-replace]')");
  const question = await evaluate("document.getElementById('add-report').textContent");
  assert.ok(
    question.includes('You already have “Smoke Tune” by Example Composer. This one is by Someone Else.'),
    question,
  );
  f = await focus();
  assert.equal(f.act, 'add-separate', 'the safe choice has the focus');
  assert.equal((await stored()).length, 1, 'nothing stored before the answer');
  await shot('replace-question', '#add-h2');
  await click('#add-report [data-act=add-replace]');
  await until("document.getElementById('add-report').textContent.includes('Replaced your piece')");
  assert.ok(
    (await evaluate("document.getElementById('add-report').textContent")).includes(
      'Replaced your piece “Smoke Tune” by Example Composer with this one by Someone Else.',
    ),
  );
  const replaced = await stored();
  assert.equal(replaced.length, 1);
  assert.ok(replaced[0].text.includes('composer: Someone Else') && replaced[0].text.includes('verified: none'));
  phase('replace question');

  // Remove takes two clicks; focus stays in the panel.
  await click('#add-list [data-act=remove]');
  await until("document.querySelector('#add-list [data-act=remove]').textContent === 'Click again to remove'");
  assert.equal((await stored()).length, 1, 'one click removes nothing');
  await click('#add-list [data-act=remove]');
  await until("document.getElementById('piece-title').textContent === 'Gymnopédie No. 1'");
  assert.equal((await stored()).length, 0);
  f = await focus();
  assert.ok(f.inPanel && f.id === 'add-h4', 'focus after Remove stays in the panel');
  phase('remove');

  // A quoted line with one very long token wraps instead of widening the menu; no control is under 44 px.
  r = await check(fenced(GOOD.replace('rh: c5:1', `rh: ${'x'.repeat(400)}`)));
  const layout = await evaluate(`(() => {
    const body = document.querySelector('#piece-drawer .drawer-body');
    const small = [...document.querySelectorAll('#piece-add button, #piece-add input:not(.add-file-input), #piece-add summary, #piece-add label.add-file')]
      .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44)
      .map((e) => e.id || e.dataset.act || e.tagName);
    return { page: [document.documentElement.scrollWidth, innerWidth], drawer: [body.scrollWidth, body.clientWidth], small };
  })()`);
  assert.ok(layout.page[0] <= layout.page[1] && layout.drawer[0] <= layout.drawer[1], JSON.stringify(layout));
  assert.deepEqual(layout.small, []);
  await shot('long-token', '#add-report');
  phase('layout', layout);

  // Keyboard · MIDI: typing in a box plays nothing and starts nothing; the same key outside the menu plays a note.
  await evaluate("document.getElementById('piece-setup').open = true");
  await click('#input-keys');
  await until("document.getElementById('input-keys').getAttribute('aria-pressed') === 'true'");
  await fill('add-answer', '');
  const before = await evaluate(
    "({ starts: __smoke.starts, phase: document.getElementById('piece-phase').textContent })",
  );
  const KEYS = {
    z: ['KeyZ', 90],
    x: ['KeyX', 88],
    c: ['KeyC', 67],
    v: ['KeyV', 86],
    q: ['KeyQ', 81],
    w: ['KeyW', 87],
    2: ['Digit2', 50],
    3: ['Digit3', 51],
    ' ': ['Space', 32],
  };
  for (const ch of 'zxcv q2w3 ') await key(ch, ...KEYS[ch]);
  await until("document.getElementById('add-answer').value === 'zxcv q2w3 '");
  const after = await evaluate(
    "({ starts: __smoke.starts, phase: document.getElementById('piece-phase').textContent, stopHidden: document.getElementById('piece-stop').hidden })",
  );
  assert.ok(
    after.starts === before.starts && after.phase === before.phase && after.stopHidden,
    JSON.stringify({ before, after }),
  );
  await key('Escape', 'Escape', 27);
  await until("!document.getElementById('piece-drawer').open");
  const control = await evaluate('__smoke.starts');
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'z',
    code: 'KeyZ',
    text: 'z',
    windowsVirtualKeyCode: 90,
  });
  await until(`__smoke.starts > ${control}`, 5000);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
  phase('keys typing', { sounds: after.starts - before.starts });

  // No console errors, no exceptions, no network requests from the panel (the browser fetches this origin's tab icon
  // itself). What this cannot see: it reads only the page's own network events, so a request made from a web worker,
  // or a WebSocket connection, would not show up here.
  // The page's own piano recordings are not the panel's: the first gesture starts loading them (sampler.ts, through
  // audio.prepare), and a played note fetches its own recording when it is not loaded yet, so on a busy machine they can
  // arrive after the quiet wait above. Only those exact files on this origin are left out: any other address, path or
  // query (anything that could carry pasted text) still fails the check.
  const errors = await evaluate('__smoke.errors');
  assert.deepEqual(errors, []);
  assert.deepEqual(browser.errors, []);
  const ownPiano = new RegExp(
    `^${new URL('piano/', `${origin}/`).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:manifest\\.json|[A-G]b?\\d\\.mp3)$`,
  );
  const ownIcon = new URL('favicon.svg', `${origin}/`).href;
  const requests = browser.requests
    .slice(quietRequests)
    .filter((u) => !/^(blob|data):/.test(u) && u !== ownIcon && !ownPiano.test(u));
  assert.deepEqual(requests, [], 'network requests from the panel');
  console.log(JSON.stringify({ phase: 'complete', width, height, phases: phases.length, errors: 0 }));
} catch (error) {
  process.exitCode = 1;
  await browser.screenshot(fileURLToPath(new URL(`import-${width}-failed.png`, artifacts))).catch(() => {});
  await writeFile(
    new URL(`import-${width}-failed.json`, artifacts),
    JSON.stringify({ error: String(error), phases }, null, 2),
  );
  console.log(
    JSON.stringify({ phase: 'failed', width, after: phases[phases.length - 1] ?? 'start', error: String(error) }),
  );
} finally {
  await browser.close();
}
