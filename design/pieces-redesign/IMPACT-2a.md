# Phase 2a impact notes (manual fallback, decision D8)

The GitNexus server timed out (CONNECT_TIMEOUT), so callers and importers were found with `git grep` over `src/`, `tests/` and `scripts/` (private packs excluded). Line numbers are in the working tree after the change.

| Symbol (file) | Change | Callers / importers found | Tests that cover it | Risk |
|---|---|---|---|---|
| `pieceShell` (view.ts:9) | Markup: `#piece-setup` details around the piece select, toggles and status; HUD readout, free tag, Back button; `.about-step` with `#unit-goal`, `#unit-why`, `#lane-help`; `#unit-caption`; NEXT TAKE / LAST TAKE panel; `#piece-score` and the two consequence notes in `#piece-result`; `#piece-today` and `#piece-map` closed. Every old id kept. | main.ts:25 (only caller). Ids read by scripts: piece-smoke.mjs (`#piece-bpm`, `#piece-start`, `#piece-stop`, `#piece-comfortable`, `#piece-struggling`, `#piece-feedback`, `#inst-guitar`, `[data-unit]`, six details), piano-realtime-check.mjs (`#piece-title`, `#piece-listen`, `#piece-stop`, `#piece-about`), piano-voice-check.mjs (`#piece-settings`, `#piece-piano`, `#piece-feedback`, `#piece-listen`), accounts-smoke.mjs (`#piece-check-pitch`, `#piece-file`, `#piece-local-list`, `#piece-account-list`). None of these moved into a new container except the setup controls, which the scripts drive with `.click()` from JS. | piece-smoke (passes unmodified) | MEDIUM: structural markup change; ids and element types unchanged |
| `paint` (main.ts:~783) | Writes tempo help (goal / one-hand chip), free state, setup summary; calls new `paintLoop`. | main.ts (requestAnimationFrame loop, last line) | piece-smoke; browser probes | MEDIUM: runs every frame; all new writes go through the cached `text()` / `html()` / `disable()` helpers |
| `paintPips` (main.ts:~858) | Markup now from `ladderHtml` (hud.ts); same hide rules for pips; ladder shown dimmed in free tempo and spot; placement buttons unchanged (`button.rung-pick[data-rung]`, `aria-pressed`, label). Comment updated for R1. | main.ts `paint` only; click delegate `#piece-pips` (main.ts:~609) | tests/piece-hud.test.ts (ladderHtml) | LOW |
| `paintLoop` (main.ts, new) | NEXT TAKE and LAST TAKE from `nextLine` and the stored chip. | `paint` | tests/piece-loop.test.ts (nextLine) | LOW |
| `nextTake` (main.ts:~492) | Branching now through `routeTake` (same conditions: placement, then free tempo, then the ladder). | `answer` (main.ts:~520) | tests/piece-loop.test.ts (routeTake parity) ; piece-smoke (free tempo and ladder takes) | LOW: identical conditions |
| `answer` (main.ts:~515) | Dry-runs `outcome` for the LAST TAKE chip before `nextTake`; sets a short pop flag after a clean event when `lively()`. | `#piece-comfortable` / `#piece-struggling` clicks (main.ts:~642), keydown handler (main.ts:~762) | piece-smoke; tests/piece-loop.test.ts | LOW: no change to what is applied or started |
| `audio.onTake` handler (main.ts:~365) | Score block (`scoreHtml`), comfort ask "How did that feel? Space = …", consequence lines (`answerLines`); metrics and count-up through `floorPct`. | `PieceAudio.onTake` (audio.ts), dev hook `__pieceDev.take` (main.ts:~44) | piece-smoke; tests/piece-hud.test.ts | LOW |
| `stepReveal` / `endReveal` (main.ts:~443/~454) | Count-up uses `Math.floor` of `floorPct(timing)`. | main.ts: onTake, paint, start, answer, startWait, selectUnit, calibrate, pointer and key handlers | piece-smoke | LOW |
| `start` (main.ts:~303) | Unchanged. | answer, endMoment, choose, Start, place button, Space key | piece-smoke | none |
| `selectUnit` (main.ts:~207) | Clears LAST TAKE; sets `#unit-caption`; D6 message when an unanswered take is dropped. | loadPack (piece change), instrument toggle, `#piece-next`, map, course and today lists, goal change, reset, NEXT TAKE "Go to" action | piece-smoke | LOW |
| `#piece-calibrate` handler (main.ts:~690) | D6 message prefixed when it drops an unanswered take. | button click; NEXT TAKE Calibrate action | piece-smoke (calibration) | LOW |
| `paintJournal` (main.ts:~288) | "best N%" through `floorPct`. | paintToday | none direct | LOW |
| `parsePieceProgress` (progress.ts:37) | R1: `clean` (0–2) and `hard` (0–1) read back, floored and clamped. | main.ts:40; tests piece-curriculum, piece-plan, piece-rewards, piece-progress-persist | tests/piece-progress-persist.test.ts (round trip, old saves, clamping, climb and step-down across a parse) | MEDIUM: rule change approved as D1; two needs-more-room takes now step down across a reload or a day |
| `compareTake` (bests.ts:44) | `pct` and the two comparisons use `floorPct`. | main.ts `recordBest` (~361) | tests/piece-rewards.test.ts, tests/piece-progress-persist.test.ts | LOW |
| `floorPct`, `routeTake`, `nextLine`, `outcome`, `answerLines` (loop.ts, new) | New pure module. | main.ts, bests.ts, hud.ts | tests/piece-loop.test.ts | LOW |
| `ladderHtml`, `scoreHtml` (hud.ts, new) | New pure builders. | main.ts | tests/piece-hud.test.ts | LOW |
| hud.css (new) | All rules scoped to `main.piece`; imported after the three existing sheets. | main.ts import | browser probes at 390 and 1280 | LOW: Trainer page unaffected |

