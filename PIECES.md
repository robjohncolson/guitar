# Pieces: from sheet music to a practice course

The **Pieces** page (`/piece.html`) turns one piece of music into a course: every chord, every change between chords, each passage per hand and hands together, the joins between passages, each section, the whole piece with its repeats, and scale, arpeggio and cadence drills in the piece's key. A guitar accompaniment is arranged from the same harmony with its own course. Everything is generated in the browser from one plain-text **piece file**; nothing is uploaded.

## Adding a piece (owner and AI assistant)

1. **Hand over the music.** A PDF or a photo per page. Say whether the piece is public domain (for example, composer died more than 70 years ago and the edition adds nothing) or private.
2. **Render pages large.** The assistant reads each page as an image. For dense music, render at 300 DPI and look at one system at a time (for example with PyMuPDF in a throwaway virtual environment: `page.get_pixmap(dpi=300)`).
3. **Transcribe twice, independently.** First pass in `pitch-mode: printed` (write what is printed; the compiler applies the key signature and bar-long accidentals). Second pass from a fresh start in `pitch-mode: sounding` (write every sharp or flat that sounds). Do not copy between them.
4. **Check.** `node scripts/piece-check.mjs mine.piece.txt` compiles and prints a plain listing of every bar. `--diff other.piece.txt` lists every bar where the two transcriptions disagree on any note's pitch, start, length (ties merged) or hand, then every bar whose chord symbols or swing differ. Resolve each by looking at the page again, never by majority or memory. If a MIDI or MusicXML-derived MIDI exists, `--midi file.mid` compares notes too.
5. **Listen.** Open the file in the app (**Add your own piece**) and use **Hear the whole piece**, then each section, with the notes falling on the keyboard. A wrong note usually sounds wrong. Mark `verified: owner` when you are satisfied.
6. **Where it lives.** Public-domain packs with `redistributable: yes` go in `src/piece/packs/` and ship with the site (a test rejects any committed pack that is not). Private or copyrighted music goes in `src/piece/packs/local/` (git-ignored) or is opened in the app, where it stays in this browser's storage. Local packs are read by the dev server only (`npm run dev`, then `/piece.html`). A build leaves them out, and stops with an error if a local pack or any piece marked `redistributable: no` would be bundled; the published site is built in GitHub Actions from a fresh clone, where local packs do not exist. On a deployed site, open the file with **Add your own piece** instead.

Only the notes, sections and optional chord names are authored. Analysis, chunking, the curriculum, drills and the guitar arrangement are deterministic code, so improving them improves every piece.

## The piece file

```text
% Comments start with a percent sign.
title: Gymnopédie No. 1
composer: Erik Satie, 1888
source: where the notes came from, with a URL
licence: Public domain
redistributable: yes          % only for music anyone may share
verified: sources             % none | checks | sources | owner
pitch-mode: printed           % printed or sounding (see below)
key: 2#                       % as printed: 0, 1# to 7#, 1b to 7b
mode: major                   % optional: major or minor
time: 3/4
tempo: q=66 Lent et douloureux
voices: mel@1:R acc@1:L lo@2:L   % name@staff:hand for every voice
section: Theme 5-12 "What the learner should notice."

|:                            % repeat start (on its own line)
== 1                          % bar number, then one line per voice
harmony: Gmaj7                % optional; several: Em@0 A/E@2 (beat offsets)
mel: R                        % whole-bar rest
acc: r:4 <b3 d4 f4>:2         % rest, then a chord
lo: g2:2.
== 2
...
[1                            % first ending starts
== 32
...
:|                            % repeat end (after its bar)
[2                            % second ending
== 40
...
```

