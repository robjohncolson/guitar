# Listen, recognize, accompany

The user found the repeater too reactive. The current app removes its automatic echo queue and manual phrase recording. It listens for three consecutive performances of a musical idea and only then chooses a quiet supporting chord. The established harmony stays fixed until Listen again, tempo reset, or panic. This is conservative rule-based accompaniment, not a claim of general musical understanding.

## Recognition

`src/music/motif.ts` retains at most 96 accepted attacks within 64 entered beats. It checks consecutive blocks of 3–24 attacks for the same pitch-class order and beat-relative timing. Cycle length must be 1–16 beats. Timing tolerance is 0.22 beats plus 4% of the within-phrase offset, with a separate 12% cycle tolerance; octave and small tuning differences are ignored. Phrases of at least five notes may contain one mismatched pitch per compared performance. Three-pass consensus removes that outlier. Sustains, one repeated pitch, differing rhythms/orders, and widely separated performances cannot establish a motif. This version does not align phrases with missing or inserted attacks.

`src/music/harmony.ts` evaluates major/minor triads, sevenths, sixths, and suspended shapes. All chord tones must have occurred in the consensus phrase. At least 65% of weighted note mass must be covered. A score margin of 0.025 is required; the first and lowest notes provide root evidence. Ambiguous patterns remain silent and can be reconsidered. No generative music model or guessed missing chord tones. A–C–E gives Am; A–C–D–E–G can support Am7. These are musical heuristics, not universal harmonic interpretations.

## Playback and room handling

`src/music/companion.ts` owns accepted input, masking, and a stable accompaniment. It chooses the next downbeat with enough output lead, rounds the observed phrase cycle to 1–4 bars, and repeats the held harmony at that interval. Chord notes use an open voicing with a root in MIDI 40–57, soft 180 ms attack, gentle release, and a per-voice gain divided by the square root of the voice count. The chord ends 150 ms before the next cycle. `Synth` filters triangle oscillators for a warmer, less percussive sound.

All musical events use AudioContext time minus `outputLatency || baseLatency || 0`, with 75 ms lookahead and 15 ms late tolerance. Suspended-tab events are skipped; unmute rejoins the phase without a burst. L fades current voices over 60 ms and clears recognition while preserving pulse. Panic is immediate. Stopped masks are shortened to the fade/output tail plus 80 ms.

Every scheduled chord voice, including its adjacent octaves, is self-masked through its audible duration plus 80 ms. This accounts for octave detections of polyphonic output. Speakers mode also uses AEC. Matching real guitar notes can be masked too, so headphones remains the cleaner input option. Only accepted attacks affect touch calibration and responsive gain; ringing energy does not claim occupancy or drive accompaniment activity.

The pitch ear remains real local CREPE tiny, tfjs WebGL, official [1,1024] normalization and 360-bin postprocessing, and AudioWorklet capture with 20 ms hops. Load-failure-only YIN remains explicitly labeled. No model or runtime API was added.

## Model provenance

Model: `https://marl.github.io/crepe/model/model.json`, with 13 relative `group*-shard1of1` paths and 1,948,384 weight bytes. Tiny only. `npm run vendor:crepe` downloads the model, preserves licenses, and records hashes; every production build verifies the assets. CREPE MIT license: `https://raw.githubusercontent.com/marl/crepe/master/LICENSE`; TensorFlow.js Apache license: `https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE`.

## Verification

Phase 1 passed 64 tests with the new motif recognizer alongside the previous engines. Phase 2 passed 74 tests after harmonic choice and scheduling. Integration removed the obsolete repeater/memory engines and their tests; the current suite covers recognition, supported/ambiguous harmony, timing/latency, stable playback, all-voice masking, mask release, mutes, settings, touch, response, and the retained CREPE/capture contract. The production build verifies TypeScript and all model hashes.

Chrome's real-CREPE synthetic microphone check passed locally: silent through two A–C–E passes, an Am chord after the third on a downbeat, all three voices scheduled together, repeat chord starts exactly two seconds apart at 120 BPM, and no late events. M retained the harmony, H kept one context and switched AEC flags, L stopped accompaniment and cleared progress, and panic stopped output. Preferences restored after reload without a stored harmony. No browser errors or external-origin runtime HTTP requests.

Physical acceptance still needs a guitar and room: at 120 BPM, play A–C–E three times in a similar rhythm, then improvise over the soft Am chord. Try unrelated notes and verify it waits. Compare headphones with laptop speakers, test L and M, and assess whether the sustained chord sits comfortably below the guitar. Synthetic input verifies the detection-to-scheduling path, not acoustic feedback cancellation or musical feel.
