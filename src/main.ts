import './styles.css';
import { enableContext, outputDelay } from './audio/context';
import { TapTempo, validBpm } from './audio/tap-tempo';
import { Grid, mod } from './audio/grid';
import { Synth } from './audio/synth';
import { Scheduler } from './audio/scheduler';
import { Ear } from './audio/ear';
import { Microphone } from './audio/worklet-grabber';
import { ListeningCapture } from './audio/listening-capture';
import { noteLabel, noteNames, pitchClass, hzToMidi } from './music/notes';
import { Companion } from './music/companion';
import { shell, element } from './ui/render';
import { loadSettings, saveSettings } from './ui/settings';

shell();
const settings = loadSettings(), tempo = new TapTempo(), companion = new Companion(), capture = new ListeningCapture();
let context: AudioContext | undefined, synth: Synth | undefined, scheduler: Scheduler | undefined;
let grid: Grid | undefined, microphone: Microphone | undefined;
let micRunning = false, changingMic = false, stopped = false, pulseAnchored = false, audioError = '', volume = 0.22;
let microphoneRequest = 0;
const bpmInput = element<HTMLInputElement>('bpm'), enableButton = element<HTMLButtonElement>('enable');
bpmInput.value = String(settings.bpm);
const replyMode = element<HTMLSelectElement>('reply-mode');
replyMode.value = settings.replyMode; companion.setReplyMode(settings.replyMode);
replyMode.onchange = () => {
  settings.replyMode = replyMode.value === 'echo' ? 'echo' : 'harmony';
  companion.setReplyMode(settings.replyMode); saveSettings(settings);
};
const ear = new Ear(
  text => { element('model').textContent = text; element('model').classList.toggle('error',/error|FALLBACK/.test(text)); },
  pitch => { element('pitch-detail').textContent = `${pitch.hz > 0 ? pitch.hz.toFixed(1) : '—'} Hz · ${Math.round(pitch.confidence*100)}% confidence`; },
  note => {
    if (!micRunning || !grid || context?.state !== 'running') return;
    const accepted = companion.accept(note); capture.note(note,accepted);
    if (!accepted) return;
    if (!pulseAnchored) { synth?.panic(); grid = new Grid(note.t,60/settings.bpm); pulseAnchored = true; makeScheduler(); updateMutes(); }
    scheduler?.response.attack(note.t,grid.period); grid.claimPlayer(note.t);
    element('note').textContent = noteLabel(note.hz);
  }, undefined,
  note => { companion.finish(note.t,note.end); capture.finish(note.t,note.end); },
  (t,rms,pitch) => capture.pitch(t,rms,pitch.hz,pitch.confidence)
);
ear.onsets.threshold = settings.voicedThreshold;
ear.onsets.accepts = note => {
  const accepted = !companion.mask.drops(note);
  if (!accepted) capture.note(note,false);
  return accepted;
};
void ear.load();

