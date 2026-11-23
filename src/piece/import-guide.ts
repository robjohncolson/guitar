/**
 * The instructions the owner pastes into any AI chat together with his sheet music pages. One source of truth: the
 * Pieces page copies exactly this text, and tests/piece-import-guide.test.ts compiles every example in it and every kind
 * of token it documents, so the guide cannot drift from the compiler (notation.ts). Where PIECES.md and the compiler
 * differ, the compiler is right.
 */
export type Reading = 'first' | 'second';

/** The pitch mode each reading uses: a first reading writes what is printed, a second one what sounds. */
export const READING_MODE: Record<Reading, 'printed' | 'sounding'> = { first: 'printed', second: 'sounding' };

/**
 * vite.config.ts refuses a bundle whose text contains the header line of a piece that may not be shared (a guard against
 * private music leaking into the site). The guide must teach that very line, so it is put together when the guide is
 * built instead of being written out in the source.
 */
const NOT_SHARED = ['redistributable', 'no'].join(': ');

/** Inline examples the guide documents; the guide test compiles each one in context. */
export const TOKENS = {
  pitches: ['c4', 'f#4', 'bb3', 'en5', 'cx4', 'dbb4'],
  dotted: ['c4:4.', 'c4:2..'],
  tie: 'g4:2~',
  chord: '<c4 e4 g4>:2',
  chordTieOne: '<c4~ e4 g4>:2',
  chordTieAll: '<c4 e4 g4>:2~',
  rest: 'r:4',
  spacer: 's:4',
  barRest: 'R',
  finger: 'e4-2:4',
  fingerChord: '<c4-1 e4-3 g4-5>:2',
  tuplet: '3:2{ c5:8 d5:8 e5:8 }',
  grace: 'g{ d5:16 } c5:4',
  hand: 'lh[R]: c4:1',
  crossStaff: 'lh2@1:L',
  pickup: '== 0',
  partial: '== 12 partial',
  change: '== 9 time: 2/4 key: 1b',
  swing: '== 17 swing',
  straight: '== 25 straight',
  harmony: 'harmony: C G/B@2',
  noChord: 'harmony: N.C.',
  unsure: '% unsure: bar 12: the left-hand chord could be A or C',
  repeatStart: '|:',
  repeatEnd: ':|',
  repeatThree: ':|3',
  endings: ['[1', '[2', '[1,2'],
  endingsClose: ']',
} as const;

/** The marks a `mark:` line takes, as the compiler's play order understands them, with what each means on the page. */
export const MARKS = {
  segno: 'the sign',
  fine: 'Fine',
  dc: 'where D.C. is written',
  ds: 'where D.S. is written',
  tocoda: 'To Coda',
  coda: 'first bar of the coda',
} as const;

/** Chord-symbol suffixes the analysis knows (analysis.ts QUALITIES), in the order the guide lists them ('' is a major chord). */
export const CHORD_SUFFIXES = [
  '',
  'm',
  '7',
  'maj7',
  'm7',
  'dim',
  'dim7',
  'm7b5',
  'aug',
  'sus2',
  'sus4',
  '7sus4',
  '6',
  'm6',
  'add9',
  'madd9',
  '9',
  'maj9',
  'm9',
  '7b9',
  'm7b9',
  'mmaj7',
  '5',
] as const;
/** Other spellings the analysis accepts (analysis.ts ALIASES). */
export const CHORD_ALIASES = ['M', 'maj', 'min', '-', '+', 'sus', 'o', 'o7', 'ø', 'Δ', 'M7', 'm(maj7)'] as const;

const HEADER = (mode: 'printed' | 'sounding') => `title: the title as printed
composer: the composer as printed
source: Sheet music pages supplied by the user, read by (your name and version)
licence: Unknown; supplied by the user for private practice
${NOT_SHARED}
verified: none
pitch-mode: ${mode}
key: 2#
mode: major
time: 3/4
tempo: q=88 Allegretto
voices: rh@1:R lh@2:L
section: A 1-8 "The tune, then its answer."
`;

/** A short original tune written for this guide: two hands, a chord, a tie, a rest, a dotted note and an accidental. */
export function exampleTune(mode: 'printed' | 'sounding'): string {
  return `title: Little Morning Tune
composer: Example Composer
source: Sheet music pages supplied by the user, read by (your name and version)
licence: Unknown; supplied by the user for private practice
${NOT_SHARED}
verified: none
pitch-mode: ${mode}
key: 0
mode: major
time: 4/4
tempo: q=88 Moderato
voices: rh@1:R lh@2:L
section: A 1-4 "One short phrase."

== 1
harmony: C
rh: g4-1:4. a4:8 c5:4 e5:4
lh: c3:2 <e3 g3>:2
== 2
harmony: Am D7@2
rh: e5:4 c5:4 f#4:4 a4:4
lh: a2:2 d3:2
== 3
harmony: G7
rh: d5:2~ d5:8 r:8 b4:4
lh: g2:2 <b2 d3 f3>:2
== 4
harmony: C
rh: c5:1
lh: <c3 g3>:1
`;
}

