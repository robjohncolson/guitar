import './styles.css';
import { enableContext, outputDelay } from './audio/context';
import { TapTempo } from './audio/tap-tempo';
import { Grid, mod } from './audio/grid';
import { Synth } from './audio/synth';
import { Scheduler } from './audio/scheduler';
import { Ear } from './audio/ear';
import { Microphone } from './audio/worklet-grabber';
import { noteLabel } from './music/notes';
import { scaleLabel } from './music/scales';
import { Partner } from './music/partner';
import { roles } from './music/voice/types';
import type { Role } from './music/voice/types';
import { shell, element } from './ui/render';
import { loadSettings, saveSettings } from './ui/settings';

shell();
const settings = loadSettings();
const tempo = new TapTempo();
const partner = new Partner();
const scales = partner.scales;
partner.role = settings.role;
partner.density = settings.density;
let context: AudioContext | undefined;
let synth: Synth | undefined;
let scheduler: Scheduler | undefined;
let grid: Grid | undefined;
let microphone: Microphone | undefined;
let micRunning = false;
let changingMic = false;
let audioError = '';
let panicked = false;
let volume = 0.22;

const ear = new Ear(
  text => { element('model').textContent = text; element('model').classList.toggle('error', /error|FALLBACK/.test(text)); },
  pitch => {
    if (pitch.hz > 0 && pitch.confidence >= ear.onsets.threshold) element('note').textContent = noteLabel(pitch.hz);
    element('pitch-detail').textContent = `${pitch.hz > 0 ? pitch.hz.toFixed(1) : '—'} Hz · ${Math.round(pitch.confidence * 100)}% confidence`;
  },
  note => { partner.accept(note); },
  t => partner.attack(t)
);
ear.onsets.threshold = settings.voicedThreshold;
void ear.load();

function persist(): void {
  settings.role = partner.role; settings.density = partner.density;
  saveSettings(settings);
}
function updateMutes(): void {
  if (synth) { synth.volume = volume; synth.setMutes(settings.companionMuted, settings.clickMuted); }
  if (scheduler) scheduler.companionMuted = settings.companionMuted || volume === 0;
  element('click-mute').textContent = `Click ${settings.clickMuted ? 'off' : 'on'} · C`;
  element('companion-mute').textContent = `Companion ${settings.companionMuted ? 'off' : 'on'} · M`;
  element('click-mute').setAttribute('aria-pressed', String(settings.clickMuted));
  element('companion-mute').setAttribute('aria-pressed', String(settings.companionMuted));
  persist();
}
function attachGrid(next?: Grid): void {
  grid = next; partner.setGrid(next);
  scheduler = grid && synth ? new Scheduler(grid, synth, partner) : undefined;
  updateMutes();
}
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
    const hadContext = Boolean(context);
    context = await enableContext(context);
    synth ??= new Synth(context);
    if (!hadContext && grid) attachGrid(new Grid(grid.t0 + context.currentTime - performance.now()/1000, grid.period));
    else if (!scheduler && grid) attachGrid(grid);
    updateMutes();
    element('mic').textContent = 'Mic requesting permission';
    microphone ??= new Microphone(context, message => ear.receive(message));
    if (!micRunning) { await microphone.start(settings.outputMode); ear.resetCapture(); }
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
    settings.outputMode = next; persist();
    if (micRunning) element('mic').textContent = `Mic listening · ${next}`;
  } catch (error) { audioError = micError(error); }
  finally { changingMic = false; }
}
function toggleDensity(): void { partner.density = partner.density === 'shy' ? 'busy' : 'shy'; persist(); }
function selectRole(role: Role): void { partner.role = role; persist(); }
function toggleMute(which: 'clickMuted' | 'companionMuted'): void { settings[which] = !settings[which]; panicked = false; updateMutes(); }
element('click-mute').onclick = () => toggleMute('clickMuted');
element('companion-mute').onclick = () => toggleMute('companionMuted');
element('lock').onclick = () => scales.toggleLock();
element('density').onclick = toggleDensity;
element('output').onclick = () => { void toggleOutput(); };
for (const id of ['density','companion-mute','output']) element<HTMLButtonElement>(id).disabled = false;
document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(button => {
  button.disabled = false; button.onclick = () => selectRole(roles[Number(button.dataset.role)]);
});
const threshold = element<HTMLInputElement>('threshold');
threshold.value = String(settings.voicedThreshold);
element('threshold-value').textContent = settings.voicedThreshold.toFixed(2);
threshold.oninput = () => {
  settings.voicedThreshold = Number(threshold.value); ear.onsets.threshold = settings.voicedThreshold;
  element('threshold-value').textContent = settings.voicedThreshold.toFixed(2); persist();
};
element<HTMLInputElement>('volume').oninput = event => {
  volume = Number((event.target as HTMLInputElement).value);
  element('volume-value').textContent = `${Math.round(volume*200)}%`; updateMutes();
};

