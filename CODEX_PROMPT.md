# Codex Implementation Prompt — Guitar Practice Partner

> Current user revision (September 6, 2026): remove unreliable Auto BPM and four-beat listening. Enter BPM manually, listen continuously for three matching whole cycles including rests, and replay the phrase half a beat later exactly three times. Keep listening with one waiting phrase and no overlapping app voices. The first accepted pluck anchors phase but never estimates or changes BPM. Follow the current contract at the top of `SPEC.md`. Auto tempo, held chords, ordinary echoes, manual memory, and four-role product phases are historical. Retain the technical constraints: real CREPE, attack segmentation, self-mask, vanilla Vite/TypeScript, local model assets, Web Audio timing, no backend or generative music.

The product spec is `SPEC.md`. Read it before writing any code. If this prompt and `SPEC.md` conflict, **`SPEC.md` wins**, except for the hard constraints below (those always win). The original greenfield instructions and product phases below are retained as history; current revision phases appear first.

This is a greenfield folder. Build the whole v1. Do not ask to shrink scope. Do not replace CREPE with a tuner FFT.

**Implement Phase 1, then tests, then Phase 2, then tests, and so on.** Do not skip to a pretty UI with a fake pitch detector.

---

## Hard constraints

1. **CREPE must actually run.** Load a real tfjs Layers CREPE model from `public/models/crepe-tiny/`. Inference uses the official I/O in `SPEC.md` §6.2 (1024 samples @ 16 kHz, zero-mean/RMS, 360 bins, cent mapping, local weighted average, `hz = 10 * 2^(cent/1200)`).  
   **Shipping YIN (or FFT-peak, or autocorrelation) as the default, even if you name the file `crepe.ts`, is a spec violation.** YIN is fallback only, and the UI must say `FALLBACK: YIN`.

2. **Occupancy is onsets, not ringing energy.** Acoustic guitar sustains. If “CREPE voiced” marks a slot occupied, holes never exist and the north-star demo fails.

3. **Self-play masking is mandatory.** Speakers + acoustic mic will hear the companion. `SPEC.md` §7.

4. **Manual clock, stable during replies.** Per the user's latest revision, remove guitar BPM estimation. Entered BPM or Space tapping sets tempo; `preventDefault` on Space. The first accepted pluck may anchor phase at that fixed tempo. Guitar input must not estimate or continuously retime the clock. Preserve the captured phrase's timing and use the entered BPM for the half-beat reply offset.

5. **No generative ML.** No Magenta, Lyria, melody RNN, cloud APIs. CREPE is the only model.

6. **Vite + TypeScript + vanilla DOM.** No React, Vue, Svelte, p5, ml5.

7. **No backend.** No accounts. No fretboard, tab, lessons, or song library.

8. **Schedule audio with `AudioContext.currentTime` minus `outputLatency`.** No `setTimeout` for musical timing.

9. **Windows / Chrome.** Use forward slashes. Do not assume `/dev/mic`.

10. **Commit model assets** under `public/models/`. Vite serves `public/` at `/`. A 404 on `model.json` is a failed build.

11. **Do not git commit** unless asked. You may `git init` if missing. Leave a working tree the human can run.

12. **Tests are part of done.** `npm test` (Vitest) covers `SPEC.md` §15.

---

## Start here

```
C:\Users\rober\Downloads\Projects\guitar\
```

Already in the folder: `SPEC.md`, this prompt, `AGENTS.md`, `README.md`. Do not delete them. Implement around them.

---

## Stack to add

```
package.json          # "guitar", type module
vite.config.ts
tsconfig.json
index.html            # entry, no CDN scripts except nothing — bundle tfjs
src/main.ts
src/styles.css
src/vite-env.d.ts
src/audio/grabber.worklet.ts
public/models/crepe-tiny/model.json + shards
public/models/NOTICE
scripts/vendor-crepe.mjs
.gitignore            # node_modules, dist, .tfjs cache
```

