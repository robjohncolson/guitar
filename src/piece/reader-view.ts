import './reader.css';
import type { Checked } from './import';
import type { Reading } from './import-guide';
import { copiedHtml, esc, FALLBACK_LINE, fallbackHtml } from './add-view';
import { PRODUCT } from '../brand';
import {
  beforeSending,
  canSendBack,
  changedLine,
  closingLine,
  roundsSpentLine,
  sendBackLabel,
  tooManyPages,
  parseSettings,
  READER_KEY,
  DEEPSEEK_ENDPOINT,
  DEFAULT_MODEL,
  endpointProblem,
  failureSentence,
  firstMessage,
  followUp,
  followUpLine,
  loadSettings,
  MAX_PAGES,
  problemsFor,
  progressLine,
  saveSettings,
  serviceName,
  streamChat,
  usageLine,
  withEndpoint,
  type ChatResult,
  type Failure,
  type Message,
  type Progress,
  type ReaderSettings,
} from './reader';
import { cutCanvas, imagePage, picturesLine, type PageCuts } from './pages';

/**
 * "Or let an AI read it for you (your own key)": the reader's part of the Add your own piece panel. It is loaded only
 * when the owner opens that part (add-panel.ts), and pdf.js only when he chooses a PDF. Nothing is sent until he presses
 * Read. The answer goes into step 2's box (or step 3's, for a second reading) and through the panel's own Check or
 * Compare (hooks.deliver): there is no second path for what an AI sends.
 */
export interface ReaderHooks {
  /** The reader's own part of step 1. */
  root: HTMLElement;
  /** Where a reading's follow-up controls show: under step 2's report and under step 3's. */
  cards: Record<Reading, HTMLElement>;
  /** The boxes a pasted answer goes into. */
  boxes: Record<Reading, HTMLTextAreaElement>;
  /** The panel's report of each box. */
  reports: Record<Reading, HTMLElement>;
  /** Put an answer in its box and run the panel's own Check (first) or Compare (second); the checked text, if any. */
  deliver: (reading: Reading, text: string) => Checked | undefined;
  /** Open the part of the panel a reading lands in. */
  reveal: (reading: Reading) => void;
  /** Say something to screen readers. */
  announce: (text: string) => void;
}

const ACCEPT = '.pdf,application/pdf,.png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp';
const fileKind = (file: File): 'pdf' | 'image' | undefined =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    ? 'pdf'
    : /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
      ? 'image'
      : undefined;

/**
 * The key's field is a password field, so that the browser hides the key as it hides any password: as dots on the
 * screen, and from screen readers and other software that reads the page (a text field drawn as dots would hand them
 * the key). It is marked as a new secret with a name of its own (`autocomplete="new-password"`): this site also has a
 * sign-in (Clean Take accounts), and the browser's password manager does not fill a saved password into a field marked
 * so. Password managers that take a hint are told to leave it alone.
 */
const KEY_FIELD = 'type="password" autocomplete="new-password" name="reader-ai-service-key"';

/**
 * The reader's fixed markup. Read comes before the files and their pictures, which grow while pages are prepared: it
 * stays where it is, and is never pages of pictures down. A message about the key, the address or a refused file
 * appears next to it (the `-note` lines); the others under Read.
 */
export function readerMarkup(): string {
  const plain = 'spellcheck="false" autocapitalize="off" autocorrect="off" data-gramm="false"',
    note = (id: string) => `<p id="${id}" class="add-status reader-note"></p>`,
    field = (id: string, type: string, label: string, after = '') =>
      `<label for="${id}" class="add-label">${label}</label><input type="${type}" id="${id}" class="reader-input" autocomplete="off" ${plain}${after ? ` aria-describedby="${id}-note"` : ''}>${after}`;
  return `<p>Instead of carrying the pages to a chat yourself, the app can send pictures of them to an AI service with your own key (you pay that service) and put its answer in step 2, where it is checked exactly like a pasted one. Nobody has yet measured how well a model reads real sheet music: the answer is a draft like any other, so compare and listen before you trust it.</p>
    <div class="reader-group">
      <label for="reader-key" class="add-label">Your key for <span data-service>DeepSeek</span></label>
      <div class="reader-key-row"><input ${KEY_FIELD} id="reader-key" class="reader-input" ${plain} aria-describedby="reader-key-note" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"><button type="button" data-reader="show" aria-pressed="false" aria-controls="reader-key">Show</button></div>
      ${note('reader-key-note')}
      <div class="add-row"><button type="button" data-reader="forget">Forget this key</button></div>
      <p class="add-hint">The key stays in this browser only (never in your account) and is sent only to <span data-service>DeepSeek</span>, when you press Read.</p>
    </div>
    <details class="reader-advanced"><summary>Advanced: another service or model</summary><div class="reader-group">
      ${field('reader-endpoint', 'url', 'Address (a chat completions endpoint)', note('reader-endpoint-note'))}
      ${field('reader-model', 'text', 'Model (one that reads pictures)')}
      <div class="add-row"><button type="button" data-reader="defaults">Use DeepSeek’s address and model</button></div>
      <p class="add-hint">Any service that speaks the same format works, a server on this computer included (http://localhost or http://127.0.0.1). An address at another service forgets the key. The cost is estimated only for ${DEFAULT_MODEL} at DeepSeek.</p>
    </div></details>
    <div class="reader-group">
      <div class="add-row"><input type="file" id="reader-files" class="add-file-input" multiple accept="${ACCEPT}" aria-describedby="reader-files-note"><label class="add-file" for="reader-files">Choose pages</label></div>
      ${note('reader-files-note')}
      <p class="add-hint">A PDF, or a photo or scan of each page (PNG, JPEG or WebP), in order: at most ${MAX_PAGES} pages for one reading. Each page is cut into pictures as well as the app can: a PDF or a straight, clean scan usually into one line of music per picture, a photo often into a few overlapping strips. Look at the pictures below before you press Read.</p>
    </div>
    <div class="add-row"><button type="button" class="primary" data-reader="read" id="reader-read">Read with DeepSeek</button></div>
    <p id="reader-privacy" class="reader-privacy"></p>
    <div id="reader-run" class="reader-run"></div>
    <p id="reader-status" class="add-status"></p>
    <ol id="reader-file-list" class="reader-files" aria-label="Files chosen"></ol>
    <p id="reader-count" class="reader-count" hidden></p>
    <ol id="reader-cuts" class="reader-cuts" aria-label="Pictures to send"></ol>`;
}