function makeScheduler(): void {
  if (grid && synth) { scheduler = new Scheduler(grid,synth,companion,note => capture.reply(note)); scheduler.responsive = settings.responsive; }
}
function stopReplies(): void {
  synth?.stopNotes();
  if (context) companion.mask.release(context.currentTime+outputDelay(context)+0.07);
}
function updateMutes(): void {
  const muted = settings.companionMuted || volume === 0;
  companion.setMuted(muted);
  if (muted) stopReplies();
  if (synth && micRunning) { synth.volume = volume; synth.setMutes(muted,settings.clickMuted); }
  element('click-mute').textContent = `Click ${settings.clickMuted ? 'off' : 'on'} · C`;
  element('companion-mute').textContent = `Replies ${settings.companionMuted ? 'off' : 'on'} · M`;
  element('click-mute').setAttribute('aria-pressed',String(!settings.clickMuted));
  element('companion-mute').setAttribute('aria-pressed',String(!settings.companionMuted));
  saveSettings(settings);
}
function listenAgain(): void {
  stopReplies(); companion.reset(grid?.t0 ?? 0,60/settings.bpm,context?.currentTime ?? 0);
  scheduler?.response.reset();
}
function restartPulse(): void {
  synth?.panic(); pulseAnchored = false;
  if (context) {
    companion.mask.release(context.currentTime+outputDelay(context));
    grid = new Grid(context.currentTime+outputDelay(context)+0.03,60/settings.bpm);
    companion.reset(grid.t0,grid.period,context.currentTime); makeScheduler();
  } else companion.reset(0,60/settings.bpm);
  updateMutes();
}
bpmInput.oninput = () => {
  tempo.reset(); const value = bpmInput.valueAsNumber;
  if (!validBpm(value)) { bpmInput.setAttribute('aria-invalid','true'); return; }
  bpmInput.removeAttribute('aria-invalid');
  if (settings.bpm !== value) { settings.bpm = value; restartPulse(); }
};
bpmInput.onblur = () => { if (!validBpm(bpmInput.valueAsNumber)) bpmInput.value = String(settings.bpm); bpmInput.removeAttribute('aria-invalid'); };
function micError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone blocked. Allow it in Chrome’s site settings, then retry.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone found. Connect one, then retry.';
  return `Audio could not start: ${error instanceof Error ? error.message : String(error)}`;
}
enableButton.onclick = async () => {
  if (changingMic) return;
  changingMic = true; audioError = ''; const request = ++microphoneRequest;
  try {
    context = await enableContext(context); synth ??= new Synth(context);
    if (!micRunning) {
      restartPulse();
      microphone ??= new Microphone(context,message => { capture.receive(message); ear.receive(message); });
      element('mic').textContent = 'Mic requesting permission';
      await microphone.start(settings.outputMode); ear.resetCapture(context.currentTime);
      if (request !== microphoneRequest) { microphone.stop(); return; }
      companion.reset(grid!.t0,grid!.period,context.currentTime);
    }
    micRunning = true; stopped = false; updateMutes();
    element('mic').textContent = `Mic listening · ${settings.outputMode}`;
  } catch (error) { audioError = micError(error); element('mic').textContent = 'Mic unavailable'; }
  finally { changingMic = false; }
};
async function toggleOutput(): Promise<void> {
  if (changingMic) return;
  const next = settings.outputMode === 'speakers' ? 'headphones' : 'speakers';
  changingMic = true; audioError = ''; const request = microphoneRequest;
  try {
    if (microphone && micRunning) { await microphone.start(next); ear.resetCapture(context?.currentTime); companion.touch.reset(); }
    if (request !== microphoneRequest) { microphone?.stop(); return; }
    settings.outputMode = next; saveSettings(settings);
    if (micRunning) element('mic').textContent = `Mic listening · ${next}`;
  } catch (error) { audioError = micError(error); }
  finally { changingMic = false; }
}
function toggleMute(which: 'clickMuted' | 'companionMuted'): void { settings[which] = !settings[which]; updateMutes(); }
function stop(): void {
  microphoneRequest++;
  const now = context?.currentTime ?? 0;
  capture.stop(now); ear.resetCapture(now); listenAgain(); synth?.panic(); microphone?.stop();
  micRunning = false; stopped = true; element('mic').textContent = 'Mic off';
}
element('listen-again').onclick = listenAgain;
element('click-mute').onclick = () => toggleMute('clickMuted');
element('companion-mute').onclick = () => toggleMute('companionMuted');
element('output').onclick = () => { void toggleOutput(); };
element('panic').onclick = stop;
const responsive = element<HTMLInputElement>('responsive'); responsive.checked = settings.responsive;
responsive.onchange = () => { settings.responsive = responsive.checked; if (scheduler) scheduler.responsive = settings.responsive; saveSettings(settings); };
const threshold = element<HTMLInputElement>('threshold');
threshold.value = String(settings.voicedThreshold); element('threshold-value').textContent = settings.voicedThreshold.toFixed(2);
threshold.oninput = () => { settings.voicedThreshold = Number(threshold.value); ear.onsets.threshold = settings.voicedThreshold; element('threshold-value').textContent = settings.voicedThreshold.toFixed(2); saveSettings(settings); };
element<HTMLInputElement>('volume').oninput = event => { volume = Number((event.target as HTMLInputElement).value); element('volume-value').textContent = `${Math.round(volume*200)}%`; updateMutes(); };
window.addEventListener('keydown', event => {
  if (event.code === 'Space') {
    event.preventDefault(); if (event.repeat) return;
    if (event.shiftKey) { tempo.reset(); restartPulse(); return; }
    const bpm = tempo.tap(performance.now()/1000);
    if (bpm !== null) { settings.bpm = Math.round(bpm); bpmInput.value = String(settings.bpm); bpmInput.removeAttribute('aria-invalid'); restartPulse(); }
    return;
  }
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'KeyC') toggleMute('clickMuted');
  else if (event.code === 'KeyM') toggleMute('companionMuted');
  else if (event.code === 'KeyH') void toggleOutput();
  else if (event.code === 'KeyL') listenAgain();
  else if (event.code === 'Escape') stop();
});
const schedulerTimer = window.setInterval(() => { if (micRunning && context?.state === 'running') scheduler?.tick(); },10);
window.addEventListener('pagehide', () => { window.clearInterval(schedulerTimer); stop(); });

