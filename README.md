# Practice Partner

Play a short phrase three times. The app listens for the repeating idea, then joins with a quiet supporting chord.

**Live app:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Play

1. Enter a BPM (40–240), or tap Space four times.
2. Enable audio & mic and wait for **CREPE ready (tiny)**.
3. Play individual notes in a short, repeating phrase. Try **A–C–E**, three times in a similar rhythm.
4. It stays silent during the first two passes. Once it recognizes the third and a clear harmony, a quiet **Am** chord enters on the next downbeat.
5. Improvise over the held harmony. **Listen again / L** fades it and starts fresh listening when you want a new idea.

The three indicators show recognition progress. Small timing and tuning differences are fine; phrases can start between beats. The app compares note order and rhythm, not just which notes occur most often. It handles phrases of 3–24 attacks, with cycles of 1–16 entered beats. Repeat at roughly the same pace.

If the phrase does not clearly support a chord, it keeps listening. A–C–E supports Am; a chromatic run may not suggest one clear harmony. It does not infer a full chord progression or transcribe strummed guitar chords. The output is a synthesized warm chord, not recorded guitar audio.

The harmony stays stable while you play. This replaces the earlier two-beat repeater and manual memory loop. No notes sound just because one attack was detected.

## Controls

| Control | Action |
| --- | --- |
| BPM | Set the pulse; clears recognition and restarts the clock |
| Space | Tap tempo |
| Shift+Space | Restart pulse and recognition |
| Listen again / L | Fade the chord and listen for a new three-pass idea; keep the clock |
| M | Mute harmony; retain the chord and phase |
| C | Mute/unmute click independently |
| H | Switch Speakers/Headphones microphone processing |
| Escape / Silence | Stop both outputs and clear recognition; keep the pulse |

Click starts off for new users; existing click preferences are respected. Listening settings contains the confidence threshold, harmony volume, and optional softening while you play. M restores harmony after Silence once an idea has been recognized again. Preferences persist under `guitar.practice.v1`; notes and recognized harmonies never persist.

Speakers uses echo cancellation and masks the pitches being synthesized. Headphones gives cleaner input; H changes microphone processing, while Windows chooses the actual output device. A real guitar attack matching the output can be masked too. Keep the page visible to avoid background-tab throttling.

## Run and verify

Use Node.js 22.12+ within Node 22, npm, and Chrome on Windows.

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

The optional Chrome smoke check uses a synthetic A–C–E microphone phrase and real local CREPE:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/browser-smoke.mjs
```

It verifies silence through two passes, third-pass recognition, an Am chord on the downbeat, stable repeated accompaniment, mute/resume, Listen again, output switching, panic, and settings migration. It does not simulate physical speaker feedback or judge the musical feel of a real guitar session.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and all 13 shards are committed in `public/models/crepe-tiny/` and served from the app's origin. Microphone audio stays in the browser. No backend, external inference API, or runtime model CDN.

```bash
npm run vendor:crepe
```

This maintenance command reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download, records SHA-256 hashes, and preserves licenses. Production builds verify those hashes. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and the license files.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); older designs below it are historical. Technical details and verification are in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).
