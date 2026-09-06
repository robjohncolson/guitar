# Guitar Practice Partner — Spec

## Current product: three phrase replies, then quiet (September 6, 2026)

### Auto tempo revision

The user explicitly requests estimating BPM from string plucks. This replaces the previous prohibition on a guitar-derived clock, including the original Space-only constraint.

- Auto is the default. Estimate one initial pulse from accepted, pitch-confirmed and self-masked guitar attacks. CREPE remains the pitch ear; no new model or backend. Do not use ringing energy or infer tempo from the app's output.
- Require at least eight attacks and three successive agreeing estimates. Support simple beat/eighth-note patterns and rests in the 40–240 BPM range. Keep a bounded window, ignore invalid/duplicate timestamps, and restart incomplete learning after a gap over three seconds. Irregular or ambiguous input keeps listening. This is a conservative onset-timing heuristic, not general beat/downbeat tracking.
- Show no numeric BPM or running beat animation until a pulse is established; suppress click and replies while learning. Retain phrase evidence and measured durations during learning, including a phrase already waiting. Align the clock to the fitted first pluck, treating it as beat one rather than claiming to infer meter.
- Once established, hold the pulse through subsequent rhythms, silence, microphone processing changes, and the finite reply exchange. Preserve each phrase's captured pace even when it differs from the locked BPM. L and Shift+Space retain the learned BPM; if still learning, they clear incomplete evidence.
- Entering BPM or tapping Space switches to manual mode. **Find tempo** clears active/waiting phrases and starts a new Auto learning pass. Keep this single small control by the BPM field; no extra setup screen. Save the Auto/manual preference, but a new Auto session must learn again rather than silently reusing the previous estimate.
- Half/double tempo can be ambiguous; favor simple rhythms with a mild comfortable-tempo bias and keep manual correction available.

Phase gates: estimator tests first; phrase-evidence preservation and preference tests second; UI integration tests/build third; real Chrome/CREPE Auto and manual checks before publishing. Cover regular tempos, jitter, rests/subdivisions, irregular input, locked tempo despite new playing, re-learning, manual/Space overrides, self-mask, preserved three-pass recognition, sequential finite replies, and preference restoration.

### Finite reply behavior

The user now wants a finite exchange: listen for recurring notes, place those notes back at the same pace three times, and keep listening for new notes without overlapping the app's phrases or tones. This replaces the indefinitely held chord contract below.

- Keep the existing three-performance phrase recognizer, real local CREPE, accepted-attack segmentation, Auto or manually entered/tapped BPM, and output-latency compensation. A recognized phrase may contain any notes; remove chord inference and harmonic gating.
- Replay the recognized notes as a single-note sequence, preserving detected pitch/tuning, relative attack spacing, accents, and rests. The cycle is the measured phrase duration in seconds, without rounding it to whole bars. Start the first pass on the next schedulable downbeat, then play exactly **three** passes and expire automatically.
- Clip note lengths before the next attack or cycle boundary. Account for the oscillator's stop tail and slightly late starts, so app-generated voices never overlap. Keep a warm, quiet triangle tone with a short attack appropriate for a note sequence. No sustained chord layer.
- Continue recognizing accepted player input during replies. Keep at most one different recognized phrase waiting; a newer different idea replaces that waiting candidate. Start it only after the current three-pass window, on a schedulable downbeat. Do not interrupt or stack phrases, and do not accumulate a backlog.
- Do not requeue the current or last-answered idea from continuing input. Treat cyclic rotations of the same notes/rhythm as the same phrase. **Start fresh / L** clears this memory as well as active/waiting replies, allowing the same idea to be learned again. Preserve the pulse. Freshly recognized different phrases can produce another finite exchange.
- M suppresses reply output while the current finite window continues to elapse; a waiting new phrase waits for unmute. Do not restart expired passes or emit a catch-up burst after a stalled tab. Escape clears active/waiting recognition and silences both outputs. BPM/Shift+Space reset recognition and pulse. H preserves active/waiting phrases and the clock.
- Continue self-masking output notes and their octave detections. Player notes matching a sounding output may be masked; headphones/AEC remain the available input controls. This version prevents overlap between app-generated notes and phrases; live guitar can continue while the app replies. Responsive softening remains optional.
- Show **Playing back · 1 / 2 / 3 of 3**, continued listening, and whether a next phrase is ready. Return automatically to listening after the last pass. Keep controls minimal and persist preferences only, never captured notes or pending replies.

Phase gates: finite sequence/timing tests; continuous-listening, deduplication and waiting-phrase tests; synth/UI integration tests plus build; real Chrome/CREPE microphone check before publishing. Verify nine output notes for a three-note phrase, identical repeated timing, preserved non-bar cycle duration, measured articulation, no voice/phrase overlap, exactly three passes, continued input recognition, single waiting candidate, no indefinite retrigger, mute/reset/panic, latency, and stale-event skipping.

