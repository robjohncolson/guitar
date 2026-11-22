import { UNANSWERED } from './loop';

/**
 * Where each message the page can say goes. Take results belong to NEXT TAKE, LAST TAKE and the result card; the
 * phase chip names what is playing; NOTICE carries everything else, one plain sentence and at most one action.
 */
export type Destination = 'notice' | 'next' | 'last' | 'card' | 'phase' | 'none';
export type NoticeSource =
  | 'wait-start'
  | 'wait-stopped'
  | 'wait-done'
  | 'piece-error'
  | 'unanswered'
  | 'path-changed'
  | 'devices-changed'
  | 'output-changed'
  | 'calibrating'
  | 'calibration'
  | 'keys-on'
  | 'stopped'
  | 'hidden'
  | 'loop'
  | 'reset'
  | 'bpm-invalid'
  | 'piano-failed'
  | 'step-intro'
  | 'answer-first'
  | 'listen-start'
  | 'count-in'
  | 'demo'
  | 'take-feedback'
  | 'placement-answer'
  | 'free-answer'
  | 'ladder-answer'
  | 'moment'
  | 'mic-on'
  | 'whole-piece'
  | 'keys-replay';

export const ROUTES: Record<NoticeSource, Destination> = {
  'wait-start': 'notice',
  'wait-stopped': 'notice',
  'wait-done': 'notice',
  'piece-error': 'notice',
  unanswered: 'notice',
  'path-changed': 'notice',
  'devices-changed': 'notice',
  'output-changed': 'notice',
  calibrating: 'notice',
  calibration: 'notice',
  'keys-on': 'notice',
  stopped: 'notice',
  hidden: 'notice',
  loop: 'notice',
  reset: 'notice',
  'bpm-invalid': 'notice',
  'piano-failed': 'notice',
  'step-intro': 'next',
  'answer-first': 'next',
  'listen-start': 'phase',
  'count-in': 'phase',
  demo: 'phase',
  'take-feedback': 'card',
  'placement-answer': 'last',
  'free-answer': 'last',
  'ladder-answer': 'last',
  moment: 'last',
  'mic-on': 'none',
  'whole-piece': 'phase',
  'keys-replay': 'phase',
};

export interface Notice {
  text: string;
  warn: boolean;
  action?: { kind: 'calibrate' | 'keys'; label: string };
}
export type NoticeDetail =
  | { notes: number; mistakes: number; seconds: number }
  | { ok: boolean; message: string }
  | { dropped: boolean }
  | string;

const RECALIBRATE = { kind: 'calibrate' as const, label: 'Calibrate' };
const s = (n: number) => (n === 1 ? '' : 's');

/** The NOTICE for a source, or undefined when the source belongs somewhere else (see ROUTES). */
export function notice(source: NoticeSource, detail?: NoticeDetail): Notice | undefined {
  if (ROUTES[source] !== 'notice') return undefined;
  const info = (text: string): Notice => ({ text, warn: false }),
    warn = (text: string, action?: Notice['action']): Notice => ({ text, warn: true, ...(action ? { action } : {}) });
  switch (source) {
    case 'wait-start':
      return info(
        'Wait for me: the notes stop at the keys until you play them. Take your time; only the keys are checked.',
      );
    case 'wait-stopped':
      return info('Wait for me stopped.');
    case 'wait-done': {
      const d = detail as { notes: number; mistakes: number; seconds: number },
        secs = Math.round(d.seconds);
      return info(
        d.mistakes === 0
          ? `All ${d.notes} notes, no wrong keys, in ${secs} s. Try it again, or play it in time with Start practice.`
          : `All ${d.notes} notes in ${secs} s, with ${d.mistakes} wrong key${s(d.mistakes)} on the way. Once there are none, play it in time with Start practice.`,
      );
    }
    case 'piece-error':
      return warn(`This piece file has errors: ${String(detail ?? '')}`.trim());
    case 'unanswered':
      return info(UNANSWERED);
    case 'path-changed':
      return warn('The audio path changed. Recalibrate to count tempo steps.', RECALIBRATE);
    case 'devices-changed':
      return warn('Audio devices changed. Recalibrate to count tempo steps.', RECALIBRATE);
    case 'output-changed':
      return warn('Input processing changed. Recalibrate to count tempo steps.', RECALIBRATE);
    case 'calibrating':
      return info(
        `${(detail as { dropped: boolean } | undefined)?.dropped ? `${UNANSWERED} ` : ''}Keep the instrument quiet. Let the microphone hear the eight clicks.`,
      );
    case 'calibration': {
      const d = detail as { ok: boolean; message: string };
      return d.ok ? info(d.message) : warn(d.message, { kind: 'calibrate', label: 'Try again' });
    }
    case 'keys-on':
      return info(
        'Play on the computer keyboard or a MIDI keyboard. Notes are graded from the keys you press; the microphone stays off.',
      );
    case 'stopped':
      return info('Stopped before the end, so that take was not recorded.');
    case 'hidden':
      return info('Paused while the page was hidden: nothing was recorded. Start again.');
    case 'loop':
      return info('Your take is looping. Play along freely; nothing is graded.');
    case 'reset':
      return info('Progress for this piece cleared. Calibration is kept.');
    case 'bpm-invalid':
      return warn('Enter a tempo from 20 to 240.');
    case 'piano-failed':
      return warn('Grand piano could not load. The simple piano plays instead; Start or Hear it tries again.');
    default:
      return undefined;
  }
}

/** An audio engine error in plain words. keys: Keyboard · MIDI is available (piano), so it can be offered. */
export function audioNotice(error: string, keys: boolean): Notice {
  const useKeys = keys ? { kind: 'keys' as const, label: 'Use Keyboard · MIDI' } : undefined;
  const warn = (text: string, action?: Notice['action']): Notice => ({
    text,
    warn: true,
    ...(action ? { action } : {}),
  });
  if (/aborterror|interrupted/i.test(error)) return warn('Playback was interrupted. Press play again.');
  if (/play\(\)|autoplay|playback/i.test(error)) return warn('The browser blocked playback. Press play again.');
  if (/notreadable|could not start|in use|busy/i.test(error))
    return warn('The microphone is busy. Close other apps that use it, then start again.');
  if (/notallowed|denied|permission|not allowed/i.test(error))
    return warn(
      `The microphone is blocked. Allow it in the address bar${keys ? ', or use Keyboard · MIDI' : ''}.`,
      useKeys,
    );
  if (/notfound|not found|no (microphone|input|device)/i.test(error))
    return warn(`No microphone was found. Connect one${keys ? ', or use Keyboard · MIDI' : ''}.`, useKeys);
  if (/disconnected/i.test(error)) return warn('The microphone disconnected. Start a new take.');
  if (/processor stopped/i.test(error)) return warn('The audio processor stopped. Start a new take.');
  if (/audio paused/i.test(error)) return warn('Audio paused. Start again when you are ready.');
  return warn(`Audio stopped: ${error.trim().replace(/\.$/, '')}.`);
}
