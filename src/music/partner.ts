import { Grid } from '../audio/grid';
import { SelfMask } from '../audio/self-mask';
import { median } from '../audio/tap-tempo';
import { ScaleTracker } from './scales';
import type { NoteOn } from './notes';
import { holeFiller } from './voice/hole-filler';
import { bass } from './voice/bass';
import { harmony } from './voice/harmony';
import { CallResponse } from './voice/call-response';
import type { Density, Role, VoiceNote, VoiceContext } from './voice/types';

export class Partner {
  readonly scales = new ScaleTracker();
  readonly mask = new SelfMask();
  readonly calls = new CallResponse();
  role: Role = 'hole-filler';
  density: Density = 'shy';
  lastPlayer?: NoteOn;
  private playerPitches: number[] = [];
  private playerSinceCompanion = false;
  private attacks: number[] = [];
  private lastCompanion = -Infinity;
  private lastAccepted = -Infinity;
  private bleedSuspicions = 0;
  hearingSelfUntil = -Infinity;
  grid?: Grid;
  setGrid(grid?: Grid): void {
    this.grid = grid; this.attacks = []; this.playerSinceCompanion = false; this.calls.reset();
  }
  attack(t: number): void {
    this.attacks.push(t); this.attacks = this.attacks.filter(time => time >= t - 0.2);
  }
  accept(note: NoteOn): boolean {
    if (this.mask.drops(note)) return false;
    const previousGuess = this.scales.guess;
    const slot = this.grid?.claimPlayer(note.t);
    if (slot) this.calls.record(slot.index,note);
    this.scales.add(note, Boolean(slot && Math.abs(note.t-slot.startTime) <= this.grid!.period * 0.15));
    const nextGuess = this.scales.guess;
    if (note.t - this.lastCompanion < 0.6 && note.t - this.lastAccepted > 0.7 && previousGuess && nextGuess &&
      (previousGuess.tonic !== nextGuess.tonic || previousGuess.id !== nextGuess.id)) {
      if (++this.bleedSuspicions >= 2) this.hearingSelfUntil = note.t + 8;
    } else if (note.t - this.lastCompanion > 1) this.bleedSuspicions = 0;
    this.lastAccepted = note.t; this.lastPlayer = note; this.playerSinceCompanion = true;
    this.playerPitches.push(note.midi); this.playerPitches = this.playerPitches.slice(-24);
    return true;
  }
  decide(index: number, now: number): VoiceNote | null {
    const grid = this.grid, scale = this.scales.active;
    if (!grid || !scale || !this.lastPlayer) return null;
    const slot = grid.slot(index);
    // A raw attack reserves decision time while CREPE settles; it never enters the histogram.
    if (this.attacks.some(t => now - t < 0.14 && grid.onsetIndex(t) === index)) return null;
    // Once a player pattern is established, do not pre-schedule into that beat on high-latency output.
    if (index >= 8 && grid.slot(index-4).occupancy === 'player' && grid.slot(index-8).occupancy === 'player') return null;
    const context: VoiceContext = { slot, previous: grid.slot(index-1), scale, lastPlayer: this.lastPlayer,
      playerMedian: median(this.playerPitches), density: this.density, ready: this.scales.ready, playerSinceCompanion: this.playerSinceCompanion };
    if (this.role === 'bass') return bass(context);
    if (this.role === 'harmony') return harmony(context);
    if (this.role === 'call-response') return this.calls.decide(context);
    return holeFiller(context);
  }
  scheduled(index: number, note: VoiceNote): void {
    if (!this.grid) return;
    const slot = this.grid.slot(index); slot.occupancy = 'companion';
    this.mask.arm(slot.startTime, note.duration, note.midi);
    this.playerSinceCompanion = false; this.lastCompanion = slot.startTime;
  }
}
