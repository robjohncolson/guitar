import { importGuide, type Reading } from './import-guide';
import { problemsMessage, type Checked } from './import';

/**
 * "Let an AI read it for you": the owner's own key sends the pictures he chose, with the same instructions the Copy button
 * gives (import-guide.ts), straight from this browser to the chat-completions service he named. This module builds the
 * request, reads the streamed answer, says what went wrong in plain sentences, estimates the cost and keeps the settings.
 * It touches no storage or network by itself: streamChat is given its fetch, and the settings functions their storage.
 *
 * What comes back is untrusted text. It goes into the same box as a pasted answer and through the same checks
 * (import.ts); nothing here reads or changes music. Nobody has measured how well any model reads real sheet music.
 *
 * The key is the owner's secret: it is kept in this browser only (`piece.reader.v1`, never synced: see
 * tests/piece-reader.test.ts), sent only in the Authorization header and only to the endpoint it was stored with, and
 * it appears in no request body, URL, sentence or log line.
 */

export const READER_KEY = 'piece.reader.v1';
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-flash';

export interface ReaderSettings {
  endpoint: string;
  model: string;
  key: string;
}
export const DEFAULTS: ReaderSettings = { endpoint: DEEPSEEK_ENDPOINT, model: DEFAULT_MODEL, key: '' };

/** The most pages one reading takes, and the service's own limits on one request. */
export const MAX_PAGES = 40;
export const MAX_IMAGES = 600;
export const MAX_BODY = 48 * 1024 * 1024;
/** How many times the problems of one reading may be sent back to the same conversation. */
export const MAX_ROUNDS = 3;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Why an endpoint cannot be used, as a sentence; undefined when it can. */
export function endpointProblem(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return 'The address is not a web address. It looks like https://api.deepseek.com/chat/completions.';
  }
  if (url.username || url.password) return 'The address must not hold a name or password. Put the key in its own box.';
  if (url.protocol === 'https:') return undefined;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return undefined;
  return url.protocol === 'http:'
    ? 'The address must start with https:// (http:// only for a server on this computer: localhost or 127.0.0.1).'
    : 'The address must start with https://.';
}

const originOf = (endpoint: string) => {
  try {
    return new URL(endpoint.trim()).origin;
  } catch {
    return '';
  }
};
/** The service as the owner sees it named: DeepSeek at its own address, otherwise the endpoint's host. */
export const serviceName = (endpoint: string) => {
  try {
    const url = new URL(endpoint.trim());
    return url.origin === originOf(DEEPSEEK_ENDPOINT) ? 'DeepSeek' : url.host;
  } catch {
    return 'the service';
  }
};

