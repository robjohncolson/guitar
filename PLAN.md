# PLAN.md — Clean Take (`robjohncolson/guitar`) Review & Next Steps

> Scope: Static, offline-first piano/guitar practice trainer. No server or database required. Local pieces added via "Add your own piece" stay strictly in browser storage (and user-initiated local backups) and are never bundled or published.

---

## 1. Fix BFCache `pagehide` audio freeze and uncompilable-piece recovery

**Why:** Navigating between `index.html` and `piece.html` and pressing the browser Back button restores the page from BFCache with a cleared `audio.tick()` interval, silently hanging playback. Separately, if a saved/selected piece fails `compile()`, `loadPack()` mutates `pack` early and exits without falling back to a working piece or populating `#piece-select`, wedging boot (`audio.prepareFor(undefined)`) or corrupting `pack.id` mid-session.

**Files touched:**
- `src/piece/main.ts` (`loadPack`, `pagehide`/`pageshow` timer lifecycle, `prefetchEar`)
- `src/trainer/main.ts` (`pagehide`/`pageshow` timer lifecycle)
- `src/piece/audio.ts` (null-safe guard in `prepareFor` or ensure `exercise` is always initialized)
- `tests/piece-progress-persist.test.ts` (or a new `tests/piece-boot.test.ts`)

**Changes (high-level):**
- Replace the one-shot `const timer = setInterval(...)` with `startTick()` / `stopTick()` helpers; stop on `pagehide` and restart on `pageshow` (when `event.persisted` is true).
- In `loadPack()`, compile into a local candidate *before* overwriting `pack`. If compilation fails at boot, show the error notice, fall back to the first compilable bundled pack, and always call `paintPicker(all)`.

**Test / manual check:**
- **Manual:** Open `index.html`, click **Pieces · piano & guitar**, click the browser **Back** button, and press **Start** — verify count-in and playback run normally. Repeat in reverse from `piece.html` → `index.html` → Back.
- **Manual:** Corrupt the text of the currently selected `mine:*` entry in `localStorage['piece.imported.v1']`, reload `piece.html` — verify an error notice appears, the page falls back to `Gymnopédie No. 1`, `#piece-select` is populated, and no console `TypeError` fires.

---

## 2. Fix piece reset/delete data leaks and Guitar course streak persistence

**Why:** Clicking "Reset progress for this piece" leaves `progress.history` and `progress.bests` intact, so Today's Plan still marks reset steps as "done today." Removing a locally added piece orphans its progress in `piece.trainer.v1`, causing a future piece with the same title to inherit old progress. On `index.html`, `parseProgress()` resets `clean` and `hard` streaks to `0` on every reload.

**Files touched:**
- `src/piece/main.ts` (`piece-reset` handler around line 2082; `mountAddPanel` `removed` callback around line 2064)
- `src/trainer/progress.ts` (`parseProgress` lines 73–74; optional expanding review intervals at line 177)
- `tests/trainer-progress.test.ts`
- `tests/piece-progress-persist.test.ts`

**Changes (high-level):**
- Extract a small `clearPieceProgress(progress, pieceId)` helper used by both `piece-reset` and `removed(id)` that deletes matching keys from `units`, `today`, `bests`, `goals`, and filters matching entries out of `history`.
- In `src/trainer/progress.ts`, restore bounded `clean` (`0..2`) and `hard` (`0..1`) in `parseProgress()` instead of zeroing them, and align `due` intervals with `REVIEW_DAYS` (`[1, 2, 4, 8, 16, 32]`).

**Test / manual check:**
- **Unit (`npm test`):** Add Vitest cases verifying `clearPieceProgress()` clears `units`, `today`, `bests`, `goals`, and `history` for the target piece without touching other pieces, and that `parseProgress()` round-trips `clean` and `hard`.
- **Manual:** Complete a take on `piece.html` so a Today's Plan row shows `✓`, click **Reset progress for this piece** twice — verify the row returns to unfinished and "Your practice today" is cleared for that piece.

---

## 3. Add versioned `localStorage` migration, corruption quarantine, and no-op boot guard

**Why:** Both `parseProgress()` and `parsePieceProgress()` silently return an empty v1 state when `JSON.parse` fails or `version !== 1`, and both pages immediately call `persist()` during initial boot — permanently overwriting unreadable or future-version data before the user notices.

**Files touched:**
- `src/storage/migrate.ts` (new: shared read/migrate/quarantine helper)
- `src/piece/progress.ts` (wire `parsePieceProgress` through versioned migrators)
- `src/trainer/progress.ts` (wire `parseProgress` through versioned migrators)
- `src/piece/mine.ts` (quarantine corrupt `piece.imported.v1` instead of silently returning `[]` and overwriting on next write)
- `src/piece/main.ts` and `src/trainer/main.ts` (skip `persist()` on initial boot unless a migration ran or user state changed)
- `tests/storage-migrate.test.ts` (new)