interface Picture {
  id: number;
  url: string;
  kept: boolean;
  item?: HTMLLIElement;
}
interface Page {
  kind: PageCuts['kind'];
  pictures: Picture[];
}
interface Chosen {
  id: number;
  name: string;
  pdf: boolean;
  state: 'waiting' | 'preparing' | 'ready' | 'failed';
  note?: string;
  /** Its page count, once known. */
  total?: number;
  pages: Page[];
}
/** One reading's conversation with the service. */
interface Talk {
  messages: Message[];
  answer: string;
  rounds: number;
  /** The box's text right after the answer went in: follow-ups are offered only while it is unchanged. */
  delivered?: string;
  checked?: Checked;
  /** The model and service the last answer came from. */
  from?: string;
}
interface Note {
  text: string;
  bad: boolean;
  /** The question asked before an answer replaces the owner's own text: its two buttons go with it. */
  ask?: boolean;
  /** An answer kept after he chose to keep his text: its Copy and Put buttons go with it. */
  kept?: boolean;
  /** Keeps a card shown while the note is there, whatever its box holds. */
  stay?: boolean;
}
/** Where a reason not to send belongs: next to the key, next to the address, or under Read. */
const KEY_FAILURES = new Set<Failure['kind']>(['no-key', 'key-character', 'not-deepseek-key']);