| Token | Meaning |
| --- | --- |
| `c4`, `f#5`, `bb3`, `en4`, `cx4` | Pitch: letter, accidental (`#`, `b`, `n` natural, `x` double sharp, `bb` double flat), octave. Middle C is `c4`. |
| `:4`, `:8.`, `:2.` | Duration: 1, 2, 4, 8, 16, 32, 64 with dots. Every note needs one. |
| `~` after the duration | Tie to the same pitch in the next note of this voice (also across the barline). |
| `<b3 d4 f#4>:2` | Chord. `~` after a single pitch inside ties just that note. |
| `r:4`, `s:4`, `R` | Rest, invisible spacer, whole-bar rest. |
| `c4-1:4` | Printed fingering 1 to 5. |
| `3:2{ c5:8 d5:8 e5:8 }` | Tuplet: three in the time of two. |
| `g{ e5:16 } f5:8` | Grace note(s) before a note: read and accidental-checked, but take no time and are not played or graded. |
| `== 60 swing`, `== 92 straight` | From this bar on, eighths are swung (an off-beat eighth sounds two thirds through the beat) or straight again. |
| `harmony: N.C.` | No chord in this bar: no chord step and no guitar strum. |
| `acc[R]: ...` | This voice is played by the other hand in this bar. |
| `== 0` or `== 12 partial` | Pickup bar or incomplete closing bar. `== 9 time: 2/4 key: 1b` changes metre or key. |
| `mark: fine`, `dc`, `ds`, `segno`, `coda`, `tocoda` | Jumps; the play order is computed. |

A chord symbol holds until the next one, as on a lead sheet, so write `harmony:` only where the printed symbol changes (or `N.C.`). Bars before the first symbol, or in a piece with none, are named from their notes.

**printed** mode writes each note by its staff position plus only the accidental printed right before it; the compiler applies the key signature, keeps an accidental for the rest of the bar on that staff line, and carries a tied accidental across the barline. **sounding** mode writes the sounding pitch with every sharp and flat; a natural that the key signature would alter must be written `n` (for example `cn5`), or the compiler warns.

A voice that moves to the other staff for some bars is written as a separate voice declared on that staff. Staff is not hand: decide hands per voice and override per bar with `[L]`/`[R]`.

### Reading positions on the staff

| | Treble clef | Bass clef |
| --- | --- | --- |
| Lines, bottom to top | E4 G4 B4 D5 F5 | G2 B2 D3 F3 A3 |
| Spaces, bottom to top | F4 A4 C5 E5 | A2 C3 E3 G3 |
| 1st, 2nd, 3rd ledger line below | C4, A3, F3 | E2, C2, A1 |
| Spaces under the staff and between those ledger lines | D4, B3, G3 | F2, D2, B1 |
| 1st, 2nd, 3rd ledger line above | A5, C6, E6 | C4, E4, G4 |
| Spaces above the staff and between those ledger lines | G5, B5, D6 | B3, D4, F4 |

Count lines and ledger lines for every notehead; do not guess from the melodic shape. Watch for `8va` signs, clef changes and cross-staff beams.

### Common transcription mistakes the checks catch

- A bar that does not add up: the compiler reports the voice and how many beats it fills.
- A forgotten key-signature sharp in sounding mode: warned unless written `n`.
- A tie that does not reach the same pitch: warned at the line.
- A misspelt bar option such as `== 78 swingg`: warned, because it would silently change the rhythm.
- Two transcriptions disagreeing: `--diff` lists the bars.

Nothing catches a mistake both transcriptions share; that is what listening is for.

## How a course is built

Analysis reads the key (signature plus the closing bass), each bar's chord (authored names win; otherwise a template match), the shapes each hand grabs, phrase-aware chunks of up to 16 beats inside each section (ending after long melody notes, never inside a held note), repeated material (practised once) and a transparent difficulty ranking (speed, stretch, leaps, chords, accidentals).

| Step | What you play | Opens after |
| --- | --- | --- |
| Hear the piece | The whole piece played for you | - |
| Chords | Each chord as written, then one note at a time (each note can then be checked) | - |
| Chord changes | Each neighbouring pair, alternating | both chords at 60% |
| Left hand, right hand | Each passage alone, up to 80% of the goal tempo (a hand with only a pickup or one chord there is learned hands together instead) | - |
| Hands together | Each passage | both hands at 70% |
| Joins | Last bar of one passage into the next, including across repeats | both passages at 70% |
| Sections, whole piece | Without stopping | passages at 80%, sections at 88% |
| Key drills | Scales, arpeggios and a I–IV–V–I cadence with standard fingering; borrowed keys optional | - |

