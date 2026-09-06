# Continuous listening and offbeat replies

The latest user revision removes Auto BPM, four beat cells, and bar-entry waits. Manual BPM sets a stable clock; the first accepted pluck anchors phase without estimating tempo. The app recognizes three whole performances of a loop, preserves its notes and rests, and replies with three copies shifted half an entered beat. It listens concurrently, keeps one waiting idea, and suppresses repeats of the current/last answered loop. Stop silences output, clears the exchange, and releases microphone tracks, including pending requests.

## Ear and rests

`src/audio/attack.ts` uses rolling 12 ms energy and high-frequency-difference windows, a 40 ms reference envelope, and 90 ms debounce. This avoids treating individual waveform cycles or ringing modulation as separate plucks. `onset.ts` waits at least 60 ms for two agreeing pitch observations with 65% support within 0.65 semitones, rejecting unsettled pitch after 140 ms. Raw attacks establish timestamps; pitch jumps alone do not create notes.

Note ends come from 80 ms of quiet raw audio (below the larger of 0.0015 RMS and 4% of the accepted attack peak), timestamped at the beginning of quiet, or the next accepted attack. All captured frames supply energy independently of GPU inference, so skipped pitch frames cannot hide a short pause. Confidence dropouts and octave blips in sustained audio do not invent rests. Self-masking occurs before a candidate can end a player's sustain. The observed end still has frame-window and room-decay uncertainty; it is not a precise finger-release transcription.

CREPE remains the actual pitch ear: local tiny tfjs Layers model, WebGL, official [1,1024] normalization and 360-bin postprocessing, AudioWorklet capture at 16 kHz with 20 ms hops. Inference keeps two short snapshots per raw attack, at most four total, plus the latest frame; snapshots older than 250 ms are dropped. Raw attacks are delivered in inferred-frame order, so a new live pluck cannot overwrite one still being analyzed. Two seconds of confirmed release timestamps preserve note ends when inference finishes after the next pluck. YIN is available only on model-load failure and is labeled `FALLBACK: YIN`.

## Loop recognition

`src/music/motif.ts` keeps at most 96 accepted attacks within 64 entered beats. Repeated pitch-class lags propose cycles of 1–16 beats; adjacent lags within 0.12 entered beats form median estimates. Recognition advances with the audio clock even in silence, waiting for the third full cycle including the closing rest.

Three cycle windows are aligned by pitch, relative attack time, and known note duration. Phrases contain 2–24 notes and at least two pitch classes. Alignment permits one insertion/deletion per comparison for phrases of three or more notes; a wrong pitch can use that same allowance at five or more notes. Timing tolerance is min(85 ms, 0.18 entered beats) plus 3.5% of elapsed phrase time. Known duration differences must fit max(90 ms, 0.22 beats, 30% of the shorter duration).

At least two performances must agree on every retained note. Consensus uses median pitch/tuning, timing, known lengths, and dynamics, discarding isolated extras. Gaps after known note ends, including the final gap, form explicit rests. Unknown ends remain uncertain and playback fills available note space instead of inventing a short note/rest. Rotated pitch/rhythm/articulation patterns count as the same loop. After recognition, only input at the next cycle boundary is retained, allowing immediate new ideas without recycling old evidence.

## Playback and room handling

`reply.ts` schedules exactly three captured cycles. `companion.ts` chooses the first schedulable occurrence of the loop's own phase plus half an entered beat; it does not round to bars. A waiting loop starts after the current full three-cycle window using its own phase. Relative timings and measured cycle duration are preserved even for a new idea at a different pace. One waiting idea may be replaced by a newer different one; no backlog or indefinite retrigger.

Audio events use AudioContext time minus `outputLatency || baseLatency || 0`, with 75 ms lookahead and 15 ms late tolerance. Slightly late notes are shortened; stale notes are skipped without catch-up. Note lengths account for the oscillator stop tail and leave a gap before the next app voice. Muting does not extend active passes; a waiting phrase waits for unmute. L fades current voices and resets loops while preserving pulse. Stop is immediate; stopped masks retain only the brief audible tail.

