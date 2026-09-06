# Guitar Practice Partner

Local Vite + TypeScript app. Acoustic guitar in, the same pitch repeated two beats later. Current product contract is at the top of `SPEC.md`; the original multi-role design is historical.

Optional phrase memory captures the last 1/2/4 completed bars (default 2) with Remember/L, loops from the next downbeat, and stays frozen while the player improvises. Clear/L returns to the ordinary repeater.

## Rules

- CREPE is the pitch ear and must actually run (tfjs Layers model in `public/models/`). Do not substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy.
- Entered BPM is the clock; Spacebar tap tempo is optional. Do not beat-track the guitar.
- No generative music models. No fretboard/lesson/tab chrome. No backend.
- Musical timing uses `AudioContext.currentTime` minus `outputLatency`.
- North-star demo: enter 120 BPM, enable audio, pluck one note, hear that exact pitch one second after its attack. No scale, lock, note-count gate, density, or role selection.
- In ordinary repeater mode, every accepted attack queues one repeat, including off-grid notes. Never quantize the repeat or recursively repeat speaker bleed.
- In memory mode, keep rolling player history separate from the frozen phrase. No overdubbing and no concurrent ordinary echoes. Preserve note timing and rests; only player attacks enter memory.

## Commands

```bash
npm install
npm run dev      # Chrome, allow mic
npm test
npm run build
```

## Layout

`src/music/repeater.ts` owns the echo queue and shared mask; `src/music/phrase-memory.ts` owns rolling history and frozen loop scheduling; `src/audio/scheduler.ts` schedules the active mode and click. Models live in `public/models/` and are committed.
