# Pieces: from sheet music to a practice course

The **Pieces** page (`/piece.html`) turns one piece of music into a course: every chord, every change between chords, each passage per hand and hands together, the joins between passages, each section, the whole piece with its repeats, and scale, arpeggio and cadence drills in the piece's key. A guitar accompaniment is arranged from the same harmony with its own course. Everything is generated in the browser from one plain-text **piece file**; nothing is uploaded.

## Adding a piece

There are two ways. Both end with the same piece file, read twice and checked by ear.

### With any AI chat, in the app (the import area)

The app reads no sheet music and calls no model. It gives you instructions to carry to whatever AI you use (ChatGPT, Gemini, Claude, DeepSeek or another), reads back what that AI answers, and says plainly what is wrong. Nothing in the import area is sent anywhere. On the Pieces page open ☰ and **Add your own piece**:

1. **Copy instructions for your AI.** Paste them into a chat together with the pages (a PDF, or one clear photo per page). The instructions (`src/piece/import-guide.ts`, about 9,000 characters) are self-contained: the piece-file format with every token, a staff-position table, a working procedure and two original examples. They ask for the piece file in one code block, for a long piece in parts of at most about 40 bars (the header with every section line in the first part), and for a comment line such as `% unsure: bar 12: the left-hand chord could be A or C` wherever the AI is unsure. They set `verified: none`, `redistributable: no` and a `source:` and `licence:` that say the pages came from you. Tests (`tests/piece-import-guide.test.ts`) compile both readings' code examples, compile each inline token example with the meaning the text gives it, check the staff table and the stated range against the compiler, the listed chord symbols against the analysis, and a few stated rules (no `R` in a pickup, accidentals after a tie in each mode, tuplets of any ratio). The rest of the prose is checked by reading it.
2. **Paste its answer** (the whole answer with its prose, or several answers one after another for a piece sent in parts; text pasted at the end of the box starts on a new line), or open or drop the text file on the box (it is added after what the box holds; **Clear** empties it), and press **Check**. Inside a code block that holds piece text, everything is piece text and the compiler judges it. Outside the code blocks (a part copied with a chat's Copy button, a `.piece.txt` file, or an answer with no code block) each line is judged by its shape, not by whether it is valid: header lines before the first bar (known or not), bar lines with option-like words, repeat and ending lines, `harmony:` lines of chord-like symbols, one-word `mark:` lines and voice lines of note-like tokens are piece text, read exactly as inside a code block, so a pure piece text gives the same result either way and its problems go to the AI. Prose is left out. A line that starts like a piece line but reads as words (`harmony: I kept it simple`, `mark: the fine is in bar 8`, `== 9 is the last bar`, `Note: ...` after the bars began) is never used: the panel names it, and the piece cannot be added until that line is deleted or corrected in the box. Everything used is joined in order. A closing fence with the next answer glued to it still closes; an answer cut off before its closing fence is reported when the next answer's fence arrives. It tidies only the characters the format needs plain (♯ ♭ ♮ in notes and chord symbols, `&lt;` and other HTML entities in music lines, curly quotes around a section note, dashes in its bar range, non-breaking spaces, a byte order mark, Windows line ends) and says what it changed. It never changes the words of the title, composer, source, licence or section note and never guesses at music. Anything over 300 KB is refused before it is read. Then it reads the piece and shows the title, bars, notes and sections, the warnings (also for chord symbols and marks the app does not know and a tempo line without a whole-number `q=`), and the bars the AI marked unsure. If it cannot read it, it lists the problems, each with its line quoted (at most 200 characters; the AI does not share our line numbers): **Copy problems for your AI**, paste that into the same chat, paste the corrected answer back and check again. A pasting slip gets one plain sentence instead, with nothing to send to the AI: bars with no header before them (a later part alone, or parts in the wrong order), a section that runs past the last bar (the first part alone), a bar number that appears twice (a part pasted twice), or a line outside the code blocks that starts like a piece line but reads as words.
3. **Add to my pieces.** A piece is known by its title and composer: a piece of yours with the same title and composer gets the new text and keeps its id (the panel says so, or that nothing changed when the text is the same); with the same title and another composer the panel asks first, naming the piece that would be replaced by title and composer (**Add as a separate piece**, which has the focus, or **Replace**); a new title gets `mine:` plus a slug of the title. At most 30 pieces, 300 KB each, in this browser's storage (`piece.imported.v1`). The piece opens at once.
4. **Compare with a second reading (recommended).** **Copy instructions for a second reading** (the same guide, in `pitch-mode: sounding`, asking for a reading from the pages only) into a fresh chat or another AI, paste its answer and press **Compare**. The result lists header disagreements (key and time signature, number of bars, pickup, key and time changes, repeats), then every bar where any note's pitch, start, length or hand differs, then every bar whose chord symbols or swing differ. **Copy differences for your AI** asks the AI to look at the page again for those bars and send the whole corrected file. Resolve each difference from the page, never by majority. Agreement does not prove both are right, and comparing never confirms a piece.
5. **Listen, then confirm.** A piece you added is a draft while its `verified:` is `none` or `checks`: the piece picker says "· yours · draft", Your pieces shows a Draft tag, and Sound & timing says so. Drafts open, play and practise like any piece. Use **Hear the whole piece** (About this piece), then each section; a wrong note usually sounds wrong. When it sounds right, press **It sounds right** under Your pieces. That click is the only thing that confirms a piece: it rewrites the `verified:` line to `verified: owner` in the piece text, so a downloaded file and an account copy carry the state with it. Adding a text that already claims `owner` or `sources` sets it back to `none`.
6. **Your pieces.** Each has **Copy text** (to give it back to an AI), **Download** (a local `.piece.txt`) and **Remove** (two clicks). Signed in, **Save to my account** uploads a piece only when you press it; confirming uploads nothing. The account list only knows which pieces are saved, not whether the text changed since: to update an account copy after confirming or replacing a piece, choose **Remove from account**, then **Save to my account**.

### With a coding assistant in this repository (the scripts)

1. **Hand over the music.** A PDF or a photo per page. Say whether the piece is public domain (for example, composer died more than 70 years ago and the edition adds nothing) or private.
2. **Render pages large.** The assistant reads each page as an image. For dense music, render at 300 DPI and look at one system at a time (for example with PyMuPDF in a throwaway virtual environment: `page.get_pixmap(dpi=300)`).
3. **Transcribe twice, independently.** First pass in `pitch-mode: printed` (write what is printed; the compiler applies the key signature and bar-long accidentals). Second pass from a fresh start in `pitch-mode: sounding` (write every sharp or flat that sounds). Do not copy between them. The instruction text in `src/piece/import-guide.ts` is a compact, tested reference for the format.
4. **Check.** `node scripts/piece-check.mjs mine.piece.txt` compiles and prints a plain listing of every bar. `--diff other.piece.txt` lists every bar where the two transcriptions disagree on any note's pitch, start, length (ties merged) or hand, then every bar whose chord symbols or swing differ (the same comparison as the import area, from `src/piece/compare.ts`). Resolve each by looking at the page again, never by majority or memory. If a MIDI or MusicXML-derived MIDI exists, `--midi file.mid` compares notes too.
5. **Listen.** Open the file in the app (**Add your own piece**, step 2) and use **Hear the whole piece**, then each section, with the notes falling on the keyboard. A wrong note usually sounds wrong. Press **It sounds right** (or set `verified: owner` in the file) when you are satisfied.
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
| `c4`, `f#5`, `bb3`, `en4`, `cx4` | Pitch: lowercase letter, accidental (`#`, `b`, `n` natural, `x` or `##` double sharp, `bb` double flat), octave. Middle C is `c4`; the range is `a0` to `c8`. |
| `:4`, `:8.`, `:2.` | Duration: 1, 2, 4, 8, 16, 32, 64 with up to three dots. Every note and rest needs its own; nothing carries over. |
| `~` after the duration | Tie to the same pitch in the next note of this voice (also across the barline). |
| `<b3 d4 f#4>:2` | Chord. `~` after a single pitch inside ties just that note. |
| `r:4`, `s:4`, `R` | Rest, invisible spacer, whole-bar rest. `R` fills the whole metre, so a pickup or partial bar writes its rests with their length. |
| `c4-1:4` | Printed fingering 1 to 5. |
| `3:2{ c5:8 d5:8 e5:8 }` | Tuplet: three in the time of two. Any ratio (`7:4`, `9:8`), nested too. Each note is rounded to whole ticks. Only when that rounding alone keeps a voice from fitting its bar (a full bar that does not add up, or a pickup or partial bar that comes out longer than a full bar) are that voice's notes placed exactly instead. A bar that already adds up, and a pickup or partial bar that fits, keep the per-note rounding, so such a pickup can be a tick or two longer than the tuplet states. The braces stand apart, with spaces around them. |
| `g{ e5:16 } f5:8` | Grace note(s) before a note: read and accidental-checked, but take no time and are not played or graded. |
| `== 60 swing`, `== 92 straight` | From this bar on, eighths are swung (an off-beat eighth sounds two thirds through the beat) or straight again. |
| `harmony: N.C.` | No chord in this bar: no chord step and no guitar strum. |
| `acc[R]: ...` | This voice is played by the hand in brackets (`L` or `R`) in this bar. |
| `== 0` or `== 12 partial` | Pickup bar or incomplete closing bar. `== 9 time: 2/4 key: 1b` changes metre or key from this bar on. |
| `:\|3`, `[1,2`, `]` | A repeat played three times; an ending used on passes 1 and 2 (no spaces); the end of the last ending when more bars follow. |
| `mark: fine`, `dc`, `ds`, `segno`, `coda`, `tocoda` | Jumps, written lowercase and exactly so (`mark: Fine` is ignored; the import area warns); the play order is computed. After a jump, repeats are not taken again and the last ending is played. |

A chord symbol holds until the next one, as on a lead sheet, so write `harmony:` only where the printed symbol changes (or `N.C.`). The `@` offsets count quarter notes from 0 at the start of the bar. Bars before the first symbol, or in a piece with none, are named from their notes. A symbol the analysis does not know (it knows the suffixes listed in `src/piece/import-guide.ts`) gets no chord step, and the guitar has no shape for it, so that bar and the bars it holds through get no strum; the import area warns, the compiler does not. Leaving the symbol out is worse: the chord before it then holds, and the guitar strums that chord. So write the nearest listed chord whose notes all belong to the printed one (F13 as F7) and keep the printed symbol in a `% unsure:` line.

A `%` starts a comment anywhere on a line, also inside a title or a section note, so `%` cannot appear in those.

**printed** mode writes each note by its staff position plus only the accidental printed right before it; the compiler applies the key signature, keeps an accidental for the rest of the bar on that staff line, and carries a tied accidental across the barline. **sounding** mode writes the sounding pitch with every sharp and flat, also on the second note of a tie; a natural that the key signature would alter must be written `n` (for example `cn5`), or the compiler warns.

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

A part written for guitar (one treble staff marked for guitar, often with a small 8 under the clef or tablature beneath it) sounds an octave lower than written. Write it one octave below its staff position, so that the piece file holds the pitches that sound; read the notes on the staff and ignore the tablature. Chord boxes above a piano part, or "Piano/Vocal/Guitar" on the cover, do not make a part guitar music: both readings would make the same octave mistake, and comparing them would not catch it.

### Common transcription mistakes the checks catch

- A bar that does not add up: the compiler reports the voice and how many beats it fills.
- A forgotten key-signature sharp in sounding mode: warned unless written `n`.
- A tie that does not reach the same pitch: warned at the line.
- A misspelt bar option such as `== 78 swingg`: warned, because it would silently change the rhythm.
- Two transcriptions disagreeing: `--diff` (or **Compare** in the import area) lists the bars.

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

Every step climbs 50, 60, 70, 80, 88, 94 and 100% of the goal tempo (default: the piece's marking; change it in Sound & timing). Two clean, comfortable takes at a step (trusted, 80% or better, not necessarily in a row) climb one step; at 80% and 100% three takes fade the help (notes shown, then hidden, then a click only on each bar); two hard takes in a row (under 65%, or answered "Needs more room") step down. Both counts, clean takes at this step and hard takes in a row, are saved with your progress, so a reload does not start the count again. **Already know it?** The tempo ladder beside the BPM has a placement control ("Already know this? Try it at N BPM"; pick the step on the ladder, default its top step). That take is graded like any other, with the notes shown; if it is trusted, calibrated (keys and MIDI count as calibrated), 80% or better and you answer "Felt comfortable", the step moves to that tempo and the take counts as its first clean take there (at 80% and 100% the notes-shown take, so the help fades from the next one). A miss records nothing: no attempt, no hard take, no step down, no personal best. Wait for me never places, one-hand steps place no higher than 80%, and a clean hands-together placement also places the one-hand steps for the same bars at their highest step at or below it (never certified). Certification and learning still need the fading takes and two days. A step is learned after the goal tempo is certified on two different days, then comes back for review after 1, 2, 4, 8, 16 and 32 days. **Today's practice** suggests a warm-up drill, due reviews, at most two new steps and one play-through. These numbers are defaults from the practice literature summarised in `IMPLEMENTATION_NOTES.md`, not proven optima.

**On the page.** The first screen holds the whole practice loop. A slim top bar has the menu (☰), the piece and composer, a **Today** chip ("Today 1 of 4") and a status chip that names the input and its worst state ("Mic · calibrated", "Calibrate", "Keys · MIDI", "Mic too loud"). On a phone the top bar keeps only the menu and the piece: the tool links (and Sign in) sit at the top of the menu, the chips, the first-visit card and the placement link are left out, and what is playing ("Count in · 3") shows in the top bar only while something plays. While something plays, the step, BPM and ladder fold away so the lane fills the screen, and a small meter beside it shows what the microphone hears. Under it: the step's name with ⓘ for About this step, a large BPM with its goal ("goal 66", or "top 53 · one hand"), the **ladder** (one 44 px segment per tempo step, ◆ on the certification steps) and its pips. The lane comes next; its height follows the screen so that on most screens it and Start fit without scrolling. It never gets shorter than 180 px on a phone or 300 px on a desktop (250 px while a result card or notice shows), so on a short desktop window Start can sit below the fold. **Next take** says in one sentence what the next take will do and why (two clean takes to climb, which help level a certification take has, that free tempo, an uncalibrated microphone or Wait for me will not move the tempo, or that an answer is still owed). **Last take** keeps what the last answered take did ("92% · Clean, 1 of 2") until the step, instrument or piece changes. Start practice is the large button; while anything plays it becomes Stop · Esc. On a phone, Next take and the buttons stay together at the bottom of the screen. After a take the result card takes the buttons' place: the combined score the ladder uses (the lower of on time and notes heard, rounded down, with marks at 65% and 80%) and, under each answer button, what that answer will do, computed by running the ladder's own rules on a copy. The card leads with three stars (one from 65%, two from 80%, three from 95%, all read from the printed, rounded-down percentage; `game.ts`), with the percentage beside them in smaller type; they fill one by one during the count-up in the lively look and appear already filled in Calm or with reduced motion, and a take that was not scored shows "Not scored" with no stars and no percentage anywhere on the card. After a keys or MIDI take the card adds "Longest run: N" from 5 up; during such a take a small "N in a row" sits at the top left of the lane from 5 up. Both count attacks with every key right and on time, by one rule (`liveRun` in `game.ts`), so the card's longest run is the highest number the counter showed; the counter simply fades when a key is wrong or an attack is missed, early or late. A star newly earned by an answer is named on the Last take line in every look (and in the milestone moment in the lively look). Steps carry stars from saved progress only (a first clean take, any certification, certification at the step's own top tempo step) in the course list, the map and beside the step's name, plus a seal once learned, with a small clock on it when a review is due. Messages that are not about a take (a blocked microphone, an audio path that changed, Wait for me finished, an unanswered take dropped) appear in one notice line, with at most one button.

**Timing leniency.** Sound & timing sets how far from the beat an attack may land and still count as on time: Tight (about 85 ms), Standard (130 ms), Relaxed (about 210 ms, the default) or Loose (about 290 ms). At fast tempos each is also limited to a share of the beat.

**Free tempo.** The ✎ beside the BPM opens a small box with the tempo and − / + buttons. Any tempo other than the step's is free tempo: the BPM turns amber and says "free", the ladder dims, and takes there do not move it. One "Back to N BPM" button returns to the step's tempo. A tempo outside 20 to 240 is not accepted.

**The menu.** ☰ opens every other panel, all closed: Today's practice (with Next in today's plan, which also appears on the stage once a step is finished), Your piece, Course (two views, not saved: Journey first, a map of the course as a walk; then List, every step by stage), Piece & input, Sound & timing, About this piece, Add your own piece, Last take (playback, download and note details; on a phone also the score details, the timing strip and the note verdicts, which stay on the result card on a desktop; the coaching line stays on the card everywhere), Your practice today and Keyboard shortcuts. The Today chip, the status chip and Review take open their own section. While the menu or the free-tempo box is open, Space, the arrows and the piano keys do nothing; Esc still stops everything and closes it. The menu cannot open while something plays, and starting playback from it closes it.

**The journey.** The Course panel's Journey view (`journey.ts` lays it out, `journey-view.ts` draws it) is the whole course as a path that winds down the panel: hearing the piece is the trailhead, the key drills (and any step that belongs nowhere else) are a camp beside it, each section is a region whose phrases (`phrases()` in `progress.ts`, in learning order) are stops, the section's run-through is a gate at the region's end, and the whole piece is the summit. Chords and changes hang above the stop they belong to as small dots; joins are short rails on the path after the phrase they leave, where there is room (at least 36 px from every stop's centre, clear of the labels and 12 px from each other; at the end of a row they go round the turn). Every step appears exactly once. Each stop shows one dot per passage step (blue left hand or bass, green right hand or melody, pale both), filled with gold a third per star, with the learned seal and the review clock exactly as the step stars use them; steps that are not ready yet are faint, never locked. A ring marks the stop that holds the open step ("you are here", scrolled into view when the panel opens), a soft halo the stops in today's plan; a stop's label and marks stand at least 2 px clear of either ring at its largest. Each stop's spoken name says how many of its steps have stars and how many are learned. Each stop is a button; it opens its steps as rows right under it, and a row opens its step exactly as the List does. In the lively look the "you are here" ring breathes; in Calm and with reduced motion the map is still and shows the same.

**Finish.** After at least one counted answer in this visit (the ladder counted it: trusted, calibrated where the tempo step needs it, or a clean placement), Finish shows a card (`summary.ts`): clean takes today against the daily aim on a ring, the stars gained in this visit with their steps in the open piece, what moved there (steps that climbed, certified, learned, stuck overnight; a placement says where it placed the step, "placed at 70%", then "then up to 80% of the goal tempo" if it climbed after; steps a hands-together placement raised say so, "placed at 70% with Bars 5–8 · hands together"), one line for each other piece whose steps made progress in this visit (a higher tempo step, a better best, which is how a first star comes, a new certification or newly learned: "Also in this visit: 2 steps made progress in …"), and one line from tomorrow's plan as it stands at the start of tomorrow. A step down is not mentioned. With nothing to list, the card says where things stand, not what happened: "No step ended this visit higher than it started." It appears only when that is true of every saved step in every piece and course (no higher tempo step, no better best, no new certification, nothing newly learned, compared with the copy from page load); a step that went up and came back down in the same visit ends where it started. "Reset progress for this piece" makes the visit forget that piece too, so after a reset the card compares it with nothing, as the page does. If some step did end higher but nothing names it, the card shows no such sentence. It compares saved progress with a copy taken when the page loaded, kept in memory; nothing new is stored. Without a counted answer, Finish gives its one sentence as before.

## Guitar accompaniment

For each chord the arranger picks the easiest shape that never adds a pitch outside the chord and keeps its third; colour tones it leaves out are listed for review. One capo position for the whole piece minimises total difficulty. The guitar takes the chord on each downbeat (a chord that arrives mid-bar is left to the piano) and rests in bars marked `N.C.`. In 3/4 the default pattern mirrors a waltz left hand: bass on beat 1, index, middle and ring together on beat 2, letting it ring. The guitar course: each shape plucked string by string (pitch checked by CREPE), each change in song order, the pattern on muted strings then on a chord, sections and the whole piece with the melody played in your headphones (timing checked; the microphone cannot certify that every string rang).

## Playing the piece on guitar

Guitar on the Pieces page can also play the written notes, not only the chord accompaniment. The arrangement is one guitar in standard tuning, frets 0–12. Notes below the low E move up an octave; notes above the 12th fret move down, so the melody can sit with the chord. A pluck never adds a pitch the score does not have at that moment. Two notes that land on the same pitch are one pluck. What still will not fit is left out, melody and bass last, and listed in About this piece. The course follows the piano: hear it, each distinct bar note by note then in rhythm, changes, the melody, the bass and chords, both together, joins, sections, the whole piece and open-position drills in the key. A single string is checked for pitch. Two or more strings at once are timing only. The accompaniment course stays available as Accompany.

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
