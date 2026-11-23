// Real Chrome against a build of the Pieces page: the reader in "Add your own piece" ("Or let an AI read it for you")
// from end to end, against a fake chat-completions service run by this script on 127.0.0.1. The real service is never
// called. The fake service speaks the streaming format and records what it received: the Authorization header, the
// instructions and the pictures in order. The pages are a PDF and a PNG drawn here (lines and boxes, no published
// music). Expected texts come from the app's own modules, so this checks the page's wiring, not the wording.
//   SMOKE_ORIGIN=http://127.0.0.1:4173 [SMOKE_SIZE=390x844] [SMOKE_ARTIFACTS=dir] node scripts/reader-smoke.mjs
import http from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  { compareReadings, comparisonLines } = await load('/src/piece/compare.ts'),
  reader = await load('/src/piece/reader.ts');

const tune = (title, mode = 'printed') =>
  guide.exampleTune(mode).replace('title: Little Morning Tune', `title: ${title}`);
const fenced = (text) => `Here is the piece.\n\`\`\`text\n${text}\`\`\``;
const GOOD = fenced(tune('Reader Tune')),
  BROKEN = fenced(
    tune('Reader Tune')
      .replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 f#4:4')
      .replace('rh: d5:2~ d5:8 r:8 b4:4', 'rh: d5:2~ d5:8 r:8 h4:4'),
  ),
  SECOND = fenced(tune('Reader Tune', 'sounding').replace('rh: e5:4 c5:4 f#4:4 a4:4', 'rh: e5:4 c5:4 g4:4 a4:4'));
const KEY = `sk-smoke-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
const USAGE = { prompt_tokens: 4321, completion_tokens: 987 };

// The fake service. Each POST takes the next planned answer.
const received = [],
  plan = [];
const service = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };
  if (req.method === 'OPTIONS') {
    received.push({ method: 'OPTIONS', url: req.url, asks: req.headers['access-control-request-headers'] ?? '' });
    res.writeHead(204, cors);
    return res.end();
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const entry = { method: req.method, url: req.url, auth: req.headers.authorization, raw, body: JSON.parse(raw) };
  received.push(entry);
  const step = plan.shift() ?? { status: 500 };
  if (step.status) {
    res.writeHead(step.status, { ...cors, 'content-type': 'application/json' });
    return res.end('{"error":{"message":"refused by the fake service"}}');
  }
  res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  res.on('close', () => (entry.aborted = !res.writableEnded));
  send({ choices: [{ index: 0, delta: { reasoning_content: 'Looking at the pictures. ' } }] });
  const text = step.text;
  for (let i = 0; i < text.length; i += 40) {
    if (res.destroyed) return;
    send({ choices: [{ index: 0, delta: { content: text.slice(i, i + 40) } }] });
    await pause(step.slow ? 50 : 2);
  }
  if (step.slow) return; // never ends: the page has to cancel it
  send({ choices: [{ index: 0, delta: {}, finish_reason: step.finish ?? 'stop' }] });
  send({ choices: [], usage: USAGE });
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${service.address().port}/v1/chat/completions`;

