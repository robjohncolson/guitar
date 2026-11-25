import { describe, expect, it } from 'vitest';
import {
  beforeSending,
  changedLine,
  closingLine,
  DEEPSEEK_ENDPOINT,
  DEFAULT_MODEL,
  DEFAULTS,
  dollars,
  endpointProblem,
  endStream,
  estimateCost,
  failureSentence,
  feedStream,
  firstMessage,
  followUp,
  followUpLine,
  loadSettings,
  MAX_BODY,
  MAX_IMAGES,
  MAX_TOKENS,
  maxTokens,
  newStream,
  parseSettings,
  PRICES,
  problemsFor,
  progressLine,
  READER_KEY,
  requestBody,
  requestFor,
  saveSettings,
  serviceName,
  streamChat,
  usageLine,
  withEndpoint,
  withoutThinking,
  canSendBack,
  sendBackLabel,
  roundsSpentLine,
  tooManyPages,
  MAX_PAGES,
  MAX_ROUNDS,
  type Failure,
  type Message,
  type ReaderSettings,
} from '../src/piece/reader';
import { exampleTune, importGuide } from '../src/piece/import-guide';
import { checkAnswer, problemsMessage } from '../src/piece/import';
import { PIECES_KEY, PROGRESS_KEYS } from '../src/account/config';
import { PROGRESS_KEYS as SERVER_KEYS } from '../server/core';
import { readerMarkup } from '../src/piece/reader-view';

// The reader sends the owner's pictures with his own key. These tests pin what leaves the browser and what he is told.
const KEY = 'sk-test-0123456789abcdef';
const settings: ReaderSettings = { endpoint: DEEPSEEK_ENDPOINT, model: DEFAULT_MODEL, key: KEY };
const images = ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB', 'data:image/jpeg;base64,CCCC'];
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
const delta = (content: string, extra: object = {}) => ({ choices: [{ index: 0, delta: { content }, ...extra }] });