Acceptance: play A–C–E three times, then hear A–C–E three times at the original pace. While that plays, repeat D–F–B three times. It should be recognized during the first reply and played only when the first three passes finish. Continuing D–F–B must not make the app replay it forever. L allows starting over.

## Previous product: a held supporting chord (historical)

The user found the attack repeater too noisy and reactive. This contract supersedes all repeater, manual memory, and original four-role behavior below. The app must exercise musical judgment before making any companion sound.

1. Enter BPM (40–240, default 100, saved), enable mic/audio, and play individual notes. Space still sets tap tempo; guitar input never sets the clock. Click is optional, off for new users. Honor a previously saved click preference.
2. Listen silently for three consecutive performances of roughly the same short phrase. Compare note order and beat-relative timing, not just a histogram or total attack count. A phrase may start between beats and need not begin on a downbeat. Support 3–24 attacks and cycles of 1–16 beats. Ignore octave/tuning differences within a pitch class; tolerate modest timing differences and one wrong pitch in phrases of at least five notes. Sustains, a single repeated pitch, unrelated sequences, and widely separated phrases cannot establish a motif. Keep history bounded.
3. Use agreement across those three performances to choose one supporting harmony. Start with a quiet sustained chord. Every chord pitch class must occur in the recognized phrase; do not invent an absent third or fifth. Consider major, minor, common seventh/sixth, and suspended shapes, weighted by accepted attacks. Require adequate coverage and a clear winner; root position and the phrase's first/lowest notes help resolve alternatives. A repeated but harmonically unclear phrase remains silent and can be reconsidered as new playing arrives.
4. Once established, enter on the next downbeat that can be scheduled after output latency. Use a warm, softly attacked chord in an open voicing; normalize level for the number of voices. Repeat the chord every 1–4 bars, nearest the observed phrase cycle. Hold the chosen harmony stable while the player improvises. No automatic reharmonization or simultaneous echo queue.
5. **Listen again / L** fades the chord and clears recognition, requiring a new three-pass idea. It preserves BPM and the click phase. **M** mutes harmony while retaining its phrase and phase. Unmute joins a future playable chord without a stale burst. **C** controls click independently. **Escape** stops both outputs, clears recognition, and preserves BPM/pulse. BPM changes and Shift+Space clear recognition and restart the pulse. **H** changes mic processing while retaining the recognized harmony and clock.
6. Keep responsive softening as a collapsed listening preference. Only accepted player attacks drive it; gain recovery never changes the click or undoes a mute. Preserve real local CREPE tiny, attack segmentation, load-failure-only labeled YIN fallback, AEC in Speakers mode, and output masking. Mask each chord voice and its neighboring octaves through its audible end plus 80 ms. When stopping a chord, shorten masks to the fade/output tail so fresh listening is not blocked for the original sustain duration.
7. Minimal UI: BPM and four beats, three recognition indicators, current player note, established chord, Listen again, harmony/click mutes, output mode, Silence, and collapsed threshold/volume/responsive preferences. Remove the two-beat delay display, Remember, and memory-length selector. Never persist notes or recognition state. Discard old memory/role fields when saving preferences.

Phase gates: motif matching tests first; harmony judgment and audio-clock scheduling tests second; UI/synth integration tests and production build third; real Chrome/CREPE synthetic-microphone verification before publishing. Cover silence through two passes, third-pass entrance, order/rhythm mismatch, tuning/timing tolerance, harmonic ambiguity, stable accompaniment, latency/stale events, all-voice masking, mutes, resets, and settings migration.

Acceptance: at 120 BPM, play A–C–E as individual notes in the same short rhythm three times. No companion sound during the first two passes. After the third, hear a quiet Am chord on a downbeat. Improvise while that chord stays stable. L returns to silent listening. Unrelated noodling must not trigger arbitrary notes. This is a conservative rule-based accompanist, not general harmonic understanding or polyphonic guitar transcription.

## Previous product: two-beat repeater with phrase memory (historical)

This contract supersedes the scale-inference and four-role product below. The user asked for a simple repeater with no musical setup wait.

### Expressive memory revision (September 6, 2026)

Preserve touch, retain the last useful phrase through pauses, and add one **Responsive on/off** toggle, on by default and saved. These rules supersede the fixed-length tones and strictly rolling capture described below.

