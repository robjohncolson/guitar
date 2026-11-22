# Clean Take

Clean Take is a trainer for guitar and piano that listens through your microphone and grades each take honestly. It has two pages, linked from the top navigation:

- **Guitar course** (`/`, `src/trainer/`): a small, guided course for acoustic guitar. Start slowly, learn a musical idea, then carry it with less help.
- **Pieces · piano & guitar** (`/piece.html`, `src/piece/`): learn a specific piece on piano or guitar, one passage at a time.

**Live:** [robjohncolson.github.io/guitar](https://robjohncolson.github.io/guitar/) (GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`) · [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) (Vercel) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar)

The build uses relative asset URLs (`base: './'` in `vite.config.ts`), so the same `dist/` works at a domain root and under a subpath. Everything a user saves lives in that browser's `localStorage`. On the Vercel deployment, an **optional account** (below) syncs it across devices; the GitHub Pages mirror is built with `VITE_ACCOUNTS=off` and stays localStorage-only. Keys: `guitar.trainer.v1` (guitar course progress, `src/trainer/progress.ts`), `piece.trainer.v1` (Pieces progress, `src/piece/progress.ts`) and `piece.imported.v1` (pieces a user added, `src/piece/main.ts`). The product name is set in `src/brand.ts` and in the titles of `index.html` and `piece.html`.

The former Play page (Partner and Looper, `/play.html`) was removed on 2026-11-22; `/play.html` is now a short static notice (`public/play.html`) that forwards to the guitar course. Its settings key `guitar.practice.v1` is no longer written or synced; the server still accepts it so that old clients keep working.

## Optional accounts (Vercel only)

**Sign in** (top right) is optional. Signed-out visitors keep using `localStorage` exactly as before and make no network requests for it. With an account (username + password, no email), `guitar.trainer.v1` and `piece.trainer.v1` sync across devices. Pieces a user adds (`piece.imported.v1`) are uploaded only when they press **Save to my account** for that piece, and are readable only with that account's session.

- **Sync.** `localStorage` stays the working copy (offline-safe). Each save marks the key changed (`src/account/changes.ts`, bookkeeping in `guitar.sync.v1`); changes are pushed 2 s later, on hide and on page exit, with a per-key version so concurrent writes are detected. Signed-in pages pull before the app starts (`src/entries/*` → `src/account/boot.ts`), and check again when the tab regains focus (a banner offers a reload if another device saved newer progress). Per key, the newer modification wins. On the first sign-in on a device where both the browser and the account hold different progress, a dialog asks: keep this device's, use the account's, or merge (newest of each part).
- **Server.** One Vercel Node function, `api/router.ts` (`vercel.json` rewrites `/api/*` to it), with the logic in `server/`. Passwords are hashed with scrypt (N=32768, r=8, p=1, per-user salt; unknown usernames still pay one hash). Sessions are 256-bit random tokens in an `HttpOnly; Secure; SameSite=Lax` `__Host-guitar_session` cookie for 30 days; only their SHA-256 is stored, at most 20 per user. Mutating requests must be same-origin JSON. Sign-in failures are rate limited per username (10) and per IP (30) per 15 minutes, sign-ups to 5 per IP per hour, in the database. Errors are generic (`Username or password is incorrect.`). Limits: 512 KB per progress key, 2 MB per piece, 30 pieces per account, `GUITAR_MAX_USERS` accounts (default 1000).
- **Database.** Private schema `guitar` in Supabase project `curriculum_renderer` (`db/000_guitar_app_role.md`, `db/001_guitar_schema.sql`), reached through the pooler as the restricted `guitar_app` role (no BYPASSRLS, no other schemas). Not exposed through the Data API. Row-level security makes progress and pieces visible only to the user id the server sets for each transaction, so even a query missing its user filter cannot cross accounts. **Delete my account and data** removes the user and cascades to their sessions, progress and pieces.
- **Environment (Vercel, Preview + Production):** `GUITAR_DATABASE_URL` (pooler URL for `guitar_app`), `GUITAR_DATABASE_CA_PEM` (Supabase CA certificate), optional `GUITAR_MAX_USERS`, optional `GUITAR_SIGNUP=closed` to pause new accounts. Without them the site works and `/api` answers 503 ("accounts unavailable").
- **Errors.** Uncaught page errors go to the console and, on Vercel, to `/api/client-error`, which writes one line to the function log (no IP, cookie or user id). No third-party trackers.
- **Tests.** `npm test` covers hashing, sessions and expiry, rate limits, validation, conflicts and cross-user isolation (`tests/server/`, `tests/account-sync.test.ts`). With a Postgres that has the schema applied, `GUITAR_TEST_DATABASE_URL=postgresql://guitar_app@127.0.0.1:55433/postgres npx vitest run tests/server/postgres.test.ts` also checks RLS directly. `GUITAR_DATABASE_URL=... node scripts/accounts-server.mjs` serves `dist/` plus the API locally; `node scripts/accounts-smoke.mjs` (or with `SMOKE_ORIGIN=<deployment>`) runs the two-browser end-to-end flow with a throwaway account it deletes.

## Pieces: learn a specific piece on piano or guitar

Open **Pieces** (`/piece.html`). The first piece is Satie's *Gymnopédie No. 1* (public domain). The page builds a course for the piece: every chord (as written, then one note at a time), every change between neighbouring chords, each passage per hand and hands together, the joins between passages including across the repeat, each section, the whole piece, and scale, arpeggio and cadence drills in its key with standard fingering. Every step climbs a tempo ladder (50 to 100% of the goal tempo) between takes, fades the help at 80% and 100%, and returns for spaced review once learned on two days. **Today's practice** suggests a short session.

Piano listening works with an acoustic piano and the laptop microphone. Each attack is timed; each note is checked from its own partials: heard, not heard, wrong (with the pitch that sounded instead), unclear, or can't check (octave doublings). Unclear evidence never counts against you. Measured on held-out real piano recordings: a played note was called missing or wrong 1.8% of the time, an unplayed note confirmed 0.7% of the time, and nothing played was never credited as on time. Details and limits are in [PIECES.md](PIECES.md).

**Guitar accompaniment** arranges the same harmony for guitar (one capo position, shapes that never add a note outside the chord, a bass-and-pinch pattern that mirrors the piano's left hand) with its own course: shapes string by string (pitch checked by CREPE), changes, the pattern, then sections and the whole piece with the melody in your headphones. **Guitar** also plays the written notes on one guitar in standard tuning (frets 0–12), with the same steps as the piano course. A single string is pitch-checked; two or more at once are timing only.

To add your own piece, give the sheet music (PDF or photos) to your AI assistant with [PIECES.md](PIECES.md): it writes a `.piece.txt` file, transcribes it twice and checks it with `node scripts/piece-check.mjs`. Open the file under **Add your own piece**: it stays in this browser. Copyrighted music belongs in the git-ignored `src/piece/packs/local/`, never in the deployed site.

Run `node scripts/piece-smoke.mjs` against `npm run preview` for the real Chrome check (calibration loopback, recorded piano and guitar notes, a wrong note, silence, the tempo ladder, CREPE guitar shape, mobile layout).

## Guitar course

1. Open the guitar course, use headphones, and tune to standard E A D G B E. **Sound & timing** has six reference tones. Allow the microphone when starting practice.
2. For reliable tempo progress, calibrate once: keep the guitar quiet and hold one headphone earcup near the mic for eight clicks. Return the headphones to your ears. Calibration measures the audio path, never your playing habits. A manual offset is also available. Recalibrate after changing devices or input processing.
3. **Hear the phrase**, then **Start practice**. A bar of count-in leads into a six-string timing lane. The number is the fret; 0 means open. Follow the line and keep counting through gaps. New lessons can demonstrate automatically before the count-in.
4. Review one suggestion and the separate timing, note and (where relevant) release scores. Say whether the take felt comfortable. Start the next take when ready. Three clear, comfortable takes at 90% or better remove moving cues; three more reduce the metronome to one click per bar. Three independent takes certify that tempo and suggest +2 BPM. Two difficult takes suggest -4 BPM. Changes apply between takes; you can turn them off or enter your own tempo. Unclear recordings and uncalibrated timing never change your level. A take that could not be judged (distorted input, interrupted timing, gaps or unclear notes) shows "Not scored" with its reason, no percentages or note marks and no comfort question; you can still hear it and start the next take.
5. Open **Course & your progress** to choose any lesson, find a starting point, revisit a due lesson, or bring back the cues. Each lesson keeps its own pace and best independent tempo. Begin around 50-55 BPM and develop control before speed.
6. **Make it yours** records a creative answer with no correctness score. Listen to your latest or previous take, loop the latest to play along, or save a WAV. Finish the session in **Your practice today** for a short summary. A useful session is a little review, five minutes on one idea, and a creative ending.

The course has 13 lessons across six connected skills: pulse, hand coordination, phrasing and rests, major/minor harmony through arpeggios, offbeats/strumming/fingerpicking, and playing by ear/transferring an idea. Each includes positions, technique guidance, theory and an application. Strumming is explicitly rhythm-only. Audio cannot certify a chord shape, string/finger choice, picking direction, posture or physical comfort.

Real local CREPE identifies individual plucked pitches. After each practice phrase the mic closes and the stored audio is analyzed at the original attack times; slower inference does not move your notes or lose the recording. Timing and pitch are matched independently. Wrong, missing, extra, early and late notes have distinct feedback. Clipping, interrupted timing and uncertain pitches freeze adaptation. Natural room decay and overlapping strings can still make a take unclear. Headphones and separate, clear plucks give the best evidence; listen to the recording as well as the score.

Only bounded learning progress is stored under `guitar.trainer.v1`. Audio stays in memory until reload; downloads are explicit and local. Nothing is uploaded. Space taps tempo while stopped (normal controls keep their keyboard behavior), Escape stops audio and releases the mic. Backgrounding or leaving the page stops practice.

Run `node scripts/trainer-smoke.mjs` against preview for the real Chrome/CREPE progression and grading checks. Set `SMOKE_TRAINER_COURSE=1` for all lesson patterns, rests and creative review, or `SMOKE_TRAINER_QUICK=1` for one graded take plus calibration, export and lifecycle checks. `SMOKE_ORIGIN` targets another deployment. Tests use known recorded-guitar input through native Web Audio capture, not injected pitch answers. Desktop/mobile screenshots and traces go to ignored `smoke-artifacts/`.

## Run and verify

Use Node.js 22.12+ within Node 22, npm, and Chrome on Windows.

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

`npm run verify` runs the format check (Prettier), the tests and the production build.

With preview running, two scripts drive real Chrome with real local CREPE and recorded input through the native microphone path:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/trainer-smoke.mjs
node scripts/piece-smoke.mjs
```

`trainer-smoke.mjs` checks the guitar course (see **Guitar course** above for `SMOKE_TRAINER_COURSE` and `SMOKE_TRAINER_QUICK`); `piece-smoke.mjs` checks Pieces with recorded piano and guitar notes. `CHROME_PATH` can override Chrome's location. Screenshots and traces go to the ignored `smoke-artifacts/`.

The recorded guitar plucks come from the [University of Iowa guitar collection](https://theremin.music.uiowa.edu/MISguitar.html). See [fixture provenance and edits](tests/fixtures/NOTICE.md). These are edited recorded notes assembled into test phrases, not a physical speaker-feedback test or a recording of your playing. Regenerate with `node scripts/vendor-guitar-fixture.mjs`.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and 13 shards are committed in `public/models/crepe-tiny/` and served locally. No inference API or runtime model CDN; the only backend is the optional account API described above. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

`npm run vendor:crepe` reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download and records SHA-256 hashes; builds verify them. CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and licenses.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); earlier designs below it are historical. See [implementation and verification notes](IMPLEMENTATION_NOTES.md).