/** Settings as stored; anything missing or unusable falls back to the defaults, and a key never outlives its endpoint. */
export function parseSettings(raw: string | null): ReaderSettings {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object') return { ...DEFAULTS };
    const endpoint = typeof v.endpoint === 'string' && !endpointProblem(v.endpoint) ? v.endpoint.trim() : '';
    return {
      endpoint: endpoint || DEFAULTS.endpoint,
      model: typeof v.model === 'string' && v.model.trim() ? v.model.trim() : DEFAULTS.model,
      // A key stored with a missing or unusable endpoint is dropped: it is only ever sent where it was typed for.
      key: endpoint && typeof v.key === 'string' ? v.key.trim() : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}
export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined): ReaderSettings {
  try {
    return parseSettings(storage?.getItem(READER_KEY) ?? null);
  } catch {
    return { ...DEFAULTS };
  }
}
/** False when browser storage is full or unavailable. */
export function saveSettings(settings: ReaderSettings, storage: Pick<Storage, 'setItem'> | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(READER_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/**
 * A new endpoint. When it points to another origin than the one the key was typed for, the key is forgotten, so that a
 * key for one service is never sent to another by accident.
 */
export function withEndpoint(
  settings: ReaderSettings,
  endpoint: string,
): { settings: ReaderSettings; forgot: boolean } {
  const next = endpoint.trim(),
    forgot = Boolean(settings.key) && originOf(next) !== originOf(settings.endpoint);
  return { settings: { ...settings, endpoint: next, key: forgot ? '' : settings.key }, forgot };
}

// The request.

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type Message = { role: 'user'; content: Part[] | string } | { role: 'assistant'; content: string };

/**
 * The last words after the pictures: what they are, true however the pages were cut (pages.ts cuts as well as it can:
 * usually one line of music per picture, sometimes overlapping strips that may begin or end partway through a line, or
 * a whole page), and that the whole piece is wanted in this one answer.
 */
export function closingLine(pictures: number, pages: number): string {
  const what =
    pictures === 1
      ? 'That is the only picture, from 1 page. It may show the whole page or a strip of it: one line of music or several, and a strip may begin or end partway through a line. Write each bar once.'
      : `Those are all ${pictures} pictures, from ${pages === 1 ? '1 page' : `${pages} pages`}. They are strips of ${pages === 1 ? 'the page in reading order, from top to bottom' : 'the pages in reading order: page by page, each from top to bottom'}. A strip may hold one line of music or several, and may begin or end partway through a line. Strips of the same page may overlap, so the same bars can appear in two pictures: write each bar once.`;
  return `${what} Your answer goes straight to the app, which reads all of it, so send the whole piece now in this one answer: for a long piece, every part as its own code block, one after another. Do not stop to wait for me to ask for the next part.`;
}

/** The first message of a reading: the guide the Copy button gives, the pictures in order, the closing line. */
export function firstMessage(reading: Reading, images: string[], closing: string): Message {
  return {
    role: 'user',
    content: [
      { type: 'text', text: importGuide(reading) },
      ...images.map((url): Part => ({ type: 'image_url', image_url: { url } })),
      { type: 'text', text: closing },
    ],
  };
}

/** The same conversation, one round further: the AI's answer, then the problems the panel found in it. */
export const followUp = (messages: Message[], answer: string, problems: string): Message[] => [
  ...messages,
  { role: 'assistant', content: answer },
  { role: 'user', content: problems },
];

const picturesOf = (n: number) =>
  n === 1 ? 'the picture this reading was made from' : `the ${n} pictures this reading was made from`;
/**
 * Under a reading's follow-up buttons, what they send and where: both send the pictures of that reading again (sending
 * the problems back continues the conversation that holds them, a second reading starts a new one with them), to the
 * service named in the settings now. `buttons` is how many of the two are offered.
 */
export function followUpLine(pictures: number, service: string, buttons: number): string {
  return `${buttons > 1 ? 'Either button sends' : 'This sends'} ${picturesOf(pictures)} again, from this browser straight to ${service}, with your key.`;
}
/**
 * Why a reading is no longer sent back nor read again: the pictures shown are not the ones it was made from, and a
 * follow-up would send those (pictures removed since, or without the ones added since).
 */
export function changedLine(service: string): string {
  return `The pictures shown have changed since this reading, so it is no longer sent back or read again: that would send the pictures it was made from, not the ones shown now. Press Read with ${service} to read the pictures shown now.`;
}

/**
 * Whether the problems of a checked answer go back to the AI, exactly as the panel offers to copy them: the problems of
 * a text it cannot read, or the warnings of one it can. A pasting slip alone is the owner's and is never sent.
 */
/** Whether the problems of one reading may go back once more: at most MAX_ROUNDS times. */
export const canSendBack = (rounds: number) => rounds < MAX_ROUNDS;
/** The button that sends them, counting the round it would be. */
export const sendBackLabel = (rounds: number) => `Send these problems back (round ${rounds + 1} of ${MAX_ROUNDS})`;
/** Said once the problems of a reading were sent back as often as one reading allows. */
export const roundsSpentLine = () =>
  `The problems were sent back ${MAX_ROUNDS} times, the most for one reading. Copy them for a chat of your own, or read the pages again.`;

/** Why a file is left out over the page limit; `before` is how many pages were chosen before it. */
export function tooManyPages(name: string, pages: number, before: number): string {
  const has = `“${name}” has ${pages === 1 ? '1 page' : `${pages} pages`}`,
    most = `the most one reading takes, so it was left out.`;
  return before
    ? `${has}: with the ${before === 1 ? 'page' : `${before} pages`} chosen before it, that is more than ${MAX_PAGES}, ${most}`
    : `${has}, more than ${MAX_PAGES}, ${most}`;
}

export function problemsFor(checked: Checked, reading: Reading): string | undefined {
  const send =
    reading === 'first'
      ? checked.ok
        ? checked.warnings.length > 0
        : checked.errors.length > 0
      : !checked.ok && checked.errors.length > 0;
  return send ? problemsMessage(checked) : undefined;
}

/**
 * The longest answer, in tokens, that the default model may write at its own service (checked 2026-11-23). Without it
 * the service stops at 64K tokens with thinking on, which a long piece and its thinking may need more than. Other
 * models get their service's own default: their limits are not known here, and too high a number is refused.
 */
export const MAX_TOKENS: Record<string, { service: string; checked: string; tokens: number }> = {
  [DEFAULT_MODEL]: { service: originOf(DEEPSEEK_ENDPOINT), checked: '2026-11-23', tokens: 384_000 },
};
export function maxTokens(model: string, endpoint: string): number | undefined {
  const limit = MAX_TOKENS[model];
  return limit && limit.service === originOf(endpoint) ? limit.tokens : undefined;
}

/** The JSON body: a streamed chat completion that reports its token use at the end. The key is not in it. */
export const requestBody = (model: string, messages: Message[], maxTokens?: number) =>
  JSON.stringify({
    model,
    messages,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    stream: true,
    stream_options: { include_usage: true },
  });

/** The fetch call. The key goes in the Authorization header only; no cookies, no referrer, and no redirects. */
export function requestFor(settings: ReaderSettings, body: string, signal?: AbortSignal): [string, RequestInit] {
  return [
    settings.endpoint.trim(),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key.trim()}`, 'Content-Type': 'application/json' },
      body,
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      // Following a redirect could carry the request somewhere the owner did not name.
      redirect: 'error',
    },
  ];
}

// The streamed answer.

export interface Usage {
  prompt: number;
  completion: number;
}
export interface StreamState {
  /** Text not yet split into lines (a line can arrive in two chunks). */
  buffer: string;
  /** A data line that did not parse alone, waiting for the rest of its event. */
  pending: string;
  answer: string;
  /** Characters of thinking (reasoning) the service streamed; it is counted, never kept. */
  thinking: number;
  finish?: string;
  usage?: Usage;
  /** The `[DONE]` line arrived. */
  done: boolean;
  /** The stream carried an error object instead of an answer. */
  failed: boolean;
}
export const newStream = (): StreamState => ({
  buffer: '',
  pending: '',
  answer: '',
  thinking: 0,
  done: false,
  failed: false,
});

interface Chunk {
  choices?: {
    delta?: { content?: unknown; reasoning_content?: unknown };
    message?: { content?: unknown };
    finish_reason?: unknown;
  }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
  error?: unknown;
}
/** One parsed event (a streamed chunk, or a whole non-streamed answer) into the state. */
function take(state: StreamState, chunk: Chunk): void {
  if (chunk.error) state.failed = true;
  for (const choice of chunk.choices ?? []) {
    const content = choice.delta?.content ?? choice.message?.content,
      thinking = choice.delta?.reasoning_content;
    if (typeof content === 'string') state.answer += content;
    if (typeof thinking === 'string') state.thinking += thinking.length;
    if (typeof choice.finish_reason === 'string') state.finish = choice.finish_reason;
  }
  const u = chunk.usage;
  if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number')
    state.usage = { prompt: u.prompt_tokens, completion: u.completion_tokens };
}
function line(state: StreamState, raw: string): void {
  const text = raw.replace(/\r$/, '');
  if (!text) {
    // The end of an event: a data line still waiting can only be broken.
    state.pending = '';
    return;
  }
  if (!text.startsWith('data:')) return; // comments (": keep-alive"), event names, ids
  const data = text.slice(5).replace(/^ /, '');
  if (data.trim() === '[DONE]') {
    state.done = true;
    return;
  }
  const joined = state.pending ? `${state.pending}\n${data}` : data;
  try {
    take(state, JSON.parse(joined) as Chunk);
    state.pending = '';
  } catch {
    state.pending = joined;
  }
}
/** Feed the next piece of the stream, as text. Lines split across pieces are joined. */
export function feedStream(state: StreamState, text: string): StreamState {
  const lines = (state.buffer + text).split('\n');
  state.buffer = lines.pop() ?? '';
  for (const l of lines) line(state, l);
  return state;
}
/** The stream ended: read what is left. */
export function endStream(state: StreamState): StreamState {
  if (state.buffer) line(state, state.buffer);
  state.buffer = '';
  return state;
}
/**
 * The answer without a model's thinking: a model on the owner's own machine may send it inside the answer, between
 * `<think>` and `</think>`. Only a complete block of that kind at the very start is dropped (with the blank space after
 * it); such tags anywhere else are left as they are.
 */
export function withoutThinking(answer: string): string {
  const block = /^\s*<think>[\s\S]*?<\/think>\s*/.exec(answer);
  return block ? answer.slice(block[0].length) : answer;
}
/** A service that ignored `stream` and sent one JSON answer. */
export function wholeAnswer(state: StreamState, text: string): StreamState {
  try {
    take(state, JSON.parse(text) as Chunk);
    state.done = true;
  } catch {
    state.failed = true;
  }
  return state;
}

// What went wrong, in the owner's words. None of these sentences can hold the key: they are never given it.

export type Failure =
  | { kind: 'no-key' }
  /** The key holds a character no key has (outside printable ASCII, or a space inside it). */
  | { kind: 'key-character' }
  /** At DeepSeek's own address, a key that does not start with "sk-" (a password, say). */
  | { kind: 'not-deepseek-key' }
  | { kind: 'endpoint'; problem: string }
  | { kind: 'no-pictures' }
  /**
   * Files were chosen, but nothing from them can be sent, for whatever reason (a page looks empty, a file could not be
   * read or was left out over the page limit, its pictures were removed): the note beside each file says which.
   */
  | { kind: 'nothing-to-send' }
  | { kind: 'too-many'; images: number }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'status'; status: number }
  | { kind: 'network' }
  | { kind: 'cancelled' }
  | { kind: 'length' }
  | { kind: 'stopped'; reason: string }
  | { kind: 'ended' }
  | { kind: 'refused' }
  | { kind: 'empty' };

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/**
 * A reading cannot be done in parts here (each answer replaces the one in the box and starts the piece from its
 * header), so a piece too long for one request goes the other way: by hand, in a chat that takes it in parts.
 */
const BY_HAND = 'use Copy instructions for your AI with an AI chat instead, where a long piece can come in parts';
export function failureSentence(f: Failure, service: string): string {
  switch (f.kind) {
    case 'no-key':
      return `Paste your key for ${service} first. You make one on the service’s own website (for DeepSeek: platform.deepseek.com, API keys).`;
    case 'key-character':
      return 'The key holds a character that cannot be part of a key, often an invisible one that came along when copying, so nothing was sent. Paste the key again.';
    case 'not-deepseek-key':
      return 'DeepSeek keys start with “sk-”, and this does not look like one, so nothing was sent. Paste your key from platform.deepseek.com (API keys).';
    case 'endpoint':
      return `${f.problem} Change it under Advanced.`;
    case 'no-pictures':
      return 'Choose the pages first: a PDF, or photos or scans of the pages.';
    case 'nothing-to-send':
      return 'Nothing from the files you chose can be sent: the note beside each file says why. Choose pages that can be sent, then press Read again.';
    case 'too-many':
      return `That is ${f.images} pictures, more than the ${MAX_IMAGES} one request may hold. Remove the pictures you do not need, or ${BY_HAND}.`;
    case 'too-large':
      return `The pictures add up to ${mib(f.bytes)}, more than the ${mib(MAX_BODY)} one request may hold. Remove the pictures you do not need, or ${BY_HAND}.`;
    case 'status':
      if (f.status === 400)
        return `${service} did not accept the request (error 400). Most often the model cannot take pictures: under Advanced, choose one that can (${DEFAULT_MODEL} can).`;
      if (f.status === 401)
        return `${service} refused the key (error 401). Check that you pasted the whole key, or make a new one on the service’s website and paste that.`;
      if (f.status === 402)
        return `${service} says your account has no balance left (error 402). Add credit on the service’s website, then try again.`;
      if (f.status === 429)
        return `${service} says there are too many requests just now (error 429). Wait a minute, then try again.`;
      if (f.status >= 500)
        return `${service} had a problem on its side (error ${f.status}). Try again in a few minutes.`;
      if (f.status === 404)
        return `${service} has nothing at this address (error 404). Check the address under Advanced.`;
      return `${service} refused the request (error ${f.status}). Check the address and the model under Advanced.`;
    case 'network':
      return `The request could not be sent to ${service}: this device may be offline, or the browser blocked it. Check the connection and the address under Advanced, then try again.`;
    case 'cancelled':
      return 'Cancelled: nothing more will arrive from this request, and nothing was put in the box. To try again, press the same button again; the service may still charge for what it had already read.';
    case 'length':
      return `The answer was cut off before it finished, so it is not complete and was not put in the box. Try again; if it is cut off again, choose a model that writes longer answers under Advanced, or ${BY_HAND}.`;
    case 'stopped':
      return `The service stopped the answer before it finished (it said “${f.reason.slice(0, 40)}”), so it was not put in the box. Try again.`;
    case 'ended':
      return 'The answer stopped arriving before it finished (the connection ended early), so it was not put in the box. Try again.';
    case 'refused':
      return `${service} sent an error instead of an answer. Try again; if it keeps happening, check the model under Advanced.`;
    case 'empty':
      return `${service} sent back no text. Try again.`;
  }
}

export type ChatResult = { ok: true; text: string; usage?: Usage } | { ok: false; failure: Failure; usage?: Usage };

/** What one request has received so far, for the progress line. */
export interface Progress {
  answer: number;
  thinking: number;
}

/** What a key may hold, once trimmed: printable ASCII, and no space. */
const KEY_CHARACTERS = /^[\x21-\x7e]+$/;

/** Problems that stop a request before anything is sent. */
export function beforeSending(settings: ReaderSettings, images: number, body?: string): Failure | undefined {
  const problem = endpointProblem(settings.endpoint);
  if (problem) return { kind: 'endpoint', problem };
  const key = settings.key.trim();
  if (!key) return { kind: 'no-key' };
  if (!KEY_CHARACTERS.test(key)) return { kind: 'key-character' };
  // At DeepSeek's own address only: what does not look like one of its keys (a password a manager filled in, say) stays.
  if (originOf(settings.endpoint) === originOf(DEEPSEEK_ENDPOINT) && !key.startsWith('sk-'))
    return { kind: 'not-deepseek-key' };
  if (!images) return { kind: 'no-pictures' };
  if (images > MAX_IMAGES) return { kind: 'too-many', images };
  const bytes = body === undefined ? 0 : new TextEncoder().encode(body).length;
  if (bytes > MAX_BODY) return { kind: 'too-large', bytes };
  return undefined;
}

/**
 * Send one request and read its streamed answer. Cancelling the signal aborts the request itself. The result is the
 * whole answer, or the reason there is none; an answer that was cut off is never returned as one.
 */
export async function streamChat(
  settings: ReaderSettings,
  messages: Message[],
  options: { signal: AbortSignal; fetch: typeof fetch; onProgress?: (p: Progress) => void; images: number },
): Promise<ChatResult> {
  const body = requestBody(settings.model, messages, maxTokens(settings.model, settings.endpoint));
  const stop = beforeSending(settings, options.images, body);
  if (stop) return { ok: false, failure: stop };
  const state = newStream();
  const cancelled = (): ChatResult => ({ ok: false, failure: { kind: 'cancelled' }, usage: state.usage });
  let response: Response;
  try {
    response = await options.fetch(...requestFor(settings, body, options.signal));
  } catch {
    return options.signal.aborted ? cancelled() : { ok: false, failure: { kind: 'network' } };
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return { ok: false, failure: { kind: 'status', status: response.status } };
  }
  try {
    if (!response.body || /application\/json/i.test(response.headers.get('content-type') ?? '')) {
      wholeAnswer(state, await response.text());
    } else {
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feedStream(state, value);
        options.onProgress?.({ answer: state.answer.length, thinking: state.thinking });
      }
      endStream(state);
    }
  } catch {
    if (options.signal.aborted) return cancelled();
    // An answer the service had already finished properly is whole, though the connection broke before the end marker:
    // the owner has paid for it. Anything else that breaks off is not.
    if (state.finish !== 'stop') return { ok: false, failure: { kind: 'ended' }, usage: state.usage };
    endStream(state);
  }
  if (options.signal.aborted) return cancelled();
  const usage = state.usage;
  if (state.failed) return { ok: false, failure: { kind: 'refused' }, usage };
  if (state.finish === 'length') return { ok: false, failure: { kind: 'length' }, usage };
  if (state.finish && state.finish !== 'stop')
    return { ok: false, failure: { kind: 'stopped', reason: state.finish }, usage };
  if (!state.finish && !state.done) return { ok: false, failure: { kind: 'ended' }, usage };
  const text = withoutThinking(state.answer);
  if (!text.trim()) return { ok: false, failure: { kind: 'empty' }, usage };
  return { ok: true, text, usage };
}

// Tokens and an estimated cost.

/**
 * Prices per million tokens, as the service published them on the day they were checked. Peak and off-peak hours are
 * the service's own; the estimate gives both ends.
 */
export const PRICES: Record<
  string,
  { service: string; checked: string; input: [number, number]; output: [number, number] }
> = {
  [DEFAULT_MODEL]: {
    service: originOf(DEEPSEEK_ENDPOINT),
    checked: '2026-11-23',
    input: [0.15, 0.3],
    output: [0.6, 1.2],
  },
};

/** The cost range of one request in US dollars (off-peak, peak), only for a model in the table at its own service. */
export function estimateCost(
  model: string,
  endpoint: string,
  usage: Usage,
): { low: number; high: number; checked: string } | undefined {
  const price = PRICES[model];
  if (!price || price.service !== originOf(endpoint)) return undefined;
  const at = (i: 0 | 1) => (usage.prompt * price.input[i] + usage.completion * price.output[i]) / 1e6;
  return { low: at(0), high: at(1), checked: price.checked };
}

const count = (n: number) => n.toLocaleString('en-US');
export const dollars = (x: number) => `$${x < 0.01 ? x.toFixed(4) : x < 1 ? x.toFixed(3) : x.toFixed(2)}`;

/** The tokens one request used and, for the default model at its own service, what it probably cost. */
export function usageLine(model: string, endpoint: string, usage: Usage | undefined): string {
  if (!usage) return 'The service did not say how many tokens this used.';
  const tokens = `${count(usage.prompt)} tokens in and ${count(usage.completion)} out (thinking included).`;
  const cost = estimateCost(model, endpoint, usage);
  return cost
    ? `${tokens} Estimated cost: ${dollars(cost.low)} at the off-peak price to ${dollars(cost.high)} at the peak price, from the prices as checked on ${cost.checked}. Check the service’s own pricing page for today’s.`
    : tokens;
}

/** The progress line while a request runs. */
export function progressLine(p: Progress, service: string): string {
  if (!p.answer && !p.thinking) return `Sent. Waiting for ${service} to answer…`;
  const thinking = p.thinking ? `${count(p.thinking)} characters of thinking` : '',
    answer = p.answer ? `${count(p.answer)} characters of the answer` : '';
  return `Reading… ${service} has sent ${[thinking, answer].filter(Boolean).join(' and ')} so far.`;
}
