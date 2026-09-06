export type OutputMode = 'speakers' | 'headphones';
export function outputDelay(context: Pick<AudioContext, 'outputLatency' | 'baseLatency'>): number {
  return context.outputLatency || context.baseLatency || 0;
}
export function microphoneConstraints(mode: OutputMode): MediaStreamConstraints {
  return { audio: { echoCancellation: mode === 'speakers', noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
}
export async function enableContext(context?: AudioContext): Promise<AudioContext> {
  const result = context ?? new AudioContext({ latencyHint: 'interactive' });
  await result.resume();
  return result;
}
