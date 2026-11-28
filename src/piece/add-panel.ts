import './add-panel.css';
import { importGuide } from './import-guide';
import { checkAnswer, MAX_BYTES, pitchMode, problemsMessage, type Checked } from './import';
import { compareReadings, differencesMessage } from './compare';
import {
  addPiece,
  confirmPiece,
  MAX_PIECES,
  pieceMeta,
  readMine,
  removePiece,
  textBytes,
  writeMine,
  type Mine,
} from './mine';
import {
  addedHtml,
  askHtml,
  checkHtml,
  compareHtml,
  copiedHtml,
  esc,
  FALLBACK_LINE,
  fallbackHtml,
  listHtml,
  problemListHtml,
} from './add-view';
import { mountPieceAccount } from '../account/pieces';
import { accountsEnabled } from '../account/config';

/**
 * "Add your own piece": instructions to carry to any AI chat, the answer brought back, a check that says plainly what is
 * wrong, a comparison of two readings, and the owner's pieces, each a draft until he confirms it by ear. No network
 * request is made here and everything that came from an AI is treated as untrusted text (see add-view.ts). The one
 * exception is the reader (reader-view.ts, loaded only when its part is opened): when the owner presses Read, it sends
 * the pictures he chose to the service he named, and its answer comes back through this panel's own Check and Compare.
 */
export interface AddPanelHooks {
  /** Open one of his pieces after adding it. */
  open: (id: string) => void;
  /** The piece open on the page. */
  current: () => { id: string; origin: string; text: string };
  /** His piece's text changed without its notes changing (confirmed): repaint labels only. */
  relabel: (id: string) => void;
  /** One of his pieces was removed. */
  removed: (id: string) => void;
}

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const box = (id: string, rows: number) =>
  `<textarea id="${id}" class="add-box" rows="${rows}" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" data-gramm="false"></textarea>`;
// The file input stays focusable but out of sight; its label is the visible button.
const fileInput = (id: string) =>
  `<input type="file" id="${id}" class="add-file-input" accept=".txt,.md,text/plain,text/markdown"><label class="add-file" for="${id}">Open a file</label>`;

/** The panel's fixed markup, placed inside `<details id="piece-add">` by view.ts. */
export function addPanelMarkup(accounts: boolean): string {
  return `<div class="add-panel">
    <p id="add-announce" class="sr-only" role="status" aria-atomic="true"></p>
    <p class="add-privacy">Nothing here is sent anywhere unless you use <em>Let an AI read it for you</em>, which sends only the pictures you choose, with your own key, to the AI service you name. Otherwise you carry the instructions to your AI and bring its answer back. Your pieces stay in this browser${accounts ? ' unless you choose <em>Save to my account</em>' : ''}.</p>
    <section class="add-step" aria-labelledby="add-h1"><h3 id="add-h1"><span class="add-num" aria-hidden="true">1</span>Copy instructions for your AI</h3>
      <p>Give your AI (ChatGPT, Gemini, Claude, DeepSeek or another) the pages of your sheet music and these instructions. It answers with a piece file.</p>
      <div class="add-row"><button type="button" data-act="copy-guide" id="add-copy-guide">Copy instructions for your AI</button></div><div class="add-fallback-slot"></div>
      <button type="button" id="add-reader-toggle" data-act="toggle-reader" class="add-disclosure" aria-expanded="false" aria-controls="add-reader">Or let an AI read it for you (your own key)</button>
      <div id="add-reader" class="add-step-body add-reader" hidden></div></section>
    <section class="add-step" aria-labelledby="add-h2"><h3 id="add-h2"><span class="add-num" aria-hidden="true">2</span>Paste its answer</h3>
      <label for="add-answer" class="add-label">The whole answer. For a long piece sent in parts, paste each answer after the one before. A file works too: open it or drop it on the box.</label>
      ${box('add-answer', 7)}
      <div class="add-row"><button type="button" data-act="check" id="add-check" class="primary">Check</button>${fileInput('add-file')}<button type="button" data-act="clear" data-box="add-answer">Clear</button></div>
      <p class="add-status"></p><div id="add-report" class="add-report" tabindex="-1"></div><div id="add-reader-first" class="add-reader-card" tabindex="-1" hidden></div></section>
    <section class="add-step" aria-labelledby="add-h3"><h3 id="add-h3"><button type="button" id="add-compare-toggle" data-act="toggle-compare" class="add-disclosure" aria-expanded="false" aria-controls="add-compare"><span class="add-num" aria-hidden="true">3</span>Compare with a second reading (recommended)</button></h3>
      <div id="add-compare" class="add-step-body" hidden>
      <p>A second reading made from the pages alone, in a fresh chat or by another AI, catches many mistakes. Give it the pages and these instructions, then paste its answer below.</p>
      <div class="add-row"><button type="button" data-act="copy-second" id="add-copy-second">Copy instructions for a second reading</button></div><div class="add-fallback-slot"></div>
      <div id="add-use-open" class="add-row" hidden><button type="button" data-act="use-open" id="add-use-open-button">Use the open piece as the first reading</button></div>
      <label for="add-second" class="add-label">The second reading (the first reading is the one in step 2)</label>
      ${box('add-second', 6)}
      <div class="add-row"><button type="button" data-act="compare" id="add-compare-go">Compare</button>${fileInput('add-second-file')}<button type="button" data-act="clear" data-box="add-second">Clear</button></div>
      <p class="add-status"></p><div id="add-compare-report" class="add-report" tabindex="-1"></div><div id="add-reader-second" class="add-reader-card" tabindex="-1" hidden></div></div></section>
    <section class="add-step" aria-labelledby="add-h4"><h3 id="add-h4" tabindex="-1"><span class="add-num" aria-hidden="true">4</span>Your pieces</h3>
      <p class="add-hint">A new piece is a draft until you have listened to it with <em>Hear the whole piece</em> and pressed <em>It sounds right</em>.</p>
      <div id="add-list" class="add-list"></div><p class="add-status"></p></section>
    <div id="piece-account-list"></div>
  </div>`;
}

