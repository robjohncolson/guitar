import { MESSAGE_LIMIT, type Checked, type Problem } from './import';
import { AGREEMENT_NOTE, agree, comparisonLines, type Comparison } from './compare';
import { isDraft, MAX_PIECES, type Added, type Mine, type PieceMeta } from './mine';

/**
 * The HTML of the "Add your own piece" panel, as pure functions of the data (add-panel.ts wires them to the page). Every
 * piece of text that came from an AI or from his storage goes through esc(); the words here are for the owner, so they say
 * "read" where the compiler would say "compile".
 */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** How many problems the panel shows before it only counts the rest. */
export const SHOWN = 12;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function problemListHtml(list: Problem[]): string {
  const rest = list.length - SHOWN;
  const item = (p: Problem) =>
    `<li>${
      p.line
        ? `<span class="add-where">Line ${p.line}${p.level === 'warn' ? ' · warning' : ''}</span><code class="add-quote">${esc(p.quote)}</code>`
        : `<span class="add-where">Whole file${p.level === 'warn' ? ' · warning' : ''}</span>`
    }<span class="add-msg">${esc(p.message)}</span></li>`;
  return `<ol class="add-problems">${list.slice(0, SHOWN).map(item).join('')}</ol>${
    rest > 0
      ? `<p>And ${rest} more not shown here. ${list.length > MESSAGE_LIMIT ? `The copied message lists the first ${MESSAGE_LIMIT}.` : 'The copied message lists them all.'}</p>`
      : ''
  }`;
}

const row = (buttons: string) => `<div class="add-row">${buttons}</div><div class="add-fallback-slot"></div>`;
const button = (act: string, label: string, primary = false) =>
  `<button type="button"${primary ? ' class="primary"' : ''} data-act="${act}">${label}</button>`;

/** Step 2's report after Check. */
export function checkHtml(c: Checked): string {
  const tidied = c.tidied.length ? `<p class="add-tidied">${c.tidied.map(esc).join(' ')}</p>` : '';
  const paste = c.paste ? `<p class="add-bad">${esc(c.paste)}</p>` : '';
  if (!c.ok) {
    if (!c.errors.length) return `${paste}${tidied}`;
    const all = [...c.errors, ...c.warnings];
    return `<p class="add-bad">The app cannot read it yet: ${plural(c.errors.length, 'problem')}${c.warnings.length ? ` and ${plural(c.warnings.length, 'warning')}` : ''}.</p>${paste}${tidied}${problemListHtml(all)}${row(button('copy-problems', 'Copy problems for your AI'))}`;
  }
  const s = c.score!,
    by = c.composer ? ` by ${esc(c.composer)}` : '';
  const summary = `<p class="add-ok"><strong>${esc(c.title || 'No title')}</strong>${by}: read and checked. ${plural(s.bars.length, 'bar')}, ${plural(s.notes.length, 'note')}, ${plural(s.sections.length, 'section')}.</p>`;
  const warnings = c.warnings.length
    ? `<p>${plural(c.warnings.length, 'warning')} to look at:</p>${problemListHtml(c.warnings)}`
    : '';
  const unsure = c.unsure.length
    ? `<p>Bars the AI marked unsure (listen to these closely):</p><ul class="add-unsure">${c.unsure.map((u) => `<li>${esc(u.note)}</li>`).join('')}</ul>`
    : '';
  const claimed = isDraft(s.meta.verified)
    ? ''
    : `<p class="add-hint">This text carries “verified: ${esc(s.meta.verified)}”. It will be added as a draft: after you have listened to it, press It sounds right again.</p>`;
  const action = !c.title
    ? '<p class="add-bad">The piece has no <code>title:</code> line. Add one at the top of the text in the box (for example <code>title: My piece</code>), then press Check again. The title is how your pieces are told apart.</p>'
    : c.addable
      ? `${row(`${button('add', 'Add to my pieces', true)}${c.warnings.length ? button('copy-problems', 'Copy warnings for your AI') : ''}`)}${claimed}`
      : c.warnings.length
        ? row(button('copy-problems', 'Copy warnings for your AI'))
        : '';
  return `${summary}${paste}${tidied}${warnings}${unsure}${action}`;
}

