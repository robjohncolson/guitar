# Practice Partner

Choose **Partner** for Echo/Harmony replies, or **Looper** to record and replay your actual guitar.

**Live:** [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar) (private)

## Four-bar Looper

1. Select **Looper**, enter BPM, and press **Record · 4 bars**. Allow the microphone. The metronome gives one bar of count-in, with an accent on beat one.
2. Play four bars in 4/4. Recording stops automatically after 16 beats and immediately starts looping. Chords, slides, rests, and your timing are preserved as audio.
3. Press **Replace** while playing to record at the next loop boundary. The old loop goes quiet for those four bars; the new take then loops continuously. **Undo replace** restores the previous take at a loop boundary.
4. **Stop / Escape** silences audio and releases the microphone, keeping the completed take. **Play** starts it from the beginning. Stop during an unfinished replacement keeps the previous take; Undo while stopped restores without starting playback.

Tempo stays fixed while recording or looping. After Stop, edit BPM for a new recording; Play restores the saved take's BPM without changing its pitch or speed. Switching modes stops audio and keeps the loop in this page. **Clear** discards it and its Undo history; reloading also discards recorded audio. **Download WAV** keeps a local copy at the audio device's sample rate.

Looper has its own metronome preference, initially on. M mutes the loop without moving its position; C toggles the click. Volume is shared with Partner. The optional **Soften the loop while I play** setting works with Headphones processing and leaves the recording itself untouched. It opens the microphone while playing; with softening off, the microphone closes when recording finishes.

Each completed take gets **Auto level**: quiet audio is boosted by up to 24 dB, with headroom for the metronome at 100% loop volume. One fixed gain preserves your accents and rests; near-silent takes stay unboosted. The applied gain appears below the waveform and follows the take through Play, Undo and WAV download. Original samples stay intact. This cannot repair distortion already captured by the microphone.

Use headphones for a clean recording: a microphone can record the speaker metronome and playback, and pitch self-masking cannot remove that sound from audio. Recording uses the device's native sample rate, a sample-clock worklet, and a tiny fade at each loop seam. Physical microphone/output latency and room bleed can affect alignment; this is a browser audio looper, not an input-latency-calibrated recording system.

With preview running, `node scripts/looper-smoke.mjs` checks the real Chrome audio path using recorded guitar plucks and chords. It attenuates the fixture to exercise automatic gain at 100% volume; `SMOKE_INPUT_GAIN` overrides that input multiplier (default 0.12). An independent worklet probes actual output for level matching without clipping, waveform fidelity, repeated timing, silent replacement, Undo, Stop/Play at reduced volume, mute, permission races, mode changes, normalized WAV export, persistence and mobile layout. It uses software WebGL for the retained CREPE model and mutes the test browser's external audio output.

## Partner

Enter BPM and play a repeating idea. The app listens for the loop, then answers with a quiet harmony half a beat later three times, including its pauses. Choose Echo for the original notes.

1. Enter BPM (40–240) and press **Start listening**. Allow the microphone; check for **CREPE ready (tiny)**.
2. Play individual notes in a short idea, including its pauses, at roughly the same pace three times. The first clear pluck anchors the pulse. There is no four-beat listening window or automatic BPM detection.
3. After recognizing three whole cycles, the app replies with the same note spacing and cycle length, shifted by half an entered beat. Harmony is the default; Echo repeats your pitches. Both play three times, then go quiet.
4. Keep playing. One newly recognized idea can wait and follow the current reply. Continuing the same idea does not make it repeat forever; use **Start fresh / L** to learn it again.

Try 120 BPM: play A, C, E at 0, 0.5, and 1.5 seconds, then start again at 2.5 seconds. Include the closing pause each time. After three performances, a C–E–G harmony starts about 7.75 seconds after your first pluck. Echo answers A–C–E. This five-beat example deliberately does not fit a four-beat bar.