- Capture each attack's unnormalized RMS during the existing pitch-settling window. Compare accepted player attacks with recent playing to retain soft/loud accents without microphone calibration controls. Masked companion attacks must not train this comparison. Softer notes also have a warmer triangle tone.
- Measure a note's end at the next settled attack or the start of at least 80 ms of unvoiced input. Brief pitch dropouts do not end it. Minimum detected length is 40 ms. In ordinary echo mode, use the length known when scheduling, capped at two beats; a still-held note uses that cap. Keep the original two-beat onset delay. A frozen phrase captures measured lengths, clipped at the next attack and source phrase boundary, including for a still-held final note.
- Keep one candidate for each memory length alongside bounded rolling history. A completed bar containing new playing updates the candidate; silent bars do not slide or erase it. Initial capture still requires full listening bars and at least one note. Preserve offsets and rests within the selected window. Show **Last phrase saved** during pauses. Late-settling attacks enter the candidate until Remember freezes it. New incomplete playing cannot replace the last completed phrase.
- Responsive changes the loop's volume as the player improvises: close accepted attacks make it quieter, and pauses bring it back smoothly. Drive activity from accepted attacks, never ringing energy or raw microphone volume. Attacks accumulate to a maximum reduction to 40% of the user's volume; recovery follows the entered pulse. This affects current as well as future loop tones, without changing stored notes, pitch, timing, click, or mutes. Turning it off restores steady playback with the recorded accents intact. Ordinary repeats always use steady volume.
- Clear retains candidates; tempo/pulse reset discards them. M keeps the frozen loop and phase; Escape silences output and clears the active loop. H retains the loop and resets microphone loudness calibration. Only preferences persist, including Responsive; no note data is stored.

Implementation gates: capture and release tests first; expressive repeater and held-memory tests next; responsive synthesis/UI tests and production build last, followed by real Chrome capture/playback verification. Test dynamics, short/long notes, dropout tolerance, 1/2/4-bar retention through silence, late bar-boundary input, immutable expression, response recovery, preserved mutes/clock, and persistence.

### Phrase memory addition

Keep the two-beat repeater as the default. Add just a **Memory: 1 / 2 / 4 bars** selector (default 2) and a **Remember / Clear** toggle, also on **L**.

Continuously retain the last four completed bars plus the current bar of accepted player attacks, and the last useful candidate for each length. Remember snapshots the selected candidate on the existing 4/4 clock, once full listening bars and at least one accepted note are available. Preserve detected pitch, touch, attack timing between beats, and rests. Do not quantize or fill empty beats. Playback uses expressive triangle tones, clipped at the phrase boundary.

Start the frozen phrase on the next downbeat with enough lead for output latency; repeat it at exactly the selected bar length. While armed or looping, incoming guitar continues entering rolling memory but cannot alter the frozen snapshot and cannot queue ordinary echoes. Both modes share the existing self-play mask, so companion output never enters memory. Remember stops pending/current ordinary echoes. No overdub or automatic replacement.

Clear cancels active/future loop tones and returns immediately to the ordinary repeater, retaining rolling history for a new capture. Disable length changes while a phrase is frozen. M mutes notes while preserving a loop and its phase; unmute rejoins the current cycle without a burst. Escape clears the frozen loop and silences output. BPM changes and Shift+Space clear the loop and rolling history, then restart the pulse. H preserves the clock and phrase. Save only the selected `memoryBars`, never history or a frozen phrase.

Show listening progress until capture is ready, then a next-downbeat start status and current loop bar. Acceptance: capture 1, 2, and 4 bars with unevenly spaced notes/rests; confirm repeated cycles match, new playing does not overdub, and Clear restores the echo. Verify mute/resume phase, panic, tempo reset, empty/partial capture, stale-cycle skipping, latency, and the self-mask.

### Default repeater behavior

- Enter BPM directly (40–240, default 100, saved). Click Enable audio & mic. Space tap tempo remains optional; the guitar never sets tempo.
- The **first** accepted note-on queues the same detected pitch, at `onset.t + 120 / bpm`. At 120 BPM this is one second after the original attack, including for off-grid notes. Preserve detected tuning rather than snapping to a scale or octave. CREPE's short onset-settling window does not add to the delay.
- Each attack produces exactly one synthesized triangle tone, at the same pitch. This is pitch repetition, not recording and replaying the guitar audio. Sustain never queues extra repeats. Preserve measured dynamics and duration as described in the expressive memory revision above.
- No scale inference, confidence-to-key gate, six-note wait, lock, density, hole filling, or role selector. Repeats can overlap a newly played note; do not delay or skip them based on occupancy.
- Retain real local CREPE tiny, official model I/O, WebGL, AudioWorklet capture, and the explicitly labeled load-failure-only YIN fallback. Retain speakers AEC and the matching-pitch self-play mask for note duration plus 80 ms.
- Audio target time is `onset.t + 120 / bpm - outputLatency`, falling back to baseLatency. Schedule with Web Audio; skip events more than 15 ms late. Do not move old repeats to the present after a stalled tab.
- Changing BPM or Shift+Space clears queued/current repeats and restarts the click phase. M mutes and clears repeats without muting click; C mutes click; H reopens mic processing without changing tempo; Escape cancels pending/current repeats and click while preserving BPM/pulse.
- UI: editable BPM, two-beat delay in seconds, four beat indicators, last accepted player note, upcoming/last repeat, mic/model state, repeater/click mutes, output mode, and collapsed threshold/volume controls.
- Persist BPM, mutes, output mode, tiny capacity, and voiced threshold under `guitar.practice.v1`. Discard former role/density fields on save. Pending repeats never persist.
- Tests cover first-note eligibility, multiple/off-grid attacks, same detected Hz, two-beat timing at 40–240 BPM, output-latency compensation, sustain segmentation, self-mask, mute/panic clearing, tempo changes, stale-event skipping, settings migration, and official CREPE postprocess.

