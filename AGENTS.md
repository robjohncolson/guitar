# Guitar Practice Partner

Local Vite + TypeScript app. Enter BPM, play a repeating idea, and hear three finite Echo or Harmony replies half a beat later. Harmony is the default and falls back to a soft octave when uncertain. The latest product contract is at the top of `SPEC.md`; implementation constraints and phase order are in `CODEX_PROMPT.md`.

The new Looper mode records four bars of native-rate mono audio in 4/4 after a one-bar count-in, then loops continuously. Replace waits for a loop boundary and silences the old take during recording. Stop retains the last completed take and releases the microphone; Play restores that take's tempo. One Undo restores the previous take; Clear/reload discard audio. Partner and Looper never play together. Read the current Looper contract in SPEC.md before changing either mode.

Listen continuously for three complete matching cycles, including internal and closing rests. Use tolerant note/time alignment, not a four-beat window, note-count gate, or pitch histogram. Preserve timing and rests in both modes; Echo preserves detected pitch and accepted attack dynamics, while Harmony chooses supporting pitches and softer dynamics. Keep listening during playback with one waiting loop; app voices and phrases must not overlap. Continuing the same idea cannot requeue it forever. Start fresh / L clears evidence and replies while keeping the clock.

## Rules

- Trainer is now the landing page, with the existing Partner/Looper on the Play page. The approved Trainer contract at the top of SPEC.md allows lessons, fret/string guidance and local progress. Use CREPE for single-note grading, explicitly label rhythm-only chord work, and never grade uncertain input as success or failure. Adaptive tempo changes only between attempts.
- CREPE is the pitch ear and must actually run as a tfjs Layers model from committed `public/models/` assets. Never substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy. Confidence dropouts and octave blips must not invent attacks or rests. Masked app notes must not cut up player sustains.
- Manual BPM or Space tapping sets the clock. No guitar BPM estimation. The first accepted pluck anchors phase at the entered tempo; subsequent playing never retimes the pulse.
- Offbeat means the whole loop shifted by half an entered beat, preserving its captured pace. No bar rounding or downbeat entry wait.
- Harmony chooses one smooth line from the whole source loop and the expected guitar at each delayed landing. Keep the line fixed for three passes; soften the third. Mode changes apply to the next exchange. Recognition compares source notes; masking uses actual output notes.
- Schedule musical events with `AudioContext.currentTime` minus `outputLatency`.
- No generative models or backend. Trainer uses authored exercises and local progress. Partner Harmony uses deterministic phrase-level pitch selection, one note at a time; see the current additions in SPEC.md.
- Stop releases the microphone and silences audio, including a pending microphone request. Partner starts fresh; Looper retains its completed take and Undo history in this page. Protect against Stop racing a worklet completion message.
- Minimal primary controls: BPM, Reply: Echo / Harmony, one pulse dot, state, and Stop. Keep optional settings and the explicit local 20-second listening check collapsed. Never store or upload captured audio/notes automatically.
- North-star demo: repeat a five-beat A-C-E idea three times with pauses; hear C-E-G in Harmony or A-C-E in Echo a half beat later for three passes, then quiet. Learn a different loop during playback and let it follow without overlap.
- Complete each phase and run its tests before the next. Verify Chrome with actual CREPE and annotated recorded guitar input before publishing. Do not claim that automated fixtures establish physical-room reliability.
- Looper capture/playback uses a dedicated native-rate AudioWorklet and sample-clock boundaries. The diagnostic 16 kHz / 20-second recorder is not its recording path. No pitch gate, overdubbing, or raw-audio speaker-bleed removal. Optional input-level softening is for headphones and does not alter saved audio.

## Commands

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

With preview running, `node scripts/browser-smoke.mjs` uses recorded guitar plucks; set `SMOKE_ORIGIN` to the preview URL. See README for options.

## Layout

`src/audio/attack.ts` and `onset.ts` segment plucks; `src/music/motif.ts` recognizes loops and rests; `reply.ts` schedules three passes; `companion.ts` owns continuous input, masking, and one waiting loop; `src/audio/scheduler.ts` schedules output. `listening-capture.ts` supports the opt-in local check. Models are committed under `public/models/`; test recording provenance is under `tests/fixtures/`.
