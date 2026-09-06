# Guitar Practice Partner

Local Vite + TypeScript app. Enter BPM, play a repeating idea, and hear three finite replies half a beat later. The latest product contract is at the top of `SPEC.md`; implementation constraints and phase order are in `CODEX_PROMPT.md`.

Listen continuously for three complete matching cycles, including internal and closing rests. Use tolerant note/time alignment, not a four-beat window, note-count gate, or pitch histogram. Preserve detected pitch, timing, rests, and accepted attack dynamics. Keep listening during playback with one waiting loop; app voices and phrases must not overlap. Continuing the same idea cannot requeue it forever. Start fresh / L clears evidence and replies while keeping the clock.

## Rules

- CREPE is the pitch ear and must actually run as a tfjs Layers model from committed `public/models/` assets. Never substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy. Confidence dropouts and octave blips must not invent attacks or rests. Masked app notes must not cut up player sustains.
- Manual BPM or Space tapping sets the clock. No guitar BPM estimation. The first accepted pluck anchors phase at the entered tempo; subsequent playing never retimes the pulse.
- Offbeat means the whole loop shifted by half an entered beat, preserving its captured pace. No bar rounding or downbeat entry wait.
- Schedule musical events with `AudioContext.currentTime` minus `outputLatency`.
- No generative models, backend, fretboard, lessons, tabs, or chord inference. One note at a time.
- Stop releases the microphone and silences audio, including a pending microphone request. Start begins a fresh session.
- Minimal primary controls: BPM, one pulse dot, state, and Stop. Keep optional settings and the explicit local 20-second listening check collapsed. Never store or upload captured audio/notes automatically.
- North-star demo: repeat a five-beat A-C-E idea three times with pauses; hear three copies a half beat later, then quiet. Learn a different loop during playback and let it follow without overlap.
- Complete each phase and run its tests before the next. Verify Chrome with actual CREPE and annotated recorded guitar input before publishing. Do not claim that automated fixtures establish physical-room reliability.

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
