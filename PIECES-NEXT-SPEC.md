# Pieces: four upgrades, as built

Built and shipped 2026-11-13. This file began as the plan and is now the record: what each feature does, the decisions made while building it, how it was checked, and what is still open.
Scope: the Pieces page only (`piece.html`, `src/piece/`).

| | Feature | Commit | In one line |
|---|---|---|---|
| A | Sampled piano | `10a1e89` | The app's piano plays grand-piano recordings; timing and grading unchanged |
| B | Trouble-spot loop | `f9c6375` | After a take with confirmed problems, practise just those bars, slower, without touching the ladder |
| C | Placement | `a49cf03` | One clean take at a higher tempo step places a step there |
| D | WebGL light layer | `f03437c` | Reward light is drawn by WebGL over the lane; notes, keys and text stay in 2D |

## 1. Rules these features were built under

They remain the rules for further work on the Pieces page.

1. `AGENTS.md` is binding, especially: unclear evidence never counts either way; microphone listening thresholds are frozen; Wait for me never moves the tempo ladder; auto-played notes are not graded; reward effects only for confirmed results; comfort answers are never automatic.
2. No new runtime dependencies. Raw Web Audio and raw WebGL2 only.
3. No new localStorage key. Saved progress goes inside `piece.trainer.v1` (old saves must load, and `parsePieceProgress` must keep new fields). Device preferences go in `piece.input.v1`.
4. Nothing is fetched from another origin at runtime. `scripts/piece-smoke.mjs` asserts this.
5. Agents building a feature do not commit or push; the owner decides.
6. Keep LF line endings (the repo is `core.autocrlf=input`).
7. Match the existing code style. No comments about plans or process.
8. Before editing an existing function, class or method, run the GitNexus `impact` tool on it and note the risk level.
9. New asset files live under `public/`, with a licence or notice file beside them.
10. Done means: `npm test` and `npm run build` pass; the microphone smoke test passes (`npm run build`, serve with `npx vite preview --port <port> --strictPort --host 127.0.0.1`, then `SMOKE_ORIGIN=http://127.0.0.1:<port> node scripts/piece-smoke.mjs`); new pure logic has unit tests; a headless browser check of the feature's own flows shows no console errors and no sideways scroll at 390 px; no dev or preview server is left running.
11. Keyboard shortcuts must never be a piano key in computer-keys mode. Piano keys are the Z row (`Z S X D C V G B H N J M , L . ; /`) and the Q row (`Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ = ]`). Left/Right change octave; Up/Down/Space answer a take.

## 2. A: Sampled piano

Demos, backing, auto-played notes and live keys play recordings through `src/piece/sampler.ts`. Sound & timing has "Piano sound: Grand piano / Simple". The simple voice plays until samples are loaded, or if they cannot load.

**As built.**
- Source: University of Iowa Musical Instrument Samples, Steinway B played mf. The source states the recordings may be used for any projects without restrictions; `public/piano/NOTICE.md` records the source and every edit. `npm run vendor:piano` reproduces the set.
- 28 notes a minor third apart from B0 to G♭7, mono MP3, 2.5 MB in all. The source has no A0, so B0 covers the bottom. Its A7 and C8 measure 55 to 57 cents flat and were left out; notes above G♭7 are pitched up from it.
- `manifest.json` holds each note's measured detune and a playback gain. Detune follows a real piano's stretch (bass a little flat, treble a little sharp) and is corrected on playback.
- Gains even out attack loudness (the peak 5 ms level in the first 100 ms) and never correct by more than 6 dB. Four notes sit at that limit: B0, G♭5, C7 and E♭7. An earlier rule, equal RMS across notes, pushed the top octave up by as much as 21 dB and was dropped.
- Overall level comes from headroom, not from matching the old voice's RMS: a six-note chord at full level peaks at 0.966, the densest bars of the Gymnopédie at 0.306, with no compressor or soft clip.
- Each decoded buffer's onset is measured at load and playback starts there, so codec padding cannot shift an attack.
- Samples are fetched after the first gesture and only for the piece's range (19 files for the Gymnopédie). A take never changes timbre midway: the voice is chosen when a take, demo, replay or Wait for me run starts.
- Unchanged: clicks, the 1000 and 1300 Hz pips, the guitar course's voice, the microphone listener.