// A PDF drawn here: page 1 has two piano systems, page 2 one. Lines and boxes only.
function system(top) {
  const ops = ['0 0 0 RG 0 0 0 rg 0.8 w'];
  for (const staffTop of [top, top - 60]) {
    for (let i = 0; i < 5; i++) ops.push(`60 ${staffTop - i * 6} m 535 ${staffTop - i * 6} l S`);
    for (let x = 80, k = 0; x < 515; x += 28, k++) {
      const y = staffTop - 24 + ((k * 7) % 22);
      ops.push(`${x} ${y} 7 5 re f ${x + 6.6} ${y + 2.5} m ${x + 6.6} ${y + 20} l S`);
    }
  }
  for (const x of [60, 180, 300, 420, 535]) ops.push(`${x} ${top} m ${x} ${top - 84} l S`);
  return ops.join('\n');
}
function makePdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  for (const [i, content] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents ${4 + 2 * i} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// A PNG drawn here: one piano system on a white page; `dark`: light notes on a dark page (a dark-mode screenshot);
// `blank`: the page alone.
function makePng(w, h, look = 'light') {
  const [paper, ink] = look === 'dark' ? [30, 230] : [255, 0];
  const rgb = Buffer.alloc(w * h * 3, paper);
  const box = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) rgb.fill(ink, (y * w + x0) * 3, (y * w + x1) * 3);
  };
  for (const top of look === 'blank' ? [] : [500, 660]) {
    for (let i = 0; i < 5; i++) box(120, top + i * 16, 1080, top + i * 16 + 3);
    for (let x = 160, k = 0; x < 1040; x += 56, k++) {
      const y = top + ((k * 13) % 60);
      box(x, y, x + 18, y + 12);
      box(x + 16, y - 45, x + 19, y + 6);
    }
  }
  if (look !== 'blank') for (const x of [120, 360, 600, 840, 1077]) box(x, 500, x + 3, 724);
  const lines = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(lines, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(lines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const artifacts = process.env.SMOKE_ARTIFACTS
  ? pathToFileURL(path.resolve(process.env.SMOKE_ARTIFACTS) + path.sep)
  : new URL('../smoke-artifacts/', import.meta.url);
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
      window.__smoke = { errors: [] };
      const error = console.error.bind(console);
      console.error = (...a) => { __smoke.errors.push(a.map(String).join(' ')); error(...a); };
      window.addEventListener('error', (e) => __smoke.errors.push('error: ' + e.message));
      window.addEventListener('unhandledrejection', (e) => __smoke.errors.push('rejection: ' + e.reason));
      // Record exactly what the page hands to the clipboard, then pass it on.
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => { __smoke.copied = text; return write(text); };
    `,
  });
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  // The real service is never called: the key checks below run at DeepSeek's own address, and the browser refuses any
  // request to it, should one ever be made (the address check at the end would name it).
  await send('Network.setBlockedURLs', { urls: ['*api.deepseek.com*', '*.deepseek.com*'] });
  await send('Page.navigate', { url: `${origin}/piece.html` });
  await until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'", 30000);

  const q = (s) => JSON.stringify(s);
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
  const fill = async (id, text) => {
    await evaluate(`(() => { const e = document.getElementById(${q(id)}); e.focus(); e.select(); })()`);
    await send('Input.insertText', { text });
    await until(`document.getElementById(${q(id)}).value === ${q(text)}`, 10000);
  };
  const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.textContent ?? ''`);
  const stored = () => evaluate(`JSON.parse(localStorage.getItem(${q(reader.READER_KEY)}) ?? 'null')`);
  const posts = () => received.filter((r) => r.method === 'POST');
  const shot = async (name, selector) => {
    if (selector) await evaluate(`document.querySelector(${q(selector)})?.scrollIntoView({ block: 'start' })`);
    await browser.screenshot(fileURLToPath(new URL(`reader-${width}-${name}.png`, artifacts)));
  };
  /** The space between two elements, in px (0 or less when they touch or overlap). */
  const gap = (a, b) =>
    evaluate(
      `(() => { const x = document.querySelector(${q(a)}).getBoundingClientRect(), y = document.querySelector(${q(b)}).getBoundingClientRect(); return Math.round(Math.max(x.top - y.bottom, y.top - x.bottom)); })()`,
    );
  /**
   * Watch where Read sits within the reader while the page changes (pages being prepared): `stop` returns every
   * distinct position seen, which must be one.
   */
  const watchRead = async () => {
    await evaluate(`(() => {
      const reader = document.getElementById('add-reader'), read = document.getElementById('reader-read');
      window.__readTops = new Set();
      const sample = () => window.__readTops.add(Math.round(read.getBoundingClientRect().top - reader.getBoundingClientRect().top));
      sample();
      window.__readWatch = new MutationObserver(sample);
      window.__readWatch.observe(reader, { subtree: true, childList: true, characterData: true, attributes: true });
    })()`);
    return async () => evaluate('(() => { window.__readWatch.disconnect(); return [...window.__readTops]; })()');
  };
  const keyNowhereOnPage = async () =>
    !(await evaluate(
      `document.body.innerText.includes(${q(KEY)}) || document.documentElement.outerHTML.includes(${q(KEY)})`,
    ));

  // The menu, then the panel; the reader is closed and nothing of it has loaded.
  await click('#piece-menu');
  await until("document.getElementById('piece-drawer').open");
  for (let last = -1, same = 0, tries = 0; same < 8 && tries < 200; tries++) {
    same = browser.requests.length === last ? same + 1 : 0;
    last = browser.requests.length;
    await pause(250);
  }
  const quietRequests = browser.requests.length;
  await click('#piece-add > summary');
  await until("document.getElementById('piece-add').open");
  assert.ok(await evaluate("document.getElementById('add-reader').hidden"), 'the reader starts closed');
  assert.equal(await evaluate("document.getElementById('add-reader-toggle').getAttribute('aria-expanded')"), 'false');
  assert.ok(!(await evaluate('[...document.scripts].some((s) => /reader-view|pdf/.test(s.src))')));
  await click('#add-reader-toggle');
  await until("document.getElementById('reader-key')", 15000);
  assert.equal(await text('#reader-read'), 'Read with DeepSeek');
  phase('open');

  // The key is checked before anything is sent: at DeepSeek's own address a key that does not start with "sk-" (a
  // password, say) stays here, and so does a key that holds a character no key has (an invisible one copied along).
  // The reason is said next to the key field, which takes the focus.
  for (const [key, kind] of [
    ['hunter2password', 'not-deepseek-key'],
    ['sk-smoke​key', 'key-character'],
  ]) {
    await fill('reader-key', key);
    await click('#reader-read');
    await until(
      `document.getElementById('reader-key-note').textContent === ${q(reader.failureSentence({ kind }, 'DeepSeek'))}`,
      10000,
    );
    assert.equal(await evaluate('document.activeElement?.id'), 'reader-key');
    assert.ok((await gap('#reader-key-note', '#reader-key')) < 60, 'the reason is said next to the key');
    assert.equal(await text('#reader-status'), '');
  }
  assert.ok(!browser.requests.some((u) => /deepseek\.com/.test(u)), 'nothing went to DeepSeek');
  phase('key checks');

  // The key is kept for its own service only: a new address at another origin forgets it.
  await fill('reader-key', KEY);
  assert.deepEqual(await stored(), { endpoint: reader.DEEPSEEK_ENDPOINT, model: reader.DEFAULT_MODEL, key: KEY });
  await click('.reader-advanced > summary');
  await until("document.querySelector('.reader-advanced').open");
  await fill('reader-endpoint', endpoint);
  await evaluate("document.getElementById('reader-endpoint').blur()");
  await until("document.getElementById('reader-key').value === ''");
  assert.deepEqual(await stored(), { endpoint, model: reader.DEFAULT_MODEL, key: '' });
  // Said next to the address that caused it.
  assert.match(await text('#reader-endpoint-note'), /another service, so the key was forgotten/);
  assert.ok((await gap('#reader-endpoint-note', '#reader-endpoint')) < 60, 'the address note is next to it');
  await fill('reader-key', KEY);
  assert.equal((await stored()).key, KEY);
  // The key is in a password field marked as a new secret with a name of its own, which the password manager does not
  // fill with this site's account password; and the browser gives it to no screen reader (a text field drawn as dots
  // would hand them the key).
  const keyField = () =>
    evaluate(
      "(() => { const e = document.getElementById('reader-key'); return { type: e.type, autocomplete: e.autocomplete, name: e.name, passwords: document.querySelectorAll('#add-reader input[type=password]').length }; })()",
    );
  const hidden = { type: 'password', autocomplete: 'new-password', name: 'reader-ai-service-key', passwords: 1 };
  const keyForScreenReaders = async () => {
    const { root: d } = await send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: d.nodeId, selector: '#reader-key' });
    const { node } = await send('DOM.describeNode', { nodeId });
    const { nodes } = await send('Accessibility.getPartialAXTree', {
      backendNodeId: node.backendNodeId,
      fetchRelatives: false,
    });
    return { role: nodes[0]?.role?.value, key: JSON.stringify(nodes).includes(KEY) };
  };
  assert.deepEqual(await keyField(), hidden);
  assert.deepEqual(await keyForScreenReaders(), { role: 'textbox', key: false });
  await click('#add-reader [data-reader=show]');
  assert.equal((await keyField()).type, 'text');
  assert.equal(await evaluate("document.querySelector('#add-reader [data-reader=show]').textContent"), 'Hide');
  await click('#add-reader [data-reader=show]');
  assert.deepEqual(await keyField(), hidden);
  assert.deepEqual(await keyForScreenReaders(), { role: 'textbox', key: false });
  const service = `127.0.0.1:${new URL(endpoint).port}`;
  assert.equal(await text('#reader-read'), `Read with ${service}`);
  phase('settings');

  // Pages: a PDF of two pages and a PNG, cut into systems in the browser.
  const pdf = path.join(browser.directory, 'drawn.pdf'),
    png = path.join(browser.directory, 'drawn.png');
  await writeFile(pdf, makePdf([`${system(760)}\n${system(470)}`, system(700)]));
  await writeFile(png, makePng(1200, 1600));
  const { root: doc } = await send('DOM.getDocument', { depth: 1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#reader-files' });
  // Read does not move while the pages are prepared: it sits above the files and their pictures.
  let stopWatch = await watchRead();
  await send('DOM.setFileInputFiles', { nodeId, files: [pdf, png] });
  await until(
    "document.getElementById('reader-count').textContent.endsWith('pages.') && [...document.querySelectorAll('#reader-file-list li')].every((li) => !/Waiting|Preparing/.test(li.textContent))",
    60000,
  );
  assert.deepEqual((await stopWatch()).length, 1, 'Read stayed where it was');
  // The count and the labels speak of pictures, never of systems.
  assert.equal(await text('#reader-count'), '4 pictures from 3 pages.');
  const files = await evaluate("[...document.querySelectorAll('#reader-file-list li')].map((li) => li.textContent)");
  assert.deepEqual(files, ['drawn.pdfPDF, 2 pagesRemove', 'drawn.pngPicture of one pageRemove']);
  const labels = () => evaluate("[...document.querySelectorAll('#reader-cuts img')].map((i) => i.alt)");
  assert.deepEqual(await labels(), [
    'Page 1, picture 1',
    'Page 1, picture 2',
    'Page 2, picture 1',
    'Page 3, picture 1',
  ]);
  assert.ok((await gap('#reader-read', '#reader-cuts li')) > 0, 'Read comes before the pictures');
  const sizes = await evaluate(
    "Promise.all([...document.querySelectorAll('#reader-cuts img')].map((i) => i.decode().then(() => [i.naturalWidth, i.naturalHeight])))",
  );
  // Each picture is one system (much wider than tall), within the size the service looks at.
  for (const [w, h] of sizes)
    assert.ok(w * h <= 1_700_000 && Math.max(w, h) <= 2600 && w > 2 * h, JSON.stringify(sizes));
  assert.equal(posts().length, 0, 'nothing is sent before Read');
  await shot('pictures', '#reader-count');
  // He removes one picture: it will not be sent.
  await click('#reader-cuts li:nth-child(2) [data-reader=remove-cut]');
  await until("document.getElementById('reader-count').textContent === '3 pictures from 3 pages.'");
  assert.deepEqual(await labels(), ['Page 1, picture 1', 'Page 2, picture 1', 'Page 3, picture 1']);
  const shown = await evaluate("[...document.querySelectorAll('#reader-cuts img')].map((i) => i.src)");
  assert.equal(
    await text('#reader-privacy'),
    `The 3 pictures shown below go from this browser straight to ${service}, with your key. They do not pass through Clean Take’s server, and no audio is ever sent.`,
  );
  phase('pictures', { sizes });

  // Read: the service receives the key in its header only, the guide, the pictures in order and the closing line; the
  // answer lands in step 2's box and goes through Check, with the same problems list.
  plan.push({ text: BROKEN });
  await click('#reader-read');
  await until("document.querySelector('#add-report .add-bad')", 30000);
  let post = posts()[0];
  assert.equal(post.url, '/v1/chat/completions');
  assert.equal(post.auth, `Bearer ${KEY}`);
  assert.ok(!post.raw.includes(KEY) && !post.url.includes(KEY), 'the key is only in the header');
  assert.ok(received.some((r) => r.method === 'OPTIONS' && /authorization/i.test(r.asks)));
  assert.equal(post.body.model, reader.DEFAULT_MODEL);
  assert.equal(post.body.stream, true);
  assert.equal(post.body.messages.length, 1);
  const parts = post.body.messages[0].content;
  assert.deepEqual(parts[0], { type: 'text', text: guide.importGuide('first') });
  assert.deepEqual(
    parts.filter((p) => p.type === 'image_url').map((p) => p.image_url.url),
    shown,
  );
  assert.ok(shown.every((u) => u.startsWith('data:image/jpeg;base64,')));
  assert.deepEqual(parts[parts.length - 1], { type: 'text', text: reader.closingLine(3, 3) });
  assert.equal(await evaluate("document.getElementById('add-answer').value"), BROKEN);
  const expected = checkAnswer(BROKEN);
  assert.deepEqual(
    await evaluate("[...document.querySelectorAll('#add-report .add-quote')].map((c) => c.textContent)"),
    expected.errors.filter((e) => e.line).map((e) => e.quote),
  );
  assert.equal(
    await text('#reader-run'),
    `Done: the answer is in step 2, checked exactly like a pasted one. ${reader.usageLine(reader.DEFAULT_MODEL, endpoint, { prompt: USAGE.prompt_tokens, completion: USAGE.completion_tokens })}`,
  );
  assert.ok(await keyNowhereOnPage(), 'the key is not on the page');
  await shot('first-answer', '#add-h2');
  phase('read', { pictures: shown.length, characters: post.raw.length });

  // Send these problems back: the same conversation, with the panel's own problems message. A second reading is not
  // offered while the first cannot be read: there would be nothing to compare it with.
  assert.equal(await text('#add-reader-first [data-reader=send-back]'), 'Send these problems back (round 1 of 3)');
  assert.equal(await evaluate("document.querySelector('#add-reader-first [data-reader=again]')"), null);
  plan.push({ text: GOOD });
  await click('#add-reader-first [data-reader=send-back]');
  await until("document.querySelector('#add-report .add-ok')", 30000);
  post = posts()[1];
  assert.equal(post.auth, `Bearer ${KEY}`);
  assert.deepEqual(post.body.messages[0], posts()[0].body.messages[0]);
  assert.deepEqual(post.body.messages.slice(1), [
    { role: 'assistant', content: BROKEN },
    { role: 'user', content: problemsMessage(expected) },
  ]);
  assert.equal(await evaluate("document.getElementById('add-answer').value"), GOOD);
  assert.match(await text('#add-reader-first'), /after 1 round of problems sent back/);
  assert.equal(await evaluate("document.querySelector('#add-reader-first [data-reader=send-back]')"), null);
  phase('problems sent back');

  // Read it again to compare: a fresh conversation with the second-reading guide, into the existing comparison.
  plan.push({ text: SECOND });
  await click('#add-reader-first [data-reader=again]');
  await until("document.querySelector('#add-compare-report .add-diffs')", 30000);
  post = posts()[2];
  assert.equal(post.body.messages.length, 1);
  assert.equal(post.body.messages[0].content[0].text, guide.importGuide('second'));
  assert.deepEqual(
    post.body.messages[0].content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url),
    shown,
  );
  assert.equal(await evaluate("document.getElementById('add-second').value"), SECOND);
  assert.deepEqual(
    await evaluate("[...document.querySelectorAll('#add-compare-report .add-diffs li')].map((li) => li.textContent)"),
    comparisonLines(compareReadings(checkAnswer(GOOD).score, checkAnswer(SECOND).score)),
  );
  assert.match(await text('#add-reader-second .reader-run'), /^Done: the second reading is in step 3 and was compared/);
  await shot('compare', '#add-compare-report');
  // A second reading the app cannot read: the card says they were not compared, and offers to send back exactly the
  // problems step 3 shows.
  plan.push({ text: BROKEN });
  await click('#add-reader-first [data-reader=again]');
  await until("document.querySelector('#add-compare-report [data-act=copy-second-problems]')", 30000);
  await until("!document.querySelector('#add-reader-second [data-reader=cancel]')", 10000);
  assert.match(await text('#add-reader-second .reader-run'), /cannot read it yet, so the two were not compared/);
  assert.equal(await text('#add-reader-second [data-reader=send-back]'), 'Send these problems back (round 1 of 3)');
  assert.equal(posts()[3].body.messages[0].content[0].text, guide.importGuide('second'));
  phase('read again to compare');

  // Both follow-ups send this reading's pictures again, and each card says so, and where. Once he removes a picture they
  // are no longer offered (they would send it again): he reads the pictures shown afresh instead.
  for (const card of ['#add-reader-first', '#add-reader-second'])
    assert.equal(await text(`${card} [data-follow-up]`), reader.followUpLine(3, service, 1));
  const postsBefore = posts().length;
  await click('#reader-cuts li:nth-child(1) [data-reader=remove-cut]');
  await until("document.getElementById('reader-count').textContent === '2 pictures from 2 pages.'");
  for (const card of ['#add-reader-first', '#add-reader-second']) {
    assert.equal(
      await evaluate(
        `document.querySelectorAll(${q(`${card} [data-reader=again], ${card} [data-reader=send-back]`)}).length`,
      ),
      0,
    );
    assert.equal(await text(`${card} [data-follow-up]`), reader.changedLine(service));
  }
  assert.equal(posts().length, postsBefore, 'nothing more is sent');
  await shot('changed', '#add-reader-first');
  phase('pictures changed after reading');

  // The reader's answer is added exactly like a pasted one: as a draft.
  await click('#add-report [data-act=add]');
  await until("document.getElementById('piece-title').textContent === 'Reader Tune'");
  assert.equal(
    await evaluate("document.querySelector('#piece-select option:checked').textContent"),
    'Reader Tune · yours · draft',
  );
  await until("document.getElementById('add-reader-first').hidden");
  phase('added as a draft');

  // What goes wrong, in plain words: a refused key, a cut-off answer, a cancel. Nothing reaches the box.
  plan.push({ status: 401 });
  await click('#reader-read');
  await until("document.querySelector('#reader-run .add-bad')", 30000);
  assert.equal(await text('#reader-run'), reader.failureSentence({ kind: 'status', status: 401 }, service));
  plan.push({ text: GOOD.slice(0, 200), finish: 'length' });
  await click('#reader-read');
  await until(
    `document.getElementById('reader-run').textContent.startsWith(${q(reader.failureSentence({ kind: 'length' }, service))})`,
    30000,
  );
  assert.equal(await evaluate("document.getElementById('add-answer').value"), '');
  plan.push({ text: GOOD.repeat(20), slow: true });
  await click('#reader-read');
  await until("/characters of the answer/.test(document.getElementById('reader-run').textContent)", 30000);
  assert.equal(await evaluate('document.activeElement?.dataset.reader'), 'cancel');
  await shot('reading', '#reader-run');
  await click('#reader-run [data-reader=cancel]');
  await until(
    `document.getElementById('reader-run').textContent === ${q(reader.failureSentence({ kind: 'cancelled' }, service))}`,
    10000,
  );
  for (let i = 0; i < 50 && posts()[posts().length - 1].aborted === undefined; i++) await pause(100);
  assert.equal(posts()[posts().length - 1].aborted, true, 'Cancel really aborts the request');
  assert.equal(await evaluate("document.getElementById('add-answer').value"), '');
  assert.ok(await keyNowhereOnPage(), 'the key is not on the page');
  phase('errors', { posts: posts().length });

  // The problems of one reading go back at most three times, counted on the button; then the card says so.
  plan.push({ text: BROKEN });
  await click('#reader-read');
  await until("document.querySelector('#add-reader-first [data-reader=send-back]')", 30000);
  for (let round = 1; round <= reader.MAX_ROUNDS; round++) {
    assert.equal(await text('#add-reader-first [data-reader=send-back]'), reader.sendBackLabel(round - 1));
    const before = posts().length;
    plan.push({ text: BROKEN });
    await click('#add-reader-first [data-reader=send-back]');
    await until(`document.getElementById('add-reader-first').textContent.includes('after ${round} round')`, 30000);
    assert.equal(posts().length, before + 1);
    assert.equal(posts()[before].body.messages.length, 1 + 2 * round, 'the same conversation, one round further');
  }
  assert.equal(await evaluate("document.querySelector('#add-reader-first [data-reader=send-back]')"), null);
  assert.equal(await text('#add-reader-first [data-limit]'), reader.roundsSpentLine());
  assert.match(await text('#add-reader-first'), /after 3 rounds of problems sent back/);
  phase('three rounds at most', { posts: posts().length });

  // Text of his own in step 2's box is never replaced silently: the reader asks first, with two buttons.
  const mine = 'My own notes on this piece, typed here before reading.';
  await fill('add-answer', mine);
  plan.push({ text: GOOD });
  await click('#reader-read');
  await until("document.querySelector('#reader-run [data-reader=replace]')", 30000);
  assert.equal(await evaluate("document.getElementById('add-answer').value"), mine);
  assert.equal(
    await text('#reader-run p'),
    'The answer has arrived, but the box in step 2 holds text that did not come from this reader: replace that text with the answer?',
  );
  assert.equal(await evaluate('document.activeElement?.dataset.reader'), 'replace');
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('#reader-run button')].map((b) => [b.textContent, b.getBoundingClientRect().height >= 44])",
    ),
    [
      ['Replace it with the answer', true],
      ['Keep my text', true],
    ],
  );
  await shot('own-text', '#reader-run');
  // Keep my text: his text stays, and the answer he has paid for waits beside the question until the next request
  // starts, with a button to copy it and one to put it in the box after all.
  const usage = reader.usageLine(reader.DEFAULT_MODEL, endpoint, {
    prompt: USAGE.prompt_tokens,
    completion: USAGE.completion_tokens,
  });
  const keptLine = `Kept your text in step 2: the answer was not put in the box. The answer waits here, under the Read button, until the next request starts: copy it, or put it in the box after all. ${usage}`;
  const keep = async () => {
    await click('#reader-run [data-reader=keep]');
    await until("document.querySelector('#reader-run [data-reader=copy-kept]')");
    assert.equal(await evaluate("document.getElementById('add-answer').value"), mine);
    assert.equal(await text('#reader-run p'), keptLine);
  };
  await keep();
  assert.equal(await evaluate("document.querySelector('#reader-run [data-reader=keep]')"), null);
  assert.equal(await evaluate('document.activeElement?.dataset.reader'), 'copy-kept');
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('#reader-run button')].map((b) => [b.textContent, b.getBoundingClientRect().height >= 44])",
    ),
    [
      ['Copy the answer', true],
      ['Put the answer in the box', true],
    ],
  );
  await click('#reader-run [data-reader=copy-kept]');
  await until("document.querySelector('#reader-run .add-fallback-slot')?.textContent === 'Copied the answer.'");
  assert.equal(await evaluate('__smoke.copied'), GOOD);
  await shot('kept-answer', '#reader-run');
  await click('#reader-run [data-reader=use-kept]');
  await until("document.querySelector('#add-report .add-ok')", 30000);
  assert.equal(await evaluate("document.getElementById('add-answer').value"), GOOD);
  assert.match(await text('#reader-run'), /^Done: the answer is in step 2/);
  // Kept only until the next request starts: once Read sends again, it is gone.
  await fill('add-answer', mine);
  plan.push({ text: GOOD });
  await click('#reader-read');
  await until("document.querySelector('#reader-run [data-reader=replace]')", 30000);
  await keep();
  plan.push({ text: GOOD.repeat(20), slow: true });
  await click('#reader-read');
  await until("/characters of the answer/.test(document.getElementById('reader-run').textContent)", 30000);
  assert.equal(await evaluate("document.querySelector('[data-reader=copy-kept], [data-reader=use-kept]')"), null);
  await click('#reader-run [data-reader=cancel]');
  await until(
    `document.getElementById('reader-run').textContent === ${q(reader.failureSentence({ kind: 'cancelled' }, service))}`,
    10000,
  );
  assert.equal(await evaluate("document.getElementById('add-answer').value"), mine);
  plan.push({ text: GOOD });
  await click('#reader-read');
  await until("document.querySelector('#reader-run [data-reader=replace]')", 30000);
  await click('#reader-run [data-reader=replace]');
  await until("document.querySelector('#add-report .add-ok')", 30000);
  assert.equal(await evaluate("document.getElementById('add-answer').value"), GOOD);
  assert.match(await text('#reader-run'), /^Done: the answer is in step 2/);
  phase('own text asked first', { posts: posts().length });

  // Forget this key.
  await click('#add-reader [data-reader=forget]');
  await until("document.getElementById('reader-key').value === ''");
  assert.equal((await stored()).key, '');
  assert.ok(!(await evaluate(`Object.values(localStorage).some((v) => v.includes(${q(KEY)}))`)));
  phase('forget');

  // Another tab of the site forgets the key: this page takes that up at once (a same-origin frame stands in for the
  // other tab, since the storage event reaches every other document of the site).
  const forgotten = `JSON.stringify({ ...JSON.parse(localStorage.getItem(${q(reader.READER_KEY)})), key: '' })`;
  await fill('reader-key', KEY);
  assert.equal((await stored()).key, KEY);
  await evaluate(
    `(() => { const f = document.createElement('iframe'); f.id = 'smoke-other-tab'; f.hidden = true; document.body.append(f); f.contentWindow.localStorage.setItem(${q(reader.READER_KEY)}, ${forgotten}); })()`,
  );
  await until("document.getElementById('reader-key').value === ''", 10000);
  assert.match(await text('#reader-key-note'), /forgotten in another tab/);
  await evaluate("document.getElementById('smoke-other-tab').remove()");
  // A change this page did not hear of (it was in the back-forward cache, say): what is stored wins before any change
  // made here and before any request, so the key is neither written back nor sent.
  await fill('reader-key', KEY);
  await evaluate(`localStorage.setItem(${q(reader.READER_KEY)}, ${forgotten})`);
  await fill('reader-model', 'another-model');
  await evaluate("document.getElementById('reader-model').blur()");
  await until(`JSON.parse(localStorage.getItem(${q(reader.READER_KEY)})).model === 'another-model'`, 10000);
  assert.equal((await stored()).key, '');
  assert.equal(await evaluate("document.getElementById('reader-key').value"), '');
  await fill('reader-key', KEY);
  await evaluate(`localStorage.setItem(${q(reader.READER_KEY)}, ${forgotten})`);
  const sentBefore = posts().length;
  await click('#reader-read');
  await until(
    `document.getElementById('reader-key-note').textContent === ${q(reader.failureSentence({ kind: 'no-key' }, service))}`,
  );
  assert.equal(posts().length, sentBefore, 'a key forgotten elsewhere is not sent');
  assert.equal(await evaluate("document.getElementById('reader-key').value"), '');
  await fill('reader-model', reader.DEFAULT_MODEL);
  await evaluate("document.getElementById('reader-model').blur()");
  phase('other tab');

  // A file that is not a page is refused next to the button that chose it. When nothing from the files chosen can be
  // sent, Read says so (not "choose the pages first") and points to the note beside each file, which says why. This
  // fully dark screenshot is cut like the same page in light mode, and its picture is sent as it was given.
  for (let i = 0; i < 100 && (await evaluate("document.querySelectorAll('#reader-file-list button').length")); i++)
    await evaluate("document.querySelector('#reader-file-list button').click()");
  await fill('reader-key', KEY);
  const choose = async (paths) => {
    const { root: d } = await send('DOM.getDocument', { depth: 1 });
    const { nodeId: input } = await send('DOM.querySelector', { nodeId: d.nodeId, selector: '#reader-files' });
    await send('DOM.setFileInputFiles', { nodeId: input, files: paths });
  };
  const prepared = () =>
    until(
      "[...document.querySelectorAll('#reader-file-list li')].every((li) => !/Waiting|Preparing/.test(li.textContent)) && !/Preparing/.test(document.getElementById('reader-count').textContent)",
      60000,
    );
  const notes = path.join(browser.directory, 'notes.txt'),
    blank = path.join(browser.directory, 'blank.png'),
    darkPng = path.join(browser.directory, 'dark.png');
  await writeFile(notes, 'not a page');
  await writeFile(blank, makePng(1200, 1600, 'blank'));
  await writeFile(darkPng, makePng(1200, 1600, 'dark'));
  await choose([notes]);
  await until(`document.getElementById('reader-files-note').textContent !== ''`);
  assert.equal(
    await text('#reader-files-note'),
    '“notes.txt” is not a PDF, PNG, JPEG or WebP file, so it was left out.',
  );
  assert.ok((await gap('#reader-files-note', 'label[for=reader-files]')) < 60, 'said next to Choose pages');
  await choose([blank]);
  await prepared();
  assert.equal(await text('#reader-files-note'), '');
  assert.equal(
    await text('#reader-count'),
    'No pictures to send. Page 1 looks empty, so nothing from it will be sent.',
  );
  // The note beside the file says why nothing from it is sent; Read points to that note.
  assert.equal(await text('#reader-file-list li .add-hint'), 'Picture of one page. Nothing to send: it looks empty.');
  const quiet = posts().length;
  const nothingToSend = async () => {
    await evaluate("document.getElementById('reader-status').textContent = ''");
    await click('#reader-read');
    await until(
      `document.getElementById('reader-status').textContent === ${q(reader.failureSentence({ kind: 'nothing-to-send' }, service))}`,
    );
    assert.equal(posts().length, quiet, 'nothing is sent');
  };
  await nothingToSend();
  await choose([darkPng]);
  await prepared();
  assert.equal(
    await text('#reader-count'),
    '1 picture from 1 page. Page 1 looks empty, so nothing from it will be sent.',
  );
  assert.deepEqual(await labels(), ['Page 2, picture 1']);
  const dark = await evaluate(`(async () => {
    const img = document.querySelector('#reader-cuts img');
    await img.decode();
    const c = document.createElement('canvas');
    [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i];
    return { width: c.width, height: c.height, mean: sum / (d.length / 4) };
  })()`);
  assert.ok(dark.width > 2 * dark.height, `one line of music, as in light mode: ${JSON.stringify(dark)}`);
  assert.ok(dark.mean < 100, `sent dark, as given: ${JSON.stringify(dark)}`);
  const removeFiles = async () => {
    for (let i = 0; i < 100 && (await evaluate("document.querySelectorAll('#reader-file-list button').length")); i++)
      await evaluate("document.querySelector('#reader-file-list button').click()");
  };
  await removeFiles();
  // Only a file left out over the page limit: nothing to send, and the note beside it says why (Read does not claim
  // that the pages look empty).
  const tooLong = path.join(browser.directory, 'too-long.pdf');
  await writeFile(tooLong, makePdf(Array.from({ length: reader.MAX_PAGES + 1 }, () => system(700))));
  await choose([tooLong]);
  await prepared();
  assert.equal(
    await text('#reader-file-list li .add-bad'),
    reader.tooManyPages('too-long.pdf', reader.MAX_PAGES + 1, 0),
  );
  await nothingToSend();
  await removeFiles();
  // A page whose pictures were all removed: the note beside its file says so.
  await choose([png]);
  await prepared();
  await click('#reader-cuts li [data-reader=remove-cut]');
  await until("document.getElementById('reader-count').textContent === 'No pictures to send.'");
  assert.equal(
    await text('#reader-file-list li .add-hint'),
    'Picture of one page. Nothing to send: its pictures were removed.',
  );
  await nothingToSend();
  await removeFiles();
  phase('refused, empty, over the limit, removed and dark pages', { dark });

  // Over 40 pages, the files chosen last are left out, never the first.
  for (let i = 0; i < 100 && (await evaluate("document.querySelectorAll('#reader-file-list button').length")); i++)
    await evaluate("document.querySelector('#reader-file-list button').click()");
  const many = [],
    onePage = makePng(1200, 900);
  for (let n = 1; n <= reader.MAX_PAGES + 1; n++) {
    const file = path.join(browser.directory, `page${String(n).padStart(2, '0')}.png`);
    await writeFile(file, onePage);
    many.push(file);
  }
  // Read stays where it is while 41 files are prepared, and above their pictures, not pages of them down.
  stopWatch = await watchRead();
  await choose(many);
  await until(
    "[...document.querySelectorAll('#reader-file-list li')].every((li) => !/Waiting|Preparing/.test(li.textContent)) && !/Preparing/.test(document.getElementById('reader-count').textContent)",
    120000,
  );
  assert.deepEqual((await stopWatch()).length, 1, 'Read stayed where it was');
  assert.ok((await gap('#reader-read', '#reader-cuts li')) > 0, 'Read comes before the pictures');
  const refused = await evaluate(
    "[...document.querySelectorAll('#reader-file-list li')].filter((li) => li.querySelector('.add-bad')).map((li) => li.querySelector('.reader-name').textContent)",
  );
  assert.deepEqual(refused, [`page${reader.MAX_PAGES + 1}.png`]);
  assert.equal(
    await text('#reader-file-list li:last-child .add-bad'),
    reader.tooManyPages(`page${reader.MAX_PAGES + 1}.png`, 1, reader.MAX_PAGES),
  );
  assert.match(await text('#reader-file-list li:last-child .add-bad'), /with the 40 pages chosen before it/);
  assert.equal(await text('#reader-count'), `${reader.MAX_PAGES} pictures from ${reader.MAX_PAGES} pages.`);
  for (let i = 0; i < 100 && (await evaluate("document.querySelectorAll('#reader-file-list button').length")); i++)
    await evaluate("document.querySelector('#reader-file-list button').click()");
  phase('page limit');

  // Layout: nothing wider than the screen or the menu; no control under 44 px.
  await shot('layout', '#add-reader-toggle');
  const layout = await evaluate(`(() => {
    const body = document.querySelector('#piece-drawer .drawer-body');
    const small = [...document.querySelectorAll('#piece-add button, #piece-add input:not(.add-file-input), #piece-add summary, #piece-add label.add-file')]
      .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44)
      .map((e) => e.id || e.dataset.reader || e.dataset.act || e.tagName);
    return { page: [document.documentElement.scrollWidth, innerWidth], drawer: [body.scrollWidth, body.clientWidth], small };
  })()`);
  assert.ok(layout.page[0] <= layout.page[1] && layout.drawer[0] <= layout.drawer[1], JSON.stringify(layout));
  assert.deepEqual(layout.small, []);
  phase('layout', layout);

  // No errors, and no request to any address but this site's own files and the service he named.
  assert.deepEqual(await evaluate('__smoke.errors'), []);
  assert.deepEqual(browser.errors, []);
  const own = (u) => {
    const url = new URL(u);
    return (
      url.origin === origin &&
      !url.search &&
      (/^\/assets\/[\w.-]+$/.test(url.pathname) ||
        /^\/piano\/(manifest\.json|[A-G]b?\d\.mp3)$/.test(url.pathname) ||
        url.pathname === '/favicon.svg')
    );
  };
  const requests = browser.requests.slice(quietRequests).filter((u) => !/^(blob|data):/.test(u));
  const elsewhere = requests.filter((u) => !own(u) && u !== endpoint);
  assert.deepEqual(elsewhere, [], 'requests to other addresses');
  assert.ok(requests.every((u) => !u.includes(KEY)));
  assert.equal(requests.filter((u) => u === endpoint).length >= posts().length, true);
  console.log(
    JSON.stringify({
      phase: 'complete',
      width,
      height,
      phases: phases.length,
      posts: posts().length,
      ownFiles: requests.filter(own).length,
      errors: 0,
    }),
  );
} catch (error) {
  process.exitCode = 1;
  await browser.screenshot(fileURLToPath(new URL(`reader-${width}-failed.png`, artifacts))).catch(() => {});
  await writeFile(
    new URL(`reader-${width}-failed.json`, artifacts),
    JSON.stringify({ error: String(error), phases }, null, 2),
  );
  console.log(
    JSON.stringify({ phase: 'failed', width, after: phases[phases.length - 1] ?? 'start', error: String(error) }),
  );
} finally {
  await browser.close();
  service.closeAllConnections();
  service.close();
}
