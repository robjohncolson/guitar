/// <reference lib="webworker" />
import { pianoOnsets } from './listen';
import { gradePiano, setLeniency, type TakeAudio } from './grade';
import type { Exercise } from './exercise';

/** Piano takes are analysed off the main thread; a long run-through must not freeze the page. */
export interface AnalysisRequest {
  id: number;
  exercise: Exercise;
  bpm: number;
  take: TakeAudio;
  offset: number;
  checkPitch: boolean;
  from: number;
  to: number;
  slack: number;
}
self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { id, exercise, bpm, take, offset, checkPitch, from, to, slack } = event.data;
  setLeniency(slack);
  try {
    const onsets = pianoOnsets(take.samples, take.rate, from, to, take.clicks);
    const result = gradePiano(exercise, bpm, take, onsets, offset, checkPitch);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