Acceptance: enter 120 BPM and play any one guitar note. Hear the same pitch one second later without tapping, locking, or training a scale. Play a few different notes and hear each once at the same delay. Stop playing and ensure repeats end rather than feeding back. Change BPM and verify the delay follows. Confirm mute/panic clears pending repeats and CREPE loads on the deployed site.

---

## Original v1 design (historical; overridden above)

Local browser app. Afternoon practice. Acoustic guitar into the laptop mic. Companion out of the laptop speakers. You tap a pulse, it listens, it infers the scale, it plays tones in the beats you leave empty.

This file is the source of truth. `CODEX_PROMPT.md` is the implementation order.

---

## 1. Product

A **practice partner**, not a lesson app and not an AI band.

**North-star demo (this is the product):**

1. Open the page in Chrome on Windows.
2. Grant mic. Wait until the UI says `CREPE ready` (not a stub, not YIN pretending).
3. Tap **Space** four or more times at a steady pulse (~80–120 BPM).
4. A muteable click follows that grid. One bar of audible count-in is fine.
5. Play an acoustic guitar into the laptop mic, **on beats 1 and 3 only**, in one scale, for a few bars (e.g. A minor pentatonic).
6. The UI shows a growing scale guess, e.g. `A minor pentatonic · 74% · unlocked`.
7. Once confidence clears the threshold (or you press **L** to lock), the companion plays a scale tone on **beats 2 and 4** — the holes — from the laptop speakers.
8. It does not play on top of your attacks. It does not chase its own speaker output into a new key. It does not require headphones, though headphones are an escape hatch.

If that loop is late, in the wrong key, doubled with the guitar, or silent because the mic heard the speakers, the build has failed.

### 1.1 Roles (all ship)

Same ear and clock. Only the voice policy changes. Switch live without resetting tempo or scale.

| Key | Role | What it plays |
|-----|------|----------------|
| `1` | **Hole-filler** | One scale tone on empty beats. Default: fifth, else tonic. |
| `2` | **Bass** | Pedal tonic/fifth, octave down, empty beats only. Not walking bass. |
| `3` | **Harmony** | Diatonic 3rd above the last player note, empty beats only. Starts shy. |
| `4` | **Call-response** | You take a bar, it answers the next bar, then leaves space. |

### 1.2 Density (two modes)

Orthogonal to role. Toggle with `D`. Persist in `localStorage`.

| Mode | Behavior |
|------|----------|
| **Busy** | Fill every slot the current role is allowed to use. |
| **Shy** (default) | Sit out often. Never two companion notes in a row without a player onset between them. Harmony and call-response always start shy. |

### 1.3 Setup this spec is written for

- Acoustic guitar → laptop built-in mic.
- Companion + click → laptop speakers (Bluetooth headphones optional).
- Hands on the guitar after tempo is set. Spacebar is a **setup gesture**, not a live tap-along.
- Standard tuning assumed. Capo is fine (pitch is pitch).
- Monophonic on purpose: one note at a time. Strums are out of scope.

---

## 2. Non-goals (do not build)

- Fretboard diagrams, tab, songs, lessons, accounts, cloud.
- Generative music (Magenta, Lyria, RNNs that emit audio).
- Polyphonic chord detection / walking bass / drummer.
- Beat tracking from the guitar. The clock is the spacebar.
- Native/Electron wrapper.
- Mobile-first layout.
- Labeling YIN as CREPE.

CREPE is the ear. Music theory is the brain. The Web Audio clock is the body. Do not invert that.

---

## 3. Stack

- **Vite + TypeScript + vanilla DOM.** No React, no p5, no ml5 runtime.
- **`@tensorflow/tfjs`** for CREPE. WebGL backend.
- **AudioWorklet** for capture. No `ScriptProcessorNode`.
- No server. No accounts. `localStorage` for role, density, mutes, output mode, CREPE capacity.
- Target: **Chrome on Windows**.
- Unit tests: **Vitest**, pure functions only (grid, scales, voices, masking, tap tempo). No required browser E2E in v1.

---

## 4. Architecture