/** Wire the panel. Returns paint(), which redraws his list (and the account list under it). */
export function mountAddPanel(hooks: AddPanelHooks): { paint: () => void } {
  const answer = el<HTMLTextAreaElement>('add-answer'),
    second = el<HTMLTextAreaElement>('add-second'),
    report = el('add-report'),
    compareReport = el('add-compare-report'),
    list = el('add-list'),
    toggle = el('add-compare-toggle'),
    compareBody = el('add-compare');
  const titleOf = (text: string) => pieceMeta(text).title;

  /** Screen readers hear every result through one status line kept out of sight. */
  const announce = (text: string) => {
    const status = el('add-announce');
    status.textContent = '';
    // Set in the next frame, so that a repeated message is announced again.
    requestAnimationFrame(() => (status.textContent = text));
  };
  /** A message with no report to carry it: shown in the step's own line (next to its buttons) and announced. */
  const say = (from: HTMLElement, text: string) => {
    const line = from.closest('.add-step')?.querySelector<HTMLElement>('.add-status');
    if (line) line.textContent = text;
    announce(text);
  };
  const quiet = (from: HTMLElement) => {
    const line = from.closest('.add-step')?.querySelector<HTMLElement>('.add-status');
    if (line) line.textContent = '';
  };

  /** Copy from a click. The result shows right after the button's row; when the clipboard refuses, the text is selected. */
  async function copy(button: HTMLElement, text: string, done: string): Promise<void> {
    const slot = button.closest('.add-row, .add-actions')?.nextElementSibling as HTMLElement | null;
    if (!slot?.classList.contains('add-fallback-slot')) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      slot.innerHTML = copiedHtml(done);
      announce(done);
    } catch {
      slot.innerHTML = fallbackHtml();
      const area = slot.querySelector('textarea')!;
      area.value = text;
      area.focus();
      area.select();
      announce(FALLBACK_LINE);
    }
  }

  let lastChecked: Checked | undefined;
  /** Check step 2's box; the result is also what the reader sends back as problems. */
  function check(button: HTMLElement): Checked | undefined {
    if (!answer.value.trim()) {
      report.innerHTML = '';
      say(button, 'Paste the AI’s answer into the box first, or open a file.');
      return undefined;
    }
    const c = (lastChecked = checkAnswer(answer.value));
    report.innerHTML = checkHtml(c);
    quiet(button);
    announce(
      c.paste && !c.ok
        ? c.paste
        : c.ok
          ? `Read and checked “${c.title || 'No title'}”: ${c.bars} bars and ${c.notes} notes.${c.warnings.length ? ` ${c.warnings.length} warnings.` : ''}${c.paste ? ` ${c.paste}` : ''}`
          : `The app cannot read it yet: ${c.errors.length} problems. Copy them for your AI.`,
    );
    return c;
  }

  /** The piece the last question offered to replace. */
  let asked = '';
  function add(choice?: { replace: string } | 'separate'): void {
    // The box may have changed since Check: read it again. The report is redrawn, so focus moves to its first button.
    const c = checkAnswer(answer.value);
    if (!c.addable) {
      lastChecked = c;
      report.innerHTML = checkHtml(c);
      announce('The text needs another look; see the report.');
      report.focus();
      return;
    }
    const result = addPiece(readMine(), { text: c.text, title: c.title, composer: c.composer }, choice);
    if (!result.ok) {
      if (result.reason === 'ask') {
        asked = result.id;
        report.innerHTML = askHtml(result, c.composer);
        announce(report.textContent ?? '');
        report.querySelector<HTMLButtonElement>('button')?.focus();
      } else
        say(
          answer,
          result.reason === 'full'
            ? `You already have ${MAX_PIECES} pieces, the most this browser keeps. Remove one under Your pieces first.`
            : result.reason === 'large'
              ? `This piece file is larger than ${MAX_BYTES / 1000} KB, the most a piece may be.`
              : 'The piece needs a title: line.',
        );
      return;
    }
    if (result.outcome !== 'unchanged' && !writeMine(result.list)) {
      say(answer, 'Browser storage is full or unavailable, so the piece was not added.');
      return;
    }
    hooks.open(result.id);
    paint();
    report.innerHTML = addedHtml(result, c.title, c.composer);
    answer.value = '';
    lastChecked = undefined;
    offerOpen();
    quiet(answer);
    announce(report.querySelector('p')?.textContent ?? '');
    report.querySelector<HTMLButtonElement>('button')?.focus();
  }

  /**
   * Put text after what a box already holds, on a new line: copied text has no final line break, so the next answer
   * pasted behind it would otherwise start on the closing line of the last one.
   */
  function append(target: HTMLTextAreaElement, text: string): void {
    const value = target.value,
      join = value && !value.endsWith('\n') ? '\n' : '';
    target.setRangeText(join + text, value.length, value.length, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** Add a chosen or dropped file (plain text, at most 300 KB) to a box. */
  async function fill(target: HTMLTextAreaElement, file: File | undefined, from: HTMLElement): Promise<void> {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      say(from, `“${file.name}” is larger than ${MAX_BYTES / 1000} KB, too large for a piece file.`);
      return;
    }
    if (file.type && !/^text\//.test(file.type) && !/\.(txt|md)$/i.test(file.name)) {
      say(from, `“${file.name}” is not a plain text file. Use the text the AI sent (.txt or .md).`);
      return;
    }
    const had = Boolean(target.value.trim());
    append(target, await file.text());
    say(
      from,
      `${had ? `Added “${file.name}” after the text already in the box (Clear empties the box).` : `Put “${file.name}” in the box.`} Press ${target === answer ? 'Check' : 'Compare'}.`,
    );
  }
  for (const [target, input] of [
    [answer, el<HTMLInputElement>('add-file')],
    [second, el<HTMLInputElement>('add-second-file')],
  ] as const) {
    input.onchange = () => {
      void fill(target, input.files?.[0], input);
      input.value = '';
    };
    target.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      const { value, selectionStart, selectionEnd } = target;
      // Only when adding to the end of text already there; anywhere else the paste is the browser's own.
      if (!text || !value || value.endsWith('\n') || selectionStart !== value.length || selectionEnd !== value.length)
        return;
      event.preventDefault();
      append(target, text);
    });
    target.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        target.classList.add('add-drop');
      }
    });
    target.addEventListener('dragleave', () => target.classList.remove('add-drop'));
    target.addEventListener('drop', (event) => {
      target.classList.remove('add-drop');
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      void fill(target, file, target);
    });
  }
  // A report about other text would mislead: editing a box clears what was said about it.
  answer.addEventListener('input', () => {
    if (lastChecked || report.innerHTML) {
      report.innerHTML = '';
      lastChecked = undefined;
    }
    compareReport.innerHTML = '';
    lastComparison = '';
    offerOpen();
  });
  second.addEventListener('input', () => {
    compareReport.innerHTML = '';
    lastComparison = '';
    lastSecond = undefined;
  });

  /** Step 3: when the first box is empty and the open piece is his, offer it as the first reading. */
  function offerOpen(): void {
    el('add-use-open').hidden = Boolean(answer.value.trim()) || hooks.current().origin !== 'mine';
  }
  // Step 3 is collapsed by default: it opens on its own button and closes again whenever the panel closes (the menu
  // closes every section when it opens).
  const expand = (open: boolean) => {
    compareBody.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) offerOpen();
  };
  el<HTMLDetailsElement>('piece-add').addEventListener('toggle', () => {
    if (!el<HTMLDetailsElement>('piece-add').open) {
      expand(false);
      openReader(false);
    }
    offerOpen();
  });

  let lastComparison = '',
    lastSecond: Checked | undefined;
  /**
   * Compare the two boxes. Returns the second reading as checked when the first could be read, so that the reader
   * sends back only problems this report shows; nothing when the first cannot be read (no comparison was made).
   */
  function compare(button: HTMLElement): Checked | undefined {
    lastComparison = '';
    lastSecond = undefined;
    compareReport.innerHTML = '';
    if (!answer.value.trim()) {
      say(button, 'Paste the first reading in step 2 first (or use your open piece).');
      return undefined;
    }
    if (!second.value.trim()) {
      say(button, 'Paste the second reading into the box first.');
      return undefined;
    }
    const a = checkAnswer(answer.value),
      b = checkAnswer(second.value);
    quiet(button);
    if (!a.ok) {
      compareReport.innerHTML = `<p class="add-bad">${esc(a.paste ?? 'The app cannot read the first reading yet. Check it in step 2 first.')}</p>`;
      announce(compareReport.textContent ?? '');
      return undefined;
    }
    if (!b.ok) {
      if (b.errors.length) {
        lastSecond = b;
        compareReport.innerHTML = `<p class="add-bad">The app cannot read the second reading yet: ${b.errors.length} problem${b.errors.length === 1 ? '' : 's'}.</p>${problemListHtml([...b.errors, ...b.warnings])}<div class="add-row"><button type="button" data-act="copy-second-problems">Copy problems for your AI</button></div><div class="add-fallback-slot"></div>`;
      } else compareReport.innerHTML = `<p class="add-bad">${esc(b.paste ?? '')}</p>`;
      announce('The app cannot read the second reading yet.');
      return b;
    }
    const c = compareReadings(a.score!, b.score!);
    lastComparison = differencesMessage(c);
    compareReport.innerHTML = compareHtml(c, [pitchMode(a.text), pitchMode(b.text)]);
    announce(compareReport.querySelector('p')?.textContent ?? '');
    return b;
  }

  // The reader ("Or let an AI read it for you"): its code loads the first time its part opens, and the panel closing
  // closes it, like step 3. A request already running goes on, and its answer still arrives in the box.
  const readerToggle = el('add-reader-toggle'),
    readerBody = el('add-reader');
  let reader: Promise<void> | undefined;
  function openReader(open: boolean): void {
    readerBody.hidden = !open;
    readerToggle.setAttribute('aria-expanded', String(open));
    if (!open || reader) return;
    readerBody.innerHTML = '<p class="add-hint">Loading…</p>';
    reader = import('./reader-view').then(
      ({ mountReader }) =>
        mountReader({
          root: readerBody,
          cards: { first: el('add-reader-first'), second: el('add-reader-second') },
          boxes: { first: answer, second },
          reports: { first: report, second: compareReport },
          deliver: (reading, text) => {
            const target = reading === 'first' ? answer : second;
            if (reading === 'second') expand(true);
            target.value = text;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return reading === 'first' ? check(el('add-check')) : compare(el('add-compare-go'));
          },
          reveal: (reading) => {
            if (reading === 'second') expand(true);
          },
          announce,
        }),
      () => {
        reader = undefined;
        readerBody.innerHTML =
          '<p class="add-bad">This part could not be loaded. Check the connection, then close it and open it again.</p>';
      },
    );
  }

  // His pieces.
  let armed = '';
  function paint(): void {
    list.innerHTML = listHtml(readMine(), pieceMeta, armed);
    account.paint();
  }
  const find = (id: string): Mine | undefined => readMine().find((m) => m.id === id);
  const named = (piece: Mine | undefined, id: string) => (piece && titleOf(piece.text)) ?? id;
  function download(piece: Mine): void {
    const url = URL.createObjectURL(new Blob([piece.text], { type: 'text/plain;charset=utf-8' })),
      a = document.createElement('a');
    a.href = url;
    a.download = `${piece.id.replace(/^mine:/, '').replace(/[^\w-]+/g, '-') || 'piece'}.piece.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** After the list is redrawn, focus the same action on the same piece, or the next piece, or the heading. */
  function refocus(id: string, act: string, fallbackIndex: number): void {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button[data-act]')];
    const same = buttons.find((b) => b.dataset.id === id && b.dataset.act === act),
      next = [...list.querySelectorAll<HTMLElement>('.add-piece')][fallbackIndex]?.querySelector<HTMLButtonElement>(
        'button',
      );
    (same ?? next ?? el('add-h4')).focus();
  }

  el('piece-add').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!button) return;
    const act = button.dataset.act!,
      id = button.dataset.id ?? '';
    if (act !== 'remove' && armed) {
      armed = '';
      paint();
    }
    switch (act) {
      case 'copy-guide':
        void copy(
          button,
          importGuide('first'),
          'Copied. In your AI chat, attach the pages and paste the instructions.',
        );
        break;
      case 'copy-second':
        void copy(
          button,
          importGuide('second'),
          'Copied. Use a fresh chat or another AI, attach the pages and paste these instructions.',
        );
        break;
      case 'toggle-compare':
        expand(toggle.getAttribute('aria-expanded') !== 'true');
        break;
      case 'toggle-reader':
        openReader(readerToggle.getAttribute('aria-expanded') !== 'true');
        break;
      case 'check':
        check(button);
        break;
      case 'clear': {
        const target = el<HTMLTextAreaElement>(button.dataset.box!);
        target.value = '';
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
        say(button, 'The box is empty.');
        break;
      }
      case 'compare':
        compare(button);
        break;
      case 'copy-problems':
        if (lastChecked) void copy(button, problemsMessage(lastChecked), 'Copied. Paste it into the same AI chat.');
        break;
      case 'copy-second-problems':
        if (lastSecond)
          void copy(button, problemsMessage(lastSecond), 'Copied. Paste it into the chat of the second reading.');
        break;
      case 'copy-differences':
        if (lastComparison) void copy(button, lastComparison, 'Copied. Paste it into either chat, then compare again.');
        break;
      case 'add':
        add();
        break;
      case 'add-replace':
        if (asked) add({ replace: asked });
        break;
      case 'add-separate':
        add('separate');
        break;
      case 'hear':
        el('piece-listen').click();
        break;
      case 'use-open': {
        const piece = hooks.current();
        if (piece.origin !== 'mine') break;
        answer.value = piece.text;
        answer.dispatchEvent(new Event('input', { bubbles: true }));
        say(button, `Using your open piece “${titleOf(piece.text) ?? piece.id}” as the first reading.`);
        break;
      }
      case 'confirm': {
        // Only this click confirms a piece; it rewrites the verified: line and uploads nothing.
        const piece = find(id);
        if (!piece) break;
        if (!writeMine(confirmPiece(readMine(), id))) {
          say(list, 'Browser storage is full or unavailable, so nothing changed.');
          break;
        }
        hooks.relabel(id);
        paint();
        refocus(id, 'copy-text', 0);
        say(list, `Confirmed “${named(piece, id)}” by ear: it is no longer a draft.`);
        break;
      }
      case 'copy-text': {
        const piece = find(id);
        if (piece) void copy(button, piece.text, `Copied the text of “${named(piece, id)}”.`);
        break;
      }
      case 'download': {
        const piece = find(id);
        if (piece) {
          download(piece);
          say(list, `Saved “${named(piece, id)}” as a file in your downloads.`);
        }
        break;
      }
      case 'remove': {
        if (armed !== id) {
          armed = id;
          paint();
          refocus(id, 'remove', 0);
          break;
        }
        armed = '';
        const mine = readMine(),
          index = mine.findIndex((m) => m.id === id),
          piece = mine[index];
        if (!writeMine(removePiece(mine, id))) {
          say(list, 'Browser storage is unavailable, so nothing changed.');
          break;
        }
        paint();
        hooks.removed(id);
        refocus('', '', Math.max(0, Math.min(index, mine.length - 2)));
        say(list, `Removed “${named(piece, id)}” from this browser.`);
        break;
      }
    }
  });

  const account = accountsEnabled
    ? mountPieceAccount({
        container: el('piece-account-list'),
        readMine,
        titleOf: (text) => titleOf(text) ?? 'Untitled piece',
        refresh: () => paint(),
        addMine: (m) => {
          const mine = readMine();
          if (mine.length >= MAX_PIECES && !mine.some((x) => x.id === m.id)) return false;
          if (textBytes(m.text) > MAX_BYTES) return false;
          return writeMine([...mine.filter((x) => x.id !== m.id), m]);
        },
      })
    : { paint: () => undefined };
  paint();
  return { paint };
}