/** Step 2's report after Add. */
const by = (composer: string) => (composer ? ` by ${esc(composer)}` : ' with no composer');
export function addedHtml(result: Extract<Added, { ok: true }>, title: string, composer: string): string {
  const name = `“${esc(title)}”`;
  const what =
    result.outcome === 'unchanged'
      ? `Your piece ${name} already has exactly this text; nothing changed.`
      : result.outcome === 'replaced'
        ? result.replacedComposer !== undefined
          ? `Replaced your piece ${name}${by(result.replacedComposer)} with this one${by(composer)}. It is a draft again.`
          : `Replaced the text of your piece ${name} (same title and composer). It is a draft again.`
        : `Added ${name} as a draft.`;
  const demoted = result.demoted ? ' The text said it was already checked; only your own click confirms a piece.' : '';
  return `<p class="add-ok">${what}${demoted} Listen to it with <em>Hear the whole piece</em>, and when it sounds right, press <em>It sounds right</em> under Your pieces.</p>${row(button('hear', 'Hear the whole piece'))}`;
}

/**
 * Step 2's question when one of his pieces has the same title but another composer. It names the piece Replace would
 * replace; the safe choice comes first (and gets the focus).
 */
export function askHtml(ask: { title: string; composer: string; others: number }, composer: string): string {
  const named = `“${esc(ask.title)}”${by(ask.composer)}`,
    others = ask.others ? ` and ${plural(ask.others, 'other piece')} with that title` : '';
  return `<p class="add-bad">You already have ${named}${others}. This one is${by(composer)}. Keep it as a separate piece, or replace ${named} with it?</p>${row(`${button('add-separate', 'Add as a separate piece')}${button('add-replace', 'Replace')}`)}`;
}

/** Step 3's report after Compare. */
export function compareHtml(c: Comparison, modes: (string | undefined)[]): string {
  const lines = comparisonLines(c);
  const sameMode =
    modes[0] && modes[0] === modes[1]
      ? `<p class="add-hint">Both readings use pitch-mode: ${esc(modes[0])}. A second reading in the other mode catches more key-signature mistakes.</p>`
      : '';
  if (agree(c))
    return `<p class="add-ok">The two readings agree on the key and time signatures, the bars, every note’s pitch, start, length and hand, the chord symbols and swing.</p><p>Agreement does not prove both are right: listen before you confirm.</p>${sameMode}`;
  return `<p>The readings differ in ${plural(lines.length, 'place')}:</p><ul class="add-diffs">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>${plural(c.sameBars, 'bar')} agree on every note. ${esc(AGREEMENT_NOTE)}</p>${sameMode}${row(button('copy-differences', 'Copy differences for your AI'))}`;
}

/** Step 4: his pieces, each with its title, the Draft tag and the confirm button while it is a draft. */
export function listHtml(mine: Mine[], metaOf: (text: string) => PieceMeta, armed = ''): string {
  if (!mine.length) return '<p class="add-hint">No pieces yet.</p>';
  const items = mine.map((m) => {
    const meta = metaOf(m.text),
      title = esc(meta.title ?? m.id),
      id = esc(m.id),
      draft = isDraft(meta.verified),
      act = (name: string, label: string, aria: string) =>
        `<button type="button" data-act="${name}" data-id="${id}" aria-label="${aria}">${label}</button>`;
    return `<li class="add-piece"><span class="add-title">${title}${meta.composer ? ` <span class="add-by">${esc(meta.composer)}</span>` : ''}${draft ? ' <span class="add-tag">Draft</span>' : ''}</span><span class="add-actions">${
      draft ? act('confirm', 'It sounds right', `It sounds right: confirm ${title}`) : ''
    }${act('copy-text', 'Copy text', `Copy the text of ${title}`)}${act('download', 'Download', `Download ${title}`)}${act(
      'remove',
      armed === m.id ? 'Click again to remove' : 'Remove',
      armed === m.id ? `Click again to remove ${title}` : `Remove ${title}`,
    )}</span><div class="add-fallback-slot"></div></li>`;
  });
  return `<ul class="add-mine">${items.join('')}</ul><p class="add-hint">${mine.length} of ${MAX_PIECES} pieces.</p>`;
}

/** What a copy button shows next to itself: the result, or the text selected for copying by hand. */
export const copiedHtml = (done: string) => `<p class="add-copied">${esc(done)}</p>`;
export const FALLBACK_LINE =
  'Copying was not allowed here, so the text is selected in this box: press Ctrl+C to copy it (Cmd+C on a Mac; on a phone, touch and hold it, then Copy).';
export const fallbackHtml = () =>
  `<div class="add-fallback"><p>${FALLBACK_LINE}</p><textarea class="add-box" rows="5" readonly aria-label="Text to copy"></textarea></div>`;