```
Spacebar taps
    → tap-tempo (BPM, t0)
    → grid (bar of 4 beats, slot = one beat)
    → click scheduler (muteable)

Laptop mic
    → getUserMedia (AEC on for speakers)
    → AudioWorklet ring buffer
    → resample to 16 kHz, 1024-sample frames
    → CREPE (tfjs) → {t, hz, confidence}
    → onset segmentation (attack, not sustain)
    → self-play mask
    → note-on events {t, midi, hz, pitchClass}

Note-ons
    → decaying pitch-class histogram
    → scale guess + confidence + optional Lock

Each upcoming empty slot
    → role policy + density → midi or sit out
    → schedule synth at gridTime − outputLatency
    → mark slot companion + arm self-play mask
```

Four layers, four modules. Do not collapse them.

| Layer | Job | ML? |
|-------|-----|-----|
| Clock | BPM + downbeat + slots | No |
| Ear | Pitch + onset | **CREPE required** |
| Theory | Scale / lock | No (histogram) |
| Voice | Which midi on which empty slot | No (rules) |

---

## 5. Clock (spacebar)

### 5.1 Tap tempo

- Listen to `keydown` Space globally. `preventDefault` so the page does not scroll.
- Record `performance.now()` (and keep an `AudioContext.currentTime` mapping once audio is running).
- Need **≥ 4** inter-onset intervals.
- BPM = `60 / mean(IOI)` after dropping IOIs outside `[0.5, 1.5] × median`.
- Clamp BPM to **40–240**.
- **t0** = time of the last tap. Beats at `t0 + n * period`, `period = 60 / bpm`.
- Further taps while running **nudge** tempo with exponential smoothing (`α ≈ 0.3`) and reset `t0` to that tap. They do not restart scale inference.
- **Shift+Space** hard-resets the clock (and clears occupancy, not the scale lock).

Time signature: **4/4**. Beat 0 of each bar is a downbeat.

### 5.2 Grid

- Default slot = **one tapped beat** (quarter note). The north-star “off beat” is the other quarters (2 and 4), not the eighth-note “and.”
- Each slot has: index, `startTime`, `endTime`, occupancy `empty | player | companion`.
- Grace: a player onset counts for the slot if it lands in `[start − 0.35·period, end − 0.15·period]`. Slightly early is OK; very late spills to the next slot.
- Keep at least 2 bars of past slots and 2 bars of future slots.

### 5.3 Click

- Short dry click (high sine or filtered noise, ~8 ms), ~−18 dB, on every beat.
- Mute with `C`. Default: **on**.
- After the 4th tap, the click is the count-in. Companion voice stays silent until scale ready (see §8).

---

## 6. Ear — CREPE is mandatory