let audioUrl = '', traceUrl = '', exportedDuration = 0, exportedRevision = -1;
element<HTMLAudioElement>('capture-audio').onplay = () => { if (micRunning) stop(); };
element('capture').onclick = () => {
  if (!micRunning || !context) return;
  if (capture.recording) capture.stop(context.currentTime);
  else {
    capture.start(context.currentTime); exportedDuration = 0;
    const player = element<HTMLAudioElement>('capture-audio'); player.pause(); player.hidden = true;
    element('capture-downloads').hidden = true;
  }
};
function renderCapture(): void {
  element<HTMLButtonElement>('capture').disabled = !micRunning;
  element('capture').textContent = capture.recording ? 'Finish recording' : 'Record a listening check';
  element('capture-status').textContent = capture.recording ? `Recording · ${capture.duration.toFixed(1)} / 20s` : capture.duration ? `${capture.notes.filter(note => note.accepted).length} notes heard · ${capture.duration.toFixed(1)}s` : 'Record up to 20 seconds to compare your playing with what I heard.';
  if (!capture.duration) return;
  if (!capture.recording && exportedDuration !== capture.duration) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(new Blob([new Uint8Array(capture.wav())],{type:'audio/wav'}));
    const player = element<HTMLAudioElement>('capture-audio'); player.src = audioUrl; player.hidden = false;
    element<HTMLAnchorElement>('download-audio').href = audioUrl;
    element('capture-downloads').hidden = false; exportedDuration = capture.duration;
  }
  if (!capture.recording && exportedRevision !== capture.revision) {
    URL.revokeObjectURL(traceUrl);
    traceUrl = URL.createObjectURL(new Blob([JSON.stringify(capture.snapshot({bpm:settings.bpm,replyMode:settings.replyMode,outputMode:settings.outputMode,outputLatency:context ? outputDelay(context) : 0}),null,2)],{type:'application/json'}));
    element<HTMLAnchorElement>('download-trace').href = traceUrl; exportedRevision = capture.revision;
  }
  if (!element<HTMLDetailsElement>('listening-check').open) return;
  const canvas = element<HTMLCanvasElement>('capture-plot'), painter = canvas.getContext('2d')!;
  const width = canvas.width, height = canvas.height, duration = capture.duration;
  painter.clearRect(0,0,width,height); painter.fillStyle = '#8a9b86';
  capture.waveform(width).forEach((peak,x) => painter.fillRect(x,45-Math.min(40,peak*110),1,Math.max(1,Math.min(80,peak*220))));
  painter.font = '12px Segoe UI';
  for (const note of capture.notes) {
    const x = note.t/duration*width, length = Math.max(2,(note.duration ?? 0.04)/duration*width);
    painter.fillStyle = note.accepted ? '#c8d8a7' : '#806b5d'; painter.fillRect(x,100,length,10);
    painter.fillText(noteNames[pitchClass(hzToMidi(note.hz))],x,130);
  }
  painter.fillStyle = '#add6cf';
  for (const note of capture.replies) painter.fillRect(note.at/duration*width,145,Math.max(2,note.duration/duration*width),8);
}
updateMutes();
let lastPaint = -Infinity, lastCapturePaint = -Infinity;
function render(timestamp: number): void {
  requestAnimationFrame(render); if (timestamp-lastPaint < 32) return; lastPaint = timestamp;
  const now = context?.currentTime ?? 0, active = companion.active;
  const pass = active ? Math.max(1,Math.min(3,Math.floor((now-active.startAt)/active.duration)+1)) : 0;
  let state = !micRunning ? stopped ? 'Stopped' : 'Ready to listen' : 'Listening';
  if (micRunning && (companion.waiting || active && now < active.startAt)) state = 'Found a loop';
  if (micRunning && active && now >= active.startAt) state = `Replying · ${pass} of 3`;
  element('phrase-status').textContent = state;
  const replyName = active?.kind === 'octave' ? 'Soft octave reply' : active?.kind === 'harmony' ? 'Harmony' : 'Echo';
  element('reply-detail').textContent = active ? `${replyName} · ${active.notes.length} notes · ${active.motif.beats.toFixed(1)} beats · half a beat later` : 'Notes and rests belong to the loop.';
  const modePending = active && active.mode !== settings.replyMode;
  element('reply-mode-help').textContent = modePending ? 'For the next loop' : '';
  element('reply').textContent = active && companion.lastReply ? noteLabel(companion.lastReply.hz) : '—';
  let hint = micRunning ? 'Keep repeating your idea, including the pauses. I’m listening for the loop.' : 'Enter BPM, start listening, and play a repeating idea.';
  if (active) hint = companion.waiting ? 'The next loop is ready. It will follow this one.' : 'Three offbeat replies. I’m still listening as you play.';
  if (modePending) hint = companion.waiting ? `The next loop is ready in ${settings.replyMode === 'harmony' ? 'Harmony' : 'Echo'}. This reply will finish first.` : `${settings.replyMode === 'harmony' ? 'Harmony' : 'Echo'} is set for the next loop. This reply will finish first.`;
  if (!active && companion.hasReplied) hint = 'That loop is finished. Play a different idea, or press L to start fresh.';
  if (settings.companionMuted && micRunning) hint = 'Replies muted · Press M to bring them back.';
  if (volume === 0) hint = 'Raise reply volume in Listening settings to hear the loop.';
  if (tempo.taps.length > 0 && tempo.taps.length < 4) hint = `Tap Space · ${tempo.taps.length}/4`;
  if (stopped && !micRunning) hint = 'Audio and microphone stopped. Start listening when you’re ready.';
  if (context?.state === 'suspended') hint = 'Audio paused · Resume listening to continue.';
  if (bpmInput.getAttribute('aria-invalid') === 'true') hint = 'Enter a BPM between 40 and 240.';
  if (audioError) hint = audioError;
  element('hint').textContent = hint;
  enableButton.textContent = micRunning ? context?.state === 'suspended' ? 'Resume listening' : 'Listening' : audioError ? 'Retry microphone' : 'Start listening';
  enableButton.disabled = changingMic || micRunning && context?.state === 'running';
  element<HTMLButtonElement>('panic').disabled = !micRunning && !changingMic;
  element<HTMLButtonElement>('listen-again').disabled = !micRunning;
  element('output').textContent = `${settings.outputMode === 'speakers' ? 'Speakers' : 'Headphones'} · H`;
  element<HTMLButtonElement>('output').disabled = changingMic;
  if (context) element('latency').textContent = `${Math.round(outputDelay(context)*1000)} ms output`;
  const phase = grid ? mod((now-grid.t0)/grid.period,1) : 1;
  element('pulse').classList.toggle('active',micRunning && pulseAnchored && phase < 0.18);
  if (timestamp-lastCapturePaint > 150) { renderCapture(); lastCapturePaint = timestamp; }
}
requestAnimationFrame(render);
