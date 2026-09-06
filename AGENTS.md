# Guitar Practice Partner

Local Vite + TypeScript app. Acoustic guitar in, a quiet supporting chord after a phrase is repeated three times. Current product contract is at the top of `SPEC.md`; repeater and four-role designs are historical.

Listen silently until note order and rhythm establish three matching performances. Choose a chord grounded in those notes; ambiguous material stays silent. Enter on a schedulable downbeat and hold the harmony stable. Listen again/L clears recognition without resetting the clock.

Preserve accepted attack dynamics. Responsive (default on, collapsed preference) smoothly softens accompaniment in response to player attacks, recovering in rests; it never changes the harmony or click.

## Rules

- CREPE is the pitch ear and must actually run (tfjs Layers model in `public/models/`). Do not substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy.
- Entered BPM is the clock; Spacebar tap tempo is optional. Do not beat-track the guitar.
- No generative music models. No fretboard/lesson/tab chrome. No backend.
- Musical timing uses `AudioContext.currentTime` minus `outputLatency`.
- North-star demo: at 120 BPM, play A–C–E three times in a similar rhythm; only then hear a quiet Am chord on the next downbeat.
- No ordinary echoes or manual phrase recording. Match repeating sequences, not merely common pitch classes or a note-count gate.
- Mask all chord voices and octave detections. Stable harmony never chases newly played notes; L requests fresh listening.

## Commands

```bash
npm install
npm run dev      # Chrome, allow mic
npm test
npm run build
```

## Layout

`src/music/motif.ts` recognizes repeated phrases; `harmony.ts` chooses supported chords; `companion.ts` owns input masking and stable accompaniment; `src/audio/scheduler.ts` schedules harmony and click. Models live in `public/models/` and are committed.
