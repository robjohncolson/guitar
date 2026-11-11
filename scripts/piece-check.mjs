// Authoring checks for a piece file. Usage:
//   node scripts/piece-check.mjs <file.piece.txt>                 compile, report problems, print the stateless bar listing
//   node scripts/piece-check.mjs <file.piece.txt> --diff <other>  compare two independent transcriptions bar by bar
//   node scripts/piece-check.mjs <file.piece.txt> --midi <file.mid> [--quarters-per-bar 3]  compare with a MIDI file's notes
//   node scripts/piece-check.mjs <file.piece.txt> --course         print the generated curriculum and guitar arrangement
import { readFile } from 'node:fs/promises';
import { runnerImport } from 'vite';
const args = process.argv.slice(2), file = args[0], option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('Usage: node scripts/piece-check.mjs <file.piece.txt> [--diff other] [--midi file.mid] [--course]'); process.exit(2); }
const load = async path => (await runnerImport(path, { configFile: false, logLevel: 'error' })).module;
const { compile, listing } = await load('/src/piece/notation.ts'), { noteName } = await load('/src/piece/score.ts');
const read = async path => { const result = compile(await readFile(path, 'utf8')); for (const d of result.diagnostics) console.log(`${path}:${d.line} ${d.level}: ${d.message}`); return result.score; };
const score = await read(file);
if (!score) { console.log('Not compiled: fix the errors above.'); process.exit(1); }
const name = m => noteName(m, score.key);
console.log(`${score.meta.title}: ${score.bars.length} written bars, ${score.playOrder.length} played, ${score.notes.length} notes, key signature ${score.key}, ${score.sections.length} sections.`);
// Notes per written bar as "beat:pitch:length:hand" strings (ties merged, so a missing tie shows up), sorted.
const onsets = s => { const bars = new Map(); for (const n of s.notes) { const k = s.bars[n.bar].number; bars.set(k, [...(bars.get(k) ?? []), `${n.tick / s.ppq}:${n.midi}:${+(n.dur / s.ppq).toFixed(3)}:${n.hand}`].sort()); } return bars; };
// Chord symbols (with their beats) and the swing feel per written bar.
const feel = s => new Map(s.bars.map(b => [b.number, `${b.harmony.map(h => `${h.symbol}@${h.tick / s.ppq + 1}`).join(' ') || 'no chord symbol'}${b.swing ? ' · swing' : ''}`]));
const compare = (a, b, labelA, labelB) => {
  let same = 0, differ = 0;
  for (const bar of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(bar) ?? [], y = b.get(bar) ?? [], onlyX = x.filter(v => !y.includes(v)), onlyY = y.filter(v => !x.includes(v));
    if (!onlyX.length && !onlyY.length && x.length === y.length) { same++; continue; }
    differ++;
    const show = list => list.map(v => { const [beat, midi, length, hand] = v.split(':'); return `${name(Number(midi))}@${Number(beat) + 1} (${length} beats, ${hand})`; }).join(' ');
    console.log(`bar ${bar}: only in ${labelA}: ${show(onlyX) || '-'} | only in ${labelB}: ${show(onlyY) || '-'}`);
  }
  console.log(`${same} bars agree on every note's pitch, start, length and hand; ${differ} differ. Look again at the page for every differing bar; agreement does not prove both are right.`);
};
const compareFeel = (a, b, labelA, labelB) => {
  let differ = 0;
  for (const [bar, text] of a) if (b.has(bar) && b.get(bar) !== text) { differ++; console.log(`bar ${bar} chords/feel: ${labelA}: ${text} | ${labelB}: ${b.get(bar)}`); }
  console.log(`${differ} bars differ in chord symbols or swing.`);
};
if (option('--diff')) { const other = await read(option('--diff')); if (other) { compare(onsets(score), onsets(other), file, option('--diff')); compareFeel(feel(score), feel(other), 'first', 'second'); } }
else if (option('--midi')) {
  const { readMidi } = await load('/src/piece/midi.ts'), midi = readMidi(new Uint8Array(await readFile(option('--midi')))), perBar = Number(option('--quarters-per-bar') ?? score.bars[0].ticks / score.ppq) * midi.division;
  const bars = new Map();
  for (const n of midi.notes) { const bar = Math.floor(n.tick / perBar) + (score.bars[0].number === 0 ? 0 : 1), beat = (n.tick % perBar) / midi.division; bars.set(bar, [...(bars.get(bar) ?? []), `${beat}:${n.midi}`].sort()); }
  console.log('MIDI bars count from the first written bar; repeats in the MIDI must be folded like the written score.');
  compare(onsets(score), bars, file, option('--midi'));
} else if (args.includes('--course')) {
  const { buildCurriculum, STAGES } = await load('/src/piece/curriculum.ts'), { arrange, guitarUnits } = await load('/src/piece/guitar.ts');
  const course = buildCurriculum(score), arrangement = arrange(score);
  console.log(course.summary.join('\n'));
  STAGES.forEach((stage, i) => { const units = course.units.filter(u => u.stage === i && !u.sameAs); if (units.length) console.log(`\n${stage} (${units.length}): ${units.map(u => u.title).join('; ')}`); });
  console.log(`\nGuitar: capo ${arrangement.capo}; shapes ${arrangement.shapes.map(s => `${s.name} ${s.frets}`).join(', ')}`);
  for (const note of arrangement.review) console.log(`  review: ${note}`);
  console.log(`Guitar steps: ${guitarUnits(score, arrangement).length}`);
} else console.log(listing(score, name));
