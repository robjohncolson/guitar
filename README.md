# Practice Partner

A local browser app that shares your pulse, listens to an acoustic guitar, infers the scale, and plays tones in the beats you leave empty.

V1 is implemented with local CREPE tiny inference, four companion roles, and an audio-clock scheduler. No account, backend, or runtime CDN.

## What it is

Afternoon practice partner. Tap Space to set BPM, play into the laptop mic, hear a companion from the speakers on the off-beats once it knows the scale. Four roles (hole-filler, bass, harmony, call-response), two densities (shy / busy). CREPE (Kim et al., ICASSP 2018) is the pitch ear. Music theory is the brain.

## What it is not

A lesson app, a tab grader, a backing-track generator, or a generative “AI band.”

## Run

Use Node.js 22.12 or newer (Node 22.17.1 was used here), npm, and Chrome on Windows.

```bash
npm install
npm run dev
```

Open the localhost address Vite prints. Click **Enable audio**, allow the microphone, and wait for **CREPE ready (tiny)**. Tap Space four times at a steady pulse, then play single notes on beats **1 and 3**, leaving **2 and 4** empty. Try A, C, D, E, G, A. Let the strings ring; only attacks occupy beats.

After at least six in-tune note attacks, press **L** when the scale guess looks right. The specified confidence formula often ties a pentatonic scale with its larger supersets, so **Lock is normally needed for pentatonic practice**. The companion can then fill the holes. Start with Shy; Busy takes more empty beats.

The output selector configures microphone echo cancellation. Select the actual speaker/headphone device in Windows. Speakers mode is the default; Headphones turns AEC off. Switching modes keeps the clock and scale lock.

If the companion hears itself through the speakers, press `H` for headphones.

## Controls

| Key | Action |
| --- | --- |
| Space | Tap tempo; more taps nudge tempo and phase |
| Shift+Space | Clear the clock and beat occupancy; keep scale lock |
| 1 / 2 / 3 / 4 | Hole-filler / Bass / Harmony / Call-response |
| D | Shy / Busy |
| L | Freeze or release the current scale |
| M / C | Mute companion / click independently |
| H | Speakers / Headphones input processing |
| Escape | Immediately silence both outputs and stop current voices; clock continues |

After Escape, use M and C to bring the outputs back independently. Listening settings contains the voiced threshold (0.3–0.8) and companion volume. Preferences are saved under `guitar.practice.v1`; BPM and scale lock are never saved.

Call-response listens for a bar with at least two attacks, then reverses those pitch classes onto the beats left empty in that call. Shy obeys the global one-companion-note-per-player-onset rule and rests for a full bar after responding; Busy allows the full answer.

## Verify and build

```bash
npm test
npm run build
npm run preview
```

Tests use pure TypeScript logic and do not require a microphone or network. The optional `node scripts/browser-smoke.mjs` runs real installed Chrome with a synthetic A2 microphone while the dev server is running. For the production preview, in PowerShell:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/browser-smoke.mjs
```

The browser check verifies local CREPE inference, AudioWorklet capture, oscillator scheduling, controls, output-mode constraints, panic, and saved settings. It does not reproduce acoustic speaker feedback. Keep the app visible during practice; background-tab timer throttling can cause skipped beats. See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for exact human acceptance steps and timing tradeoffs.

## Model assets and attribution

`public/models/crepe-tiny/` contains the actual official [CREPE browser model](https://marl.github.io/crepe/) and all 13 shards (about 2 MB). Vite serves it at `/models/crepe-tiny/model.json`; nothing is fetched from a CDN at runtime. Tiny is the only capacity shipped. Keep the model files in Git so every deployment includes them.

To reproduce the download (network required only for this maintenance step):

```bash
npm run vendor:crepe
```

The script downloads the manifest and every referenced shard, records SHA-256 hashes, and preserves the upstream MIT and Apache licenses. The build checks the model's hashes and fails if any model file is missing or corrupted. CREPE: Jong Wook Kim, Justin Salamon, Peter Li, Juan Pablo Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018. TensorFlow.js is Apache 2.0. See `public/models/NOTICE` and the license files.

If CREPE cannot load or WebGL cannot initialize, the page explicitly says **FALLBACK: YIN**. Successful CREPE loading always selects the neural model. A later inference error stops the ear and displays an error; it does not silently change detectors. Use Chrome’s site settings to recover blocked microphone permission, then click Retry audio & mic.

## Docs

| File | What |
|------|------|
| `SPEC.md` | Product and architecture (source of truth) |
| `CODEX_PROMPT.md` | Phased implementation prompt |
| `AGENTS.md` | Constraints for agents working in this folder |