Recognition compares pitch order, rhythm, and measured note lengths. It supports 2–24 notes with at least two different pitch classes and cycles of 1–16 entered beats. Small timing/tuning differences and an occasional extra or missed pluck in longer phrases are tolerated. Ringing notes and uncertain pitch frames do not count as repeated plucks. A rest means the sound has quieted; a string still ringing between attacks is a sustain.

Replies use synthesized individual tones. Harmony chooses a smooth supporting line from the whole phrase and considers the guitar expected when each delayed note lands. It favors thirds and nearby consonant alternatives, keeps your overall tuning, and uses the same line for all three passes. The final harmony pass is slightly softer. Short or ambiguous phrases get a quieter octave reply, shown as **Soft octave reply**. This is a musical heuristic, not chord transcription or a claim to know your key.

App notes do not overlap each other; you can play during the reply. “Offbeat” shifts the whole loop by half a beat; it does not force every note onto a grid or play only in your gaps. Small articulation changes or a one-note fragment of the answered rhythm do not trigger another reply; use L to hear that idea again with different damping or compare its Echo and Harmony replies.

## Controls

| Control | Action |
| --- | --- |
| BPM / Space | Enter or tap tempo; restart phase and loop recognition |
| Reply: Echo / Harmony | Choose the next exchange; a playing reply finishes in its original mode |
| Shift+Space | Restart phase and recognition at the current BPM |
| Start fresh / L | Clear active/waiting loops and learn again; keep the pulse |
| M | Mute/unmute replies; an active three-pass window still expires |
| C | Toggle the optional click, initially off |
| H | Switch Speakers/Headphones microphone processing |
| Stop / Escape | Silence output, clear loops, and release the microphone |
| Start listening | Begin a fresh session after Stop |

Listening settings contains output processing, reply volume, pitch confidence threshold, and optional softening while you play. BPM, reply mode, mutes, output processing, threshold, and softening preferences persist under `guitar.practice.v1`; captured notes and loops do not. Old Auto preferences are ignored. Reply volume starts at its default each page session.

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

The default smoke run starts in Harmony and switches to Echo during playback; the current harmony must finish unchanged and the waiting loop must use Echo. Set `SMOKE_REPLY_MODE=echo` to test the reverse. Set `SMOKE_SYNTHETIC=1` for the synthetic regression fixture, `SMOKE_INPUT_MODE=headphones` to start with echo cancellation off, or `SMOKE_MODEL_FAILURE=1` to deliberately fail the model request and check the labeled fallback. `CHROME_PATH` can override Chrome's location.

The smoke script prints its WebGL renderer. Set `$env:SMOKE_ANGLE = 'swiftshader'` to compare software WebGL when the headless hardware path cannot keep up. This still runs the real CREPE model; it changes only the test browser's graphics renderer, not the app's pitch detector or production configuration.

The check covers output pitches and third-pass dynamics, timing and rests, continuous learning, queue handoff, non-overlap, no indefinite retrigger, preference restoration, Stop and microphone races, local recording playback, and mobile overflow. It locates the isolated source plucks in the captured WAV independently of the app's detector, allowing for Chrome fake-microphone drift, then checks detected pitches/times against them with a 90 ms tolerance. It reports accepted and masked notes separately. Every masked note must match an actual output pitch/time window; matching real guitar notes can be masked while the app harmonizes.

The recorded plucks come from the [University of Iowa guitar collection](https://theremin.music.uiowa.edu/MISguitar.html). See [fixture provenance and edits](tests/fixtures/NOTICE.md). These are edited recorded notes assembled into test phrases, not a physical speaker-feedback test or a recording of your playing. Regenerate with `node scripts/vendor-guitar-fixture.mjs`.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and 13 shards are committed in `public/models/crepe-tiny/` and served locally. No backend, inference API, or runtime model CDN. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

`npm run vendor:crepe` reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download and records SHA-256 hashes; builds verify them. CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and licenses.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); earlier designs below it are historical. See [implementation and verification notes](IMPLEMENTATION_NOTES.md).
