# V1 implementation notes

## Assets and runtime

Vendored the unmodified official tiny browser tfjs Layers model from `https://marl.github.io/crepe/model/model.json`, plus every referenced `group1-shard1of1` through `group13-shard1of1` URL relative to that directory. Weights total 1,948,384 bytes. `scripts/vendor-crepe.mjs` reproduces the download and SHA-256 manifest. Upstream MIT license: `https://raw.githubusercontent.com/marl/crepe/master/LICENSE`; TensorFlow.js Apache license: `https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE`. Tiny only; optional small was not converted. Model files are present and unignored, ready for the user's commit; no Git commit was made.

CREPE runs with bundled TensorFlow.js on WebGL, [1,1024] input and 360-bin output, official zero-mean/RMS normalization and local weighted cent mapping. Chrome smoke testing supplied synthetic harmonic A2 plucks through getUserMedia and the actual production AudioWorklet. The model returned approximately 110 Hz with over 90% confidence. All 14 model requests (manifest plus shards) used the local Vite origin. No runtime CDN.

## Spec resolutions and practical limits

- **Four taps:** §5.1 asks for four intervals (five taps), while §15, the UI copy, and the demo request four taps. Start after four taps/three intervals, then use up to eight intervals and the specified median rejection and 0.3 smoothing.
- **Grace overlap:** the written interval in §5.2 would keep a 60%-late attack in the current slot, contrary to §15. Nearest-beat assignment satisfies the required 30%-early and 60%-late examples. This also allows attacks as much as half a beat early to associate with the upcoming beat.
- **Scale ties:** the exact score and confidence formulas give pentatonic scales identical scores to same-tonic supersets. Ties prefer the smaller template; the specified relative minor-pentatonic bias also applies. Confidence remains mathematically honest, often 0%. Six accepted onsets plus Lock enables playing even then. No fabricated confidence or altered score.
- **Scheduling causality:** companion events target `slotStart - (outputLatency || baseLatency || 0)`, with 8 ms lookahead and the specified 15 ms late tolerance. Raw attacks temporarily veto a decision during the 60 ms pitch-settling period. They never enter the histogram or permanently mark occupancy. Repeated player beats in both preceding bars are conservatively protected, including Busy. This can leave a newly abandoned beat empty for one bar. An unpredictable attack arriving after audio has already been sent to the output device cannot retroactively cancel that sound; Bluetooth increases this uncertainty. Shy and a steady 1/3 pattern reduce that risk.
- **Density:** global Shy always requires a new accepted player onset between companion notes. Consequently a Shy call-response phrase may contain just one note when the guitarist stays silent; Busy plays the full negative-space response. Shy also sits out the following bar. This prioritizes §1.2's global rule. Harmony honors the global density when switched live.
- **Panic:** Escape stops active oscillators and sets both outputs to zero, retaining the running clock and scale. M and C restore each output independently.
- Histogram half-life is four seconds. Out-of-tune attacks still claim a slot but do not enter the histogram. The companion pitch mask lasts for note duration plus 80 ms and leaves clearly different player pitches eligible.

## Verification

Stopped for tests at each phase boundary: Phase 1, 7 passed; Phase 2, 14; Phase 3, 19; Phase 4, 25; Phase 5, 33. Each phase also passed the production build before proceeding. Phase 6: 34 unit tests passed and `npm run build` passed. The bundled TensorFlow.js produces a roughly 902 kB JavaScript bundle (233 kB gzip), so Vite emits its informational chunk-size warning.

Production Chrome smoke passed: real tiny inference, A2 recognition, 117 BPM from the test's approximate 500 ms key presses, a single AudioContext across output-mode changes, real companion and bass oscillators, no oscillator scheduled in the past, all role controls, scale lock, AEC on/off constraints, panic retaining BPM, and persistence across reload with BPM reset. No browser exceptions or nonlocal runtime HTTP requests. A screenshot was inspected at `smoke-artifacts/production.png` (ignored from Git). Synthetic onsets occupied beats 1/3 and a companion occupied beat 2 in that capture.

A separate Chrome run intercepted only the model manifest with a deliberate 404: the app displayed `FALLBACK: YIN`, correctly recognized A2, and passed the same controls/scheduling checks. Normal startup loads CREPE. The production build verifies every model/shard SHA-256 digest and fails if an asset is absent or corrupted; Git attributes protect model bytes on Windows.

No physical guitar was plucked and no laptop-speaker acoustic feedback loop was measured here. The automated browser check uses synthesized microphone input and does not prove real-room AEC quality or perceptual timing.

Human acceptance:

1. Run `npm install`, `npm run dev`; open the localhost URL in Chrome on Windows with laptop speakers selected. Click Enable audio and allow the built-in mic.
2. Confirm `CREPE ready (tiny)` and local `/models/crepe-tiny/model.json` plus 13 local shards in Network. Pluck open A: expect A2 near 110 Hz, with one accepted onset per pluck even while it rings.
3. Tap Space four steady times at 80–120 BPM. Hear the click and watch the four beat cells.
4. Play A, C, D, E, G, A as single notes on beats 1 and 3 for a few bars. Confirm warm cells on 1/3, and a plausible minor-pentatonic guess. After six accepted notes, press L to lock.
5. In Hole-filler/Shy, hear cool companion notes on 2/4 and none on guitar attacks. Stop playing and confirm Shy stops after its one allowed answer. Confirm the histogram onset count does not climb from companion bleed and the unlocked guess does not chase the speakers.
6. Try 2 (low tonic/fifth), 3 (scale third), and 4 (call bar then reversed answer on the call's holes). Toggle D; Busy should be denser, while Shy leaves its required space. Clock and lock must remain unchanged.
7. M and C mute independently. Escape immediately silences both while cells continue pulsing. Shift+Space clears the clock while retaining lock. H reopens the microphone with AEC off/on without resetting tempo. Physically select headphones in Windows for the escape hatch.
8. Reload: role, density, mutes, output mode and threshold persist; BPM and lock reset.