Dependencies (pin current stable, do not invent names):

- `vite`, `typescript`, `vitest` (dev)
- `@tensorflow/tfjs`

Dev scripts: `"dev": "vite"`, `"build": "tsc --noEmit && vite build"`, `"test": "vitest run"`, `"preview": "vite preview"`.

Worklet: load via `new URL('./audio/grabber.worklet.ts', import.meta.url)` (Vite worker/worklet pattern). If Vite needs `?worker` / `?url`, use the documented Vite AudioWorklet recipe — do not leave a broken relative path.

---

## CREPE vendoring (do this in Phase 2, before wiring audio)

1. Download the official browser model:

   - `https://marl.github.io/crepe/model/model.json`
   - every weight shard `model.json` references

   into `public/models/crepe-tiny/`.

2. Write `scripts/vendor-crepe.mjs` that performs that download so it is repeatable. Run it.

3. `public/models/NOTICE` — CREPE (MIT, Kim et al. ICASSP 2018), TensorFlow.js (Apache 2.0).

4. Optional: convert `model-small.h5` from `https://github.com/marl/crepe/tree/models`. If conversion is painful, skip small. Tiny is required.

5. Confirm in devtools Network that inference does **not** hit a CDN.

If the official URL layout has changed, hunt the same tiny tfjs model (ml5 `pitch-detection/crepe` is an acceptable tiny source) but **do not take a runtime dependency on ml5**.

---

## Current revision phases

The latest user-approved addition is the four-bar audio Looper. Follow its phase gates at the top of SPEC.md. The existing Partner retains CREPE and its Echo/Harmony behavior. Looper records native-rate audio directly; no alternative pitch detector is introduced. The manual clock, local-only architecture, committed real CREPE assets, and audio scheduling constraints remain in force.

The preceding Partner addition was Echo / Harmony. Retain its regression coverage while following the newest Looper phases in SPEC.md. Harmony changes pitch choice and reply dynamics only; all technical hard constraints above remain in force.

Stop and run tests at each phase boundary before starting the next.

1. Ear reliability: one note per pluck, stable pitch evidence, actual quiet for note ends. Confidence dropouts and ringing must not invent attacks or rests. Run ear and regression tests.
2. Continuous loop recognition: three complete cycles, tolerant alignment, internal/closing rests, finite half-beat replies, one waiting idea, no overlap or indefinite retrigger. Run recognition, playback, and regression tests.
3. Minimal manual UI: BPM, one pulse dot, listening/reply state, Stop. Remove Auto and four-beat displays; keep optional settings and an explicit local listening check. Run all tests and production build.
4. Verify real CREPE in Chrome using recorded guitar plucks and known note/rest timings, then review and publish under the user's existing GitHub/Vercel authorization. Report physical-room limits honestly.

## Historical Phase 1 — Scaffold, tap tempo, grid, click, UI shell

No mic yet.

- Vite + TS + CSS. Dark, large type, four beat cells, BPM readout, hint “Tap Space 4 times”.
- `tap-tempo.ts` + `grid.ts` as specified.
- Unlock `AudioContext` on a visible **Enable audio** button (user gesture).
- Click on the grid (`synth.ts` click voice only). Mute with `C`.
- Keyboard: Space, Shift+Space, Escape (panic silence), C.
- Pulse the current beat cell.
- Unit tests: tap tempo + grid grace.

**Exit:** tap Space 4 times, see ~correct BPM, hear click, cells light in time. No guitar yet.

---

## Phase 2 — Mic + CREPE + onsets + last-note UI

This phase is failed if CREPE is not in the loop.