Paper: Kim, Salamon, Li, Bello, “CREPE: A Convolutional Representation for Pitch Estimation,” ICASSP 2018.
Weights: [marl/crepe](https://github.com/marl/crepe). Browser reference: [marl.github.io/crepe](https://marl.github.io/crepe/) and `crepe.js` on the `gh-pages` branch.

### 6.1 What “CREPE must ship” means

- The running app loads a **real CREPE tfjs Layers model** from **local files** under `public/models/`.
- No CDN at inference time. Offline after `npm install` + first load from disk.
- Default capacity: **tiny**. UI switch to **small** if vendored; tiny alone is acceptable if small conversion fails, but tiny **must** run.
- UI states: `CREPE loading` → `CREPE ready (tiny)` → pitch Hz updates while a string rings.
- **Violation:** YIN/autocorrelation as the default path, or a fake `crepe.ts` that returns math on an FFT peak. YIN is allowed only as a labeled fallback when the model file fails to load. The UI must then say `FALLBACK: YIN`, never `CREPE ready`.

### 6.2 Model I/O (pin this)

Official browser demo contract:

- Input: **1024** samples at **16 kHz**, float32.
- Normalize: zero-mean, then divide by RMS (`||x−mean|| / sqrt(1024)`). Guard RMS ≈ 0.
- Shape: `[1, 1024]`.
- Output: **360** sigmoid bins (20 cents each), C1–B7.
- Cent mapping (do not invent another):

```
cents[i] = 1997.3794084376191 + i * (7180 / 359)   // i = 0..359
         = linspace(0, 7180, 360) + 1997.3794084376191
hz = 10 * 2^(cent / 1200)
```

- Confidence = `max(activation)`.
- Pitch = **local weighted average** of cents in `[argmax−4, argmax+5)`, not raw argmax.
- Voiced if `confidence ≥ voicedThreshold` (default **0.5**, slider 0.3–0.8).
- Range we care about: guitar **E2–E6** (82 Hz–1319 Hz). CREPE covers it.

Use `tf.loadLayersModel` (not deprecated `tf.loadModel`). `tf.tidy` every frame. WebGL backend.

### 6.3 Capture graph

```
getUserMedia({
  audio: {
    echoCancellation: true,   // speakers mode (see §7)
    noiseSuppression: false,  // do not smear the guitar
    autoGainControl: false,   // do not pump transients
    channelCount: 1
  }
})
→ MediaStreamSource
→ AudioWorklet (ring buffer, downsample to 16 kHz)
→ post frames to main thread (or a dedicated worker)
→ CREPE infer
```

Worklet buffer: next power of two ≥ `(sampleRate / 16000) * 1024` so one device buffer covers a 1024-sample 16 kHz frame. **Hop ≤ 20 ms** of 16 kHz audio (≤ 320 samples at 16 kHz) so we have enough time resolution for quarter-note occupancy at 120 BPM. The official demo’s ~10 Hz ScriptProcessor hop is too coarse; overlap frames.

Resampling: if `sampleRate % 16000 === 0`, stride; else linear interpolation. Same as the official demo.

Do **not** run tfjs inside the AudioWorklet. Do **not** block the audio thread.

A silent GainNode (gain 0) may be required to keep the input graph alive — the official demo needed this. Do not route mic to speakers at audible gain.

### 6.4 Vendoring weights

Commit the weight files. They are the product.

1. Vendor the official browser model from `https://marl.github.io/crepe/model/` (this is the tiny model used in the live demo) into `public/models/crepe-tiny/` (`model.json` + `*.bin` shards).
2. Optionally convert `model-small.h5` from the [crepe `models` branch](https://github.com/marl/crepe/tree/models) with `tensorflowjs_converter` into `public/models/crepe-small/`.
3. Script: `scripts/vendor-crepe.mjs` (or `.py`) that downloads/converts. Document it in README.
4. License: CREPE is MIT; preserve a `public/models/NOTICE`.

### 6.5 Onsets, not sustain

Acoustic guitar **rings**. Pitched energy on beat 2 after a beat-1 pluck is still *your* note. If occupancy = “CREPE is voiced,” the holes never exist.

**Occupancy is note-on (attack), not voicing.**

Segmentation:

1. **Attack:** rise in high-frequency / spectral flux in the worklet, **or** CREPE confidence crossing `voicedThreshold` upward, **or** a pitch jump > 90 cents while voiced.
2. Debounce 40 ms. Then take the **median voiced Hz over the next 60 ms** as the note’s pitch (lets the pick noise die).
3. Ignore frames with `|cents-from-equal-temperament| > 40` for the histogram (bends, bad frames). Still allow the onset to claim the slot.
4. Note-off: confidence below threshold for 80 ms, or a new attack.
5. Emit one `{ t, hz, midi, pitchClass, cents, confidence }` per attack.

MIDI: `69 + 12 * log2(hz / 440)`. Pitch class = `mod(round(midi), 12)`.

---

## 7. The room (speakers + acoustic mic)

This is the hard problem. Design it; do not hope.

### 7.1 Echo cancellation

- Output mode UI: **Speakers** (default) | **Headphones**.
- Speakers: `echoCancellation: true`. Same-device speaker + built-in mic is the case WebRTC AEC is built for.
- Headphones: `echoCancellation: false` (cleaner guitar). Bluetooth is the escape hatch; it adds output latency — see §10.

### 7.2 Self-play mask (mandatory even if AEC is good)

When a companion note of pitch `P` is scheduled for slot `S` at time `T` with duration `D`:

- Mark `S` as `companion` so the voice will not fill it again.
- From `T` to `T + D + 80 ms`, **drop onsets within 50 cents of P**.
- Player occupancy still wins if a clearly different pitch attacks in that window (you played a real note over the companion).

Without this, the companion hears itself, “you” played the hole, and it goes silent or changes key.

### 7.3 If the room wins

If the scale guess flips when the companion plays while the guitar is idle, AEC+mask failed. UI hint: “Hearing myself — try headphones.” Do not auto-switch.

---

## 8. Scale (classical)

Decaying 12-bin histogram. Half-life **4 seconds** (or 8 beats, whichever you implement; pick one and unit-test it).

Weight:

- On-grid onset: `1.0`
- Off-grid onset: `0.4`
- Skip frames that failed the 40-cent gate.

Templates, intervals from tonic:

| id | intervals |
|----|-----------|
| major | 0,2,4,5,7,9,11 |
| natural minor | 0,2,3,5,7,8,10 |
| major pentatonic | 0,2,4,7,9 |
| minor pentatonic | 0,3,5,7,10 |
| blues | 0,3,5,6,7,10 |
| dorian | 0,2,3,5,7,9,10 |
| mixolydian | 0,2,4,5,7,9,10 |

Score each of 12 tonics × 7 templates:

`score = inScaleMass − 0.6 * outScaleMass + 0.3 * tonicMass + 0.15 * fifthMass`

Winner = argmax. Confidence = `(best − second) / max(best, ε)`, clamped 0–1.

**Guitar bias:** if relative major/minor pentatonic tie within 5%, prefer **minor pentatonic**. Open-string noodling (E A D G B E) must not dominate — recency decay is the main fix; do not special-case unless tests need it.

### 8.1 When the companion may speak

Silent (except click) until **all** of:

- ≥ **6** histogram onsets, and
- confidence ≥ **0.25**, **or** user pressed **Lock** (`L`).

Lock freezes the tonic+template used by voices. Histogram and UI guess may keep moving; a subtitle can show the unlocked guess. `L` again unlocks.

Display: `A minor pentatonic · 74% · locked|unlocked`

---

## 9. Voices

All voices: skip occupied player slots; skip if scale not ready; skip if density says sit; never schedule in the past.

**Last player note** = most recent player onset’s MIDI.

### 9.1 Hole-filler (`1`)

- Eligible: empty beats.
- Pitch class: scale **degree 5** (fifth). If that is the last player pitch class, use **degree 1**. If that is also taken, next scale degree upward.
- Octave: around **C4–A4**, and at least 7 semitones away from last player MIDI when possible.
- Duration: 55% of the beat, gentle attack/release.
- Busy: every eligible slot.
- Shy: eligible only if the **previous** slot was `player`; never two companion notes in a row.

### 9.2 Bass (`2`)

- Same occupancy rule as hole-filler (holes only — do not stack on the player’s attack; the mic cannot take it).
- Pitch class: **tonic** on beats 1 and 3; **fifth** on beats 2 and 4. If that pitch class equals last player (rare in bass register), stay tonic.
- Octave: nearest MIDI in **[36, 52]** (C2–E3), preferably ~12 semitones below player median.
- Timbre: sine/triangle, longer than hole-filler (80% of beat).
- Shy: only beats 2 and 4, and never two in a row.

This is a **pedal bass**, not walking bass.

### 9.3 Harmony (`3`)

- Diatonic 3rd **above** last player note: two steps up the locked scale’s pitch-class list, then the lowest MIDI **strictly above** last player MIDI with that class.
- If last player pitch class is not in the scale, snap to nearest in-scale class first, then take the 3rd.
- Empty slots only. Default density **shy** even if the global toggle was busy when you last used hole-filler? No — honor the global toggle, but **default app state is shy**, so first landing on harmony is shy.
- If the 3rd would be unison with last player (shouldn’t), use diatonic 6th (four scale steps).
- Register cap: do not go above MIDI 79 (G5).

### 9.4 Call-response (`4`)

Different rhythm contract.

- Bar N is a **call** if it contains ≥ 2 player onsets.
- Companion is **silent during the call bar**.
- Bar N+1 is the **response**:
  - Take the call’s pitch classes in order.
  - **Retrograde** them.
  - Snap each to the locked scale.
  - Place them on the beats that were **empty in the call bar** (negative space of the call). If that set is empty, play tonic on beat 1 of the response bar only.
  - Contour fallback if retrograde is degenerate: invert scale degrees around tonic (`d → (N − d) mod N`).
- After a response:
  - **Shy:** sit out the next full bar (N+2) even if the player is still going.
  - **Busy:** listen again immediately (next call can be bar N+2).
- Response duration ≤ call duration. Do not spill into bar N+2.

No melody RNN. Timing being on the downbeat of N+1 is the musicality.

---

## 10. Synth and latency

Web Audio oscillators + simple envelopes. Not samples. Distinguish roles by timbre:

| Role | Oscillator | Filter |
|------|------------|--------|
| Hole-filler | triangle | lowpass ~2 kHz |
| Bass | sine | lowpass ~600 Hz |
| Harmony | triangle | lowpass ~3 kHz |
| Call-response | square at 8% mix + triangle | lowpass ~1.8 kHz |
| Click | short sine 1 kHz or noise | — |

Master companion gain. `M` mutes companion (click unaffected). `C` mutes click.

**Schedule in the audio clock, not `setTimeout`.**

```
outputDelay = audioContext.outputLatency || audioContext.baseLatency || 0
fireAt = slotStartTime − outputDelay
```

If `fireAt` is in the past by < 15 ms, play immediately; if later, skip the slot.

Bluetooth headphones inflate `outputLatency`. Query it; do not hardcode 0.

Panic: **Escape** — `gain.value = 0` on companion + click, stop oscillators, do not destroy the graph. Second thought: keep the clock running so the player is not stranded; just silence output. Document that.

---

## 11. UI

Desktop, dark, large type, readable across a room with a guitar in your hands. Not a DAW. Not a startup landing page.

Must show:

- Mic state, CREPE state (`loading` / `ready (tiny|small)` / `FALLBACK: YIN` / error).
- BPM + a pulse that flashes on the beat.
- **Four beat cells** for the current bar: empty / player (warm) / companion (cool).
- Last heard note (`A3 +8¢`) and confidence.
- Scale line + confidence bar + Lock button.
- Role (4) and density (2).
- Companion mute, click mute, speakers/headphones.
- Voiced-threshold slider (advanced, collapsed is fine).
- One-line hint that changes: “Tap Space 4 times” → “Play” → “Lock the scale if I’m wrong”.
- Keyboard legend, small, bottom.

No fretboard. No lesson list. No “AI” branding.

---

## 12. Keyboard

| Key | Action |
|-----|--------|
| Space | Tap tempo |
| Shift+Space | Reset clock |
| 1 / 2 / 3 / 4 | Hole / Bass / Harmony / Call-response |
| D | Shy ↔ Busy |
| L | Lock / unlock scale |
| M | Mute companion |
| C | Mute click |
| H | Headphones ↔ Speakers (re-getUserMedia with new AEC flags) |
| Escape | Panic silence |

---

## 13. Persistence (`localStorage` key `guitar.practice.v1`)

Save: role, density, companionMuted, clickMuted, outputMode, crepeCapacity, voicedThreshold.

Do not save BPM or scale lock (those are session).

---

## 14. Module map

Suggested. Names can move; responsibilities cannot.

```
index.html
src/main.ts                 # wire UI ↔ engines
src/styles.css
src/audio/context.ts        # AudioContext, mic constraints, outputLatency
src/audio/worklet-grabber.ts + src/audio/grabber.worklet.ts
src/audio/crepe.ts          # load + infer + postprocess (official math)
src/audio/yin.ts            # fallback only
src/audio/onset.ts          # attacks from flux + CREPE
src/audio/tap-tempo.ts
src/audio/grid.ts
src/audio/scheduler.ts      # click + notes, latency compensate
src/audio/synth.ts
src/audio/self-mask.ts
src/music/notes.ts          # hz, midi, names, cents
src/music/scales.ts         # histogram, templates, lock
src/music/voice/types.ts
src/music/voice/hole-filler.ts
src/music/voice/bass.ts
src/music/voice/harmony.ts
src/music/voice/call-response.ts
src/music/voice/density.ts
src/ui/render.ts
public/models/crepe-tiny/   # committed
public/models/NOTICE
scripts/vendor-crepe.mjs
tests/                      # vitest
```

---

## 15. Tests (must exist)

Pure functions. No AudioContext required.

- Tap tempo: 4 taps 500 ms apart → ~120 BPM; one outlier ignored.
- Grid: onset 30% early still claims the slot; 60% late claims the next.
- Occupancy is onset-based: a long “voiced” window after one onset claims **one** slot.
- Scale: notes A3 C4 D4 E4 G4 A4 (weighted) → A minor pentatonic or C major pentatonic; with extra A and E mass → **A minor pentatonic**.
- Blues notes (A C D D# E G) prefer blues or minor pent, not major.
- Hole-filler: empty slots only; never last-player pitch class; shy never two in a row.
- Bass MIDI in [36, 52]; tonic/fifth policy.
- Harmony: E4 in C major → G4 (diatonic 3rd).
- Call-response: silent in call bar; retrograde-on-holes in next bar; shy sits out the bar after.
- Self-mask: onset at companion pitch during the mask window is dropped; a different pitch is kept.
- CREPE postprocess: a one-hot-ish activation peaked at a known bin reconstructs a Hz within 1% of `10 * 2^(cents/1200)` for that bin. This test locks the mapping even without the network.

---

## 16. Failure modes (handle, don’t ignore)

| Symptom | Likely cause | What to do |
|---------|--------------|------------|
| Companion silent forever | Scale never confident | Show onset count + hint to Lock |
| Companion plays on top of you | Occupancy used sustain, or grace window too tight | Onsets only; widen grace |
| Scale flips when companion plays | Heard the speakers | Mask + AEC; hint headphones |
| Late notes | Scheduled with `setTimeout` or ignored `outputLatency` | Audio clock − latency |
| Low E missing | Frame shorter than ~64 ms at 16 kHz | 1024 samples @ 16 kHz is the minimum |
| Octave errors | Unnormalized frames, or YIN fallback | Zero-mean / RMS; CREPE |
| Page scroll on Space | Forgot preventDefault | Prevent it |
| AudioContext suspended | No user gesture | Mic button resumes context |
| Model 404 | Weights not committed / wrong Vite public path | `public/models/...` |

---

## 17. Acceptance

A human with an acoustic guitar and a Windows laptop, Chrome, this repo `npm run dev`, speakers on:

1. Sees `CREPE ready`.
2. Taps Space ~4 times.
3. Hears a click on that pulse.
4. Plays 1 and 3 in a key.
5. Sees the scale guess.
6. Hears a plausible tone on 2 and 4 from the speakers, in that key, not on 1 and 3.
7. Can switch to bass / harmony / call-response and shy / busy without reloading.
8. Can Lock the scale. Can panic with Escape.

That is v1. Everything else is extra.