Reply notes and adjacent octaves are masked through their audible duration plus 80 ms. Recent windows remain available for 500 ms afterward to check delayed inference against its original timestamp; this does not extend their audible masking interval. Speakers mode also requests AEC. Matching real guitar attacks can be masked, and room sound can obscure silence, so physical feedback remains a limitation. Only accepted attacks affect touch calibration and optional responsive softening. No model, backend, or runtime API was added.

## Optional inspection

`listening-capture.ts` allocates a maximum 20-second, 16 kHz local buffer only after an explicit button press. Timestamped overlapping frames reconstruct a WAV; JSON records raw attacks, pitch/RMS observations, accepted/masked notes and durations, and scheduled replies. Late inference annotations refresh the trace after recording stops. The waveform and note bars let the player compare actual sound with detections. Clip playback stops the live microphone. Audio and notes are neither persisted nor uploaded; only preferences use localStorage. Obsolete Auto settings are discarded.

## Model and recording provenance

Model: `https://marl.github.io/crepe/model/model.json`, with 13 relative `group*-shard1of1` paths and 1,948,384 weight bytes. Tiny only. `npm run vendor:crepe` downloads the model, preserves licenses, and records hashes; production builds verify the assets. CREPE MIT license: `https://raw.githubusercontent.com/marl/crepe/master/LICENSE`; TensorFlow.js Apache license: `https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE`.

The browser fixture uses six real plucks from the [University of Iowa guitar recordings](https://theremin.music.uiowa.edu/MISguitar.html), edited into phrases with known onsets, note ends, and pauses. `scripts/vendor-guitar-fixture.mjs` reproduces the committed WAV and hash/provenance manifest. Source recordings, permission, and edits are documented in [tests/fixtures/NOTICE.md](tests/fixtures/NOTICE.md). Full source downloads remain ignored; the test WAV is not deployed to the app.

## Verification

Phase gates passed: 60 tests after ear changes, 65 after loop/playback changes, and 55 plus build after removing the 12 Auto tests and adding local capture tests. Final regressions cover early self-masking, silence detection while pitch inference skips frames, overlapping capture/inference work on successive plucks, and delayed output masking. The current suite has 59 passing tests across ten files; production TypeScript, model hashes, and build pass.

The Chrome smoke check compares detections against annotated source plucks, including note endings. It exercises actual CREPE, half-beat entry of a five-beat phrase, three passes, a second loop learned concurrently, one waiting idea, preserved cycle/rest timing, non-overlapping voices, suppression of indefinite repeats, mutes/reset, manual BPM/Space, microphone processing changes, Stop races, recording playback, mobile overflow, and preference restoration. Synthetic and recorded fixtures exercise the microphone-to-output path. Repeated runs exposed variable note lengths and missed short plucks when GPU work skipped frames; independent energy observation, two retained attack snapshots, and deterministic regressions address those failures. The final synthetic run detected all 29 expected plucks with no extras and a 30 ms mean absolute note-duration error; it produced exactly 18 reply notes, no overlap, no late schedules, and no browser errors.

The recorded-guitar run detected 28 of 29 expected plucks (96.6% recall, no extras) with a 24 ms mean absolute note-duration error. Both five-beat and 3.5-beat ideas produced three finite passes with no overlap, late schedules, browser errors, or external runtime requests. Recognition retained the full three-note idea despite the missed pluck. These metrics apply to the annotated fixture only.

Physical acceptance remains: enter 120 BPM, start listening, and play an A-C-E idea at offsets 0, 0.5, 1.5 seconds in a 2.5-second cycle, three times with the closing pause. Hear three half-beat-shifted copies, then quiet. Repeat a different idea during the reply and hear it follow. Compare muted pauses with ringing strings, use Check what I heard, try Stop/restart, and compare headphones with laptop speakers. Automated edited recordings do not establish reliability for every guitar, room, microphone, chord, or very fast pluck.
