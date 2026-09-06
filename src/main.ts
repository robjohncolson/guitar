import './styles.css';
import { enableContext, outputDelay } from './audio/context';
import { TapTempo } from './audio/tap-tempo';
import { Grid, mod } from './audio/grid';
import { Synth } from './audio/synth';
import { Scheduler } from './audio/scheduler';
import { Ear } from './audio/ear';
import { Microphone } from './audio/worklet-grabber';
import { noteLabel } from './music/notes';
import { Repeater, validBpm } from './music/repeater';
import { shell, element } from './ui/render';
import { loadSettings, saveSettings } from './ui/settings';

shell();
const settings = loadSettings(), tempo = new TapTempo(), repeater = new Repeater();
repeater.setTempo(settings.bpm);
let context: AudioContext | undefined, synth: Synth | undefined, scheduler: Scheduler | undefined;
let grid: Grid | undefined, microphone: Microphone | undefined;
let micRunning = false, changingMic = false, panicked = false, audioError = '';
let volume = 0.22;
const bpmInput = element<HTMLInputElement>('bpm');
bpmInput.value = String(settings.bpm);

const ear = new Ear(
  text => { element('model').textContent = text; element('model').classList.toggle('error',/error|FALLBACK/.test(text)); },
  pitch => { element('pitch-detail').textContent = `${pitch.hz > 0 ? pitch.hz.toFixed(1) : '—'} Hz · ${Math.round(pitch.confidence*100)}% confidence`; },
  note => {
    if (micRunning && grid && context?.state === 'running' && repeater.accept(note)) {
      grid.claimPlayer(note.t);
      element('note').textContent = noteLabel(note.hz);
    }
  }
);
ear.onsets.threshold = settings.voicedThreshold;
void ear.load();

function updateMutes(): void {
  const muted = settings.companionMuted || volume === 0;
  repeater.setMuted(muted);
  if (synth) { if (muted) synth.stopEchoes(); synth.volume = volume; synth.setMutes(muted,settings.clickMuted); }
  element('click-mute').textContent = `Click ${settings.clickMuted ? 'off' : 'on'} · C`;
  element('companion-mute').textContent = `Repeater ${settings.companionMuted ? 'off' : 'on'} · M`;
  element('click-mute').setAttribute('aria-pressed',String(settings.clickMuted));
  element('companion-mute').setAttribute('aria-pressed',String(settings.companionMuted));
  saveSettings(settings);
}
function restartPulse(): void {
  synth?.panic();
  repeater.setTempo(settings.bpm);
  if (context && synth) {
    grid = new Grid(context.currentTime+outputDelay(context)+0.03,60/settings.bpm);
    scheduler = new Scheduler(grid,synth,repeater);
  }
  updateMutes();
}
function setBpm(value: number): void {
  if (!validBpm(value)) { bpmInput.setAttribute('aria-invalid','true'); return; }
  bpmInput.removeAttribute('aria-invalid');
  if (settings.bpm === value) return;
  settings.bpm = value;
  restartPulse();
}
bpmInput.oninput = () => { tempo.reset(); setBpm(bpmInput.valueAsNumber); };
bpmInput.onblur = () => { if (!validBpm(bpmInput.valueAsNumber)) bpmInput.value = String(settings.bpm); bpmInput.removeAttribute('aria-invalid'); };

