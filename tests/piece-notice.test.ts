import { describe, expect, it } from 'vitest';
import { audioNotice, notice, ROUTES, type NoticeSource } from '../src/piece/notice';
import { UNANSWERED } from '../src/piece/loop';

// Every message source and where it goes. Take results never reach NOTICE.
const TABLE: [NoticeSource, string, { text: RegExp; warn: boolean; action?: string } | undefined][] = [
  ['wait-start', 'notice', { text: /^Wait for me: the notes stop at the keys/, warn: false }],
  ['wait-stopped', 'notice', { text: /^Wait for me stopped\.$/, warn: false }],
  ['unanswered', 'notice', { text: new RegExp(`^${UNANSWERED.replace('.', '\\.')}$`), warn: false }],
  [
    'path-changed',
    'notice',
    { text: /^The audio path changed\. Recalibrate to count tempo steps\.$/, warn: true, action: 'calibrate' },
  ],
  ['devices-changed', 'notice', { text: /^Audio devices changed\. Recalibrate/, warn: true, action: 'calibrate' }],
  ['output-changed', 'notice', { text: /^Input processing changed\. Recalibrate/, warn: true, action: 'calibrate' }],
  ['calibrating', 'notice', { text: /^Keep the instrument quiet/, warn: false }],
  ['keys-on', 'notice', { text: /^Play on the computer keyboard or a MIDI keyboard/, warn: false }],
  ['stopped', 'notice', { text: /not recorded/, warn: false }],
  [
    'hidden',
    'notice',
    { text: /^Paused while the page was hidden: nothing was recorded\. Start again\.$/, warn: false },
  ],
  ['loop', 'notice', { text: /nothing is graded/, warn: false }],
  ['reset', 'notice', { text: /^Progress for this piece cleared/, warn: false }],
  ['bpm-invalid', 'notice', { text: /^Enter a tempo from 20 to 240\.$/, warn: true }],
  [
    'piano-failed',
    'notice',
    {
      text: /^Grand piano could not load\. The simple piano plays instead; Start or Hear it tries again\.$/,
      warn: true,
    },
  ],
  ['step-intro', 'next', undefined],
  ['answer-first', 'next', undefined],
  ['listen-start', 'phase', undefined],
  ['count-in', 'phase', undefined],
  ['demo', 'phase', undefined],
  ['whole-piece', 'phase', undefined],
  ['keys-replay', 'phase', undefined],
  ['take-feedback', 'card', undefined],
  ['placement-answer', 'last', undefined],
  ['free-answer', 'last', undefined],
  ['ladder-answer', 'last', undefined],
  ['moment', 'last', undefined],
  ['mic-on', 'none', undefined],
];

describe('NOTICE routing', () => {
  it.each(TABLE)('%s goes to %s', (source, to, want) => {
    expect(ROUTES[source]).toBe(to);
    const n = notice(source);
    if (!want) {
      expect(n).toBeUndefined();
      return;
    }
    expect(n?.text).toMatch(want.text);
    expect(n?.warn).toBe(want.warn);
    expect(n?.action?.kind).toBe(want.action);
  });

  it('covers every source in the table', () => {
    expect(
      Object.keys(ROUTES)
        .filter((k) => !TABLE.some((t) => t[0] === k))
        .sort(),
    ).toEqual(['calibration', 'piece-error', 'wait-done']);
  });

  it.each([
    [
      { notes: 12, mistakes: 0, seconds: 30.4 },
      'All 12 notes, no wrong keys, in 30 s. Try it again, or play it in time with Start practice.',
    ],
    [
      { notes: 12, mistakes: 1, seconds: 41.6 },
      'All 12 notes in 42 s, with 1 wrong key on the way. Once there are none, play it in time with Start practice.',
    ],
    [
      { notes: 8, mistakes: 3, seconds: 9 },
      'All 8 notes in 9 s, with 3 wrong keys on the way. Once there are none, play it in time with Start practice.',
    ],
  ])('Wait for me finished: %j', (detail, text) => {
    expect(notice('wait-done', detail)).toEqual({ text, warn: false });
  });

  it.each([
    [{ ok: true, message: 'Timing measured: 36 ms.' }, false, undefined],
    [{ ok: false, message: 'Only 3 of 8 clicks were heard.' }, true, 'Try again'],
  ])('calibration result %j', (detail, warn, label) => {
    const n = notice('calibration', detail)!;
    expect(n.text).toBe(detail.message);
    expect(n.warn).toBe(warn);
    expect(n.action?.label).toBe(label);
    if (label) expect(n.action?.kind).toBe('calibrate');
  });

  it('prefixes the unanswered-take line when Calibrate drops a take', () => {
    expect(notice('calibrating', { dropped: true })!.text.startsWith(`${UNANSWERED} Keep the instrument quiet`)).toBe(
      true,
    );
    expect(notice('calibrating', { dropped: false })!.text.startsWith('Keep the instrument quiet')).toBe(true);
  });

  it('names piece-file errors', () => {
    expect(notice('piece-error', 'line 3: unknown note')).toEqual({
      text: 'This piece file has errors: line 3: unknown note',
      warn: true,
    });
  });
});

describe('audio errors in plain words', () => {
  it.each([
    [
      'NotAllowedError: Permission denied',
      true,
      'The microphone is blocked. Allow it in the address bar, or use Keyboard · MIDI.',
      'keys',
    ],
    ['Permission denied', false, 'The microphone is blocked. Allow it in the address bar.', undefined],
    [
      'NotFoundError: Requested device not found',
      true,
      'No microphone was found. Connect one, or use Keyboard · MIDI.',
      'keys',
    ],
    [
      'The microphone disconnected. Please start a new take.',
      true,
      'The microphone disconnected. Start a new take.',
      undefined,
    ],
    [
      'The audio processor stopped. Please start a new take.',
      true,
      'The audio processor stopped. Start a new take.',
      undefined,
    ],
    ['Audio paused. Start again when you are ready.', true, 'Audio paused. Start again when you are ready.', undefined],
    [
      'NotReadableError: Could not start audio source',
      true,
      'The microphone is busy. Close other apps that use it, then start again.',
      undefined,
    ],
    [
      "NotAllowedError: play() failed because the user didn't interact with the document first.",
      true,
      'The browser blocked playback. Press play again.',
      undefined,
    ],
    [
      'AbortError: The play() request was interrupted by a call to pause().',
      true,
      'Playback was interrupted. Press play again.',
      undefined,
    ],
    ['Something odd.', true, 'Audio stopped: Something odd.', undefined],
  ])('%s', (error, keys, text, action) => {
    const n = audioNotice(error, keys);
    expect(n.text).toBe(text);
    expect(n.warn).toBe(true);
    expect(n.action?.kind).toBe(action);
  });
});

describe('tone', () => {
  it('never uses loss words', () => {
    const all = [
      ...Object.keys(ROUTES).map(
        (k) =>
          notice(
            k as NoticeSource,
            k === 'wait-done'
              ? { notes: 4, mistakes: 2, seconds: 5 }
              : k === 'calibration'
                ? { ok: false, message: 'x' }
                : undefined,
          )?.text ?? '',
      ),
      ...[
        'denied',
        'not found',
        'disconnected',
        'processor stopped',
        'Audio paused',
        'NotReadableError',
        'play()',
        'AbortError',
        'other',
      ].map((e) => audioNotice(e, true).text),
    ];
    for (const text of all) expect(text).not.toMatch(/\b(lost|reset|failed|streak|hard take)\b/i);
  });
});
