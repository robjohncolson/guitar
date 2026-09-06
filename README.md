# Practice Partner

Enter BPM and play a repeating idea. The app listens for the loop, then plays it back half a beat later three times, including its pauses.

**Live:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Play

1. Enter BPM (40–240) and press **Start listening**. Allow the microphone; check for **CREPE ready (tiny)**.
2. Play individual notes in a short idea, including its pauses, at roughly the same pace three times. The first clear pluck anchors the pulse. There is no four-beat listening window or automatic BPM detection.
3. After recognizing three whole cycles, the app replies with the same note spacing and cycle length, shifted by half an entered beat. It plays three times, then goes quiet.
4. Keep playing. One newly recognized idea can wait and follow the current reply. Continuing the same idea does not make it repeat forever; use **Start fresh / L** to learn it again.

Try 120 BPM: play A, C, E at 0, 0.5, and 1.5 seconds, then start again at 2.5 seconds. Include the closing pause each time. After three performances, the reply starts about 7.75 seconds after your first pluck. This five-beat example deliberately does not fit a four-beat bar.

Recognition compares pitch order, rhythm, and measured note lengths. It supports 2–24 notes with at least two different pitch classes and cycles of 1–16 entered beats. Small timing/tuning differences and an occasional extra or missed pluck in longer phrases are tolerated. Ringing notes and uncertain pitch frames do not count as repeated plucks. A rest means the sound has quieted; a string still ringing between attacks is a sustain.

Replies use synthesized individual tones, preserving detected tuning and timing. They do not transcribe strummed chords or generate harmony. App notes do not overlap each other; you can play during the reply. “Offbeat” shifts the whole loop by half a beat; it does not force every note onto a grid or play only in your gaps. Small articulation changes or a one-note fragment of the answered rhythm do not trigger another reply; use L to hear that idea again with different damping.

## Controls

| Control | Action |
| --- | --- |
| BPM / Space | Enter or tap tempo; restart phase and loop recognition |
| Shift+Space | Restart phase and recognition at the current BPM |
| Start fresh / L | Clear active/waiting loops and learn again; keep the pulse |
| M | Mute/unmute replies; an active three-pass window still expires |
| C | Toggle the optional click, initially off |
| H | Switch Speakers/Headphones microphone processing |
| Stop / Escape | Silence output, clear loops, and release the microphone |
| Start listening | Begin a fresh session after Stop |

Listening settings contains output processing, reply volume, pitch confidence threshold, and optional softening while you play. BPM, mutes, output processing, threshold, and softening preferences persist under `guitar.practice.v1`; captured notes and loops do not. Old Auto preferences are ignored. Reply volume starts at its default each page session.

Speakers uses echo cancellation and masks synthesized pitches and their octaves. A matching guitar note can be masked too. Headphones gives cleaner input; H changes microphone processing, while Windows selects the actual output device. Keep the page visible while playing.

## Check what it heard

Open **Check what I heard** and press **Record a listening check** while listening. It captures up to 20 seconds locally and shows the waveform, detected note lengths, masked notes, and replies. Gaps between completed note bars show pauses. Play the clip or download its WAV and note-timing JSON to compare the detection with your playing. Playing the clip stops the microphone to avoid feeding it back in.

Recording starts only on that button. Nothing is uploaded or saved automatically; leaving or reloading clears the clip. This check is useful when a room, string, or playing style produces missing or extra notes.

## Run and verify

Use Node.js 22.12+ within Node 22, npm, and Chrome on Windows.

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

With preview running, exercise Chrome's microphone pipeline and actual local CREPE using annotated recorded guitar plucks:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/browser-smoke.mjs
```

Set `SMOKE_SYNTHETIC=1` for the synthetic regression fixture, or `SMOKE_MODEL_FAILURE=1` to deliberately fail the model request and check the labeled fallback. `CHROME_PATH` can override Chrome's location. The smoke test checks pluck detection and note endings against source timings, non-bar cycles and rests, half-beat entry, three finite replies, continuous learning, queue handoff, no overlapping voices, no indefinite retrigger, settings, Stop and microphone races, local recording playback, and mobile overflow.

The recorded plucks come from the [University of Iowa guitar collection](https://theremin.music.uiowa.edu/MISguitar.html). See [fixture provenance and edits](tests/fixtures/NOTICE.md). These are edited recorded notes assembled into test phrases, not a physical speaker-feedback test or a recording of your playing. Regenerate with `node scripts/vendor-guitar-fixture.mjs`.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and 13 shards are committed in `public/models/crepe-tiny/` and served locally. No backend, inference API, or runtime model CDN. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

`npm run vendor:crepe` reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download and records SHA-256 hashes; builds verify them. CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and licenses.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); earlier designs below it are historical. See [implementation and verification notes](IMPLEMENTATION_NOTES.md).
