# Guitar Practice Partner

Local Vite + TypeScript app. Acoustic guitar in, companion tones out. Spec: `SPEC.md`. Implementation order: `CODEX_PROMPT.md`.

## Rules

- CREPE is the pitch ear and must actually run (tfjs Layers model in `public/models/`). Do not substitute YIN as the default.
- Occupancy is note-on attacks, not ringing energy.
- Spacebar is the clock. Do not beat-track the guitar.
- No generative music models. No fretboard/lesson/tab chrome. No backend.
- Musical timing uses `AudioContext.currentTime` minus `outputLatency`.
- Before changing a shipped function, think about the north-star demo: play beats 1 and 3, hear a scale tone on 2 and 4.

## Commands

```bash
npm install
npm run dev      # Chrome, allow mic
npm test
npm run build
```

## Layout

See `SPEC.md` §14. Models live in `public/models/` and are committed.
