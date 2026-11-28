# Clean Take

Clean Take is a trainer for guitar and piano that listens through your microphone and grades each take honestly. It has two pages, linked from the top navigation:

- **Guitar course** (`/`, `src/trainer/`): a small, guided course for acoustic guitar. Start slowly, learn a musical idea, then carry it with less help.
- **Pieces · piano & guitar** (`/piece.html`, `src/piece/`): learn a specific piece on piano or guitar, one passage at a time.

**Live:** [robjohncolson.github.io/guitar](https://robjohncolson.github.io/guitar/) (GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`) · [guitar-lac-seven.vercel.app](https://guitar-lac-seven.vercel.app) (Vercel) · **Source:** [robjohncolson/guitar](https://github.com/robjohncolson/guitar)

The build uses relative asset URLs (`base: './'` in `vite.config.ts`), so the same `dist/` works at a domain root and under a subpath. Everything a user saves lives in that browser's `localStorage`; there is no active account service or cross-device sync. Progress and local pieces move between browsers only when the user downloads a JSON backup and imports it in the other browser (**Back up & move progress** on either page). Keys: `guitar.trainer.v1` (guitar course progress, `src/trainer/progress.ts`), `piece.trainer.v1` (Pieces progress, `src/piece/progress.ts`), `piece.imported.v1` (pieces a user added, `src/piece/mine.ts`) and `piece.input.v1` (per-browser input settings). The optional reader's address, model and key (`piece.reader.v1`, `src/piece/reader.ts`) stay in the browser and are never included in a backup or sent anywhere except the AI service the user names. The product name is set in `src/brand.ts` and in the titles of `index.html` and `piece.html`.

The former Play page (Partner and Looper, `/play.html`) was removed on 2026-11-22; `/play.html` is now a short static notice (`public/play.html`) that forwards to the guitar course. Its settings key `guitar.practice.v1` is no longer written and is not part of progress or backups.

## Offline-first progress and JSON backup

Each page has **Back up & move progress** (the Pieces menu, and the Guitar course's *Your practice today* panel). **Export backup** downloads one versioned JSON file named `clean-take-backup-YYYY-MM-DD.json` containing `guitar.trainer.v1`, `piece.trainer.v1`, `piece.imported.v1` and `piece.input.v1`. The reader's key (`piece.reader.v1`) and the old sync bookkeeping (`guitar.sync.v1`) are never included.

**Import backup** reads and validates every part before writing anything. It shows a short summary (pieces, steps, practised days, guitar lessons) and asks whether to **Merge** (keep this browser's newer per-step state and add what the file has) or **Replace** (use the file's copy for the parts it contains). Malformed, future-version or unfamiliar files are refused without changing `localStorage`; a storage error during the write rolls back every key it touched. Saved text that cannot be read is copied to `<key>.quarantine` before an explicit restore replaces it.

Accounts and sync were removed from the product. The historical `src/account/`, `api/`, `server/`, `db/` and `tests/server/` code remains in the repository for reference, but this build mounts no account UI, makes no `/api/*` request, and `accountsEnabled` is `false` in `src/account/config.ts`. There is no Railway or Supabase dependency at runtime.

## Pieces: learn a specific piece on piano or guitar

Open **Pieces** (`/piece.html`). The first piece is Satie's *Gymnopédie No. 1* (public domain). The page builds a course for the piece: every chord (as written, then one note at a time), every change between neighbouring chords, each passage per hand and hands together, the joins between passages including across the repeat, each section, the whole piece, and scale, arpeggio and cadence drills in its key with standard fingering. Every step climbs a tempo ladder (50 to 100% of the goal tempo) between takes, fades the help at 80% and 100%, and returns for spaced review once learned on two days. **Today's practice** suggests a short session.

Piano listening works with an acoustic piano and the laptop microphone. Each attack is timed; each note is checked from its own partials: heard, not heard, wrong (with the pitch that sounded instead), unclear, or can't check (octave doublings). Unclear evidence never counts against you. Measured on held-out real piano recordings: a played note was called missing or wrong 1.8% of the time, an unplayed note confirmed 0.7% of the time, and nothing played was never credited as on time. Details and limits are in [PIECES.md](PIECES.md).

**Guitar accompaniment** arranges the same harmony for guitar (one capo position, shapes that never add a note outside the chord, a bass-and-pinch pattern that mirrors the piano's left hand) with its own course: shapes string by string (pitch checked by CREPE), changes, the pattern, then sections and the whole piece with the melody in your headphones. **Guitar** also plays the written notes on one guitar in standard tuning (frets 0–12), with the same steps as the piano course. A single string is pitch-checked; two or more at once are timing only.

To add your own piece, open **Add your own piece** in the Pieces menu: copy the instructions into any AI chat together with the pages (PDF or photos), paste its answer back and press **Check**. The app tells you plainly what is wrong (as text to paste back to the AI), compares a second, independent reading if you make one, and keeps the piece as a draft until you have listened to it and pressed **It sounds right**. The app sends nothing anywhere unless you use the optional reader (**Or let an AI read it for you**), which sends only the pictures of your pages that you choose, with your own key, straight from the browser to the AI service you name (DeepSeek by default; see PIECES.md). The piece stays in this browser. A coding assistant working in this repository can instead follow [PIECES.md](PIECES.md) and check its files with `node scripts/piece-check.mjs`. Copyrighted music belongs in the git-ignored `src/piece/packs/local/` or in the browser, never in the deployed site.

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

With preview running, two scripts drive real Chrome with real local CREPE and recorded input through the native microphone path, and two more drive the import area:

```powershell
$env:SMOKE_ORIGIN = 'http://127.0.0.1:4173'
node scripts/trainer-smoke.mjs
node scripts/piece-smoke.mjs
node scripts/import-smoke.mjs
node scripts/reader-smoke.mjs
```

`trainer-smoke.mjs` checks the guitar course (see **Guitar course** above for `SMOKE_TRAINER_COURSE` and `SMOKE_TRAINER_QUICK`); `piece-smoke.mjs` checks Pieces with recorded piano and guitar notes. `import-smoke.mjs` needs no audio: it checks **Add your own piece** with real clicks, keys and clipboard (copying the instructions, Check and Add, the draft marks, confirming, a broken reading and its message, parts pasted behind each other, a file added to the box, Clear, Compare, the Replace question, Remove, focus, and that typing in the boxes plays nothing with Keyboard · MIDI); set `SMOKE_SIZE=390x844` for phone width (default 1280x800). `reader-smoke.mjs` drives that panel's reader against a fake chat service it runs itself on 127.0.0.1 (a drawn PDF and PNG, the key and its field, the pictures, Read, problems sent back, a second reading, errors and Cancel, a key forgotten in another tab, the 40-page limit, and no request to any other address); it takes `SMOKE_SIZE` too and never calls a real service. `CHROME_PATH` can override Chrome's location. Screenshots and traces go to the ignored `smoke-artifacts/`.

The recorded guitar plucks come from the [University of Iowa guitar collection](https://theremin.music.uiowa.edu/MISguitar.html). See [fixture provenance and edits](tests/fixtures/NOTICE.md). These are edited recorded notes assembled into test phrases, not a physical speaker-feedback test or a recording of your playing. Regenerate with `node scripts/vendor-guitar-fixture.mjs`.

## Local model and deployment

Real CREPE tiny runs on bundled TensorFlow.js/WebGL. Its manifest and 13 shards are committed in `public/models/crepe-tiny/` and served locally. No inference API, runtime model CDN or application backend. Only a model-load failure enables the explicitly labeled **FALLBACK: YIN** path.

`npm run vendor:crepe` reproduces the official [CREPE browser model](https://marl.github.io/crepe/) download and records SHA-256 hashes; builds verify them. CREPE: Kim, Salamon, Li, Bello, *A Convolutional Representation for Pitch Estimation*, ICASSP 2018 (MIT). TensorFlow.js: Apache 2.0. See `public/models/NOTICE` and licenses.

Pushes to `main` deploy through the connected Vercel project after tests and the production build. The current contract is at the top of [SPEC.md](SPEC.md); earlier designs below it are historical. See [implementation and verification notes](IMPLEMENTATION_NOTES.md).
