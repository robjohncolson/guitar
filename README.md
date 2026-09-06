# Practice Partner

Enter a BPM. Play a guitar note. Hear the same pitch **two beats later**, starting with your first note.

Want to keep a phrase? Choose **1, 2, or 4 bars** of memory, then **Remember** it and play over the loop.

**Live app:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Play

1. Enter your BPM (40–240). At **120 BPM**, each repeat arrives **one second** after your attack.
2. Click **Enable audio & mic**, allow the microphone, and wait for **CREPE ready (tiny)**.
3. Play one string at a time. Every detected attack queues one tone at the same detected pitch. Notes keep their timing even between beats.

There is no scale to establish or lock. The app synthesizes a gentle triangle tone; it does not record and replay the guitar's sound. Soft and strong attacks keep their accents, and detected short/long notes shape the playback. Ordinary echoes last up to two beats. Let strings ring: sustained energy does not create extra repeats.

Speakers mode uses echo cancellation and a pitch mask to avoid repeating its own output. For cleaner input, use headphones and press H. Select the actual output device in Windows; H changes microphone processing.

## Remember a phrase

Choose **Memory: 1 / 2 / 4 bars** (default 2). The app continuously remembers accepted guitar attacks while the ordinary repeater runs. Once that many full bars have finished, **Remember** (or **L**) captures your last useful completed phrase and starts the loop on the next downbeat. Take your time: **Last phrase saved** means silent bars are not pushing it out of memory. New playing updates the candidate when its bar finishes. A phrase must contain at least one note; its accents, note lengths, rests, and notes between beats stay in place.

The captured phrase stays fixed while you play over it. Your new notes do not overdub the loop or also trigger the two-beat echo. **Clear** (or L again) stops the loop and returns to normal repeating. You can then Remember a new phrase from your recent playing. Clear the loop before choosing a different length.

**Responsive** is on by default. The loop gently softens as you play, making more room for busy phrases, then returns in your pauses. Switch it off for steady loop volume; the captured accents remain. The click and ordinary two-beat repeats keep their volume.

**M** mutes the loop while retaining its phase; unmute to rejoin it. **Escape** clears the loop and silences both outputs. Changing BPM or restarting the pulse clears the loop, candidates, and rolling history. Memory length and Responsive are saved; recorded note events stay in this session.

## Controls

| Control | Action |
| --- | --- |
| BPM field | Set tempo immediately; saved for next time |
| Space | Optional tap tempo (four taps) |
| Shift+Space | Clear repeats and restart the pulse at the current BPM |
| L | Remember the last completed phrase / Clear the loop |
| Responsive | Let the loop soften during your playing and return in pauses |
| M | Mute notes; clear pending echoes or retain the frozen loop |
| C | Mute the click independently |
| H | Speakers / Headphones input processing |
| Escape / Silence | Stop both outputs and clear repeats; keep BPM/pulse |

After Silence, use M and C to restore the outputs independently. Changing BPM clears old repeats and memory so they cannot play with the wrong delay. Listening settings contains voiced threshold and repeat volume. BPM, memory length, Responsive, mutes, output mode, and threshold persist under `guitar.practice.v1`. Keep the page visible to avoid browser background-tab throttling.

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

The smoke test checks first-note repetition, same detected pitch, two-beat timing, soft/strong and short/long playback, phrase retention through silence, repeated cycles with frozen expression, responsive volume recovery, Clear returning to repeating, mutes/panic, microphone mode switching, and saved preferences. It does not measure a physical acoustic speaker feedback loop.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. The model manifest and all 13 shards are committed in `public/models/crepe-tiny/` and served from the same origin as the app. Microphone audio stays in your browser. No backend, external inference API, or runtime model CDN.

```bash
npm run vendor:crepe
```

This maintenance command reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download, records SHA-256 hashes, and preserves licenses. Every production build checks those hashes and fails for a missing or corrupted model file. If loading fails, the UI explicitly says **FALLBACK: YIN**; successful startup always uses CREPE.

CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and the license files.

Pushes to `main` automatically deploy through the connected Vercel project, running all tests and the production build first. The current product contract is at the top of [SPEC.md](SPEC.md); the earlier four-role design below it is historical. See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for timing details and acceptance steps.