## Review fix batch

| Symbol (file) | Change | Callers / importers | Tests | Risk |
|---|---|---|---|---|
| `outcome` (loop.ts) | "Not counted" lines say the tempo step stays; step-down and hold lines use clamped rungs and the 20 BPM floor; a rung past the top no longer promises a step slower. | main.ts `answer`, `answerLines` | tests/piece-loop.test.ts (table rows, promise tests, real-unit sweep) | LOW |
| `nextState` (loop.ts, new) | Pure guards moved out of `paintLoop`: owed only when not in Wait for me; placement only during a live practice plan; uncalibrated only for mic, not listening, covered or spot. | main.ts `paintLoop` | tests/piece-loop.test.ts (guard table) | LOW |
| `firstSentence`, `capNote`, `UNANSWERED`, `takeStatus`, `comfortAsk` (loop.ts, new) | Copy helpers without regex lookbehind. | main.ts `selectUnit`, `audio.onTake`, Calibrate handler | tests/piece-loop.test.ts | LOW |
| `floorPct` (pct.ts, new leaf) | Moved; loop.ts re-exports it. | bests.ts, loop.ts, hud.ts, main.ts | tests/piece-loop.test.ts, piece-rewards | LOW |
| `answer` (main.ts) | Ladder pop only on keys input or when a milestone moment holds the next take. | as above | piece-smoke | LOW |
| `audio.onTake` handler (main.ts) | Score block hidden for spot passes; one status line per take; count-up number `aria-hidden` with an sr-only copy. | as above | piece-smoke; probe | LOW |
| `paint` (main.ts) | Placement label gated on the live plan; "Mic too loud" latched until the take ends; `--digits` on `#piece-bpm`. | rAF loop | piece-smoke | LOW |
| `paintPips` (main.ts) | Restores focus to the same `[data-rung]` after a re-render. | `paint` | probe | LOW |
| `#piece-calibrate`, `#piece-free-back`, `#piece-next-action` handlers (main.ts) | Calibrate hides the card when it drops a take; focus moves to `#piece-bpm` when the focused button disappears. | buttons | piece-smoke (calibrate) | LOW |
| `pieceShell` (view.ts) | Setup summary label, `aria-describedby` on the answer buttons, `#piece-take-status`, Course paragraph matches R1, `tempo-pips` class dropped. | main.ts | piece-smoke | LOW |
| hud.css / styles.css | Welcome-card line clamp, contrast, 44 px ladder targets (4-column wrap at 383 px and below), readout underline and digit sizing; dead `.pips`, `.rungs`, `.tempo-pips` rules deleted (no remaining users by `git grep`). | Piece page only | probes at 390 and 1280 | LOW |

## Final diff

```
 PIECES.md                            |    4 +-
 src/piece/bests.ts                   |    7 +-
 src/piece/main.ts                    |  114 ++++++---
 src/piece/progress.ts                |    2 +-
 src/piece/styles.css                 |    6 +-
 src/piece/view.ts                    |   20 +-
 tests/piece-rewards.test.ts          |    7 +
 src/piece/hud.css                    |  158 (new)
 src/piece/hud.ts                     |   66 (new)
 src/piece/loop.ts                    |  179 (new)
 src/piece/pct.ts                     |    2 (new)
 tests/piece-hud.test.ts              |  271 (new)
 tests/piece-loop.test.ts             | 1064 (new)
 tests/piece-progress-persist.test.ts |   93 (new)
```

`AGENTS.md` and `CLAUDE.md` changes predate this stage; the `UX-REDESIGN.md` and `mockup.html` edits are the coordinator's spec updates. None of them are part of this diff.

**Changed symbols:** `pieceShell`, `paint`, `paintPips`, `nextTake`, `answer`, `audio.onTake` handler, `stepReveal`, `selectUnit`, `#piece-calibrate` handler, `paintJournal`, `parsePieceProgress`, `compareTake`. **New:** `nextState`, `firstSentence`, `capNote`, `UNANSWERED`, `takeStatus`, `comfortAsk` (loop.ts), `floorPct` in pct.ts, `toBpm` (main.ts), `paintLoop`, `takeFacts`, `freeBack`, `#piece-free-back` and `#piece-next-action` handlers (main.ts); loop.ts (`floorPct`, `routeTake`, `nextLine`, `outcome`, `answerLines`, `CLEAN_RULE`); hud.ts (`ladderHtml`, `scoreHtml`).
