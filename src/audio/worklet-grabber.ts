import workletUrl from './grabber.worklet.ts?worker&url';
import { microphoneConstraints } from './context';
import type { OutputMode } from './context';
import type { CaptureFrame } from './frame-buffer';
export type CaptureMessage = ({ type: 'frame' } & CaptureFrame) | { type: 'attack'; t: number };

export class Microphone {
  private source?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private silent?: GainNode;
  constructor(readonly context: AudioContext, readonly receive: (message: CaptureMessage) => void) {}
  async start(mode: OutputMode): Promise<void> {
    // Acquire the replacement before disconnecting the old stream; the clock is independent.
    const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(mode));
    try {
      if (!this.node) {
        await this.context.audioWorklet.addModule(workletUrl);
        this.node = new AudioWorkletNode(this.context, 'guitar-grabber');
        this.silent = this.context.createGain(); this.silent.gain.value = 0;
        this.node.connect(this.silent).connect(this.context.destination);
        this.node.port.onmessage = event => this.receive(event.data as CaptureMessage);
      }
      const source = this.context.createMediaStreamSource(stream);
      source.connect(this.node);
      this.source?.disconnect(); this.stream?.getTracks().forEach(track => track.stop());
      this.source = source; this.stream = stream;
    } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  }
  stop(): void {
    this.source?.disconnect(); this.stream?.getTracks().forEach(track => track.stop());
    this.node?.disconnect(); this.node?.port.close(); this.silent?.disconnect(); this.node = undefined;
  }
}