export function mountReader(hooks: ReaderHooks): void {
  const root = hooks.root;
  root.innerHTML = readerMarkup();
  const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const keyInput = q<HTMLInputElement>('reader-key'),
    endpointInput = q<HTMLInputElement>('reader-endpoint'),
    modelInput = q<HTMLInputElement>('reader-model'),
    fileInput = q<HTMLInputElement>('reader-files'),
    fileList = q('reader-file-list'),
    count = q('reader-count'),
    cutList = q('reader-cuts'),
    privacy = q('reader-privacy'),
    readButton = q<HTMLButtonElement>('reader-read'),
    runArea = q('reader-run'),
    statusLine = q('reader-status'),
    keyNote = q('reader-key-note'),
    endpointNote = q('reader-endpoint-note'),
    filesNote = q('reader-files-note'),
    advanced = root.querySelector<HTMLDetailsElement>('.reader-advanced')!;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    storage = undefined;
  }
  let settings: ReaderSettings = loadSettings(storage);
  /** Browser storage refused the last save: until one succeeds, this page's settings are the only copy. */
  let unsaved = false;
  const service = () => serviceName(settings.endpoint);
  /** Say something in one of the reader's lines (under Read, or next to the key, the address or the file picker). */
  const say = (line: HTMLElement, text: string, bad = false) => {
    line.textContent = text;
    line.classList.toggle('add-bad', bad);
    if (text) hooks.announce(text);
  };
  const status = (text: string) => say(statusLine, text);
  /** A message about the address, next to it: Advanced opens so that it can be seen. */
  const sayAddress = (text: string, bad = false) => {
    if (text) advanced.open = true;
    say(endpointNote, text, bad);
  };
  const save = () => {
    unsaved = !saveSettings(settings, storage);
    if (unsaved)
      say(
        keyNote,
        'Browser storage is unavailable, so these settings and the key last only until the page closes.',
        true,
      );
  };
  /**
   * Take the settings as stored. Another tab or window of this site may have changed them (Forget this key, another
   * address): this runs before every change made here and every request, so that a key forgotten there is never
   * written back or sent from here.
   */
  function reload(): void {
    if (!storage || unsaved) return;
    try {
      settings = parseSettings(storage.getItem(READER_KEY));
    } catch {
      // Unreadable now: keep what this page has.
    }
  }
  /** Reload, and redraw the fields when another tab changed something; true when it did. */
  function refresh(): boolean {
    const before = JSON.stringify(settings);
    reload();
    if (JSON.stringify(settings) === before) return false;
    paintSettings();
    return true;
  }
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== storage || (event.key !== null && event.key !== READER_KEY)) return;
    const had = Boolean(settings.key);
    if (refresh() && had && !settings.key)
      say(
        keyNote,
        'The key was forgotten in another tab or window of this site, so it is no longer stored here either.',
      );
  });
  // A page brought back from the browser's back-forward cache missed the changes made meanwhile.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });

  // Settings and the key.
  function paintSettings(): void {
    keyInput.value = settings.key;
    endpointInput.value = settings.endpoint;
    modelInput.value = settings.model;
    endpointInput.removeAttribute('aria-invalid');
    for (const span of root.querySelectorAll('[data-service]')) span.textContent = service();
    readButton.textContent = `Read with ${service()}`;
    paintPrivacy();
    paintFollowUps();
  }
  keyInput.addEventListener('input', () => {
    reload();
    settings = { ...settings, key: keyInput.value.trim() };
    // What was said about the key before is about the key he is replacing.
    say(keyNote, '');
    save();
  });
  function setEndpoint(endpoint: string, model?: string): void {
    const problem = endpointProblem(endpoint);
    if (problem) {
      endpointInput.setAttribute('aria-invalid', 'true');
      sayAddress(problem, true);
      return;
    }
    reload();
    const next = withEndpoint(settings, endpoint);
    settings = { ...next.settings, model: model ?? settings.model };
    save();
    paintSettings();
    sayAddress(
      next.forgot
        ? `${service()} is another service, so the key was forgotten. Paste the key for ${service()}.`
        : `Reading with ${settings.model} at ${service()}.`,
    );
  }
  endpointInput.addEventListener('change', () => setEndpoint(endpointInput.value));
  modelInput.addEventListener('change', () => {
    reload();
    settings = { ...settings, model: modelInput.value.trim() || DEFAULT_MODEL };
    save();
    paintSettings();
  });

  // The pages and their pictures.
  let chosen: Chosen[] = [],
    ids = 0,
    queue = Promise.resolve(),
    preparing = '';
  /**
   * The pages of the files chosen before this one. Files are prepared in the order chosen, so those are all counted by
   * now, and over the limit it is the last pages that are left out, never the first.
   */
  const pagesBefore = (c: Chosen) =>
    chosen
      .slice(0, Math.max(0, chosen.indexOf(c)))
      .filter((x) => x.state !== 'failed')
      .reduce((n, x) => n + (x.total ?? 0), 0);
  /** Every page in order, numbered from 1 across the files. */
  const allPages = () => {
    let number = 0;
    return chosen.flatMap((c) => c.pages.map((page) => ({ page, number: ++number })));
  };
  const kept = () => allPages().flatMap(({ page }) => page.pictures.filter((p) => p.kept));

  /**
   * Why nothing from a prepared file will be sent, said beside it (a file that could not be read or was left out over
   * the page limit has its own note); undefined while it has a picture to send.
   */
  const sendsNothing = (c: Chosen): string | undefined => {
    if (c.pages.some((page) => page.pictures.some((p) => p.kept))) return undefined;
    const one = c.pages.length === 1,
      empty = c.pages.filter((page) => page.kind === 'blank').length;
    const why =
      empty === c.pages.length
        ? one
          ? c.pdf
            ? 'its page looks empty'
            : 'it looks empty'
          : 'its pages look empty'
        : empty
          ? 'its pages look empty or their pictures were removed'
          : one && !c.pdf
            ? 'its pictures were removed'
            : 'all its pictures were removed';
    return `Nothing to send: ${why}.`;
  };
  /** Drawn again only when it changed, so that a Remove button keeps the focus while pages are prepared. */
  let filesHtml = '';
  function paintFiles(): void {
    const html = chosen
      .map((c) => {
        const nothing = c.state === 'ready' ? sendsNothing(c) : undefined;
        const what =
          c.state === 'failed'
            ? `<span class="add-bad">${esc(c.note ?? 'Could not be read.')}</span>`
            : c.state === 'ready'
              ? `<span class="add-hint">${c.pdf ? `PDF, ${c.total} page${c.total === 1 ? '' : 's'}` : 'Picture of one page'}${nothing ? `. ${esc(nothing)}` : ''}</span>`
              : `<span class="add-hint">${c.state === 'preparing' ? 'Preparing…' : 'Waiting…'}</span>`;
        return `<li><span class="reader-name">${esc(c.name)}</span>${what}<button type="button" data-reader="remove-file" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">Remove</button></li>`;
      })
      .join('');
    if (html === filesHtml) return;
    fileList.innerHTML = filesHtml = html;
  }
  function paintPictures(): void {
    const items: HTMLLIElement[] = [];
    for (const { page, number } of allPages())
      page.pictures.forEach((p, i) => {
        if (!p.kept) return;
        // Pictures, never systems: a picture may hold one line of music or several, or part of one.
        const label = `Page ${number}, picture ${i + 1}`;
        if (!p.item) {
          p.item = document.createElement('li');
          p.item.className = 'reader-cut';
          p.item.innerHTML = `<img src="${esc(p.url)}" alt=""><span class="reader-cut-label"></span><button type="button" data-reader="remove-cut" data-id="${p.id}">Remove</button>`;
        }
        p.item.querySelector('img')!.alt = label;
        p.item.querySelector('.reader-cut-label')!.textContent = label;
        p.item.querySelector('button')!.setAttribute('aria-label', `Remove ${label}`);
        items.push(p.item);
      });
    cutList.replaceChildren(...items);
    const pages = allPages().map(({ page, number }) => ({
      page: number,
      kind: page.kind,
      kept: page.pictures.filter((p) => p.kept).length,
    }));
    count.hidden = !pages.length && !preparing;
    count.textContent = [pages.length ? picturesLine(pages) : '', preparing].filter(Boolean).join(' ');
    // A file whose pictures were all removed says so beside it.
    paintFiles();
    paintPrivacy();
    paintFollowUps();
  }
  function paintPrivacy(): void {
    const n = kept().length;
    const what = !n
      ? 'When you press Read, the pictures shown below go'
      : n === 1
        ? 'The picture shown below goes'
        : `The ${n} pictures shown below go`;
    privacy.textContent = `${what} from this browser straight to ${service()}, with your key. ${n === 1 ? 'It does' : 'They do'} not pass through ${PRODUCT}’s server, and no audio is ever sent.`;
  }

  async function prepare(c: Chosen, file: File): Promise<void> {
    if (!chosen.includes(c)) return;
    c.state = 'preparing';
    paintFiles();
    const tooMany = (pages: number) => tooManyPages(c.name, pages, pagesBefore(c));
    try {
      if (c.pdf) {
        preparing = `Opening “${c.name}”…`;
        paintPictures();
        const { openPdf } = await import('./pdf');
        const pdf = await openPdf(await file.arrayBuffer(), c.name);
        if (typeof pdf === 'string') {
          c.state = 'failed';
          c.note = pdf;
          return;
        }
        try {
          if (pagesBefore(c) + pdf.pages > MAX_PAGES) {
            c.state = 'failed';
            c.note = tooMany(pdf.pages);
            return;
          }
          c.total = pdf.pages;
          for (let n = 1; n <= pdf.pages && chosen.includes(c); n++) {
            preparing = `Preparing “${c.name}”, page ${n} of ${pdf.pages}…`;
            paintPictures();
            const canvas = await pdf.page(n);
            addPage(c, cutCanvas(canvas));
            canvas.width = canvas.height = 0;
          }
        } finally {
          await pdf.close();
        }
      } else {
        if (pagesBefore(c) + 1 > MAX_PAGES) {
          c.state = 'failed';
          c.note = tooMany(1);
          return;
        }
        preparing = `Preparing “${c.name}”…`;
        paintPictures();
        c.total = 1;
        const canvas = await imagePage(file);
        addPage(c, cutCanvas(canvas));
        canvas.width = canvas.height = 0;
      }
      c.state = 'ready';
    } catch {
      c.state = 'failed';
      c.note = `“${c.name}” could not be read${c.pdf ? ' as a PDF' : ' as a picture'}.`;
      c.pages = [];
    } finally {
      preparing = '';
      paintFiles();
      paintPictures();
      paintButtons();
    }
  }
  function addPage(c: Chosen, cut: { kind: PageCuts['kind']; pictures: string[] }): void {
    c.pages.push({ kind: cut.kind, pictures: cut.pictures.map((url) => ({ id: ++ids, url, kept: true })) });
    paintPictures();
  }
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    const refused: string[] = [];
    for (const file of files) {
      const kind = fileKind(file);
      if (!kind) {
        refused.push(file.name);
        continue;
      }
      const c: Chosen = { id: ++ids, name: file.name, pdf: kind === 'pdf', state: 'waiting', pages: [] };
      chosen.push(c);
      queue = queue.then(() => prepare(c, file));
    }
    paintFiles();
    paintFollowUps();
    // A refused file is named next to the button that chose it; what is being prepared, under Read.
    say(
      filesNote,
      refused.length
        ? `${refused.map((n) => `“${n}”`).join(', ')} ${refused.length === 1 ? 'is not' : 'are not'} a PDF, PNG, JPEG or WebP file, so ${refused.length === 1 ? 'it was' : 'they were'} left out.`
        : '',
      true,
    );
    const taken = files.length - refused.length;
    if (taken)
      status(
        `Preparing the pictures for ${taken === 1 ? '1 file' : `${taken} files`}. Nothing is sent until you press Read.`,
      );
  });

  // Requests.
  let busy: { host: HTMLElement; controller: AbortController; progress: () => void } | undefined;
  /**
   * The pictures (and which ones they were) and closing line of the last first reading: a second reading and every
   * round send them again, so they are offered only while those are still exactly the pictures shown.
   */
  let sent: { images: string[]; ids: number[]; closing: string } | undefined;
  let talks: Partial<Record<Reading, Talk>> = {};
  /** The settings of the last request sent (the owner may change them while it runs). */
  let used: ReaderSettings = settings;
  const notes = new Map<HTMLElement, Note>();
  let delivering = false;
  /** What this reader last put in each box. A box holds the owner's own text when it holds anything else. */
  const placed: Partial<Record<Reading, string>> = {};
  const ownText = (reading: Reading) => {
    const value = hooks.boxes[reading].value;
    return value.trim() !== '' && value !== placed[reading];
  };
  /**
   * An answer that arrived while its box held the owner's own text: it waits until he says which to keep, and when he
   * keeps his text (`kept`), until the next request starts, so that he can still copy it or put it in the box.
   */
  let pending:
    | { reading: Reading; host: HTMLElement; result: ChatResult; text: string; land: () => void; kept?: boolean }
    | undefined;
  const stepOf = (reading: Reading) => (reading === 'first' ? 'step 2' : 'step 3');

  function progressHtml(): string {
    return `<p class="reader-progress"><span class="reader-dot" aria-hidden="true"></span><span data-progress></span></p><div class="add-row"><button type="button" data-reader="cancel">Cancel</button></div>`;
  }
  /** What each request area shows now: drawn again only when it changes, so that a button keeps the focus. */
  const drawn = new WeakMap<HTMLElement, string>();
  const draw = (area: HTMLElement, html: string) => {
    if (drawn.get(area) === html) return;
    area.innerHTML = html;
    drawn.set(area, html);
  };
  /** Draw a request area: progress while its request runs, else its last note (and a question's two buttons). */
  function paintRun(host: HTMLElement): void {
    const area = host === runArea ? runArea : host.querySelector<HTMLElement>('.reader-run')!;
    if (busy?.host === host) {
      if (!area.querySelector('[data-progress]')) draw(area, progressHtml());
      busy.progress();
      return;
    }
    const note = notes.get(host);
    draw(
      area,
      note
        ? `<p class="${note.bad ? 'add-bad' : 'add-ok'}">${esc(note.text)}</p>${note.ask ? '<div class="add-row"><button type="button" data-reader="replace">Replace it with the answer</button><button type="button" data-reader="keep">Keep my text</button></div>' : ''}${note.kept ? '<div class="add-row"><button type="button" data-reader="copy-kept">Copy the answer</button><button type="button" data-reader="use-kept">Put the answer in the box</button></div><div class="add-fallback-slot"></div>' : ''}`
        : '',
    );
  }
  /**
   * The pictures shown are exactly the ones the last reading was made from, in the same order, and no file is still
   * being prepared: only then may a follow-up send that reading's pictures again.
   */
  function samePictures(): boolean {
    if (!sent || preparing || chosen.some((c) => c.state === 'waiting' || c.state === 'preparing')) return false;
    const now = kept(),
      ids = sent.ids;
    return now.length === ids.length && now.every((p, i) => p.id === ids[i]);
  }
  function paintCard(reading: Reading): void {
    const card = hooks.cards[reading],
      talk = talks[reading],
      running = busy?.host === card,
      current = talk?.delivered !== undefined && hooks.boxes[reading].value === talk.delivered,
      note = notes.get(card);
    card.hidden = !running && !current && !(note && (note.stay || (talk && talk.delivered === undefined)));
    if (card.hidden) return;
    const problems = current && talk?.checked ? problemsFor(talk.checked, reading) : undefined;
    const rounds = talk?.rounds ?? 0;
    const from = current
      ? `<p class="add-hint">This answer came from ${esc(talk?.from ?? '')}${rounds ? `, after ${rounds === 1 ? '1 round' : `${rounds} rounds`} of problems sent back` : ''}.</p>`
      : '';
    // Both follow-ups send this reading's pictures again: they are offered only while those are the pictures shown,
    // and say so, and where they go. A second reading is compared with the first, which the app has to be able to read.
    const canSend = Boolean(problems) && canSendBack(rounds),
      canAgain = reading === 'first' && current && talk?.checked?.ok === true,
      same = samePictures();
    const send =
      canSend && same
        ? `<button type="button" data-reader="send-back" data-reading="${reading}">${esc(sendBackLabel(rounds))}</button>`
        : '';
    const again = canAgain && same ? `<button type="button" data-reader="again">Read it again to compare</button>` : '';
    const where =
      send || again
        ? `<p class="add-hint" data-follow-up>${esc(followUpLine(sent?.images.length ?? 0, service(), send && again ? 2 : 1))}</p>`
        : canSend || canAgain
          ? `<p class="add-hint" data-follow-up>${esc(changedLine(service()))}</p>`
          : '';
    const limit =
      problems && !canSendBack(rounds) ? `<p class="add-hint" data-limit>${esc(roundsSpentLine())}</p>` : '';
    // Drawn again only when it changed, so that a running request keeps its Cancel button (and the focus on it).
    const html = `${from}<div class="reader-run"></div>${send || again ? `<div class="add-row">${send}${again}</div>` : ''}${where}${limit}`;
    if (card.dataset.drawn !== html) {
      card.innerHTML = html;
      card.dataset.drawn = html;
    }
    paintRun(card);
    paintButtons();
  }
  function paintButtons(): void {
    const off = Boolean(busy);
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-reader=read]')) b.disabled = off;
    for (const reading of ['first', 'second'] as const)
      for (const b of hooks.cards[reading].querySelectorAll<HTMLButtonElement>(
        '[data-reader=send-back], [data-reader=again]',
      ))
        b.disabled = off;
  }
  /** Both cards: what they offer depends on the pictures shown and the service named, too. */
  function paintFollowUps(): void {
    paintCard('first');
    paintCard('second');
    paintButtons();
  }
  function paintRequests(): void {
    paintRun(runArea);
    paintFollowUps();
  }
  // Editing a box (or Clear, or Add emptying it) means its problems no longer belong to what the AI wrote.
  for (const reading of ['first', 'second'] as const)
    hooks.boxes[reading].addEventListener('input', () => {
      if (!delivering) paintCard(reading);
    });
  document.getElementById('piece-add')?.addEventListener('click', () => queueMicrotask(() => paintRequests()));

  async function run(host: HTMLElement, messages: Message[], images: number): Promise<ChatResult> {
    const controller = new AbortController(),
      started = Date.now(),
      name = service(),
      snapshot = settings;
    let latest: Progress = { answer: 0, thinking: 0 },
      queued = false;
    const progress = () => {
      const line = busy?.host.querySelector<HTMLElement>('[data-progress]');
      const seconds = Math.round((Date.now() - started) / 1000);
      if (line)
        line.textContent = `${progressLine(latest, name)} (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`;
    };
    busy = { host, controller, progress };
    used = snapshot;
    notes.delete(host);
    // A question left unanswered goes with the answer it was about: a new request was asked for instead.
    if (pending) {
      notes.delete(pending.host);
      pending = undefined;
    }
    paintRequests();
    host.querySelector<HTMLButtonElement>('[data-reader=cancel]')?.focus();
    const timer = window.setInterval(progress, 1000);
    try {
      return await streamChat(snapshot, messages, {
        signal: controller.signal,
        fetch: window.fetch.bind(window),
        images,
        onProgress: (p) => {
          latest = p;
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            progress();
          });
        },
      });
    } finally {
      window.clearInterval(timer);
      busy = undefined;
    }
  }
  /** After a request: its note, from the result and the tokens the service reported, priced for the model it used. */
  function noteFor(host: HTMLElement, result: ChatResult, done: string): void {
    const tokens = usageLine(used.model, used.endpoint, result.usage);
    notes.set(
      host,
      result.ok
        ? { text: `${done} ${tokens}`, bad: false }
        : {
            text: `${failureSentence(result.failure, serviceName(used.endpoint))}${result.usage ? ` ${tokens}` : ''}`,
            bad: true,
          },
    );
  }
  function deliver(reading: Reading, talk: Talk, text: string): void {
    talk.from = `${used.model} at ${serviceName(used.endpoint)}`;
    delivering = true;
    try {
      talk.checked = hooks.deliver(reading, text);
    } finally {
      delivering = false;
    }
    talk.delivered = placed[reading] = hooks.boxes[reading].value;
  }
  /**
   * A finished answer goes into its box, unless the box holds text that did not come from this reader (his own, or his
   * edits of an answer): then he is asked first, in one sentence with two buttons, and nothing is replaced until he
   * answers. `land` puts the answer in and says so.
   */
  function arrive(reading: Reading, host: HTMLElement, result: ChatResult, answer: string, land: () => void): void {
    if (!ownText(reading)) return land();
    pending = { reading, host, result, text: answer, land };
    const text = `The answer has arrived, but the box in ${stepOf(reading)} holds text that did not come from this reader: replace that text with the answer?`;
    notes.set(host, { text, bad: false, ask: true, stay: true });
    paintRequests();
    hooks.announce(text);
    host.querySelector<HTMLButtonElement>('[data-reader=replace]')?.focus();
  }
  /**
   * He chose: the answer replaces his text, or his text stays and the answer is kept beside the question (he has paid
   * for it) until the next request starts, with a button to copy it and one to put it in the box after all.
   */
  function answerQuestion(replace: boolean): void {
    const asked = pending;
    if (!asked || asked.kept) return;
    if (replace) {
      pending = undefined;
      return asked.land();
    }
    asked.kept = true;
    const where = asked.host === runArea ? 'under the Read button' : `at the end of ${stepOf(asked.reading)}`;
    const text = `Kept your text in ${stepOf(asked.reading)}: the answer was not put in the box. The answer waits here, ${where}, until the next request starts: copy it, or put it in the box after all. ${usageLine(used.model, used.endpoint, asked.result.usage)}`;
    notes.set(asked.host, { text, bad: false, stay: true, kept: true });
    paintRequests();
    hooks.announce(text);
    asked.host.querySelector<HTMLButtonElement>('[data-reader=copy-kept]')?.focus();
  }
  /** Copy the kept answer. The result shows under its buttons; when the clipboard refuses, the text is selected there. */
  async function copyKept(button: HTMLElement): Promise<void> {
    const kept = pending?.kept ? pending.text : undefined,
      slot = button.closest('.add-row')?.nextElementSibling as HTMLElement | null;
    if (kept === undefined || !slot?.classList.contains('add-fallback-slot')) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(kept);
      slot.innerHTML = copiedHtml('Copied the answer.');
      hooks.announce('Copied the answer.');
    } catch {
      slot.innerHTML = fallbackHtml();
      const area = slot.querySelector('textarea')!;
      area.value = kept;
      area.focus();
      area.select();
      hooks.announce(FALLBACK_LINE);
    }
  }
  /** Put the kept answer in its box after all: as if he had chosen Replace. */
  function useKept(): void {
    const kept = pending;
    if (!kept?.kept) return;
    pending = undefined;
    kept.land();
  }

  /**
   * Why nothing was sent, next to its cause: the key (its field takes the focus), the address (Advanced opens), or
   * under Read.
   */
  function stopHere(stop: Failure): void {
    const text = failureSentence(stop, service());
    if (KEY_FAILURES.has(stop.kind)) {
      say(keyNote, text, true);
      keyInput.focus();
    } else if (stop.kind === 'endpoint') {
      sayAddress(text, true);
      endpointInput.focus();
    } else say(statusLine, text, true);
  }

  async function readPages(): Promise<void> {
    if (busy) return;
    if (preparing || chosen.some((c) => c.state === 'waiting' || c.state === 'preparing'))
      return status('Wait until every page is prepared, then press Read.');
    if (endpointInput.value.trim() !== settings.endpoint) {
      sayAddress(
        endpointProblem(endpointInput.value) ?? 'Press Enter in the address box to use the new address.',
        true,
      );
      endpointInput.focus();
      return;
    }
    refresh();
    const pictures = kept();
    let stop = beforeSending(settings, pictures.length);
    // Pages were chosen, but none has anything to send: not "choose the pages first".
    if (stop?.kind === 'no-pictures' && chosen.length) stop = { kind: 'nothing-to-send' };
    if (stop) return stopHere(stop);
    const pages = allPages().filter(({ page }) => page.pictures.some((p) => p.kept));
    const images = pictures.map((p) => p.url);
    sent = { images, ids: pictures.map((p) => p.id), closing: closingLine(images.length, pages.length) };
    talks = {};
    notes.clear();
    say(statusLine, '');
    say(keyNote, '');
    const messages = [firstMessage('first', images, sent.closing)];
    hooks.announce(`Sent ${images.length === 1 ? '1 picture' : `${images.length} pictures`} to ${service()}. Reading…`);
    const result = await run(runArea, messages, images.length);
    if (!result.ok) {
      noteFor(runArea, result, '');
      paintRequests();
      hooks.announce(notes.get(runArea)!.text);
      readButton.focus();
      return;
    }
    const text = result.text;
    arrive('first', runArea, result, text, () => {
      talks.first = { messages, answer: text, rounds: 0 };
      deliver('first', talks.first, text);
      noteFor(runArea, result, 'Done: the answer is in step 2, checked exactly like a pasted one.');
      paintRequests();
      hooks.reports.first.focus();
    });
  }

  async function sendBack(reading: Reading): Promise<void> {
    const talk = talks[reading],
      card = hooks.cards[reading];
    if (busy || !talk || !sent) return;
    const problems = talk.checked && problemsFor(talk.checked, reading);
    if (hooks.boxes[reading].value !== talk.delivered || !problems || !canSendBack(talk.rounds) || !samePictures())
      return paintCard(reading);
    refresh();
    const stop = beforeSending(settings, sent.images.length);
    if (stop) return refuse(reading, stop);
    const messages = followUp(talk.messages, talk.answer, problems);
    hooks.announce(`Sent the problems back to ${service()}. Reading…`);
    const result = await run(card, messages, sent.images.length);
    if (!result.ok) {
      noteFor(card, result, '');
      paintRequests();
      return afterRun(reading, result);
    }
    const text = result.text;
    arrive(reading, card, result, text, () => {
      talk.messages = messages;
      talk.answer = text;
      talk.rounds++;
      deliver(reading, talk, text);
      noteFor(card, result, 'Done: the corrected answer replaced the text in the box and was checked again.');
      paintRequests();
      afterRun(reading, result);
    });
  }

  async function readAgain(): Promise<void> {
    const first = talks.first;
    if (busy || !sent || !first) return;
    if (hooks.boxes.first.value !== first.delivered || !first.checked?.ok || !samePictures()) return paintCard('first');
    refresh();
    const stop = beforeSending(settings, sent.images.length);
    if (stop) return refuse('first', stop);
    hooks.reveal('second');
    const card = hooks.cards.second,
      messages = [firstMessage('second', sent.images, sent.closing)],
      talk: Talk = { messages, answer: '', rounds: 0 };
    talks.second = talk;
    hooks.announce(`Sent the same pictures to ${service()} for a second, separate reading. Reading…`);
    const result = await run(card, messages, sent.images.length);
    if (!result.ok) {
      noteFor(card, result, '');
      paintRequests();
      return afterRun('second', result);
    }
    const text = result.text;
    arrive('second', card, result, text, () => {
      talk.answer = text;
      deliver('second', talk, text);
      // Say what step 3 really did: the first box may have changed while the second reading ran.
      noteFor(
        card,
        result,
        !talk.checked
          ? 'Done: the second reading is in step 3, but the first reading in step 2 cannot be read now, so the two were not compared.'
          : talk.checked.ok
            ? 'Done: the second reading is in step 3 and was compared with the first.'
            : 'Done: the second reading is in step 3, but the app cannot read it yet, so the two were not compared.',
      );
      paintRequests();
      afterRun('second', result);
    });
  }
  /**
   * A follow-up that cannot be sent (the key was forgotten meanwhile, say): why, in the card whose button it was, and
   * next to the key or the address when that is the cause.
   */
  function refuse(reading: Reading, stop: Failure): void {
    const text = failureSentence(stop, service());
    notes.set(hooks.cards[reading], { text, bad: true });
    paintCard(reading);
    if (KEY_FAILURES.has(stop.kind)) say(keyNote, text, true);
    else if (stop.kind === 'endpoint') sayAddress(text, true);
    else hooks.announce(text);
  }
  /** Focus where the result is: the report the answer went to, or the card that says what went wrong. */
  function afterRun(reading: Reading, result: ChatResult): void {
    if (result.ok) hooks.reports[reading].focus();
    else {
      hooks.announce(notes.get(hooks.cards[reading])?.text ?? '');
      hooks.cards[reading].focus();
    }
  }

  root.addEventListener('click', onClick);
  for (const reading of ['first', 'second'] as const) hooks.cards[reading].addEventListener('click', onClick);
  function onClick(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-reader]');
    if (!button) return;
    switch (button.dataset.reader) {
      case 'show': {
        const show = button.getAttribute('aria-pressed') !== 'true';
        keyInput.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(show));
        button.textContent = show ? 'Hide' : 'Show';
        break;
      }
      case 'forget':
        reload();
        settings = { ...settings, key: '' };
        save();
        keyInput.value = '';
        say(keyNote, 'The key is forgotten: it is no longer stored in this browser.');
        break;
      case 'defaults':
        setEndpoint(DEEPSEEK_ENDPOINT, DEFAULT_MODEL);
        break;
      case 'remove-file': {
        const index = chosen.findIndex((c) => String(c.id) === button.dataset.id);
        if (index < 0) break;
        const [c] = chosen.splice(index, 1);
        paintFiles();
        paintPictures();
        status(`Removed “${c.name}” and its pictures.`);
        (
          fileList.querySelectorAll<HTMLButtonElement>('button')[Math.min(index, chosen.length - 1)] ?? fileInput
        ).focus();
        break;
      }
      case 'remove-cut': {
        const all = kept(),
          index = all.findIndex((p) => String(p.id) === button.dataset.id);
        if (index < 0) break;
        const label = all[index].item?.querySelector('.reader-cut-label')?.textContent ?? 'the picture';
        all[index].kept = false;
        paintPictures();
        status(`Removed ${label}: it will not be sent.`);
        (cutList.querySelectorAll<HTMLButtonElement>('button')[Math.min(index, all.length - 2)] ?? readButton).focus();
        break;
      }
      case 'read':
        void readPages();
        break;
      case 'cancel':
        busy?.controller.abort();
        break;
      case 'send-back':
        void sendBack(button.dataset.reading === 'second' ? 'second' : 'first');
        break;
      case 'again':
        void readAgain();
        break;
      case 'replace':
      case 'keep':
        answerQuestion(button.dataset.reader === 'replace');
        break;
      case 'copy-kept':
        void copyKept(button);
        break;
      case 'use-kept':
        useKept();
        break;
    }
  }
  paintSettings();
  paintPictures();
  paintRequests();
}