window.addEventListener('keydown', event => {
  if (event.code === 'Space') {
    event.preventDefault();
    if (event.repeat) return;
    if (event.shiftKey) { tempo.reset(); synth?.panic(); attachGrid(); return; }
    const performanceTime = performance.now()/1000;
    const bpm = tempo.tap(performanceTime);
    if (bpm !== null) {
      // Cancel output queued on the old phase before nudging the clock.
      synth?.panic();
      attachGrid(new Grid(context?.currentTime ?? performanceTime, 60/bpm));
    }
    return;
  }
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'KeyC') toggleMute('clickMuted');
  else if (event.code === 'KeyM') toggleMute('companionMuted');
  else if (event.code === 'KeyL') scales.toggleLock();
  else if (event.code === 'KeyD') toggleDensity();
  else if (event.code === 'KeyH') void toggleOutput();
  else if (/^Digit[1-4]$/.test(event.code)) selectRole(roles[Number(event.code.slice(-1))-1]);
  else if (event.code === 'Escape') {
    settings.companionMuted = true; settings.clickMuted = true; panicked = true;
    synth?.panic(); updateMutes();
  }
});

// Timer callbacks only supply scheduling opportunities. Musical event times are Web Audio times.
const schedulerTimer = window.setInterval(() => { if (context?.state === 'running') scheduler?.tick(); }, 10);
window.addEventListener('pagehide', () => { window.clearInterval(schedulerTimer); synth?.panic(); microphone?.stop(); });
updateMutes();
let lastPaint = -Infinity;
function render(timestamp: number): void {
  requestAnimationFrame(render);
  if (timestamp-lastPaint < 32) return;
  lastPaint = timestamp;
  const now = context?.currentTime ?? performance.now()/1000;
  element('bpm').textContent = tempo.bpm === null ? '—' : String(Math.round(tempo.bpm));
  if (context) scales.decay(now);
  const guess = scales.guess, active = scales.locked ?? guess;
  element('scale').textContent = active ? `${scaleLabel(active)} · ${Math.round((guess?.confidence ?? 0)*100)}% · ${scales.locked ? 'locked' : 'unlocked'}` : 'Listening for a key';
  element<HTMLProgressElement>('scale-confidence').value = guess?.confidence ?? 0;
  element('onsets').textContent = `${scales.onsetCount} notes heard${scales.locked && guess ? ` · guess: ${scaleLabel(guess)}` : ''}`;
  element<HTMLButtonElement>('lock').disabled = !active;
  element('lock').textContent = scales.locked ? 'Unlock · L' : 'Lock · L';
  element('lock').setAttribute('aria-pressed',String(Boolean(scales.locked)));
  element('density').textContent = `${partner.density === 'shy' ? 'Shy' : 'Busy'} · D`;
  element('density').setAttribute('aria-pressed', String(partner.density === 'busy'));
  element('output').textContent = `${settings.outputMode === 'speakers' ? 'Speakers' : 'Headphones'} · H`;
  element<HTMLButtonElement>('output').disabled = changingMic;
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(button => {
    const selected = roles[Number(button.dataset.role)] === partner.role;
    button.classList.toggle('selected',selected); button.setAttribute('aria-pressed',String(selected));
  });
  let hint = 'Tap Space 4 times to set the pulse';
  if (!grid && tempo.taps.length > 0) hint = `Tap Space 4 times to set the pulse · ${tempo.taps.length}/4`;
  if (grid) hint = 'Play. I’ll wait until the scale is clear.';
  if (grid && guess) hint = scales.locked ? `Scale locked · ${scales.onsetCount < 6 ? `${6-scales.onsetCount} more notes to begin` : 'Keep playing.'}` : `Looks like ${scaleLabel(guess)}. Press L to lock.`;
  if (grid && scales.ready) hint = `Filling holes · ${partner.role} · ${partner.density}`;
  if (grid && settings.companionMuted) hint = 'Companion muted · Press M to bring it back';
  if (!context) hint += ' · Enable audio to listen';
  if (partner.hearingSelfUntil > now && settings.outputMode === 'speakers') hint = 'Hearing myself — try headphones (H)';
  if (context?.state === 'suspended') hint = 'Audio paused · Click Enable audio to resume';
  if (panicked) hint = 'Output silenced. Pulse continues · M for companion, C for click';
  if (audioError) hint = audioError;
  element('hint').textContent = hint;
  if (context) element('latency').textContent = `${Math.round(outputDelay(context)*1000)} ms output`;
  const index = grid?.indexAt(now) ?? -1;
  document.querySelectorAll<HTMLElement>('.beat').forEach((cell, beat) => {
    const slot = grid?.slot(index-mod(index,4)+beat);
    cell.className = `beat ${slot?.occupancy ?? ''} ${grid && mod(index,4) === beat ? 'active' : ''}`;
    cell.querySelector('small')!.textContent = slot?.occupancy ?? 'empty';
    cell.setAttribute('aria-label', `Beat ${beat+1}: ${slot?.occupancy ?? 'empty'}`);
  });
}
requestAnimationFrame(render);