Every step climbs 50, 60, 70, 80, 88, 94 and 100% of the goal tempo (default: the piece's marking; change it in Sound & timing). Two clean, comfortable takes (trusted, 90% or better) climb one step; at 80% and 100% three takes fade the help (notes shown, then hidden, then a click only on each bar); two hard takes step down. **Already know it?** The tempo-step strip has a placement control ("Already know this? Try it at N BPM"; pick the step on the strip, default its top step). That take is graded like any other, with the notes shown; if it is trusted, calibrated (keys and MIDI count as calibrated), 90% or better and you answer "Felt comfortable", the step moves to that tempo and the take counts as its first clean take there (at 80% and 100% the notes-shown take, so the help fades from the next one). A miss records nothing: no attempt, no hard take, no step down, no personal best. Wait for me never places, one-hand steps place no higher than 80%, and a clean hands-together placement also places the one-hand steps for the same bars at their highest step at or below it (never certified). Certification and learning still need the fading takes and two days. A step is learned after the goal tempo is certified on two different days, then comes back for review after 1, 2, 4, 8, 16 and 32 days. **Today's practice** suggests a warm-up drill, due reviews, at most two new steps and one play-through. These numbers are defaults from the practice literature summarised in `IMPLEMENTATION_NOTES.md`, not proven optima.

## Guitar accompaniment

For each chord the arranger picks the easiest shape that never adds a pitch outside the chord and keeps its third; colour tones it leaves out are listed for review. One capo position for the whole piece minimises total difficulty. The guitar takes the chord on each downbeat (a chord that arrives mid-bar is left to the piano) and rests in bars marked `N.C.`. In 3/4 the default pattern mirrors a waltz left hand: bass on beat 1, index, middle and ring together on beat 2, letting it ring. The guitar course: each shape plucked string by string (pitch checked by CREPE), each change in song order, the pattern on muted strings then on a chord, sections and the whole piece with the melody played in your headphones (timing checked; the microphone cannot certify that every string rang).

## What the piano listening can claim

Piano takes are recorded, then analysed in a worker: spectral-flux attacks, each matched to at most one expected attack, then each note's own partials (those no other note in the chord shares) must rise at the attack. A note is **heard** when its lowest own partial and another (including an odd one) rose; **not heard** only when its partials are quiet after the attack (or still decaying when the previous attack was at least 0.5 s earlier) while the attack itself clearly sounded; **can't check** when every partial is shared (octave and twelfth doublings); **unclear** otherwise. Neighbouring and lower pitches are tested the same way to name wrong notes. Unclear evidence never counts for or against you; a take with too many uncertain attacks or capture problems is not scored.

Measured on 26 real piano recordings with aligned notes (MAESTRO v3, used locally only), thresholds chosen on 13 and frozen before the other 13 (held-out results, clean / with a simulated laptop microphone: 120 Hz high-pass, room reverb, noise at 35 dB SNR):

| | Held-out, clean | Held-out, laptop |
| --- | --- | --- |
| Expected attack where nothing was played, credited as on time | 0% | 0% |
| Real, well-separated attack called missed | 1.5% | 1.5% |
| Played note called not heard or wrong | 1.8% | 1.9% |
| Unplayed note called heard (worst case: still ringing, not re-struck) | 0.7% (2.0%) | 0.7% (1.8%) |
| Semitone wrong note named definitely | 51% | 50% |
| Played notes heard / unclear / can't check | 35% / 43% / 20% | 34% / 43% / 21% |

Those recordings are concert performances in good rooms; exercises in this app are slower and clearer, but your piano, room and laptop are untested. Tuning more than about 45 cents from A440 pauses note checks (turn them off in Sound & timing). Pedalling, legato, voicing, tone, hand position and fingering are for you to judge; listen back to your takes.
