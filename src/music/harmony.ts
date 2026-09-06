import { median } from '../audio/tap-tempo';
import { hzToMidi, pitchClass } from './notes';
import type { Motif } from './motif';

export type ReplyMode = 'echo' | 'harmony';
export interface HarmonyPlan { readonly kind: 'harmony' | 'octave'; readonly midis: readonly number[]; readonly gain: number }
const major = [0,2,4,5,7,9,11];
const mod = (n:number) => (n%12+12)%12;

/** Infer a pitch collection, without pretending a short phrase identifies a unique key. */
function collection(midis: readonly number[]): number[] | undefined {
  const pcs = new Set(midis.map(pitchClass));
  if (pcs.size < 3) return;
  const candidates = Array.from({length:12},(_,root) => {
    const scale = major.map(step => mod(root+step)).sort((a,b)=>a-b);
    if (![...pcs].every(pc => scale.includes(pc))) return;
    const scores = [[root,mod(root+4),mod(root+7)],[mod(root+9),root,mod(root+4)]].map(triad => {
      const complete = triad.every(pc => pcs.has(pc));
      const score = (complete ? 4 : 0)+(pitchClass(midis[0]) === triad[0] ? 0.75 : 0)+
        (pitchClass(midis.at(-1)!) === triad[0] ? 0.25 : 0);
      return {score,complete};
    }).sort((a,b)=>b.score-a.score);
    return {scale,...scores[0]};
  }).filter(candidate => candidate !== undefined).sort((a,b)=>b.score-a.score);
  if (!candidates.length) return;
  const best = candidates[0];
  if (candidates.length === 1 && pcs.size >= 4 || best.complete && best.score-(candidates[1]?.score ?? -Infinity) >= 0.5) return best.scale;
  // Different possible keys can still agree on every proposed third (e.g. A-C-E).
  const thirds = (scale:number[]) => midis.map(midi => scale[(scale.indexOf(pitchClass(midi))+2)%7]).join(',');
  if (candidates.every(candidate => thirds(candidate.scale) === thirds(best.scale))) return best.scale;
}

function lengths(motif: Motif, cycle: number): number[] {
  const origin = motif.notes[0].t;
  return motif.notes.map((note,i) => {
    const space = (motif.notes[i+1]?.t ?? origin+cycle)-note.t;
    return Math.max(0,Math.min(space,note.duration ?? space));
  });
}

/** Compare the whole sounding reply span with the guitar expected at its delayed landing. */
function landingCost(motif: Motif, midis: readonly number[], durations: readonly number[], cycle:number, shift:number, index:number, midi:number): number {
  const origin = motif.notes[0].t, from = motif.notes[index].t-origin+shift, length = durations[index];
  if (length <= 0) return 0;
  const penalties = [0.3,15,5,0,0,1,14,0.2,0,0,5,15];
  let cost = 0;
  for (const repeat of [0,1]) motif.notes.forEach((note,i) => {
    const start = note.t-origin+repeat*cycle;
    const overlap = Math.max(0,Math.min(from+length,start+durations[i])-Math.max(from,start));
    cost += overlap/length*penalties[mod(Math.round(midi)-Math.round(midis[i]))];
  });
  return cost;
}

const motion = (a:number,b:number) => Math.abs(a-b)*0.07+Math.max(0,Math.abs(a-b)-5)**2*0.06;

/** One deterministic line per phrase. No new attacks, durations, or harmonic decisions between passes. */
export function planHarmony(motif: Motif, period:number): HarmonyPlan {
  const input = motif.notes.map(note => hzToMidi(note.hz)), scale = collection(input);
  if (!scale) {
    const midis = input.map(midi => {
      let doubled = midi+12;
      while (doubled > 84) doubled -= 12;
      while (doubled < 48) doubled += 12;
      return doubled;
    });
    return Object.freeze({kind:'octave',midis:Object.freeze(midis),gain:0.55});
  }
  const tuning = median(input.map(midi => midi-Math.round(midi)));
  const cycle = motif.beats*period, durations = lengths(motif,cycle);
  const center = Math.max(52,Math.min(79,median(input)+4));
  const options = input.map((source,i) => {
    const degree = scale.indexOf(pitchClass(source));
    const colors = [2,5,4,0].map(step => scale[(degree+step)%7]);
    const third = Math.round(source)+mod(colors[0]-pitchClass(source));
    const result: {midi:number;cost:number}[] = [];
    for (let midi=48;midi<=84;midi++) {
      const color = colors.indexOf(pitchClass(midi));
      if (color < 0) continue;
      const cost = [0,2.6,3.2,4][color]+Math.abs(midi-third)*0.1+Math.abs(midi-center)*0.025+
        Math.max(0,source-midi)*0.12+landingCost(motif,input,durations,cycle,period/2,i,midi);
      result.push({midi,cost});
    }
    return result;
  });
  let best: {cost:number;line:number[]} | undefined;
  // Close the voice-leading path across the loop boundary as well as inside it.
  for (const first of options[0]) {
    let paths = [{cost:first.cost,line:[first.midi]}];
    for (let i=1;i<options.length;i++) paths = options[i].map(option => {
      const previous = paths.reduce((best,path) => path.cost+motion(path.line.at(-1)!,option.midi) < best.cost+motion(best.line.at(-1)!,option.midi) ? path : best);
      return {cost:previous.cost+option.cost+motion(previous.line.at(-1)!,option.midi),line:[...previous.line,option.midi]};
    });
    for (const path of paths) {
      const cost = path.cost+motion(path.line.at(-1)!,first.midi);
      if (!best || cost < best.cost) best = {cost,line:path.line};
    }
  }
  return Object.freeze({kind:'harmony',midis:Object.freeze(best!.line.map(midi => midi+tuning)),gain:0.72});
}
