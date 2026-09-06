import { Grid, mod } from './grid';
import { outputDelay } from './context';
import { fireTime } from './timing';
import type { Synth } from './synth';
import type { Repeater } from '../music/repeater';
export { fireTime } from './timing';

export class Scheduler {
  private clicked = new Set<number>();
  constructor(readonly grid: Grid, readonly synth: Synth, readonly repeater: Repeater) {}
  tick(): void {
    const now = this.synth.context.currentTime, delay = outputDelay(this.synth.context);
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
    // Echo timing belongs to the original attack, regardless of beat occupancy.
    for (const note of this.repeater.takeDue(now,delay)) {
      this.synth.note(note.midi,note.fireAt,note.duration);
      this.repeater.scheduled(note,delay);
      const slot = this.grid.slot(this.grid.onsetIndex(note.at));
      if (slot.occupancy === 'empty') slot.occupancy = 'companion';
    }
  }
}
