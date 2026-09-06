import type { CaptureMessage } from './worklet-grabber';
import type { NoteOn } from '../music/notes';
import type { ReplyNote } from '../music/reply';

/** Optional, user-started local diagnostic clip. Never runs or stores audio by default. */
export class ListeningCapture {
  readonly rate = 16000;
  readonly limit = 20;
  private samples = new Float32Array(0);
  private origin = 0;
  private until = 0;
  private count = 0;
  recording = false;
  revision = 0;
  attacks: number[] = [];
  notes: (NoteOn & {accepted:boolean})[] = [];
  replies: ReplyNote[] = [];
  frames: {t:number;rms:number;hz:number;confidence:number}[] = [];
  get duration(): number { return this.count/this.rate; }
  start(now: number): void {
    this.origin = now; this.until = now+this.limit; this.count = 0; this.recording = true; this.revision++;
    this.samples = new Float32Array(this.rate*this.limit); this.attacks = []; this.notes = []; this.replies = []; this.frames = [];
  }
  stop(now: number): void { if (this.recording) { this.until = Math.min(this.until,now); this.recording = false; } }
  private includes(t: number): boolean { return this.samples.length > 0 && t >= this.origin && t <= this.until; }
  receive(message: CaptureMessage): void {
    if (!this.recording) return;
    if (message.type === 'attack') { if (this.includes(message.t)) this.attacks.push(message.t-this.origin); return; }
    const first = Math.round((message.t-0.032-this.origin)*this.rate);
    for (let i=0;i<message.samples.length;i++) {
      const index = first+i;
      if (index >= 0 && index<this.samples.length) { this.samples[index] = message.samples[i]; this.count = Math.max(this.count,index+1); }
    }
    if (message.t+0.032 >= this.until) this.stop(this.until);
  }
  pitch(t: number,rms: number,hz: number,confidence: number): void {
    if (this.includes(t) && this.frames.length < 1200) { this.frames.push({t:t-this.origin,rms,hz,confidence}); this.revision++; }
  }
  note(note: NoteOn,accepted: boolean): void {
    if (this.includes(note.t) && this.notes.length < 500) { this.notes.push({...note,t:note.t-this.origin,accepted}); this.revision++; }
  }
  finish(t: number,end: number): void {
    const note = this.notes.find(note => Math.abs(note.t-(t-this.origin)) < 1e-6);
    if (note) { note.duration = Math.max(0,Math.min(end,this.until)-t); this.revision++; }
  }
  reply(note: ReplyNote): void {
    if (this.includes(note.at) && this.replies.length < 500) { this.replies.push({...note,at:note.at-this.origin,fireAt:note.fireAt-this.origin}); this.revision++; }
  }
  snapshot(metadata: Record<string,unknown> = {}): object {
    return {version:1,sampleRate:this.rate,duration:this.duration,metadata,attacks:this.attacks,notes:this.notes,replies:this.replies,frames:this.frames};
  }
  waveform(bins: number): number[] {
    return Array.from({length:bins},(_,i) => {
      const from = Math.floor(i*this.count/bins), to = Math.floor((i+1)*this.count/bins);
      let peak = 0; for (let index=from;index<to;index++) peak = Math.max(peak,Math.abs(this.samples[index]));
      return peak;
    });
  }
  wav(): Uint8Array {
    const bytes = new Uint8Array(44+this.count*2), view = new DataView(bytes.buffer);
    const ascii = (offset:number,text:string) => [...text].forEach((char,i) => bytes[offset+i] = char.charCodeAt(0));
    ascii(0,'RIFF'); view.setUint32(4,bytes.length-8,true); ascii(8,'WAVE'); ascii(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,this.rate,true); view.setUint32(28,this.rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    ascii(36,'data'); view.setUint32(40,this.count*2,true);
    for (let i=0;i<this.count;i++) view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,this.samples[i]))*32767),true);
    return bytes;
  }
}
