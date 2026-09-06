# Guitar Practice Partner

Local Vite + TypeScript app. Acoustic guitar in, three finite replies of a recognized phrase at its original pace. Current product contract is at the top of `SPEC.md`; held chords, ordinary echoes, and four-role designs are historical.

Listen until note order and rhythm establish three matching performances. Replay the actual notes exactly three times, then stop. Keep listening during playback and hold at most one new phrase to follow. App-generated notes and phrases must not overlap. Start fresh/L clears active/waiting recognition without resetting the clock.

Preserve detected pitch, timing, rests, and accepted attack dynamics. Responsive (default on, collapsed preference) smoothly softens replies in response to player attacks, recovering in rests; it never changes the notes or click.

## Rules

- CREPE is the pitch ear and must actually run (tfjs Layers model in `public/models/`). Do not substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy.
- Entered BPM is the clock; Spacebar tap tempo is optional. Do not beat-track the guitar.
- No generative music models. No fretboard/lesson/tab chrome. No backend.
- Musical timing uses `AudioContext.currentTime` minus `outputLatency`.
- North-star demo: recognize A–C–E, play A–C–E back three times, then stop; learn a new repeated phrase concurrently and let it follow.
- No ordinary echoes, chord inference, or manual phrase recording. Match repeating sequences, not merely common pitch classes or a note-count gate.
- Mask reply notes and octave detections. Continuing the same idea must not requeue it forever. L permits learning it again.

## Commands

```bash
npm install
npm run dev      # Chrome, allow mic
npm test
npm run build
```

## Layout

`src/music/motif.ts` recognizes and compares phrases; `reply.ts` schedules three finite passes; `companion.ts` owns continuous input, masking, and one waiting phrase; `src/audio/scheduler.ts` schedules reply notes and click. Models live in `public/models/` and are committed.
