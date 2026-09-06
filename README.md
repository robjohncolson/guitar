# Practice Partner

Enter a BPM. Play a guitar note. Hear the same pitch **two beats later**, starting with your first note.

**Live app:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Play

1. Enter your BPM (40–240). At **120 BPM**, each repeat arrives **one second** after your attack.
2. Click **Enable audio & mic**, allow the microphone, and wait for **CREPE ready (tiny)**.
3. Play one string at a time. Every detected attack queues one tone at the same detected pitch. Notes keep their timing even between beats.

There is no scale to establish or lock. The app synthesizes a gentle triangle tone; it does not record and replay the guitar's sound. Let strings ring: sustained energy does not create extra repeats.

Speakers mode uses echo cancellation and a pitch mask to avoid repeating its own output. For cleaner input, use headphones and press H. Select the actual output device in Windows; H changes microphone processing.

## Controls

| Control | Action |
| --- | --- |
| BPM field | Set tempo immediately; saved for next time |
| Space | Optional tap tempo (four taps) |
| Shift+Space | Clear repeats and restart the pulse at the current BPM |
| M | Mute the repeater and clear pending repeats |
| C | Mute the click independently |
| H | Speakers / Headphones input processing |
| Escape / Silence | Stop both outputs and clear repeats; keep BPM/pulse |

After Silence, use M and C to restore the outputs independently. Changing BPM clears old repeats so they cannot play with the wrong delay. Listening settings contains voiced threshold and repeat volume. BPM, mutes, output mode, and threshold persist under `guitar.practice.v1`. Keep the page visible to avoid browser background-tab throttling.

## Run and verify

Use Node.js 22.12+ within Node 22, npm, and Chrome on Windows.

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

The optional `node scripts/browser-smoke.mjs` exercises real Chrome, CREPE, and a synthetic A2 microphone while the dev server runs. For a production preview or the live app, set `SMOKE_ORIGIN` in PowerShell:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/browser-smoke.mjs
```

The smoke test checks first-note repetition, same detected pitch, two-beat timing, mutes/panic, microphone mode switching, and persisted BPM. It does not measure a physical acoustic speaker feedback loop.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. The model manifest and all 13 shards are committed in `public/models/crepe-tiny/` and served from the same origin as the app. Microphone audio stays in your browser. No backend, external inference API, or runtime model CDN.

```bash
npm run vendor:crepe
```

This maintenance command reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download, records SHA-256 hashes, and preserves licenses. Every production build checks those hashes and fails for a missing or corrupted model file. If loading fails, the UI explicitly says **FALLBACK: YIN**; successful startup always uses CREPE.

CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and the license files.

Pushes to `main` automatically deploy through the connected Vercel project, running all tests and the production build first. The current product contract is at the top of [SPEC.md](SPEC.md); the earlier four-role design below it is historical. See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for timing details and acceptance steps.
