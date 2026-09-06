# Guitar Practice Partner

Local Vite + TypeScript app. Acoustic guitar in, the same pitch repeated two beats later. Current product contract is at the top of `SPEC.md`; the original multi-role design is historical.

## Rules

- CREPE is the pitch ear and must actually run (tfjs Layers model in `public/models/`). Do not substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy.
- Entered BPM is the clock; Spacebar tap tempo is optional. Do not beat-track the guitar.
- No generative music models. No fretboard/lesson/tab chrome. No backend.
- Musical timing uses `AudioContext.currentTime` minus `outputLatency`.
- North-star demo: enter 120 BPM, enable audio, pluck one note, hear that exact pitch one second after its attack. No scale, lock, note-count gate, density, or role selection.
- Every accepted attack queues one repeat, including off-grid notes. Never quantize the repeat or recursively repeat speaker bleed.

## Commands

```bash
npm install
npm run dev      # Chrome, allow mic
npm test
npm run build
```

## Layout

`src/music/repeater.ts` owns the echo queue and mask; `src/audio/scheduler.ts` schedules it and the click. Models live in `public/models/` and are committed.