describe('the request', () => {
  const closing = closingLine(3, 2);
  const message = firstMessage('first', images, closing);
  const body = requestBody(DEFAULT_MODEL, [message]);
  const parsed = JSON.parse(body);

  it('holds the instructions the Copy button gives, the pictures in order as data URLs, and the closing line', () => {
    const parts = parsed.messages[0].content;
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].role).toBe('user');
    expect(parts[0]).toEqual({ type: 'text', text: importGuide('first') });
    expect(parts.slice(1, -1)).toEqual(images.map((url) => ({ type: 'image_url', image_url: { url } })));
    expect(parts[parts.length - 1]).toEqual({ type: 'text', text: closing });
    expect(parsed).toMatchObject({ model: DEFAULT_MODEL, stream: true, stream_options: { include_usage: true } });
    // A second reading uses the guide's own second-reading text.
    expect((firstMessage('second', images, closing).content as { text?: string }[])[0].text).toBe(
      importGuide('second'),
    );
  });

  it('carries the key only in the Authorization header, never in the body or the address', () => {
    const [url, init] = requestFor(settings, body);
    expect(url).toBe(DEEPSEEK_ENDPOINT);
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(body).not.toContain(KEY);
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
  });

  it('says what the pictures are, true however the pages were cut, and asks for the whole piece in this one answer', () => {
    // The cutting is best effort: a picture may hold one line of music or several, a strip may begin or end partway
    // through a line (a page that went as overlapping strips), strips of one page may overlap, and a single picture
    // may be a whole page. The line says so for every cut, and promises nothing more (no "one system per picture",
    // no "usually").
    expect(closingLine(3, 1)).toBe(
      'Those are all 3 pictures, from 1 page. They are strips of the page in reading order, from top to bottom. A strip may hold one line of music or several, and may begin or end partway through a line. Strips of the same page may overlap, so the same bars can appear in two pictures: write each bar once. Your answer goes straight to the app, which reads all of it, so send the whole piece now in this one answer: for a long piece, every part as its own code block, one after another. Do not stop to wait for me to ask for the next part.',
    );
    expect(closing).toMatch(
      /^Those are all 3 pictures, from 2 pages\. They are strips of the pages in reading order: page by page, each from top to bottom\. A strip may hold one line of music or several, and may begin or end partway through a line\. Strips of the same page may overlap, so the same bars can appear in two pictures: write each bar once\. /,
    );
    const one = closingLine(1, 1);
    expect(one).toBe(
      'That is the only picture, from 1 page. It may show the whole page or a strip of it: one line of music or several, and a strip may begin or end partway through a line. Write each bar once. Your answer goes straight to the app, which reads all of it, so send the whole piece now in this one answer: for a long piece, every part as its own code block, one after another. Do not stop to wait for me to ask for the next part.',
    );
    expect(one).not.toMatch(/overlap|It is a strip/);
    for (const line of [one, closing, closingLine(40, 12)]) {
      expect(line).toMatch(/send the whole piece now in this one answer/);
      expect(line).toMatch(/one line of music or several/);
      expect(line).toMatch(/begin or end partway through a line/);
      expect(line).not.toMatch(/system|cleanly|band|usually/);
    }
  });

  it('continues the same conversation with the panel’s own problems message, and only where the panel offers it', () => {
    const broken = checkAnswer(exampleTune('printed').replace('rh: c5:1', 'rh: c5:2'));
    const problems = problemsFor(broken, 'first')!;
    expect(problems).toBe(problemsMessage(broken));
    const next = followUp([message], 'the answer', problems);
    expect(next).toEqual([message, { role: 'assistant', content: 'the answer' }, { role: 'user', content: problems }]);
    // A clean reading has nothing to send; a pasting slip (a later part alone) is the owner's and is never sent.
    expect(problemsFor(checkAnswer(exampleTune('printed')), 'first')).toBeUndefined();
    const part = checkAnswer(exampleTune('printed').slice(exampleTune('printed').indexOf('== 3')));
    expect(part.paste).toBeTruthy();
    expect(problemsFor(part, 'first')).toBeUndefined();
    // Warnings go back for the first reading (the panel offers to copy them), not for the second.
    const warned = checkAnswer(exampleTune('printed').replace('harmony: G7', 'harmony: G13'));
    expect(warned.ok && warned.warnings.length).toBeTruthy();
    expect(problemsFor(warned, 'first')).toBe(problemsMessage(warned));
    expect(problemsFor(warned, 'second')).toBeUndefined();
    expect(problemsFor(broken, 'second')).toBe(problemsMessage(broken));
  });

  it('lets the default model at its own service write its longest answer, and other models their own default', async () => {
    expect(MAX_TOKENS[DEFAULT_MODEL]).toEqual({
      service: 'https://api.deepseek.com',
      checked: '2026-11-23',
      tokens: 384_000,
    });
    expect(maxTokens(DEFAULT_MODEL, DEEPSEEK_ENDPOINT)).toBe(384_000);
    expect(maxTokens('deepseek-v4-pro', DEEPSEEK_ENDPOINT)).toBeUndefined();
    expect(maxTokens(DEFAULT_MODEL, 'http://localhost:8080/v1/chat/completions')).toBeUndefined();
    expect(JSON.parse(requestBody('m', [message])).max_tokens).toBeUndefined();
    const bodies: string[] = [];
    const record: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(sse(delta('ok', { finish_reason: 'stop' })), {
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    for (const s of [
      settings,
      { ...settings, endpoint: 'http://127.0.0.1:9/v1/chat/completions' },
      { ...settings, model: 'my-model' },
    ])
      await streamChat(s, [message], { signal: new AbortController().signal, fetch: record, images: images.length });
    expect(bodies.map((b) => JSON.parse(b).max_tokens)).toEqual([384_000, undefined, undefined]);
    expect(bodies.every((b) => !b.includes(KEY))).toBe(true);
  });

  it('stops before sending when something is missing or too large', () => {
    expect(beforeSending({ ...settings, key: '' }, 3)).toEqual({ kind: 'no-key' });
    expect(beforeSending(settings, 0)).toEqual({ kind: 'no-pictures' });
    expect(beforeSending(settings, MAX_IMAGES + 1)).toEqual({ kind: 'too-many', images: MAX_IMAGES + 1 });
    expect(beforeSending({ ...settings, endpoint: 'http://example.com/v1' }, 3)?.kind).toBe('endpoint');
    expect(beforeSending(settings, 3, 'x'.repeat(MAX_BODY + 1))).toEqual({ kind: 'too-large', bytes: MAX_BODY + 1 });
    expect(beforeSending(settings, 3, body)).toBeUndefined();
  });

  it('sends no key that holds a character no key has, and says so instead of blaming the connection', async () => {
    // An invisible character copied along (a zero-width space, a non-breaking space inside), a letter outside ASCII,
    // a space inside the key, a line break: nothing is sent.
    for (const key of [`sk-abc​def`, `sk-abc def`, 'sk-abcé', 'sk-abc def', 'sk-abc\ndef', 'sk-\u0000x'])
      expect(beforeSending({ ...settings, key }, 3), JSON.stringify(key)).toEqual({ kind: 'key-character' });
    // Blank space around it is trimmed off, and the trimmed key is what goes in the header.
    expect(beforeSending({ ...settings, key: `  ${KEY}\n` }, 3)).toBeUndefined();
    expect(
      (requestFor({ ...settings, key: `  ${KEY}\n` }, body)[1].headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${KEY}`);
    const calls: string[] = [];
    const record: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(sse(delta('ok', { finish_reason: 'stop' })), {
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const signal = new AbortController().signal;
    expect(
      await streamChat({ ...settings, key: `sk-abc​def` }, [message], { signal, fetch: record, images: 3 }),
    ).toEqual({ ok: false, failure: { kind: 'key-character' } });
    expect(calls).toHaveLength(0);
    expect(failureSentence({ kind: 'key-character' }, 'DeepSeek')).toBe(
      'The key holds a character that cannot be part of a key, often an invisible one that came along when copying, so nothing was sent. Paste the key again.',
    );
  });

  it('at DeepSeek’s own address, sends no key that does not start with “sk-” (a password, say); elsewhere any key', async () => {
    for (const key of ['hunter2', 'my-account-password', 'SK-123', 'ssk-123'])
      expect(beforeSending({ ...settings, key }, 3), key).toEqual({ kind: 'not-deepseek-key' });
    expect(
      beforeSending({ ...settings, endpoint: 'https://api.deepseek.com/v1/chat/completions', key: 'hunter2' }, 3),
    ).toEqual({ kind: 'not-deepseek-key' });
    expect(beforeSending({ ...settings, key: 'sk-anything' }, 3)).toBeUndefined();
    for (const endpoint of ['http://127.0.0.1:8080/v1/chat/completions', 'https://deepseek.example.com/chat'])
      expect(beforeSending({ ...settings, endpoint, key: 'hunter2' }, 3), endpoint).toBeUndefined();
    const calls: string[] = [];
    const record: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response('{}', { status: 401 });
    };
    expect(
      await streamChat({ ...settings, key: 'hunter2' }, [message], {
        signal: new AbortController().signal,
        fetch: record,
        images: 3,
      }),
    ).toEqual({ ok: false, failure: { kind: 'not-deepseek-key' } });
    expect(calls).toHaveLength(0);
    expect(failureSentence({ kind: 'not-deepseek-key' }, 'DeepSeek')).toBe(
      'DeepSeek keys start with “sk-”, and this does not look like one, so nothing was sent. Paste your key from platform.deepseek.com (API keys).',
    );
  });
});

describe('the streamed answer', () => {
  it('joins lines split across chunks, adds up the answer and the thinking, and reads the usage', () => {
    const text = sse(
      { choices: [{ delta: { reasoning_content: 'Let me look' } }] },
      delta('```text\n'),
      delta('title: A'),
      delta('\n```', { finish_reason: 'stop' }),
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 340 } },
    );
    for (const size of [1, 3, 7, 64, text.length]) {
      const s = newStream();
      for (let i = 0; i < text.length; i += size) feedStream(s, text.slice(i, i + size));
      endStream(s);
      expect(s.answer).toBe('```text\ntitle: A\n```');
      expect(s.thinking).toBe('Let me look'.length);
      expect(s.finish).toBe('stop');
      expect(s.usage).toEqual({ prompt: 1200, completion: 340 });
      expect(s.done).toBe(true);
    }
  });

  it('ignores comments and blank lines, reads CRLF, and a last line without a line break', () => {
    const s = newStream();
    feedStream(s, ': keep-alive\r\n\r\n');
    feedStream(s, `data: ${JSON.stringify(delta('a'))}\r\n\r\n`);
    feedStream(s, `data:${JSON.stringify(delta('b', { finish_reason: 'length' }))}`);
    endStream(s);
    expect(s.answer).toBe('ab');
    expect(s.finish).toBe('length');
    expect(s.done).toBe(false);
  });

  const respond =
    (body: string, init: ResponseInit = {}) =>
    async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' }, ...init });
  const chat = (fetch: typeof globalThis.fetch, signal = new AbortController().signal) =>
    streamChat(settings, [firstMessage('first', images, 'end')], { signal, fetch, images: images.length });

  it('returns the whole answer and the usage', async () => {
    const r = await chat(
      respond(
        sse(delta('hello '), delta('there', { finish_reason: 'stop' }), {
          choices: [],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      ),
    );
    expect(r).toEqual({ ok: true, text: 'hello there', usage: { prompt: 5, completion: 2 } });
  });

  it('never returns a cut-off answer as one', async () => {
    const r = await chat(respond(sse(delta('half a piece', { finish_reason: 'length' }))));
    expect(r).toMatchObject({ ok: false, failure: { kind: 'length' } });
    expect(await chat(respond(`data: ${JSON.stringify(delta('half'))}\n\n`))).toMatchObject({
      ok: false,
      failure: { kind: 'ended' },
    });
    expect(await chat(respond(sse(delta('', { finish_reason: 'stop' }))))).toMatchObject({
      ok: false,
      failure: { kind: 'empty' },
    });
    expect(await chat(respond(sse({ error: { message: 'bad' } })))).toMatchObject({
      ok: false,
      failure: { kind: 'refused' },
    });
    expect(await chat(respond(sse(delta('x', { finish_reason: 'content_filter' }))))).toMatchObject({
      ok: false,
      failure: { kind: 'stopped', reason: 'content_filter' },
    });
  });

  it('reads a service that answers with one JSON object instead of a stream, and its finish reason', async () => {
    const whole = (finish: string) => ({
      choices: [{ message: { content: 'all of it' }, finish_reason: finish }],
      usage: { prompt_tokens: 9, completion_tokens: 3 },
    });
    const json = (o: object) => async () =>
      new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    expect(await chat(json(whole('stop')))).toEqual({
      ok: true,
      text: 'all of it',
      usage: { prompt: 9, completion: 3 },
    });
    // A whole answer cut off at the length limit is not complete, nor one the service stopped for its own reasons.
    expect(await chat(json(whole('length')))).toEqual({
      ok: false,
      failure: { kind: 'length' },
      usage: { prompt: 9, completion: 3 },
    });
    expect(await chat(json(whole('content_filter')))).toMatchObject({
      ok: false,
      failure: { kind: 'stopped', reason: 'content_filter' },
    });
    expect(await chat(json({ error: { message: 'no' } }))).toMatchObject({ ok: false, failure: { kind: 'refused' } });
  });

  it('takes no answer as whole when an error arrives after part of it', async () => {
    for (const tail of [{ error: { message: 'overloaded' } }, { error: 'overloaded' }])
      expect(
        await chat(
          respond(sse(delta('```text\ntitle: A\n'), delta('== 1\n'), tail, delta('', { finish_reason: 'stop' }))),
        ),
        JSON.stringify(tail),
      ).toMatchObject({ ok: false, failure: { kind: 'refused' } });
  });

  /** A response whose stream sends `text`, then breaks (the connection drops) instead of ending. */
  const breaking = (text: string) => async () => {
    let sent = false;
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(new TextEncoder().encode(text));
              return;
            }
            // The break comes after the text has been read (an error discards what is still queued).
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                c.error(new TypeError('network error'));
                resolve();
              }, 5),
            );
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };

  it('keeps an answer that had finished properly when the connection breaks before the end marker', async () => {
    const finished = [delta('all of '), delta('it', { finish_reason: 'stop' })]
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join('');
    expect(await chat(breaking(finished))).toEqual({ ok: true, text: 'all of it', usage: undefined });
    // With its usage too, when that came before the break.
    const used = `${finished}data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } })}\n\n`;
    expect(await chat(breaking(used))).toEqual({ ok: true, text: 'all of it', usage: { prompt: 7, completion: 2 } });
    // Not finished, or finished for another reason: not whole.
    expect(await chat(breaking(`data: ${JSON.stringify(delta('half'))}\n\n`))).toMatchObject({
      ok: false,
      failure: { kind: 'ended' },
    });
    expect(
      await chat(breaking(`data: ${JSON.stringify(delta('half', { finish_reason: 'length' }))}\n\n`)),
    ).toMatchObject({ ok: false, failure: { kind: 'ended' } });
  });

  it('drops a model’s thinking block at the very start of the answer, and only there', async () => {
    const piece = '```text\ntitle: A\n```';
    expect(withoutThinking(`<think>\nThe first bar is C.\n</think>\n\n${piece}`)).toBe(piece);
    expect(withoutThinking(`  \n<think>a</think>${piece}`)).toBe(piece);
    // Drafts inside the thinking go with it.
    expect(withoutThinking(`<think>\nDraft:\n${piece.replace('A', 'B')}\n</think>\nHere:\n${piece}`)).toBe(
      `Here:\n${piece}`,
    );
    // Not at the start, not complete, or not that tag: left as it is.
    for (const text of [
      `Here:\n<think>x</think>\n${piece}`,
      `<think>still thinking ${piece}`,
      `<thinking>x</thinking>${piece}`,
      `${piece}\n<think>x</think>`,
    ])
      expect(withoutThinking(text)).toBe(text);
    // The answer that reaches the box has no thinking block, and one that is only thinking is no answer.
    const think = (content: string) => respond(sse(delta(content, { finish_reason: 'stop' })));
    expect(await chat(think(`<think>hmm</think>\n${piece}`))).toMatchObject({ ok: true, text: piece });
    expect(await chat(think('<think>hmm</think>\n'))).toMatchObject({ ok: false, failure: { kind: 'empty' } });
  });

  it('maps a refused request, a failed connection and a cancel', async () => {
    for (const status of [400, 401, 402, 404, 429, 500, 503])
      expect(await chat(respond('{"error":{"message":"no"}}', { status }))).toEqual({
        ok: false,
        failure: { kind: 'status', status },
      });
    expect(await chat(async () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({
      ok: false,
      failure: { kind: 'network' },
    });
    // Cancel while the answer streams: the request's own signal is aborted, and the stream stops.
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const r = await chat(async (_url, init) => {
      seen = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta('part'))}\n\n`));
          init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
          queueMicrotask(() => controller.abort());
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }, controller.signal);
    expect(seen).toBe(controller.signal);
    expect(r).toMatchObject({ ok: false, failure: { kind: 'cancelled' } });
  });

  it('sends nothing without a key, and the key never reaches a URL or a body it sends', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const record: typeof fetch = async (url, init) => {
      calls.push([String(url), init]);
      return new Response(sse(delta('ok', { finish_reason: 'stop' })), {
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    expect(
      await streamChat({ ...settings, key: '' }, [], {
        signal: new AbortController().signal,
        fetch: record,
        images: 1,
      }),
    ).toEqual({ ok: false, failure: { kind: 'no-key' } });
    expect(calls).toHaveLength(0);
    await chat(record);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(DEEPSEEK_ENDPOINT);
    expect(String(calls[0][1]?.body)).not.toContain(KEY);
    expect((calls[0][1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });
});

describe('what the owner is told', () => {
  const failures: Failure[] = [
    { kind: 'no-key' },
    { kind: 'key-character' },
    { kind: 'not-deepseek-key' },
    { kind: 'endpoint', problem: endpointProblem('ftp://x')! },
    { kind: 'no-pictures' },
    { kind: 'nothing-to-send' },
    { kind: 'too-many', images: 700 },
    { kind: 'too-large', bytes: 60 * 1024 * 1024 },
    ...[400, 401, 402, 403, 404, 429, 500, 502].map((status): Failure => ({ kind: 'status', status })),
    { kind: 'network' },
    { kind: 'cancelled' },
    { kind: 'length' },
    { kind: 'stopped', reason: 'content_filter' },
    { kind: 'ended' },
    { kind: 'refused' },
    { kind: 'empty' },
  ];

  it('one or two plain sentences for every failure, each saying what to do, none showing the key', () => {
    for (const f of failures) {
      const s = failureSentence(f, 'DeepSeek');
      expect(s.split(/(?<=[.!?])\s+(?=[A-Z])/).length, s).toBeLessThanOrEqual(2);
      expect(s).not.toContain(KEY);
      expect(s).not.toMatch(/undefined|null|\[object/);
      expect(s).not.toMatch(/\bHTTP\b|JSON|CORS|[Ff]etch|[Ss]tream|[Tt]oken/);
    }
    const said = (f: Failure) => failureSentence(f, 'DeepSeek');
    expect(said({ kind: 'status', status: 401 })).toMatch(/refused the key/);
    expect(said({ kind: 'status', status: 402 })).toMatch(/no balance/);
    expect(said({ kind: 'status', status: 429 })).toMatch(/too many requests/);
    expect(said({ kind: 'status', status: 503 })).toMatch(/problem on its side/);
    expect(said({ kind: 'status', status: 400 })).toMatch(/cannot take pictures/);
    expect(said({ kind: 'network' })).toMatch(/offline, or the browser blocked it/);
    expect(said({ kind: 'length' })).toMatch(/cut off before it finished.*not complete/);
    expect(said({ kind: 'cancelled' })).toMatch(/^Cancelled/);
    // Cancelled says what to do next, too.
    expect(said({ kind: 'cancelled' })).toMatch(/To try again, press the same button again/);
    expect(said({ kind: 'no-key' })).toMatch(/Paste your key/);
    // Files were chosen, but nothing from them can be sent: not "choose the pages first". The reason may be any (a page
    // looks empty, a file could not be read or was left out over the page limit, its pictures were removed), so the
    // sentence names none of them and points to the note beside each file, which does.
    expect(said({ kind: 'nothing-to-send' })).toBe(
      'Nothing from the files you chose can be sent: the note beside each file says why. Choose pages that can be sent, then press Read again.',
    );
    expect(said({ kind: 'nothing-to-send' })).not.toMatch(/first|empty|could not be read|removed|limit/);
  });

  it('says why a file goes over the page limit, also when nothing was chosen before it', () => {
    expect(tooManyPages('x.pdf', 41, 0)).toBe(
      `“x.pdf” has 41 pages, more than ${MAX_PAGES}, the most one reading takes, so it was left out.`,
    );
    expect(tooManyPages('x.pdf', 3, 39)).toBe(
      `“x.pdf” has 3 pages: with the 39 pages chosen before it, that is more than ${MAX_PAGES}, the most one reading takes, so it was left out.`,
    );
    expect(tooManyPages('p.png', 1, 40)).toMatch(/^“p\.png” has 1 page: with the 40 pages chosen before it/);
    expect(tooManyPages('x.pdf', 40, 1)).toMatch(/^“x\.pdf” has 40 pages: with the page chosen before it, that/);
    for (const before of [0, 1, 5]) expect(tooManyPages('x.pdf', 45, before)).not.toMatch(/\b0\b|the 1 /);
  });

  it('sends the problems of one reading back at most three times, and counts the rounds on the button', () => {
    expect(MAX_ROUNDS).toBe(3);
    expect([0, 1, 2, 3, 4].map(canSendBack)).toEqual([true, true, true, false, false]);
    expect([0, 1, 2].map(sendBackLabel)).toEqual([
      'Send these problems back (round 1 of 3)',
      'Send these problems back (round 2 of 3)',
      'Send these problems back (round 3 of 3)',
    ]);
    expect(roundsSpentLine()).toBe(
      'The problems were sent back 3 times, the most for one reading. Copy them for a chat of your own, or read the pages again.',
    );
  });

  it('never advises reading fewer pages, which the reader cannot join: a piece too long goes to a chat in parts', () => {
    for (const f of [
      { kind: 'too-many', images: 700 },
      { kind: 'too-large', bytes: 60 * 1024 * 1024 },
      { kind: 'length' },
    ] as Failure[]) {
      const s = failureSentence(f, 'DeepSeek');
      expect(s).not.toMatch(/fewer|at a time/);
      expect(s).toMatch(
        /use Copy instructions for your AI with an AI chat instead, where a long piece can come in parts\.$/,
      );
    }
    expect(failureSentence({ kind: 'length' }, 'DeepSeek')).toMatch(/^The answer was cut off.*Try again;/);
  });

  it('shows the cost only for the default model at its own service, from a dated table', () => {
    expect(PRICES[DEFAULT_MODEL].checked).toBe('2026-11-23');
    const usage = { prompt: 1_000_000, completion: 1_000_000 };
    expect(estimateCost(DEFAULT_MODEL, DEEPSEEK_ENDPOINT, usage)).toEqual({
      low: 0.75,
      high: 1.5,
      checked: '2026-11-23',
    });
    expect(estimateCost(DEFAULT_MODEL, DEEPSEEK_ENDPOINT, { prompt: 20_000, completion: 5_000 })!.low).toBeCloseTo(
      0.006,
    );
    expect(estimateCost('deepseek-v4-pro', DEEPSEEK_ENDPOINT, usage)).toBeUndefined();
    expect(estimateCost(DEFAULT_MODEL, 'http://localhost:8080/v1/chat/completions', usage)).toBeUndefined();
    const line = usageLine(DEFAULT_MODEL, DEEPSEEK_ENDPOINT, { prompt: 20_000, completion: 5_000 });
    expect(line).toBe(
      '20,000 tokens in and 5,000 out (thinking included). Estimated cost: $0.0060 at the off-peak price to $0.012 at the peak price, from the prices as checked on 2026-11-23. Check the service’s own pricing page for today’s.',
    );
    expect(usageLine('my-model', DEEPSEEK_ENDPOINT, { prompt: 10, completion: 2 })).toBe(
      '10 tokens in and 2 out (thinking included).',
    );
    expect(usageLine(DEFAULT_MODEL, DEEPSEEK_ENDPOINT, undefined)).toBe(
      'The service did not say how many tokens this used.',
    );
    expect([dollars(0.0012), dollars(0.25), dollars(3)]).toEqual(['$0.0012', '$0.250', '$3.00']);
  });

  it('says that it is working and how much has arrived', () => {
    expect(progressLine({ answer: 0, thinking: 0 }, 'DeepSeek')).toBe('Sent. Waiting for DeepSeek to answer…');
    expect(progressLine({ answer: 1234, thinking: 56 }, 'DeepSeek')).toBe(
      'Reading… DeepSeek has sent 56 characters of thinking and 1,234 characters of the answer so far.',
    );
  });

  it('says that sending the problems back or reading again sends the reading’s pictures again, and where', () => {
    expect(followUpLine(6, 'DeepSeek', 2)).toBe(
      'Either button sends the 6 pictures this reading was made from again, from this browser straight to DeepSeek, with your key.',
    );
    expect(followUpLine(1, '127.0.0.1:8080', 1)).toBe(
      'This sends the picture this reading was made from again, from this browser straight to 127.0.0.1:8080, with your key.',
    );
    // Once the pictures shown are not the reading's own, nothing more is sent from it: the owner reads them afresh.
    expect(changedLine('DeepSeek')).toMatch(/^The pictures shown have changed since this reading, so it is no longer/);
    expect(changedLine('DeepSeek')).toMatch(/Press Read with DeepSeek to read the pictures shown now\.$/);
  });
});

describe('the settings and the key', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
  };

  it('are stored under their own key, which is never synced', () => {
    expect(READER_KEY).toBe('piece.reader.v1');
    expect(PROGRESS_KEYS as readonly string[]).not.toContain(READER_KEY);
    expect(SERVER_KEYS as readonly string[]).not.toContain(READER_KEY);
    expect(PIECES_KEY).not.toBe(READER_KEY);
    const store = memory();
    expect(saveSettings(settings, store)).toBe(true);
    expect([...store.map.keys()]).toEqual([READER_KEY]);
    expect(loadSettings(store)).toEqual(settings);
  });

  it('default to DeepSeek, and drop a key whose stored address is missing or unusable', () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings('not json')).toEqual(DEFAULTS);
    expect(parseSettings(JSON.stringify({ key: KEY }))).toEqual(DEFAULTS);
    expect(parseSettings(JSON.stringify({ endpoint: 'http://evil.example/v1', model: 'm', key: KEY }))).toEqual({
      ...DEFAULTS,
      model: 'm',
    });
    expect(
      parseSettings(JSON.stringify({ endpoint: 'http://127.0.0.1:8080/v1/chat/completions', model: '', key: KEY })),
    ).toEqual({
      endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
      model: DEFAULT_MODEL,
      key: KEY,
    });
  });

  it('forget the key when the address moves to another service, and keep it within the same one', () => {
    const local = withEndpoint(settings, 'http://localhost:11434/v1/chat/completions');
    expect(local).toEqual({
      settings: { ...settings, endpoint: 'http://localhost:11434/v1/chat/completions', key: '' },
      forgot: true,
    });
    const same = withEndpoint(settings, 'https://api.deepseek.com/v1/chat/completions');
    expect(same).toEqual({
      settings: { ...settings, endpoint: 'https://api.deepseek.com/v1/chat/completions' },
      forgot: false,
    });
    // A port is part of the origin.
    expect(withEndpoint({ ...settings, endpoint: 'http://localhost:1/x' }, 'http://localhost:2/x').forgot).toBe(true);
    expect(withEndpoint({ ...settings, key: '' }, 'http://localhost:2/x').forgot).toBe(false);
  });

  it('the key goes in a password field marked as a new secret, so no saved sign-in fills it', () => {
    // A password field: the browser hides it from screen readers as well as the screen (a text field drawn as dots
    // would not). Marked as a new secret with its own name: this site's own sign-in is never filled into it.
    const markup = readerMarkup(),
      field = markup.match(/<input [^>]*id="reader-key"[^>]*>/)?.[0] ?? '';
    expect(field).toContain('type="password"');
    expect(field).toContain('autocomplete="new-password"');
    expect(field).toContain('name="reader-ai-service-key"');
    expect(field).not.toMatch(/current-password|username|autocomplete="off"|data-masked/);
    expect(markup.match(/type="password"/g)).toHaveLength(1);
  });

  it('take https, or http only on this computer', () => {
    expect(endpointProblem(DEEPSEEK_ENDPOINT)).toBeUndefined();
    expect(endpointProblem('http://localhost:8080/v1/chat/completions')).toBeUndefined();
    expect(endpointProblem('http://127.0.0.1:1234/chat')).toBeUndefined();
    expect(endpointProblem('http://192.168.1.5/chat')).toMatch(/https/);
    expect(endpointProblem('http://localhost.example.com/chat')).toMatch(/https/);
    expect(endpointProblem('ftp://x/y')).toMatch(/https/);
    expect(endpointProblem('api.deepseek.com')).toMatch(/not a web address/);
    expect(endpointProblem('https://user:pw@api.deepseek.com/chat')).toMatch(/name or password/);
    expect(serviceName(DEEPSEEK_ENDPOINT)).toBe('DeepSeek');
    expect(serviceName('http://127.0.0.1:8080/v1')).toBe('127.0.0.1:8080');
  });
});

it('keeps the messages a plain list the service reads (no stray fields)', () => {
  const messages: Message[] = followUp([firstMessage('first', images.slice(0, 1), 'end')], 'a', 'b');
  expect(JSON.parse(requestBody('m', messages)).messages.map((m: Message) => m.role)).toEqual([
    'user',
    'assistant',
    'user',
  ]);
});
