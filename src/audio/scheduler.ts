import { Grid, mod } from './grid';
import { outputDelay } from './context';
import { fireTime } from './timing';
import type { Synth } from './synth';
import type { Companion } from '../music/companion';
import { Response } from '../music/response';
export { fireTime } from './timing';

export class Scheduler {
  private clicked = new Set<number>();
  readonly response = new Response();
  responsive = true;
  constructor(readonly grid: Grid, readonly synth: Synth, readonly companion: Companion) {}
  tick(): void {
    const now = this.synth.context.currentTime, delay = outputDelay(this.synth.context);
    this.synth.setResponse(this.companion.active && this.responsive ? this.response.gain(now,this.grid.period) : 1);
    this.grid.maintain(now);
    const first = this.grid.indexAt(now+delay)-1;
    for (let i=first;i<=first+3;i++) {
      const slot = this.grid.slot(i);
      if (i<0 || slot.startTime-delay>now+0.075 || this.clicked.has(i)) continue;
      this.clicked.add(i);
      const time = fireTime(slot.startTime,now,delay);
      if (time !== null) this.synth.click(time,mod(i,4) === 0);
    }
    for (const i of this.clicked) if (i<first-16) this.clicked.delete(i);
    this.companion.mask.prune(now);
    const notes = this.companion.takeDue(now,delay);
    for (const note of notes) {
      this.synth.pad(note.midi,note.fireAt,note.duration,note.velocity);
      this.companion.scheduled(note,delay);
      const slot = this.grid.slot(this.grid.onsetIndex(note.at));
      if (slot.occupancy === 'empty') slot.occupancy = 'companion';
    }
  }
}