**Checks.** `npm run check:piano` (every sample decodes, pitch matches the manifest, no clipping, gain rule). `npm run check:piano-voice` (offline render: attacks a median 0.5 ms and at most 1.5 ms from the plan; the app's own listener hears every note). `npm run check:piano-realtime` (the live page: a demo plays from samples, Stop is silent within 100 ms, a live key starts at the next audio callback, Simple never touches the samples, only the needed files are requested).

## 3. B: Trouble-spot loop

After a take with confirmed problems the result says "Practise bars N–M". Spot passes are graded for feedback and change nothing else. Code: `src/piece/spot.ts` and the take flow in `main.ts`.

**As built.**
- What counts as a problem: an attack marked missed, a note marked wrong or not heard. Early or late counts only when the take's timing is calibrated (keys takes always are). Unsure attacks and unclear notes never count.
- Picking the spot: problem bars with at most one clean bar between them form a group, and the group with the most problems wins. There is no offer when more than half the step's bars have problems or the group spans more than half the step; the ladder's own step-down covers that case.
- The spot adds the whole bar before as a lead-in when one exists. Its tempo is the next tempo step below the take's, or 15% slower when there is none, never under 20 BPM.
- After "Needs more room", or a take under 65%, the next take waits and an offer appears: Space practises the spot, Down runs Wait for me on those bars (keys or MIDI only), Up carries on as usual, and a button offers one hand only on hands-together steps.
- In a spot, a banner names the bars and tempo and says it does not count for tempo steps. After each pass: Space again, Down slower, Up back to the step. After two clean passes in a row Space becomes "Back to bars X–Y" and Up becomes "Again".
- For 350 ms after the offer or a pass result appears, Space, Up and Down are ignored, and key repeats always are, so a double press cannot start something unintended.
- When more than half of a microphone take's events are unclear, no bars are picked; From/to selects let the learner choose.
- Spot ids are `spot/<step>/<from>-<to>/<hands>`. A spot never calls `advanceUnit`, writes no step progress, history or personal bests, and counts in the day log as a take played, not a clean take.
- Piano course only, and not on drill, chord or listen steps.

**Checks.** `tests/piece-spot.test.ts`. Browser checks covered the main flow, Wait for me on a spot, one hand only, mostly and entirely unclear takes, and the double-press guard, each asserting saved progress is identical before and after.

## 4. C: Placement

"Already know this? Try it at N BPM" sits beside Start practice on any step that is not learned and not certified at its top tempo step. The pips above the current step choose a different target; the default is the top. Code: `canPlace`, `placeUnit` and `placeHands` in `src/piece/progress.ts`.

**As built.**
- Placement is explicit: only a take started from that control can place. Free-tempo takes still count for nothing. Wait for me cannot place.
- A placement take is an ordinary graded take at the target tempo with the notes shown and no demonstration first.
- It places only if the take is trusted, calibrated where tempo steps need calibration, 90% or better, and answered "Felt comfortable". The step then moves to the target and the take counts as its first clean take there. At 80% and 100% that is the notes-shown take, so two takes with fading help are still needed to certify. "Learned" still needs the top step certified on two different days.
- A failed placement records nothing against the step: no attempt, hard-take count, step-down, history entry or personal best. The day log counts a take played.
- A hands-together placement also raises the one-hand steps for the same bars to their highest step at or below the target, at most their own 80% top. It never certifies them and never lowers a step.
- After a placement take the paused trouble-spot offer is not shown, though the result's "Practise bars N–M" link may be, and the next take never starts by itself.
- `SPEC.md`, `PIECES.md` and `AGENTS.md` describe the changed ladder.

**Checks.** `tests/piece-placement.test.ts`; the plan simulation in `tests/piece-plan.test.ts` still passes. A browser check placed a step in keys mode and saw the strip and the piece map update.

## 5. D: WebGL light layer

Reward light is drawn by WebGL2 on a transparent layer over the lane. Everything readable stays on the 2D canvas. A full WebGL lane was rejected: the 2D lane is already cheap, sharp and handles text, and a rewrite would have risked a tested lane for no visible gain.

**As built.**
- `src/piece/light.ts` (`lightFrame`) is the single pure decision of what light exists each frame: key glows (perfect and good hits), rings (perfect only), the warmth band from a run of on-time notes, the beat glow line, the reveal sweep and particle bursts. Bursts are generated from a seed, so both backends draw identical particles.
- The list is empty in Calm mode, with reduced motion, and during microphone takes and demos.
- Ink, always 2D: notes, keys, labels, hints, the hit line and its beat brightening, the early/late tick, the base haze and the neutral microphone level band.
- `src/piece/lightgl.ts` draws the list: two instanced programs, additive blending, a `plus-lighter` overlay, device pixel ratio capped at 2. Particles live in a ring buffer of 1536, are uploaded once and moved on the GPU. Light is clipped above the hit line and kept off the message pill and the milestone banner. Nothing is drawn while there is no light. Shaders compile in the background and the 2D light stands in until they are ready.
- The 2D canvas draws the same list as the fallback on software renderers (where it is cheaper), after a lost context, or with `?light=2d`. `?light=gl` forces WebGL.
- Limits: 150 live particles during a take. Celebrations, which happen outside takes, use 204, 296 or 708 particles by size. Brightness caps: glow 0.9, ring 0.6, band 0.12, beat line 0.3, sweep 0.18.
- The per-frame light code allocates nothing and does no work when there is no light. A first version did both, roughly doubled frame time under software rendering, and made timer-driven key presses land late; that was found by running the same check against the previous commit.

**Checks.** `tests/piece-light.test.ts` carries the contracts. A browser check read the layer's pixels: light appears after on-time keys; the layer is fully transparent in Calm mode, during a microphone take and during a demo; `?light=2d` has no overlay; a lost context falls back to 2D. On the real GPU a keys take costs 0.94 to 1.02 ms of script per frame against 0.99 to 1.03 ms before.

## 6. Open points

- Nobody has listened to the piano's top two octaves. In Keyboard · MIDI mode the Right arrow moves both key rows up an octave per press.
- The browser checks for B, C and D were scripts kept outside the repo and are not committed. Only the piano checks and the smoke test are.
- Forcing WebGL on a software renderer (`?light=gl` with no GPU) costs about 2.5 ms more per frame. Software renderers default to 2D light.
- The trouble-spot loop is not offered in the guitar course, and the guitar lane has no light.
- After a placement, the check confirms the piece map updates but not what today's plan changes to.

## 7. How it was built

One lead (Opus 5.5) per feature made the design decisions the plan left open and reviewed every change; workers (Sonnet 5.5) did targeted reading and implementing; runners (Haiku 5.5) ran tests, builds and browser scripts. The plan's author checked each feature independently before it was committed and edited no code.

Lessons worth keeping:
- A helper must never leave a server running as its own background task: its final notification never arrives and the chain waits. Start the server, run the check and stop it in one command.
- Browser checks that press keys from timers are sensitive to machine load. Run them one at a time, and treat a failure as real only when it repeats on an idle machine and does not happen on the previous commit.
- On Windows, remove a junction with `rmdir` before deleting the directory that holds it; otherwise the target's contents go too.
