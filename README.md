# Practice Partner

Play a short phrase three times. The app recognizes the repeating idea, plays those notes back at the same pace three times, then goes quiet.

**Live app:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Play

1. Enter a BPM (40–240), or tap Space four times.
2. Enable audio & mic and wait for **CREPE ready (tiny)**.
3. Play individual notes in a short, repeating phrase. Try **A–C–E**, three times in a similar rhythm.
4. It stays silent during the first two passes. Once it recognizes the third, a reply starts on the next downbeat and plays your phrase exactly three times.
5. Keep playing. It listens during the reply and lets one newly recognized idea wait its turn. The latest different idea replaces an older waiting idea.

The three indicators show recognition progress. Small timing and tuning differences are fine; phrases can start between beats. The app compares note order and rhythm, not just which notes occur most often. It handles phrases of 3–24 attacks, with cycles of 1–16 entered beats. Repeat at roughly the same pace.

Replies preserve the captured note spacing, tuning, and phrase cycle instead of stretching it to whole bars. Notes are synthesized warm tones, not recorded guitar audio. This version follows individual notes; it does not transcribe strummed guitar chords or choose a harmony.

Reply notes and phrases do not overlap each other. Your live guitar can continue during playback. Continuing the same idea will not restart it forever: play a different idea, or use **Start fresh / L** to let the app recognize the same one again. No notes sound just because one attack was detected.

## Controls

| Control | Action |
| --- | --- |
| BPM | Set the pulse; clears recognition and restarts the clock |
| Space | Tap tempo |
| Shift+Space | Restart pulse and recognition |
| Start fresh / L | Fade the reply, clear active/waiting phrases, and listen again; keep the clock |
| M | Mute/unmute replies; an active three-pass window still expires while muted |
| C | Mute/unmute click independently |
| H | Switch Speakers/Headphones microphone processing |
| Escape / Silence | Stop both outputs and clear recognition; keep the pulse |

Click starts off for new users; existing click preferences are respected. Listening settings contains the confidence threshold, reply volume, and optional softening while you play. M restores replies after Silence once an idea has been recognized again. Preferences persist under `guitar.practice.v1`; notes and recognized phrases never persist.

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

The optional Chrome smoke check uses synthetic A–C–E and D–F–B microphone phrases and real local CREPE:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/browser-smoke.mjs
```

It verifies silence through two passes, third-pass recognition, three replies at the captured pace, continuous listening, a waiting phrase, no overlapping output notes, and silence after the last pass. It also checks mute/resume, Start fresh, output switching, panic, and settings restoration. It does not simulate physical speaker feedback or judge the musical feel of a real guitar session.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and all 13 shards are committed in `public/models/crepe-tiny/` and served from the app's origin. Microphone audio stays in the browser. No backend, external inference API, or runtime model CDN.

```bash
npm run vendor:crepe
```

This maintenance command reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download, records SHA-256 hashes, and preserves licenses. Production builds verify those hashes. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and the license files.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); older designs below it are historical. Technical details and verification are in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).