**Changes (high-level):**
- Create a `loadVersioned(key, { currentVersion, legacyKeys, migrations, parse })` helper that:
  - Checks `legacyKeys` if the primary key is missing, migrating forward step-by-step (`v1 → v2 → ...`).
  - If raw JSON is corrupt or `version > currentVersion`, copies the raw string to `${key}.backup.${timestamp}` (capped to 1 backup per key), flags a read-only/warning banner, and refuses to auto-overwrite the original key on boot.
- Avoid writing to `localStorage` during `selectUnit()` / `selectLesson()` on initial page load when nothing actually changed.

**Test / manual check:**
- **Unit (`npm test`):** Test v1 → v2 migration, renamed-key fallback, corrupt JSON quarantine, and future-version (`version: 99`) non-destructive handling in `tests/storage-migrate.test.ts`.
- **Manual:** Put `{"version": 99, "units": {"test": {}}}` into `localStorage['piece.trainer.v1']`, reload `piece.html` — verify the original key is preserved (or backed up) and a non-blocking warning is shown instead of silently wiping it.

---

## 4. Add offline-first JSON Export/Import backup and decouple Railway/Supabase sync

**Why:** Moving away from Railway and Supabase means users need a reliable, zero-server way to back up progress and move between browsers/devices, without accidentally leaking their AI reader API key (`piece.reader.v1`) or firing dead `/api/*` requests.

**Files touched:**
- `src/storage/backup.ts` (new: envelope serializer, validator, preview summary, Replace/Merge restore)
- `src/piece/view.ts` and `src/piece/main.ts` (Export/Import buttons in the menu drawer)
- `src/trainer/view.ts` and `src/trainer/main.ts` (Export/Import buttons in the trainer journal/settings)
- `src/account/config.ts` and `src/account/boot.ts` (default `accountsEnabled` to `false` / offline-only mode; remove or disable `/api/client-error` and `bootSync` network calls)
- `tests/storage-backup.test.ts` (new)

**Changes (high-level):**
- Define a versioned backup file format (`clean-take-backup-YYYY-MM-DD.json`) containing `guitar.trainer.v1`, `piece.trainer.v1`, `piece.imported.v1`, and `piece.input.v1` — explicitly excluding `piece.reader.v1` (API keys) and `guitar.sync.v1`.
- On import, validate all keys before writing, display a summary of what's inside (pieces count, units, days logged), let the user choose **Merge** or **Replace**, and roll back if `QuotaExceededError` occurs.
- Default the build to offline-first (`accountsEnabled = false`), removing runtime dependency on Railway/Supabase endpoints.

**Test / manual check:**
- **Unit (`npm test`):** Verify round-trip export/import, API-key exclusion (`piece.reader.v1` never exported), malformed backup rejection without mutating `localStorage`, and Merge vs. Replace semantics.
- **Manual:** Export a backup from `piece.html`, open a private/incognito window, import the JSON file — verify progress, daily log, and local pieces restore intact, and verify the browser Network tab shows zero `/api/*` requests.

---

## 5. Add on-demand A–B section loop, spot tempo-ramp, and persistent weak-spot review

**Why:** Today, spot practice (`src/piece/spot.ts`) is only offered *after* a struggling take, has no way to step tempo back up inside the loop, and forgets problem bars as soon as you leave the step. Making bar-range looping proactive, adding a tempo ramp inside spot practice, and feeding recurring weak spots into Today's Plan directly boosts practice effectiveness offline.

**Files touched:**
- `src/piece/spot.ts` (add `fasterBpm()` helper alongside `slowerBpm()`, plus weak-spot aggregation/persistence helpers)
- `src/piece/progress.ts` (add bounded `weakSpots` per piece/course with `due` timestamp; surface 1–2 due weak spots in `suggestToday()`)
- `src/piece/view.ts` and `src/piece/main.ts` (compact "Loop bars" A–B range picker on stage/drawer, optional auto-repeat toggle, and "Step up (next rung)" button after 2 clean spot passes)
- `tests/piece-spot.test.ts` and `tests/piece-progress-persist.test.ts`

**Changes (high-level):**
- Reuse `spotExercise()` / `sliceExercise()` to let the user pick any bar range `from..to` (plus hand filter and continuous loop toggle) *before* starting a take.
- After 2 clean passes in spot practice, add a **Step up to X BPM** button (next rung toward the parent step's tempo) alongside **Back to the step**.
- Persist recurring problem bar clusters (from `problemBars()`) in `piece.trainer.v1` (bounded, e.g., top 5 per course) with spaced-review `due` dates so `suggestToday()` resurfaces weak passages automatically.

**Test / manual check:**
- **Unit (`npm test`):** Test `fasterBpm()` capping at parent step BPM, `weakSpots` serialization/pruning in `parsePieceProgress()`, and `suggestToday()` including due weak spots without exceeding plan size.
- **Manual:** Open a multi-bar passage on `piece.html`, select bars 5–6 in the A–B loop control, play 2 clean passes, click **Step up** to climb a rung inside the loop, then return to the full passage.
