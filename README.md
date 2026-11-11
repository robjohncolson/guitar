# Guitar Trainer

A small, guided course for acoustic guitar. Start slowly, learn a musical idea, then carry it with less help. Partner, the four-bar Looper and **Pieces** (learn a specific piece on piano or guitar) are in the top navigation.

**Live:** [robjohncolson.github.io/guitar](https://robjohncolson.github.io/guitar/) (GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`) · [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) (Vercel) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar)

The build uses relative asset URLs (`base: './'` in `vite.config.ts`), so the same `dist/` works at a domain root and under a subpath. Everything a user saves lives in that browser's `localStorage`. On the Vercel deployment, an **optional account** (below) syncs it across devices; the GitHub Pages mirror is built with `VITE_ACCOUNTS=off` and stays localStorage-only. Keys: `guitar.trainer.v1` (Trainer progress, `src/trainer/progress.ts`), `guitar.practice.v1` (Partner and Looper settings, `src/ui/settings.ts`), `piece.trainer.v1` (Pieces progress, `src/piece/progress.ts`) and `piece.imported.v1` (pieces a user added, `src/piece/main.ts`).

## Optional accounts (Vercel only)

**Sign in** (top right) is optional. Signed-out visitors keep using `localStorage` exactly as before and make no network requests for it. With an account (username + password, no email), `guitar.trainer.v1`, `guitar.practice.v1` and `piece.trainer.v1` sync across devices. Pieces a user adds (`piece.imported.v1`) are uploaded only when they press **Save to my account** for that piece, and are readable only with that account's session.

- **Sync.** `localStorage` stays the working copy (offline-safe). Each save marks the key changed (`src/account/changes.ts`, bookkeeping in `guitar.sync.v1`); changes are pushed 2 s later, on hide and on page exit, with a per-key version so concurrent writes are detected. Signed-in pages pull before the app starts (`src/entries/*` → `src/account/boot.ts`), and check again when the tab regains focus (a banner offers a reload if another device saved newer progress). Per key, the newer modification wins. On the first sign-in on a device where both the browser and the account hold different progress, a dialog asks: keep this device's, use the account's, or merge (newest of each part).
- **Server.** One Vercel Node function, `api/router.ts` (`vercel.json` rewrites `/api/*` to it), with the logic in `server/`. Passwords are hashed with scrypt (N=32768, r=8, p=1, per-user salt; unknown usernames still pay one hash). Sessions are 256-bit random tokens in an `HttpOnly; Secure; SameSite=Lax` `__Host-guitar_session` cookie for 30 days; only their SHA-256 is stored, at most 20 per user. Mutating requests must be same-origin JSON. Sign-in failures are rate limited per username (10) and per IP (30) per 15 minutes, sign-ups to 5 per IP per hour, in the database. Errors are generic (`Username or password is incorrect.`). Limits: 512 KB per progress key, 2 MB per piece, 30 pieces per account, `GUITAR_MAX_USERS` accounts (default 1000).
- **Database.** Private schema `guitar` in Supabase project `curriculum_renderer` (`db/000_guitar_app_role.md`, `db/001_guitar_schema.sql`), reached through the pooler as the restricted `guitar_app` role (no BYPASSRLS, no other schemas). Not exposed through the Data API. Row-level security makes progress and pieces visible only to the user id the server sets for each transaction, so even a query missing its user filter cannot cross accounts. **Delete my account and data** removes the user and cascades to their sessions, progress and pieces.
- **Environment (Vercel, Preview + Production):** `GUITAR_DATABASE_URL` (pooler URL for `guitar_app`), `GUITAR_DATABASE_CA_PEM` (Supabase CA certificate), optional `GUITAR_MAX_USERS`, optional `GUITAR_SIGNUP=closed` to pause new accounts. Without them the site works and `/api` answers 503 ("accounts unavailable").
- **Errors.** Uncaught page errors go to the console and, on Vercel, to `/api/client-error`, which writes one line to the function log (no IP, cookie or user id). No third-party trackers.
- **Tests.** `npm test` covers hashing, sessions and expiry, rate limits, validation, conflicts and cross-user isolation (`tests/server/`, `tests/account-sync.test.ts`). With a Postgres that has the schema applied, `GUITAR_TEST_DATABASE_URL=postgresql://guitar_app@127.0.0.1:55433/postgres npx vitest run tests/server/postgres.test.ts` also checks RLS directly. `GUITAR_DATABASE_URL=... node scripts/accounts-server.mjs` serves `dist/` plus the API locally; `node scripts/accounts-smoke.mjs` (or with `SMOKE_ORIGIN=<deployment>`) runs the two-browser end-to-end flow with a throwaway account it deletes.

## Pieces: learn a specific piece on piano or guitar

Open **Pieces** (`/piece.html`). The first piece is Satie's *Gymnopédie No. 1* (public domain). The page builds a course for the piece: every chord (as written, then one note at a time), every change between neighbouring chords, each passage per hand and hands together, the joins between passages including across the repeat, each section, the whole piece, and scale, arpeggio and cadence drills in its key with standard fingering. Every step climbs a tempo ladder (50 to 100% of the goal tempo) between takes, fades the help at 80% and 100%, and returns for spaced review once learned on two days. **Today's practice** suggests a short session.

Piano listening works with an acoustic piano and the laptop microphone. Each attack is timed; each note is checked from its own partials: heard, not heard, wrong (with the pitch that sounded instead), unclear, or can't check (octave doublings). Unclear evidence never counts against you. Measured on held-out real piano recordings: a played note was called missing or wrong 1.8% of the time, an unplayed note confirmed 0.7% of the time, and nothing played was never credited as on time. Details and limits are in [PIECES.md](PIECES.md).

**Guitar accompaniment** arranges the same harmony for guitar (one capo position, shapes that never add a note outside the chord, a bass-and-pinch pattern that mirrors the piano's left hand) with its own course: shapes string by string (pitch checked by CREPE), changes, the pattern, then sections and the whole piece with the melody in your headphones.

To add your own piece, give the sheet music (PDF or photos) to your AI assistant with [PIECES.md](PIECES.md): it writes a `.piece.txt` file, transcribes it twice and checks it with `node scripts/piece-check.mjs`. Open the file under **Add your own piece**: it stays in this browser. Copyrighted music belongs in the git-ignored `src/piece/packs/local/`, never in the deployed site.

Run `node scripts/piece-smoke.mjs` against `npm run preview` for the real Chrome check (calibration loopback, recorded piano and guitar notes, a wrong note, silence, the tempo ladder, CREPE guitar shape, mobile layout).

## Guided Trainer

1. Open the Trainer, use headphones, and tune to standard E A D G B E. **Sound & timing** has six reference tones. Allow the microphone when starting practice.
2. For reliable tempo progress, calibrate once: keep the guitar quiet and hold one headphone earcup near the mic for eight clicks. Return the headphones to your ears. Calibration measures the audio path, never your playing habits. A manual offset is also available. Recalibrate after changing devices or input processing.
3. **Hear the phrase**, then **Start practice**. A bar of count-in leads into a six-string timing lane. The number is the fret; 0 means open. Follow the line and keep counting through gaps. New lessons can demonstrate automatically before the count-in.
4. Review one suggestion and the separate timing, note and (where relevant) release scores. Say whether the take felt comfortable. Start the next take when ready. Three clear, comfortable takes at 90% or better remove moving cues; three more reduce the metronome to one click per bar. Three independent takes certify that tempo and suggest +2 BPM. Two difficult takes suggest -4 BPM. Changes apply between takes; you can turn them off or enter your own tempo. Unclear recordings and uncalibrated timing never change your level.
5. Open **Course & your progress** to choose any lesson, find a starting point, revisit a due lesson, or bring back the cues. Each lesson keeps its own pace and best independent tempo. Begin around 50-55 BPM and develop control before speed.
6. **Make it yours** records a creative answer with no correctness score. Listen to your latest or previous take, loop the latest to play along, or save a WAV. Finish the session in **Your practice today** for a short summary. A useful session is a little review, five minutes on one idea, and a creative ending.

The course has 13 lessons across six connected skills: pulse, hand coordination, phrasing and rests, major/minor harmony through arpeggios, offbeats/strumming/fingerpicking, and playing by ear/transferring an idea. Each includes positions, technique guidance, theory and an application. Strumming is explicitly rhythm-only. Audio cannot certify a chord shape, string/finger choice, picking direction, posture or physical comfort.

Real local CREPE identifies individual plucked pitches. After each practice phrase the mic closes and the stored audio is analyzed at the original attack times; slower inference does not move your notes or lose the recording. Timing and pitch are matched independently. Wrong, missing, extra, early and late notes have distinct feedback. Clipping, interrupted timing and uncertain pitches freeze adaptation. Natural room decay and overlapping strings can still make a take unclear. Headphones and separate, clear plucks give the best evidence; listen to the recording as well as the score.

Only bounded learning progress is stored under `guitar.trainer.v1`. Audio stays in memory until reload; downloads are explicit and local. Nothing is uploaded. Space taps tempo while stopped (normal controls keep their keyboard behavior), Escape stops audio and releases the mic. Backgrounding or leaving the page stops practice.

Run `node scripts/trainer-smoke.mjs` against preview for the real Chrome/CREPE progression and grading checks. Set `SMOKE_TRAINER_COURSE=1` for all lesson patterns, rests and creative review, or `SMOKE_TRAINER_QUICK=1` for one graded take plus calibration, export and lifecycle checks. `SMOKE_ORIGIN` targets another deployment. Tests use known recorded-guitar input through native Web Audio capture, not injected pitch answers. Desktop/mobile screenshots and traces go to ignored `smoke-artifacts/`.

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