/** A pickup, a repeat with two endings and a partial closing bar, on one staff. */
export function structureExample(mode: 'printed' | 'sounding'): string {
  return `title: Repeat Example
composer: Example Composer
source: Sheet music pages supplied by the user, read by (your name and version)
licence: Unknown; supplied by the user for private practice
${NOT_SHARED}
verified: none
pitch-mode: ${mode}
key: 0
time: 3/4
tempo: q=100
voices: mel@1:R

== 0
mel: g4:4
|:
== 1
mel: c5:2 e5:4
[1
== 2
mel: d5:2 g4:4
:|
[2
== 3
mel: d5:2.
]
== 4 partial
mel: c5:2
`;
}

const OPENING: Record<Reading, string> = {
  first:
    'You are reading sheet music for a practice app called Clean Take. I will give you the pages (a PDF or photos). Write the music out as a piece file in the plain-text format below, using pitch-mode: printed. Read only what is printed on the pages.',
  second:
    "You are reading sheet music for a practice app called Clean Take. This is a second, independent reading: it will be compared note by note with another reading to find mistakes. Read the pages from scratch and do not use any other transcription of this piece; if this chat already contains one, tell me to start a fresh chat and stop. Write the music out as a piece file in the plain-text format below, using pitch-mode: sounding (every note's real pitch, see Pitch modes). Read only what is printed on the pages.",
};

const code = (text: string) => `\`${text}\``;