- `getUserMedia` with `SPEC.md` §6.3 constraints. Speakers mode default (`echoCancellation: true`).
- AudioWorklet grabber → resample → 1024-sample 16 kHz frames, hop ≤ 20 ms.
- `crepe.ts`: `tf.loadLayersModel('/models/crepe-tiny/model.json')`, WebGL, `tf.tidy`, official postprocess.
- UI: `CREPE loading` → `CREPE ready (tiny)`. On model failure: `FALLBACK: YIN` and only then use `yin.ts`.
- `onset.ts`: attacks, not sustain. Last-note readout `A3 +8¢` plus CREPE confidence.
- Unit test: CREPE postprocess mapping (`SPEC.md` §15 last bullet) with a fake activation vector — no need to load weights in Vitest.
- Manual: pluck a string, Hz and note name update while it rings; **one** new note per pluck, not a flood.

**Exit:** `CREPE ready`, pluck A string, UI shows A2/A3 (octave errors: fix normalization before “tuning” the mapping).

---

## Phase 3 — Scale histogram + lock

- `scales.ts` exactly as `SPEC.md` §8 (templates, score, guitar pentatonic bias, lock).
- Scale line + confidence bar + `L`.
- Companion still silent.
- Tests: A-minor-pent set; blues set; lock freeze.

**Exit:** noodle in a key, guess appears; `L` freezes it.

---

## Phase 4 — Hole-filler + self-mask + latency (the product)

- Voice `hole-filler` + density shy/busy (`D`, default shy).
- Companion may speak only when `SPEC.md` §8.1 is satisfied.
- Scheduler: `slotStart − outputLatency`.
- Self-play mask `SPEC.md` §7.2.
- Timbre: triangle, out of the guitar’s way.
- `M` mutes companion.
- Tests: empty slots only; never last-player PC; shy no two-in-a-row; mask drops matching pitch.

**Exit — north-star demo:** tap pulse, play 1 and 3, hear a scale tone on 2 and 4 from the speakers, not on 1 and 3, without the scale flipping from speaker bleed.

If speaker bleed flips the scale, tighten the mask before adding more roles.

---

## Phase 5 — Bass, harmony, call-response

- `1/2/3/4` switch roles without resetting clock or lock.
- Implement `SPEC.md` §9.2–9.4 literally (pedal bass, diatonic 3rd, retrograde-on-holes + shy sit-out bar).
- Distinct timbres per role.
- Tests listed in §15 for these three voices.

**Exit:** all four roles work on the same grid; shy/busy both do something audible.

---

## Phase 6 — Polish

- Headphones/speakers toggle (`H`) re-requests the mic with new AEC flags without killing the clock if possible.
- `localStorage` key `guitar.practice.v1`.
- Voiced-threshold control.
- Hint copy as state changes.
- README: how to run, Chrome + mic permission, “tap space then play 1 and 3”, CREPE attribution, headphones escape hatch.
- `.gitignore`.
- `npm test` green, `npm run build` green.
- Keyboard legend on the page.

---

## UI copy (use this, don’t brand it)

- Title: **Practice Partner**
- Hint empty: `Tap Space 4 times to set the pulse`
- Hint running, no notes: `Play. I’ll wait until the scale is clear.`
- Hint guessing: `Looks like {scale}. Press L to lock.`
- Hint ready: `Filling holes · {role} · {density}`
- Hearing itself: `Hearing myself — try headphones (H)`

---

## Definition of done

- [ ] `npm run dev` on Windows, Chrome, acoustic guitar, laptop speakers.
- [ ] UI shows `CREPE ready (tiny)` and Network tab loaded `/models/crepe-tiny/model.json` locally.
- [ ] North-star demo in `SPEC.md` §1 and §17 works.
- [ ] Four roles, two densities, lock, mutes, panic, speakers/headphones.
- [ ] `npm test` covers §15.
- [ ] `npm run build` succeeds.
- [ ] No React, no server, no generative model, no fretboard.
- [ ] Model files exist on disk under `public/models/crepe-tiny/`.

When finished, write a short `IMPLEMENTATION_NOTES.md`: what you vendored (URLs), CREPE capacity shipped, any deviation from `SPEC.md` and why, and how you verified the north-star demo (even if you could not pluck a real guitar — then say so, and list the exact human steps).
