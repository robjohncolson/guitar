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
import { PhraseMemory, isMemoryBars } from './music/phrase-memory';
import { shell, element } from './ui/render';
import { loadSettings, saveSettings } from './ui/settings';

shell();
const settings = loadSettings(), tempo = new TapTempo(), repeater = new Repeater();
const memory = new PhraseMemory();
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
    if (micRunning && grid && context?.state === 'running' && repeater.accept(note,!memory.active)) {
      memory.record(repeater.lastPlayer!);
      scheduler?.response.attack(note.t,grid.period);
      grid.claimPlayer(note.t);
      element('note').textContent = noteLabel(note.hz);
    }
  }, undefined,
  note => { repeater.finish(note.t,note.end); memory.finish(note.t,note.end); }
);
ear.onsets.threshold = settings.voicedThreshold;
void ear.load();

function updateMutes(): void {
  const muted = settings.companionMuted || volume === 0;
  repeater.setMuted(muted);
  memory.setMuted(muted);
  if (synth) { if (muted) synth.stopEchoes(); synth.volume = volume; synth.setMutes(muted,settings.clickMuted); }
  element('click-mute').textContent = `Click ${settings.clickMuted ? 'off' : 'on'} · C`;
  element('companion-mute').textContent = `${memory.active ? 'Loop' : 'Repeater'} ${settings.companionMuted ? 'off' : 'on'} · M`;
  element('click-mute').setAttribute('aria-pressed',String(settings.clickMuted));
  element('companion-mute').setAttribute('aria-pressed',String(settings.companionMuted));
  saveSettings(settings);
}
function restartPulse(): void {
  ear.resetCapture(context?.currentTime);
  synth?.panic();
  repeater.setTempo(settings.bpm);
  memory.reset(0,60/settings.bpm);
  if (context && synth) {
    grid = new Grid(context.currentTime+outputDelay(context)+0.03,60/settings.bpm);
    memory.reset(grid.t0,grid.period);
    scheduler = new Scheduler(grid,synth,repeater,memory);
    scheduler.responsive = settings.responsive;
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
      await microphone.start(settings.outputMode); ear.resetCapture(context.currentTime);
      if (grid) memory.reset(grid.t0,grid.period,Math.max(grid.t0,context.currentTime));
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
    if (microphone && micRunning) {
      await microphone.start(next); ear.resetCapture(context?.currentTime); repeater.touch.reset();
    }
    settings.outputMode = next; saveSettings(settings);
    if (micRunning) element('mic').textContent = `Mic listening · ${next}`;
  } catch (error) { audioError = micError(error); }
  finally { changingMic = false; }
}
function toggleMute(which: 'clickMuted' | 'companionMuted'): void { settings[which] = !settings[which]; panicked = false; updateMutes(); }
function panic(): void {
  settings.companionMuted = true; settings.clickMuted = true; panicked = true;
  synth?.panic(); repeater.clear(); memory.clear(); scheduler?.response.reset(); updateMutes();
}
function toggleRemember(): void {
  if (!context || !micRunning) return;
  if (memory.active) memory.clear();
  else if (!memory.remember(settings.memoryBars,context.currentTime,outputDelay(context))) return;
  // Stop the old mode's queued/active tones before the next downbeat can begin the loop.
  synth?.stopEchoes(); repeater.clear(); panicked = false; updateMutes();
}
element('remember').onclick = toggleRemember;
function updateResponsive(): void {
  if (scheduler) scheduler.responsive = settings.responsive;
  element('responsive').textContent = `Responsive ${settings.responsive ? 'on' : 'off'}`;
  element('responsive').setAttribute('aria-pressed',String(settings.responsive));
}
element('responsive').onclick = () => { settings.responsive = !settings.responsive; updateResponsive(); saveSettings(settings); };
updateResponsive();
document.querySelectorAll<HTMLButtonElement>('[data-memory-bars]').forEach(button => {
  button.onclick = () => {
    const bars = Number(button.dataset.memoryBars);
    if (memory.active || !isMemoryBars(bars)) return;
    settings.memoryBars = bars; saveSettings(settings);
  };
});
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
  else if (event.code === 'KeyL') toggleRemember();
  else if (event.code === 'Escape') panic();
});
// The timer supplies lookahead; Web Audio schedules the actual click and repeat times.
const schedulerTimer = window.setInterval(() => { if (context?.state === 'running') scheduler?.tick(); },10);
window.addEventListener('pagehide', () => { window.clearInterval(schedulerTimer); synth?.panic(); repeater.clear(); memory.clear(); microphone?.stop(); });
updateMutes();
let lastPaint = -Infinity;
function render(timestamp: number): void {
  requestAnimationFrame(render);
  if (timestamp-lastPaint < 32) return;
  lastPaint = timestamp;
  const now = context?.currentTime ?? 0;
  const loop = memory.active;
  const remember = element<HTMLButtonElement>('remember');
  remember.disabled = !micRunning || (!loop && !memory.canRemember(settings.memoryBars,now));
  remember.textContent = loop ? 'Clear · L' : 'Remember · L';
  remember.setAttribute('aria-pressed',String(Boolean(loop)));
  document.querySelectorAll<HTMLButtonElement>('[data-memory-bars]').forEach(button => {
    button.disabled = Boolean(loop);
    button.setAttribute('aria-pressed',String(Number(button.dataset.memoryBars) === settings.memoryBars));
  });
  const noun = settings.memoryBars === 1 ? 'bar' : 'bars';
  let memoryStatus = `Play ${settings.memoryBars} ${noun}, then Remember.`;
  if (micRunning) {
    const available = Math.min(settings.memoryBars,memory.availableBars(now));
    memoryStatus = available < settings.memoryBars ? `Listening · ${available}/${settings.memoryBars} completed bars` :
      memory.canRemember(settings.memoryBars,now) ? `${memory.held(settings.memoryBars,now) ? 'Last phrase saved' : `${settings.memoryBars} ${noun} ready`} · ${memory.noteCount(settings.memoryBars,now)} ${memory.noteCount(settings.memoryBars,now) === 1 ? 'note' : 'notes'}` : 'Play a phrase to remember.';
  }
  if (loop) memoryStatus = now < loop.startAt ? `Starts on the next downbeat · ${Math.ceil(loop.startAt-now)}s` :
    `Looping · bar ${Math.floor(((now-loop.startAt)%loop.duration)/(loop.duration/loop.bars))+1}/${loop.bars} · ${loop.notes.length} ${loop.notes.length === 1 ? 'note' : 'notes'}`;
  if (element('memory-status').textContent !== memoryStatus) element('memory-status').textContent = memoryStatus;
  element('repeat-label').textContent = loop ? 'LOOP' : 'REPEAT';
  element('delay-value').firstChild!.textContent = String(loop?.bars ?? 2);
  element('delay-value').querySelector('span')!.textContent = loop ? (loop.bars === 1 ? 'bar' : 'bars') : 'beats';
  element('delay-seconds').textContent = loop ? `${loop.duration.toFixed(2)} seconds per loop` : `${repeater.delay.toFixed(2)} seconds later`;
  element('output').textContent = `${settings.outputMode === 'speakers' ? 'Speakers' : 'Headphones'} · H`;
  element<HTMLButtonElement>('output').disabled = changingMic;
  const scheduled = repeater.lastRepeat;
  const next = scheduled && scheduled.at > now ? scheduled : repeater.next;
  element('echo-note').textContent = next ? noteLabel(next.hz) : scheduled ? noteLabel(scheduled.hz) : '—';
  element('queue').textContent = loop ? 'Phrase held · play over it, or Clear to return to repeating' : next ? `In ${Math.max(0,next.at-now).toFixed(1)}s · two beats after your note` :
    repeater.repeatCount > 0 ? `${repeater.repeatCount} repeats · listening for your next note` : 'Ready for your first note';
  let hint = micRunning ? 'Play a note. I’ll repeat it two beats later.' : 'Set your BPM, enable audio, and play a note.';
  if (loop) hint = settings.responsive ? 'Play over your phrase. It softens while you play and returns in the pauses.' : 'Your phrase is held. Play something over it.';
  if (tempo.taps.length > 0 && tempo.taps.length < 4) hint = `Tap Space · ${tempo.taps.length}/4 · current tempo continues`;
  if (settings.companionMuted) hint = `${loop ? 'Loop' : 'Repeater'} muted · Press M to bring it back`;
  if (volume === 0) hint = 'Repeat volume is zero · Raise it in Listening settings';
  if (context?.state === 'suspended') hint = 'Audio paused · Click Enable audio to resume';
  if (panicked) hint = 'Output silenced. Loop and repeats cleared · M for repeater, C for click';
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