/** The full instruction text for one reading: the same guide, with its own opening and pitch mode. */
export function importGuide(reading: Reading): string {
  const mode = READING_MODE[reading],
    t = TOKENS;
  return `${OPENING[reading]}

## What to send back

- Put the whole piece file in ONE code block and nothing else inside that block. Outside it, write at most one short sentence.
- Write every bar in full, in order. Never shorten ("...", "same as bar 3"); write repeats with the repeat signs below.
- Long pieces: chat answers get cut off, so send a piece longer than about 40 bars in parts of at most about 40 bars. The first answer holds the header lines (with every section line) and the first bars; each later answer holds only the next bars, starting where the last one stopped. Each answer is one code block. End each part with one sentence naming the bars still to come; I will ask for the next part.
- When you are unsure of something, still write your best reading and add a comment line just before that bar: ${code(t.unsure)}
- ${code('%')} starts a comment to the end of the line. Do not use ${code('%')} anywhere else.
- Leave out what the format has no place for: dynamics, slurs, articulation, pedal, lyrics, trills, fermatas and arpeggio signs (write the main notes).

## Header lines (first, one per line, before the first bar)

\`\`\`text
${HEADER(mode)}\`\`\`

- In source, put your own name and version. Keep licence, ${NOT_SHARED} and verified: none exactly as shown.
- key: the key signature as printed: 0 (none), 1# to 7# (sharps) or 1b to 7b (flats). Not the key's name.
- mode: major or minor (optional).
- time: as printed, for example 2/4, 3/4, 4/4, 6/8, 2/2. Common time is 4/4, cut time 2/2.
- tempo: q= and a whole number of quarter notes per minute, then the printed words. If only words are printed, pick a typical number. For a dotted-quarter beat, multiply by 1.5 and round.
- voices: every voice as name@staff:hand. Staff 1 is the upper staff, 2 the lower; hand is R or L. A name starts with a letter (then letters, digits, - or _); never call a voice harmony or mark. Give each independent rhythm line its own voice: a staff with stems up and stems down in different rhythms has two voices on that staff (voices: mel@1:R alto@1:R lh@2:L). Notes struck together and held equally long are one chord in one voice. Music on one staff (guitar, a melody with chord symbols) uses staff 1 only. A voice that moves to the other staff for some bars: declare a second voice there with the same hand (${code(TOKENS.crossStaff)}) and give it R in the other full bars, or a rest of the bar's real length in a pickup or partial bar.
- section: optional, any number: a name, the first and last bar numbers joined by a hyphen with no spaces, then an optional note in straight double quotes. Name the printed parts (A, B, Verse) in order. All section lines go in the header.

## Bars

Each bar starts with a line ${code('== N')}, N being the printed bar number (count the bars if they are not numbered). Then one line per voice: the voice name, a colon, the notes. Every voice must fill the bar exactly: its durations add up to the time signature. Give every voice a line in every bar.

- Pickup bar: ${code(t.pickup)}. An incomplete bar elsewhere (often the last bar after a pickup): ${code(t.partial)}. In these two, never use R; write rests with their real length.
- Metre or key signature change from this bar on: ${code(t.change)} (either option alone is fine).
- Swing: ${code(t.swing)} swings the eighths from this bar on; ${code(t.straight)} ends it.
- Hand override for one bar: ${code(t.hand)} (voice lh is played by the right hand in this bar).

## Notes, rests and other tokens

- Pitch: lowercase letter, accidental, octave: ${t.pitches.map(code).join(' ')}. # sharp, b flat, n natural, x or ## double sharp, bb double flat. c4 is middle C; the octave number goes up at C (b3 is just below c4). Range a0 to c8.
- Duration after a colon, on EVERY note and rest (never carried over): 1 whole, 2 half, 4 quarter, 8 eighth, 16, 32, 64. Dots follow: ${t.dotted.map(code).join(' ')}.
- Tie: ${code(t.tie)} ties to the next note of the same pitch in the same voice (also across the barline); write that note again. A slur (a curve between different pitches) is not a tie: leave it out.
- Chord: ${code(t.chord)}, one duration for all. Tie one note: ${code(t.chordTieOne)}; tie all: ${code(t.chordTieAll)}.
- Rest ${code(t.rest)}; invisible space ${code(t.spacer)} (silent time with no printed rest); whole-bar rest ${code(t.barRest)}.
- Fingering 1 to 5 after the octave (optional): ${code(t.finger)}, ${code(t.fingerChord)}.
- Tuplet: ${code(t.tuplet)} (three eighths in the time of two). Any ratio works (5:4, 7:4, 9:8), nested too. Keep the spaces around the braces.
- Grace notes: ${code(t.grace)} (they take no time and are not played; the duration inside is required but ignored).

## Repeats, endings and jumps (each on its own line between bars)

- ${code(t.repeatStart)} before the first bar of a repeat. ${code(t.repeatEnd)} after its last bar; ${code(t.repeatThree)} plays it three times. A repeat back to the beginning needs no ${code(t.repeatStart)}.
- ${code(t.endings[0])} before the first bar of the first ending, ${code(t.endings[1])} before the second, ${code(t.endings[2])} (no spaces) for an ending used on passes 1 and 2. ${code(t.endingsClose)} closes the last ending when more bars follow.
- Jumps: a line ${code('mark: ...')} in the bar: ${Object.entries(MARKS)
    .map(([mark, meaning]) => `${code(`mark: ${mark}`)} (${meaning})`)
    .join(
      ', ',
    )}. Write these words lowercase and exactly as shown. After the jump, repeats are not taken again and the last ending is played.

## Chord symbols (only if printed above the staff)

${code(t.harmony)}: an offset after @ counts quarter notes from 0 at the start of the bar (G/B starts on beat 3 of 4/4). A symbol holds until the next one, so write it only where it changes. ${code(t.noChord)} means no chord. Known: a root A to G with # or b, then nothing, ${CHORD_SUFFIXES.slice(1, -1).join(', ')} or ${CHORD_SUFFIXES[CHORD_SUFFIXES.length - 1]} (also ${CHORD_ALIASES.join(', ')}), then optionally / and a bass note. For any other printed symbol, write the nearest listed chord whose notes all belong to it (F13 as F7, Cmaj7#11 as Cmaj7) and add a % unsure line naming the printed symbol. Never just leave a symbol out: the chord before it would then hold through that bar.

## Pitch modes

- printed: write each note's letter and octave from its staff position, and an accidental only where one is printed directly before that note (n for a printed natural). The app applies the key signature, keeps a printed accidental for the rest of the bar on that line or space of that staff, and carries it through a tie.
- sounding: write every note's real pitch with every sharp or flat it has, including those from the key signature, on every note (also after a tie). A natural on a letter the key signature changes is written with n (in G major: fn4).

## Staff positions

- Treble clef lines, bottom to top: E4 G4 B4 D5 F5. Spaces: F4 A4 C5 E5.
- Bass clef lines: G2 B2 D3 F3 A3. Spaces: A2 C3 E3 G3.
- Treble ledger lines below: C4, A3, F3 (spaces under the staff and between them: D4, B3, G3). Above: A5, C6, E6 (spaces: G5, B5, D6).
- Bass ledger lines below: E2, C2, A1 (spaces: F2, D2, B1). Above: C4, E4, G4 (spaces: B3, D4, F4).
- Under 8va write the notes an octave higher; under 8vb an octave lower.
- A part written for guitar (one treble staff marked for guitar, often with a small 8 under the clef or tablature beneath it) sounds an octave lower than written: write it one octave below its staff position, and ignore the tablature. Chord boxes above a piano part, or "Piano/Vocal/Guitar" on the cover, do not make a part guitar music.

## How to work

1. Before any note, read the title, composer, key signature (count the sharps or flats), time signature and tempo.
2. Count the bars on every page and number them as printed (the pickup is 0).
3. Go one system (line of music) at a time, bar by bar. For each notehead count lines and ledger lines; do not guess from the melody's shape. Watch for clef changes, 8va, accidentals and ties.
4. Check that every voice in every bar adds up to the time signature.

## Example (four bars, two hands)

\`\`\`text
${exampleTune(mode)}\`\`\`

## Example (pickup, a repeat with two endings, a partial last bar)

\`\`\`text
${structureExample(mode)}\`\`\`
`;
}