function micError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone blocked. Allow it in Chrome’s site settings, then retry.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone found. Connect one, then retry.';
  return `Audio could not start: ${error instanceof Error ? error.message : String(error)}`;
}
const enableButton = element<HTMLButtonElement>('enable');
enableButton.onclick = async () => {
  if (changingMic) return;
  changingMic = true; enableButton.disabled = true; audioError = '';
  try {
    context = await enableContext(context);
    synth ??= new Synth(context);
    if (!scheduler) restartPulse();
    microphone ??= new Microphone(context,message => ear.receive(message));
    if (!micRunning) {
      element('mic').textContent = 'Mic requesting permission';
      await microphone.start(settings.outputMode); ear.resetCapture();
    }
    micRunning = true;
    element('mic').textContent = `Mic listening · ${settings.outputMode}`;
    enableButton.textContent = 'Audio & mic enabled';
  } catch (error) { audioError = micError(error); element('mic').textContent = 'Mic unavailable'; enableButton.textContent = 'Retry audio & mic'; }
  finally { changingMic = false; enableButton.disabled = false; }
};
async function toggleOutput(): Promise<void> {
  if (changingMic) return;
  const next = settings.outputMode === 'speakers' ? 'headphones' : 'speakers';
  changingMic = true; audioError = '';
  try {
    if (microphone && micRunning) { await microphone.start(next); ear.resetCapture(); }
    settings.outputMode = next; saveSettings(settings);
    if (micRunning) element('mic').textContent = `Mic listening · ${next}`;
  } catch (error) { audioError = micError(error); }
  finally { changingMic = false; }
}
function toggleMute(which: 'clickMuted' | 'companionMuted'): void { settings[which] = !settings[which]; panicked = false; updateMutes(); }
function panic(): void {
  settings.companionMuted = true; settings.clickMuted = true; panicked = true;
  synth?.panic(); repeater.clear(); updateMutes();
}
element('click-mute').onclick = () => toggleMute('clickMuted');
element('companion-mute').onclick = () => toggleMute('companionMuted');
element('output').onclick = () => { void toggleOutput(); };
element('panic').onclick = panic;
const threshold = element<HTMLInputElement>('threshold');
threshold.value = String(settings.voicedThreshold);
element('threshold-value').textContent = settings.voicedThreshold.toFixed(2);
threshold.oninput = () => {
  settings.voicedThreshold = Number(threshold.value); ear.onsets.threshold = settings.voicedThreshold;
  element('threshold-value').textContent = settings.voicedThreshold.toFixed(2); saveSettings(settings);
};
element<HTMLInputElement>('volume').oninput = event => {
  volume = Number((event.target as HTMLInputElement).value);
  element('volume-value').textContent = `${Math.round(volume*200)}%`; updateMutes();
};
window.addEventListener('keydown', event => {
  if (event.code === 'Space') {
    event.preventDefault();
    if (event.repeat) return;
    if (event.shiftKey) { tempo.reset(); restartPulse(); return; }
    const bpm = tempo.tap(performance.now()/1000);
    if (bpm !== null) { settings.bpm = Math.round(bpm); bpmInput.value = String(settings.bpm); bpmInput.removeAttribute('aria-invalid'); restartPulse(); }
    return;
  }
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'KeyC') toggleMute('clickMuted');
  else if (event.code === 'KeyM') toggleMute('companionMuted');
  else if (event.code === 'KeyH') void toggleOutput();
  else if (event.code === 'Escape') panic();
});
// The timer supplies lookahead; Web Audio schedules the actual click and repeat times.
const schedulerTimer = window.setInterval(() => { if (context?.state === 'running') scheduler?.tick(); },10);
window.addEventListener('pagehide', () => { window.clearInterval(schedulerTimer); synth?.panic(); repeater.clear(); microphone?.stop(); });
updateMutes();
let lastPaint = -Infinity;
function render(timestamp: number): void {
  requestAnimationFrame(render);
  if (timestamp-lastPaint < 32) return;
  lastPaint = timestamp;
  const now = context?.currentTime ?? 0;
  element('delay-seconds').textContent = `${repeater.delay.toFixed(2)} seconds later`;
  element('output').textContent = `${settings.outputMode === 'speakers' ? 'Speakers' : 'Headphones'} · H`;
  element<HTMLButtonElement>('output').disabled = changingMic;
  const scheduled = repeater.lastRepeat;
  const next = scheduled && scheduled.at > now ? scheduled : repeater.next;
  element('echo-note').textContent = next ? noteLabel(next.hz) : scheduled ? noteLabel(scheduled.hz) : '—';
  element('queue').textContent = next ? `In ${Math.max(0,next.at-now).toFixed(1)}s · two beats after your note` :
    repeater.repeatCount > 0 ? `${repeater.repeatCount} repeats · listening for your next note` : 'Ready for your first note';
  let hint = micRunning ? 'Play a note. I’ll repeat it two beats later.' : 'Set your BPM, enable audio, and play a note.';
  if (tempo.taps.length > 0 && tempo.taps.length < 4) hint = `Tap Space · ${tempo.taps.length}/4 · current tempo continues`;
  if (settings.companionMuted) hint = 'Repeater muted · Press M to bring it back';
  if (volume === 0) hint = 'Repeat volume is zero · Raise it in Listening settings';
  if (context?.state === 'suspended') hint = 'Audio paused · Click Enable audio to resume';
  if (panicked) hint = 'Output silenced. Repeats cleared · M for repeater, C for click';
  if (bpmInput.getAttribute('aria-invalid') === 'true') hint = 'Enter a BPM between 40 and 240.';
  if (audioError) hint = audioError;
  element('hint').textContent = hint;
  if (context) element('latency').textContent = `${Math.round(outputDelay(context)*1000)} ms output`;
  const index = grid?.indexAt(now) ?? -1;
  document.querySelectorAll<HTMLElement>('.beat').forEach((cell,beat) => {
    const slot = index >= 0 ? grid?.slot(index-mod(index,4)+beat) : undefined;
    cell.className = `beat ${slot?.occupancy ?? ''} ${index >= 0 && mod(index,4) === beat ? 'active' : ''}`;
    const label = slot?.occupancy === 'player' ? 'you' : slot?.occupancy === 'companion' ? 'repeat' : '—';
    cell.querySelector('small')!.textContent = label;
    cell.setAttribute('aria-label',`Beat ${beat+1}: ${label}`);
  });
}
requestAnimationFrame(render);
