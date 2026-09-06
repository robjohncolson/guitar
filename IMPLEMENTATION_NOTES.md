# Listen, recognize, reply

The app listens for three consecutive performances of an idea, plays the recognized notes back three times at the captured pace, then stops. It continues listening during playback and keeps one waiting phrase. A newer different idea replaces the waiting one; it can start only after the current three-pass window ends. Repeating the current or last answered idea does not cause an endless loop. Start fresh clears that memory.

## Recognition

`src/music/motif.ts` retains at most 96 accepted attacks within 64 entered beats. It checks consecutive blocks of 3–24 attacks for the same pitch-class order and beat-relative timing. Cycle length must be 1–16 beats. Timing tolerance is 0.22 beats plus 4% of the within-phrase offset, with a separate 12% cycle tolerance; octave and small tuning differences are ignored. Phrases of at least five notes may contain one mismatched pitch per compared performance. Three-pass consensus removes that outlier. Sustains, one repeated pitch, differing rhythms/orders, and widely separated performances cannot establish a motif. This version does not align phrases with missing or inserted attacks.

Consensus captures pitches, velocities, and available note durations from preceding performances. Duplicate recognition compares cyclic rotations of pitch classes and onset gaps, so hearing the same loop from a different starting note does not restart it. Every recognized phrase starts a fresh evidence window while playback proceeds. Chromatic phrases can be replayed; there is no chord-selection gate or generative model.

## Playback and room handling

`src/music/reply.ts` schedules exactly three copies of the captured phrase. It preserves relative onset spacing and cycle length instead of rounding to whole bars. Each note ends before the next onset, including the oscillator stop tail. Late notes are shortened or skipped. `src/music/companion.ts` owns continuous input, masking, the active reply, and one waiting idea. A reply starts on the first available downbeat after recognition or the previous reply's full three-pass window. `Synth` uses filtered triangle oscillators with short attacks and gentle releases.

All musical events use AudioContext time minus `outputLatency || baseLatency || 0`, with 75 ms lookahead and 15 ms late tolerance. Suspended-tab events are skipped. Muting does not extend an active reply's budget; a waiting phrase remains available until unmute. L briefly fades current voices and clears recognition and both phrases while preserving pulse. A stop fade never extends a voice's original end. Panic is immediate. Stopped masks are shortened to the fade/output tail plus 80 ms.

Every scheduled reply note, including its adjacent octaves, is self-masked through its audible duration plus 80 ms. Speakers mode also uses AEC. Matching real guitar notes can be masked too, so headphones remains the cleaner input option. Only accepted attacks affect touch calibration and responsive gain; ringing energy does not claim occupancy or drive accompaniment activity. App notes never overlap one another; live guitar can continue during a reply.

The pitch ear remains real local CREPE tiny, tfjs WebGL, official [1,1024] normalization and 360-bin postprocessing, and AudioWorklet capture with 20 ms hops. Load-failure-only YIN remains explicitly labeled. No model or runtime API was added.

## Model provenance

Model: `https://marl.github.io/crepe/model/model.json`, with 13 relative `group*-shard1of1` paths and 1,948,384 weight bytes. Tiny only. `npm run vendor:crepe` downloads the model, preserves licenses, and records hashes; every production build verifies the assets. CREPE MIT license: `https://raw.githubusercontent.com/marl/crepe/master/LICENSE`; TensorFlow.js Apache license: `https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE`.

## Verification

Phase 1 passed 46 tests with the finite reply model alongside the previous harmony engine. Phase 2 passed 41 tests after replacing that engine with continuous listening and a waiting phrase. Phase 3 passed all 41 tests and the production build after synth/UI integration. The current suite covers recognition, exactly three replies, captured timing and durations, rotated duplicates, queue replacement, non-overlapping note tails, late events, mutes, masking, settings, touch, response, and the retained CREPE/capture contract. The production build checks TypeScript and all model hashes.

The Chrome smoke check passed locally with real CREPE: three A–C–E performances, then D–F–B while the first reply was playing. It verified nine notes per idea, the captured pace, recognition during playback, sequential handoff, and silence after three replies even as the same input continued. Mute/resume, Start fresh, microphone processing changes, panic, and preference restoration without persisted phrases also passed. No overlapping voices, late events, browser errors, or external runtime requests were detected.

Physical acceptance still needs a guitar and room: at 120 BPM, play A–C–E three times in a similar rhythm, then a different idea during its reply. Listen for three copies of each, no overlapping app notes, and silence afterward. Compare headphones with laptop speakers. Synthetic input verifies the detection-to-scheduling path, not acoustic feedback cancellation or musical feel.
