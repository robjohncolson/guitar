# Pieces page redesign: visuals first, loop legible

**Approved by Robert on 2026-11-14: Part A (version 3); D1–D7 as recommended (R1: persist `clean` and `hard`); D8: a manual caller-search fallback is fine and is noted in the PR description. Phase 2 runs as 2a then 2b, one Opus lead per stage, committed per stage, with a stop for Robert's OK between them.**

Phase 1 spec, version 3. Branch `pieces-visuals-first-redesign`. Besides the uncommitted files that were already there (AGENTS.md GitNexus block, CLAUDE.md, `.claude/`), this file and `mockup.html` (same folder) are the only additions, and nothing is committed. `design/` is not an entry page, not under `public/`, and outside `tsconfig` and the Pages build, so it cannot ship.

**Part A** is what you approve. **Part B** is the evidence and the detail an implementer needs. Open `design/pieces-redesign/mockup.html` in a browser: links across its top switch between states; `Phone / Desktop` and `Calm` switches are included. All labels are Gymnopédie No. 1 (public pack), goal 66 BPM, example step "Bars 1–4 · left hand" (rungs 33, 40, 46, 53 BPM; one hand stops at 53). Citations are `file:line` in the current tree (`src/piece/` unless a path is given).

---

# Part A: for approval

## A1. In one page

- **On stage**: the lane, the passage name, a very large BPM with its goal, a ladder you can see (44 px segments, not 7 px ticks) with big pips, and one plain sentence, **NEXT TAKE**, saying what the next take will do and why. A **LAST TAKE** chip keeps what the previous take did. A slim top bar holds the menu, the piece, a compact **Today** chip and one status chip.
- **After a take**: a result card shows the *combined* score the ladder actually uses, and each answer button says what it will do (a dry run of `advanceUnit`, so it cannot disagree with the real outcome).
- **In a drawer, all closed**: today's plan, the piece map, the course, Piece & input, Sound & timing, About, Add your own piece, take review, the journal, shortcuts. The two panels that are open today are closed.
- **Kept on stage because they are not clutter**: Hear it, Wait for me, Stop, the trouble-spot offer, error notices, the account nav row.
- **One rule change recommended (R1)**: save the clean and hard counts through `parsePieceProgress`. Without it, one clean take plus a reload is "1 of 2" again.
- **Staged build**: **Phase 2a** makes the loop legible (NEXT TAKE, LAST TAKE, result card, big ladder, R1, closed panels) with no dialog, no message rerouting and no script edits. **Phase 2b** restructures the stage (drawer, top bar, free-tempo popover, NOTICE). 2a alone fixes the opacity. The mockup shows the end state, 2b.
- Nothing in the engine, grading, listening or contracts changes. Eight decisions for you are in A6.

## A2. What is on stage

```
phone 390                          desktop 1060 max
┌────────────────────────────┐     ┌───────────────────────────────────────────────┐
│ Trainer Pieces Partner Looper│   │ Trainer  Pieces  Partner  Looper    Sign in   │
│ ☰ Gymnopédie No.1  ◔1/4  ● │     │ ☰ Gymnopédie No.1       ◔ Today 1/4  ● Mic    │
│ 04 · LEFT HAND             │     │ 04 · LEFT HAND            ┌─ NEXT TAKE ──────┐ │
│ Bars 1–4 · left hand   ⓘ   │     │ Bars 1–4 · left hand      │ Two clean takes  │ │
│ 33 BPM     top 53 ✎       │     │ 33 BPM   top 53 · one hand│ in a row move…   │ │
│ [33][40][46][53◆]          │     │ [33][40][46][53◆]         ├─ LAST TAKE ──────┤ │
│ ○○ 0 of 2 clean in a row   │     │ ○○ 0 of 2 clean in a row  └──────────────────┘ │
│ Ready…            lane help│     │ Ready when you are                  lane help  │
│ ┌────────────────────────┐ │     │ ┌───────────────────────────────────────────┐ │
│ │ lane                   │ │     │ │ lane                                      │ │
│ └────────────────────────┘ │     │ └───────────────────────────────────────────┘ │
│ ┌ sticky ────────────────┐ │     │ [ Start practice ]  (Hear it) (Wait for me)   │
│ │NEXT TAKE Two clean…    │ │     └───────────────────────────────────────────────┘
│ │[ Start practice ]      │ │
│ └────────────────────────┘ │
└────────────────────────────┘
```

1. **Account nav row**: the existing `nav.app-nav` stays as a slim row (account code puts Sign in and the first-run card there).
2. **Top bar**: ☰ menu · piece title and composer · **Today** chip ("Today 1 of 4") · **status** chip (dot plus words; on phones a dot and one word).
3. **HUD**: stage eyebrow, passage name, one-line caption, ⓘ; the BPM at 72–104 px; a gold chip ("goal 66", or "top 53 · one hand" on a one-hand step); a ✎ for free tempo; the **ladder**, one 44 px segment per rung with its BPM, ◆ on certification rungs, ahead segments still the placement-target buttons; **pips** (2 for a plain rung, 3 labelled Notes · Memory · Click for a certification rung).
4. **Lane**, the largest element, with a header row above it (phase chip, one-line help). Nothing is drawn over the canvas.
5. **NOTICE** (only when needed): errors and non-take messages, one sentence and at most one button.
6. **NEXT TAKE** and **LAST TAKE**. On phones NEXT TAKE and the action row form one **sticky block** at the bottom of the stage; its muted second line moves into ⓘ.
7. **Actions**: Start practice (becomes Stop · Esc while anything is playing), Hear it, Wait for me (keys only), and a link "Already know this? Try it at 53 BPM" only when placement is possible.
8. **After a take** the result card takes the action slot (A3 and B3.2).

**Acceptance targets**, measured from the top of the app frame (not the page, so the mock controls strip does not count), in the mockup now and in Phase 2 again:

| Viewport | Target |
|----------|--------|
| 390×844 | lane top under 330 px; lane, NEXT TAKE and Start all visible without scrolling |
| 390×664 (phone with browser bars) | the sticky block (NEXT TAKE sentence and Start) fully visible; passage name, BPM, goal chip and ladder visible above it; at least 100 px of lane visible between. While a result card is open the lane is secondary (160 px) and may sit under the sticky block |
| 1280×800 | two HUD columns; lane at least 300 px, or at least 250 px while a result card or NOTICE is showing; Start (or the answer buttons) fully visible |

Lane height: phones `clamp(180px, 100dvh − 500px, 300px)` (300 fixed today); desktop `min(440px, 100vh − 360px)` with a 300 px floor (440 today), set where view.ts:259 and :414 set it.

## A3. The loop sentence

**Slots.** **NEXT TAKE** is always visible: what the next take will do, and why; a DOM element of its own, so the count-in text cannot replace it. **LAST TAKE** is the score and outcome of the last *answered* take, kept until the next take is graded, greyed while a card is open, cleared when the step, instrument or piece changes. The **result card** sits between the end of a take and its answer.

**Priority for NEXT TAKE**, first match wins: answer owed › offer or spot-pass choices › spot › Wait for me › mic not calibrated (mic takes only; not keys, listening or spot) › placement take › free tempo › the step's own state.

### A3.1 NEXT TAKE wording (T = current BPM, N = next rung; one idea per sentence, 130 characters or fewer, plus an optional muted second line)

| Case | NEXT TAKE | Rule |
|------|-----------|------|
| Plain rung, 0 in a row | "Two clean takes in a row move you up to 40 BPM." Muted: "Clean = 90% or better, and you say it felt comfortable." | progress.ts:86, 126 |
| Plain rung, 1 in a row | "One more clean take moves you up to 40 BPM." Same muted line. | progress.ts:127 |
| Certification rung, help 0 | "Three clean takes certify 53 BPM, each with less help. This one: notes shown (1 of 3)." | progress.ts:113–114 |
| Certification rung, help 1 | "Take 2 of 3 at 53 BPM, notes hidden. A clean take unlocks the last one: a click on each bar only." | progress.ts:114 |
| Certification rung, help 2 | "Last of 3 at 53 BPM: notes hidden, a click on each bar only. A clean take certifies it and moves you up to 58 BPM." At the top: "…certifies 53 BPM, the top step for one hand." | progress.ts:115–124 |
| Top rung certified today, not learned | "Certified today. Come back on another day to call it learned." | progress.ts:117–121 |
| Top rung certified on an earlier day only | "Certified before. {n} clean takes today make it learned." with n = 3 − help level (the help level is saved) | progress.ts:119–120 |
| Learned, not due | "Learned. It comes back for review in {n} days." (from `due`; "1 day" when n is 1) | progress.ts:105, 120 |
| Learned, review due, at the top | "Review due: one clean take at 66 BPM passes it. A take that needs more room moves you one step slower." | progress.ts:105–106 |
| Learned, review due, below the top | "Review due: work back up to 66 BPM, then one clean take there passes it." | progress.ts:104–106 |
| Listening step | "Let it play to the end. Then it counts as heard. Nothing is scored." | main.ts:326 |
| Covered step (`sameAs`) | "Same notes as “Bars 1–4 · left hand”. Practise that step; this one follows it." plus a Go-to button | main.ts:222 |
| Answer owed | "Answer first: how did that take feel? ↑ comfortable · ↓ needs more room." While a demo, take playback or loop is playing: "Answer when the playback ends." During a Wait for me run the Wait sentence shows instead. | main.ts:299–300, 773 |
| Offer after a miss | "Practise bar 3 at 28 BPM, or carry on." The choices fill the action slot (Practise, Wait for me on keys, one hand, Next take as usual). Appears only after "Needs more room" or a trusted take under 65%, on a piano step of 2+ bars, when the take shows confirmed trouble in at most half the bars. | main.ts:516–517, 537–546; spot.ts:32–46, 69–70 |
| Spot-pass choices | "Again until it comes out clean, or slow it down." / "Clean pass. One more in a row, then back to the step." / "Two clean passes in a row. Put them back in context." | main.ts:547–552 |
| Spot loop | "Spot practice on bar 3 at 28 BPM. It never changes your tempo step." plus Back to the step | main.ts:368–378, 770 |
| Wait for me | "Wait for me: the notes wait for your keys. Only keys are checked, and it never moves your tempo." | main.ts:140–156 |
| Mic not calibrated | "Takes will not move your tempo until timing is calibrated: 8 clicks, with an earcup held to the mic." plus an inline Calibrate button | progress.ts:97; main.ts:662; calibration.ts:32–33 |
| Placement take | "Placement take at 53 BPM: one clean, comfortable take places you here. Otherwise nothing is recorded." | progress.ts:142–155 |
| Free tempo | "Free tempo: takes at 36 BPM do not move the ladder. Go back to 33 BPM to count takes." | main.ts:483, 492 |
| One-hand cap | No sentence of its own: the chip reads "top 53 · one hand", the ladder ends at 53, and ⓘ says "Top step for this passage on its own. Sections and the whole piece go on to 66." | curriculum.ts:80 |
| Next equals current (20 BPM floor) | "…moves you to the next step (still 20 BPM, the slowest allowed)" instead of naming a BPM | progress.ts:75 |

### A3.2 The card's answer lines

Computed by calling `advanceUnit` once per answer on a copy (it copies the progress it is given, progress.ts:95). "Slowest step" cases follow progress.ts:109–110: at rung 0 a second needs-more-room take moves nothing.

| Situation | Felt comfortable | Needs more room |
|-----------|------------------|-----------------|
| 90% or better, plain rung, 0 clean so far | "Clean take 1 of 2. One more moves you up to 40 BPM." | At the slowest step (33 BPM): "Stays at 33 BPM, the slowest step." At any other rung: "Stays at 40 BPM. A second one in a row makes room: one step slower." |
| 90% or better, 1 clean so far | "Clean take 2 of 2. Moves you up to 40 BPM." | as above, then "Two clean takes in a row are needed again." |
| 90% or better, certification rung | "Clean. Next take: notes hidden." (or "a click on each bar only", or "certifies 53 BPM") | "Stays at 53 BPM. A second one in a row makes room: one step slower." |
| A second needs-more-room in a row | | "One step slower: 33 BPM." At the slowest step: "33 BPM is the slowest step, so it stays." |
| 65–89% | "Kept at 33 BPM: 84% is under the 90% a clean take needs." (with 1 clean so far, add "Two clean takes in a row are needed again.") | the needs-more-room line above |
| Under 65% | both: "Under 65%, so this counts as needing more room." then the needs-more-room line | |
| Review due | at the top: "Passes the review." | "One step slower: 46 BPM. It comes back quickly." |
| Unclear recording | both, one line: "Not counted: {reason}. Your tempo step stays as it is." | |
| Mic not calibrated | both: "Not counted: timing is not calibrated. Your tempo step stays as it is." | |
| Free tempo | both: "Not counted: free tempo. Your tempo step stays as it is." | |
| Spot | no comfort question (today's behaviour) | |
| Placement | scored 90% or better: "Places you at 53 BPM." Under 90%: "Not placed: 84% is under 90%. Nothing is recorded." | "Not placed. Nothing is recorded." |

After the answer the card closes, LAST TAKE fills in, NEXT TAKE updates, and the next take starts as today, except after an offer, learned, review passed, placed, or a placement take, which wait (main.ts:507–518).

### A3.3 LAST TAKE chips

| Outcome | Chip |
|---------|------|
| clean | "92% · Clean, 1 of 2" |
| climb | "92% · Up to 40 BPM" |
| fade | "92% · Clean: next take hides the notes" (or "a click on each bar only") |
| certified, learned, review passed, overnight | "92% · Certified at 53 BPM" · "Learned" · "Review passed" · "Clean: it stuck overnight" |
| hold | "84% · Kept at 40 BPM: under 90%" |
| needs more room | "92% · Needs more room: stays at 33 BPM" |
| step-down after two | "Needs more room twice in a row · one step slower: 33 BPM"; at the slowest step "· 33 BPM is the slowest step, so it stays" |
| step-down in review (one take) | "Needs more room · one step slower: 46 BPM. It comes back quickly." |
| not counted | "Not counted · {reason}" or "Not counted · free tempo" |
| placement | "Placed at 53 BPM" or "Not placed · nothing recorded" |

## A4. The one rule change

**R1 (recommended): persist the clean and hard counts.** In `parsePieceProgress` (progress.ts:50) replace `clean: 0, hard: 0` with bounded reads: `clean: Math.floor(bounded(s.clean, 0, 2, 0))` and `hard: Math.floor(bounded(s.hard, 0, 1, 0))`. `persist()` already writes both, so existing saves hold them; missing or tampered values become 0. Effect on a plain rung: a clean take before a reload still counts as "1 of 2" after it (certification pips already persist through `support`).

Cost, stated plainly: a needs-more-room take late one day plus one the next now steps a unit down, because "two in a row" no longer ends at a reload. On a certification rung that also zeroes the help level (progress.ts:109). Alternative **R1b**: persist `clean` only and keep `hard` per sitting, which is gentler. If R1 is rejected the ladder keeps its reset and the HUD says under the pips, only while the count is above 0: "Clean takes in a row count while this page stays open."

Tests: round trip of `units` through `JSON.stringify` and `parsePieceProgress`; old saves without the fields load as 0; tampered values clamp; two clean takes across a parse boundary climb; hard 1 + parse + hard 1 steps down (R1) or does not (R1b). Today nothing asserts clean, hard or support after parse (tests/piece-curriculum.test.ts:128–135 checks rung, best and days). Under R1 also update the comment at main.ts:819 and the ladder paragraph in PIECES.md:111.

No other rule changes are proposed. Kept as they are, and now explained on screen: two clean takes to climb; three with fading help at certification rungs, not necessarily in a row; two hard takes to step down; 65–89% holds; "Needs more room" on a 90%+ take is hard; unclear and uncalibrated takes never count; free tempo, Wait for me, spot loops and failed placement never move the ladder; one hand stops at 80% of goal; the review pass and its one-hard-take step-down.

## A5. Before and after: a take that feels stuck

Step "Bars 1–4 · left hand", 33 BPM (the slowest step), top 53 for one hand.

| Moment | Today | After (R1 approved) |
|--------|-------|---------------------|
| Take 1: 94% on time, 92% notes heard | Metrics show 94% and 92%. The combined 92% is not shown. | Result card: "Score 92%", the lower number marked, "90% counts as clean". |
| Comfort question | "Your answer, with the score, decides the next tempo." | Buttons say what each does: "Clean take 1 of 2. One more moves you up to 40 BPM." and "Stays at 33 BPM, the slowest step." |
| After ↑ | No banner for a hold. The message sits in front of "One bar to count in." in the 15 px coach line and is replaced when the next take is graded. | LAST TAKE "92% · Clean, 1 of 2" and NEXT TAKE "One more clean take moves you up to 40 BPM." stay put through the count-in and the take. |
| Page reloads (account sign-in, update banner) | Pips back to 0 of 2. | Pips still 1 of 2. |
| Take 2: clean | "Clean. One more like that…" again. The tempo is still 33. | Climb: "Up to 40 BPM", marker slides, pips refill. |
| Typed 34 in the BPM box by accident | One line and a 10 px help line, then every take is ignored until the box is set back. | Readout turns amber "free", NEXT TAKE says takes are not counted, one tap goes back to 33. |

## A6. Decisions for Robert

| ID | Question | Recommendation |
|----|----------|----------------|
| D1 | R1: persist `clean` and `hard`? | Yes, both. R1b (clean only) if a needs-more-room take should never carry over a reload or a day. |
| D2 | Free tempo as a ✎ popover (2b), or keep the BPM box visible? In 2a the box stays visible but gets a loud "free" state and a Back button. | Popover in 2b. |
| D3 | Print every take percentage rounded down (`floorPct`), so the score never reads 90% when it is 89.6%? | Yes. |
| D4 | "Next in today's plan" moves into the drawer and shows on stage after a step finishes? | Yes (2b). |
| D5 | The first-run "New here? How it works" card (302 px on a phone) is account code. Leave its logic alone and shrink it with CSS under `.piece`? | Yes. |
| D6 | Show "That take was not answered, so it did not change your tempo step." when picking another step or Calibrate drops one? | Yes. |
| D7 | Lane height as in A2 (phones `clamp(180, 100dvh − 500, 300)`, desktop `min(440, 100vh − 360)` with a 300 floor)? | Yes, so Start stays on the first screen. |
| D8 | The GitNexus tool server timed out in this session (CONNECT_TIMEOUT). The repo rule is to run `impact` before editing a symbol. Fix the server, or approve a manual fallback (recorded caller searches for each symbol touched)? | Fix it if quick; otherwise approve the fallback. |

---

# Part B: evidence and detail for the implementer

## B1. Why "I played and the tempo did not move"

The ladder works as coded. The screen hides which gate a take hit, and one persistence rule makes it feel stuck. In the order a learner meets them:

| # | Gate | What the code does | What the learner sees today | Source |
|---|------|--------------------|-----------------------------|--------|
| 1 | Comfort answer owed | A take is logged and its best kept, but only an answer (↑ ↓ Space or a button) applies it to the ladder. Start while an answer is owed refuses. Picking another step, pressing Calibrate, or reloading drops the unanswered take silently. | The comfort question says the answer decides the next tempo. Nothing says an unanswered take is dropped. | main.ts:300, 390–396, 480–494, 202, 662 |
| 2 | Clean count not saved | `persist()` writes every unit's `clean` and `hard`; `parsePieceProgress` zeroes both on load. `support` (the fade step) survives. | On a plain rung: one clean take, reload, next clean take is "1 of 2" again. Reloads also follow account sign-in. | progress.ts:50; main.ts:157–160, 819 |
| 3 | Free tempo sticks | Any BPM other than the step's sets `manualBpm`. Takes there skip the ladder, and the free-tempo branch returns before `manualBpm` is cleared, so the next take auto-starts at the same free tempo. Pips hide while it is set. | One coach line, plus a 10 px help line ("Free tempo · step is 33"). | view.ts:16; main.ts:636–643, 483, 492, 785, 833 |
| 4 | Unclear or uncalibrated take | `trusted && calibrated` is the first gate. Piano more than 45 cents off makes a take untrusted (its reason says "timing still counts", but the ladder ignores it). Mic takes need calibration, which an audio-path, output or device change clears. Keys takes always count as calibrated. | An amber dot far above the lesson, and a line in the small coach line under the actions after the take. The answer buttons do not say the take counts for nothing. | progress.ts:96–97; grade.ts:103–107; main.ts:66, 318, 388, 649, 662, 706 |
| 5 | Certification rungs | At 80% and 100% (one-hand steps: 80% only; performance and drills: 100% only) the first two clean takes change help level, not tempo. The three takes need not be in a row; only two hard takes zero the help level. | Three tiny pips and a 10 px caption. | progress.ts:113–125; curriculum.ts:28, 80, 105, 116 |
| 6 | In-between takes | 65–89% and comfortable: tempo holds and the clean count returns to 0. A 90%+ take answered "Needs more room" counts as hard and also zeroes clean. | The score the ladder uses is never shown (row 10). | progress.ts:102–103, 112 |
| 7 | One-hand cap | One-hand piano steps stop at 80% of goal: 53 of 66 BPM. | The tempo help line says "of 66 goal". | curriculum.ts:80 |
| 8 | By design, never moves the ladder | Wait for me, trouble-spot loops, failed placement, free tempo, listening steps, covered steps. | Said only in short banners or hints. | main.ts:140–156, 368–378, 770; progress.ts:142–149 |
| 9 | The message is small and short-lived | The ladder message is carried into the count-in line ("{message} One bar to count in.") in the 15 px coach line under the actions and is replaced when the next take is graded. Banners are canvas-only and lively-only, for climb, fade, certified, learned, review, placed and a first clean take of a day, 1.2–3.5 s. Hold, uncounted and step-down get none. | A small line that changes at the next take; no stable place to look. | main.ts:294, 312, 387, 506–524, 518 |
| 10 | Score shown is not the score used | The result shows "% on time" and "% notes heard". The ladder uses the lower of the two against 90% and 65% (timing alone when notes were not checked). Displays round, thresholds do not: 89.6% shows 90% yet is not clean. | A 94% on-time take can still be a hold. | grade.ts:102, 123, 162, 261; main.ts:400–401 |
| 11 | Slowest step says "slower" | A second hard take at the lowest step moves nothing but says "one step slower". | A promise the screen does not keep. | progress.ts:109–110 |
| 12 | After a miss the next take waits | After "Needs more room" or a take under 65% on a multi-bar step the app can offer a trouble-spot loop and start no take. After learned, review passed or placed it also waits. | A keyed offer under the card that this redesign must place. | main.ts:507–517, 529–555 |

Page weight today (live page, fresh profile, includes the 302 px first-run welcome card on a phone): at 390×844 the lane starts at y=1109 and Start practice at y=1452 on a 3353 px page; at 1280×800 the lane starts at y=831 and Start at y=1314. Today and Your piece are open by default (615 and 639 px on a phone). The BPM box is 26–30 px, its help line 10 px, rungs 7×5 px, pips 9×9 px. No sideways scroll at 390 px today (checked with device emulation); that must stay true.

## B2. Rules this redesign keeps

- Reward effects only for confirmed results, never in Calm or with reduced motion, never in a mic take or demo (AGENTS.md:14, 16). Milestone banners stay canvas-drawn and lively-only.
- Comfort is always the learner's own key press or click, never automatic (AGENTS.md:14). Unclear evidence never counts either way (AGENTS.md:12). Space, ↑ and ↓ are never piano keys in computer-keys mode (PIECES-NEXT-SPEC.md:27).
- Wait for me never moves the ladder; placement is the only skip, records nothing on a miss, and never starts the next take by itself (AGENTS.md:13–14; PIECES-NEXT-SPEC.md:72).
- Lenient tone: count clean work, no loss framing, no streaks, badges, XP or notifications (AGENTS.md:14). Copy says "clean takes in a row" and what a take did; it never says "lost", "reset", "failed", "streak" or "hard take". The owner-initiated "Reset progress for this piece" button keeps its name.
- No new localStorage key; progress stays in `piece.trainer.v1`, device preferences in `piece.input.v1`; old saves must still load (PIECES-NEXT-SPEC.md:19). Nothing is fetched from another origin; no new runtime dependency; no web font (PIECES-NEXT-SPEC.md:18, 20).
- Listening thresholds, CREPE, the piano sample set and the Wait / comfort / unclear contracts are untouched. Imported pieces stay in this browser (`piece.imported.v1`, owner-only); the opt-in "Save to my account" path (`#piece-account-list`, `src/account/pieces.ts`) is untouched. No server, schema, API, Supabase or account change: **`src/account/*` is not edited**. Local-first.
- The practice engine (`advanceUnit`, grading, listening) is unchanged unless R1 is approved.
- Agents do not commit or push; LF line endings; no comments about plans or process in code (PIECES-NEXT-SPEC.md:21–23). No branch is pushed (a pushed branch can trigger a Vercel preview per `vercel.json`).
- Done means: `npm test` and `npm run build` pass, the piece smoke passes, no console errors, no sideways scroll at 390 px, no server left running (PIECES-NEXT-SPEC.md:26).

## B3. Layout detail

### B3.1 The stage, item by item

0. **Account nav row** (28 px): the existing `nav.app-nav`. Account code appends its Sign-in button to it and inserts the first-run welcome card after it (account/ui.ts:124–128, welcome.ts:25), so it must stay visible. The welcome card is shrunk with CSS scoped to `.piece`; no account file is edited.
1. **Top bar** (52 px): ☰ (44 px hit area) · piece title (18 px) over composer (12 px) · Today chip · status chip ("Mic · calibrated", "Calibrate", "Keys · MIDI", "Mic too loud"; on phones one word: "Mic", "Calibrate", "Keys", "Too loud").
2. **HUD**
   - Passage: stage eyebrow ("04 · LEFT HAND"), passage name (24–28 px), a one-line caption (the first sentence of `unit.goal`, 13 px, ellipsized) and an ⓘ (44 px hit area) that opens "About this step" (the full `unit.goal`, `unit.why`, the lane help, and the muted "Clean = …" line on phones).
   - Tempo readout: current BPM at 72–104 px, weight 700, tabular figures; "BPM" label; a gold chip, "goal 66" on a normal step, or "top 53 · one hand" with a muted "piece goal 66" on a one-hand step (decided from `unit.rungs[last] < 1`, as `stateLabel` does at main.ts:167); a ✎ (44 px hit area) for free tempo. No separate "next tempo" label: the next tempo is in the ladder and in NEXT TAKE.
   - Ladder: one segment per rung of this step (7; 4 for one-hand and performance steps; 3 for guitar shapes; none for listening and covered steps), `flex: 1`, 44 px high, at least 36 px wide, BPM inside. Passed = lime fill with dark text, current = larger with a lime ring, ahead = outline. Certification rungs carry a gold ◆. **Ahead segments stay buttons** (`button.rung-pick[data-rung]`, `aria-pressed`, label "Place at 70%: 46 BPM") exactly as today (main.ts:828–832), because they pick the placement target (SPEC.md:8); the chosen target has a gold outline and the default is the top rung.
   - Pips under the current segment, 22 px: plain rung = 2 pips ("0 of 2 clean takes in a row"); certification rung = 3 pips labelled Notes · Memory · Click ("help level 2 of 3"). Hidden in free tempo, spot, at a top rung without certification, and when a step is learned and done (main.ts:821–834).
3. **Lane header row** (24 px): the phase chip (left; "Ready when you are", "Count in · 3", "Play · bar 2") and a one-line lane help (right). Nothing is drawn over the canvas: the Wait-for-me pill and milestone banner are canvas-drawn and would collide, and the additive `.piece-light` layer sits over the canvas parent (view.ts:255).
4. **Lane**: canvas unchanged except height (A2). Chord boxes and keys-mode help stay under it.
5. **NOTICE** (B3.7).
6. **NEXT TAKE** and **LAST TAKE**: NEXT TAKE is in the right-hand HUD column on desktop and, on phones, the top of the sticky block. LAST TAKE is a one-line chip under the pips on phones.
7. **Action row**: Start practice (primary, 56 px; becomes Stop · Esc for every `active()` state: take, demo, listen, Wait for me; Stop always works at once) · Hear it · Wait for me (keys only). Placement link only when possible, with `placeBpm()` (default the top rung, main.ts:108–109). Sticky inside the stage on phones (`position: sticky`, not `fixed`, so it does not sit under the account banner).
8. **After a take**: the result card (B3.2).

### B3.2 The result card

- **Score**, large, with a bar that has ticks at 65% and 90% and the words "90% counts as clean". Three variants, chosen from the take's result: *scored* ("Score: the lower of the two", then "94% on time · 92% notes heard", with the lower one marked; "right keys" on a keyboard); *timing only* when notes were not checked ("Score: on time. Notes were not checked."); *not scored* when the take is untrusted ("Not scored" plus the reason from `result.reason`; no bar). An uncalibrated mic take adds "estimate".
- **Two answer buttons**, side by side, each with its consequence line underneath (A3.2). The default for Space is marked ("Space = felt comfortable"). Both live in one parent, as today, because `answer()` hides that parent for spot takes (main.ts:390).
- **Secondary row**: "Hear this take", "Hear it", "Review take". Hear it and Wait for me stay usable while an answer is owed, as in the code (main.ts:299).
- On phones the two answer buttons are the sticky block, and the lane collapses to 160 px **after the reveal sweep ends** (the take is over), and the timing strip and verdict chips move to Drawer › Last take. On desktop the strip and chips stay on the card as one row.
- LAST TAKE is greyed while the card is open (it still shows the previous take).
- A spot-loop take shows no score card: a spot pass is clean by a stricter rule (every attack good, no wrong or extra notes) and never touches the ladder, so "90% counts as clean" would be false there (found in the 2a review).

### B3.3 Drawer

One `<dialog>`: a right-hand drawer on desktop, a bottom sheet on phones. It opens from ☰, the Today chip, the status chip and "Review take". Its sections are today's `<details>`, **all closed** on every open; the chip that opened it opens its section. Titles keep today's names because other strings point at them ("Sound & timing" in grade.ts:107, welcome.ts:21, PIECES.md).

Today's practice (plan, daily aim, week) · Your piece (map) · Course · **Piece & input** (piece select, Piano / Guitar, Microphone / Keyboard · MIDI, backing) · **Sound & timing** (the four status lines, goal tempo, output, volume, metronome, piano voice, Key feedback Lively / Calm, MIDI sound, note checks, calibration, offset, the honesty note) · About this piece (summary, "Hear the whole piece") · Add your own piece · Last take (player, previous / latest / loop, Download WAV, Note details, strip, verdict chips) · Your practice today (journal, finish, reset) · Keyboard shortcuts.

Interaction rules, because the page has global keys and live audio:
- ☰, the chips and ✎ are disabled while `active()`, like the 15 controls main.ts:761 already disables, so a sheet can never cover a live take.
- One `overlayOpen()` check (dialog open or popover open) at the top of the keydown handlers in main.ts (about 714–744) and keys.ts (about 64–68), and of the pointerdown handler: while it is true Space, ↑, ↓, ←, → and piano keys do nothing, and keyboard input is released. Esc keeps today's meaning, stop everything (main.ts:737), and also closes the dialog in the same press.
- Audio started from inside the drawer (Hear the whole piece, Calibrate, Hear take, Loop) closes it, so Stop is reachable on stage.
- The sheet scrolls inside itself (`overscroll-behavior: contain`); focus returns to a stable opener (the chips and ☰ are not rewritten by paint).

### B3.4 Where each existing element goes (every id is kept)

| Today | After |
|-------|-------|
| `nav.app-nav` (and what account code adds to it) | Stays, as the slim row 0 |
| `#piece-composer`, `#piece-title`, `#piece-summary` | Top bar (title, composer); summary → About this piece |
| `#piece-select`, `#inst-*`, `#input-*`, `#piece-backing` | Drawer › Piece & input; the status chip names the input |
| `#piece-mic`, `#piece-model`, `#piece-calibration`, `#piece-verified` | The status chip carries the worst state (including "too loud"); the four lines live in Drawer › Sound & timing |
| `#unit-stage`, `#unit-title`, `#unit-goal`, `#unit-why`, `#lane-help` | HUD passage, one-line caption, ⓘ About this step |
| `#piece-bpm`, `#piece-tempo-help`, `#piece-pips` | HUD readout, free-tempo popover, ladder and pips (rung buttons kept) |
| `#piece-phase`, `#piece-guidance` | Lane header row; help level becomes the pip captions |
| lane canvas, `#unit-text` (sr-only description), `#unit-shapes` | Lane (canvas parent stays a dedicated `position: relative` box); `#unit-text` stays beside it |
| `#piece-start`, `#piece-stop`, `#piece-demo`, `#piece-wait`, `#piece-place` | Action row (Stop takes Start's slot while `active()`) |
| `#piece-next` ("Next in today's plan") | Drawer › Today's practice, and on stage after a step finishes (certified, learned, placed) |
| `#piece-feedback` (coach) | Becomes the NOTICE slot (errors and non-take messages); take results move to NEXT TAKE, LAST TAKE and the card |
| `#piece-result`, `#piece-comfortable`, `#piece-struggling` | The result card, buttons in one parent |
| `#piece-choices`, `#piece-spot-banner`, `#piece-spot-hint` (injected by main.ts:529–531) | `#piece-choices` fills the action slot beside the card; the spot banner joins NOTICE and NEXT TAKE; the hint stays with the take details |
| `#piece-review` | Drawer › Last take, opened by "Review take" |
| `details#piece-today`, `#piece-map` (open today) | Drawer, closed |
| `details#piece-course`, `-about`, `-settings`, `-add`, `-journal` | Drawer, closed (seven `<details>` in all; the smoke opens six and not the map) |
| footer key hints | Drawer › Keyboard shortcuts; one line under Start on desktop |

### B3.5 Free tempo is a deliberate act

2b: `#piece-bpm` stays as the one input (the smoke script drives it) but moves into a popover opened by ✎: stepper, the line "Free tempo: takes here do not move the ladder", and a **Back to 33 BPM** button that clears `manualBpm`. While free tempo is on, the readout turns amber and says "free", the ladder dims, pips hide, and NEXT TAKE states the consequence with the same Back button. An out-of-range value says "Enter a tempo from 20 to 240" (today Start silently does nothing, main.ts:297). 2a: the box stays visible with the same "free" state and Back button. UI change, not a rule change (D2).

### B3.6 Visual language and accessibility

Keep the dark forest palette; make the HUD bolder. New tokens live in one block scoped to `.piece` in `src/piece/` CSS (today none exist; every colour is a literal hex). Shared `src/styles.css` and `src/trainer/styles.css` are not edited because the Trainer page uses them.

| Token | Value | Use |
|-------|-------|-----|
| bg / card / raised | #131715 / #19211c / #1f2a23 | page, HUD card, chips |
| line | #3a493c | decorative borders only |
| outline | #8fa486 | ahead segments, empty pips, 65% and 90% ticks (at least 3:1 on card; line is 1.7:1) |
| ink / muted | #e8e9df / #a4ada1 | text (muted on card 7.1:1) |
| lime / gold / amber | #c8d8a7 / #e1c48f / #e1ad88 | current and clean / goal and certification and NEXT TAKE label / hold, free tempo, uncalibrated, late |
| on-fill | #131715 | text on lime, gold and amber fills (ink on those fills is only 1.2–1.6:1) |
| hand-L | #8fb9d9 | left-hand notes |

Gold and amber are close (1.19:1 apart), so state is always carried by words or shape too. Type: Segoe UI stack, no web fonts. BPM readout 72–104 px/700 (72 px below 700 px of viewport height); passage 24–28 px/600; NEXT TAKE sentence 17–19 px; nothing under 12 px (today's help is 10 px); tap targets and hit areas at least 44 px. Primary button: static lime halo, nothing loops.

Motion: transitions 250 ms or less. Confirmed-result pops only: after the answer to a take the ladder counted as clean, a pip fills with a short scale pop and, on a climb, the current marker slides, in lively mode only (JS adds the class when `lively()` is true; CSS also drops animation under `prefers-reduced-motion`). Calm has no CSS hook today (it is a JS flag, main.ts:117), so pops are gated in JS. No pop for an unanswered, uncounted, free-tempo, spot or Wait-for-me take. The drawer slide drops under reduced motion.

Announcements: NEXT TAKE is `role="status" aria-atomic="true"`, written only through the existing `text()` helper (identical rewrites are skipped, main.ts:750–753) and not rewritten during a take; the phase chip is not live; the result card gets one status line written once ("Take finished: 92%. Answer with ↑ or ↓."); the count-up number is `aria-hidden`; the "too loud" state latches until the take ends.

### B3.7 NOTICE: where non-take messages go

Take results go to NEXT TAKE, LAST TAKE and the card. Everything else that today lands in the coach line or `audio.error` goes to NOTICE, in plain words with at most one action. Phase 2b audits every `feedback =` write (about 20) and routes each. Examples, not final copy:

| Source | Example | Action |
|--------|---------|--------|
| Microphone blocked or unavailable | "The microphone is blocked. Allow it in the address bar, or use Keyboard · MIDI." | Use keyboard |
| Microphone disconnected (audio.ts:122) | "The microphone disconnected. Start a new take." | none |
| Page hidden or take stopped early (main.ts:745) | "Paused: nothing was recorded. Start again." | none |
| Calibration result (calibration.ts:33) | the existing text, also kept in Drawer › Sound & timing | Try again on failure |
| Audio path or devices changed (main.ts:318, 706) | "The audio path changed. Recalibrate to count tempo steps." | Calibrate |
| Wait for me started or finished (main.ts:147, 153) | the existing text | none |
| Unanswered take dropped by picking a step or Calibrate (D6) | "That take was not answered, so it did not change your tempo step." | none |

### B3.8 How the copy is built

A pure module `src/piece/loop.ts` (no DOM) returns `{next, notice, last, card}` strings from the unit, its progress, the take result and the session flags. `nextTake`'s routing (placement, free tempo, ladder) is extracted into one pure function shared by `nextTake` and `loop.ts`, with a parity test, so the preview agrees with the real outcome on every branch, not only inside `advanceUnit`. One helper `floorPct(x) = Math.floor(x * 100 + 1e-9)` prints every take percentage so "90%" on screen means 90.0% or better. Copy already right in `progress.ts` messages is reused; the rung-0 line and the 20 BPM floor line are written in the new module so `progress.ts` messages stay as they are. Table-driven tests pin every row of A3.

## B4. Phase 2 plan (after approval)

**Phase 2a: make the loop legible.** Low risk: no `<dialog>`, no rerouting of `feedback`, no edits under `scripts/`, and `scripts/piece-smoke.mjs` passes unmodified.
- `src/piece/loop.ts`, the shared routing function and `floorPct`, with `tests/piece-loop.test.ts`; R1 in `parsePieceProgress` with tests (if approved).
- In the existing lesson card: the big BPM readout (the existing `#piece-bpm` restyled, with a "free" state and a Back button), the ladder and pips at the new sizes with rung buttons kept, NEXT TAKE and LAST TAKE as new elements, the result card with the combined score and the consequence lines under the comfort buttons.
- `details#piece-today` and `#piece-map` lose `open`; the piece select, Piano / Guitar, Microphone / Keyboard · MIDI and the status line move into one closed `<details>` in normal flow; CSS shrinks the account welcome card under `.piece`.
- Run the other scripts that open `/piece.html` (`piano-realtime-check.mjs`, `piano-voice-check.mjs`) when practical, because the folded controls change what a real mouse click can reach.

**Phase 2b: restructure the stage.** The `<dialog>` drawer, the top bar and chips, the ✎ popover, NOTICE routing of `feedback` and `audio.error`, `overlayOpen()` guards in main.ts and `keys.ts`, the phone sticky block and lane heights, and the script edits: `piece-smoke.mjs` line 97 reads "Free tempo" from `#piece-feedback` and line 140 opens the details inside a closed dialog and would pass vacuously (open the drawer and assert `dialog.scrollWidth <= clientWidth`); `piano-realtime-check.mjs` clicks with real mouse events at element centres (`#piece-listen` is in the drawer, `#piece-stop` only shows while active), so open the drawer first; `piano-voice-check.mjs` reads `#piece-feedback`. `accounts-smoke.mjs` and `trainer-smoke.mjs` are unaffected.

**Both**: new copy tests; PIECES.md ladder and layout text; `npm test` (39 files today) plus new ones; `npm run build`; the piece smoke (`npm run build`, `npx vite preview --port <port> --strictPort --host 127.0.0.1`, then `SMOKE_ORIGIN=http://127.0.0.1:<port> node scripts/piece-smoke.mjs`, server stopped in the same command). Impact checks per D8 for each symbol touched (`pieceShell`, `paintPips`, `paint`, `nextTake`, `answer`, `start`, `selectUnit`, `parsePieceProgress`, `drawKeys` heights). Manual checks for Robert: no sideways scroll at 390 px; HUD readable at 390 px; panels start closed; a clean take previews the next tempo; a free-tempo edit is obvious; an uncalibrated mic take says tempo will not move; Calm and reduced motion stay quiet; and in 2b: Space, ↑ and ↓ do nothing while the drawer is open, Esc still stops a take, and the sticky bar clears the account banner.

**Phase 3**: Robert starts the local preview himself with the command and `127.0.0.1` URL I give him, or one command starts it, checks it and stops it. No push of any branch, no merge, no Pages run.

## B5. Review log

- Round 1: three independent Sonnet reviewers (code accuracy, contracts and tone, learner legibility) returned 41 findings, none blocking. Applied: the "message vanishes" claim, the review path, the one-hand sentence, the placement default and rung buttons, the offer and spot choices, NOTICE, covered and listening steps, untrusted and timing-only scores, the modal drawer versus global keys and Esc, the account nav row, scripts that read the page, tone, contrast and sizes, lane heights. **Declined**: a session-finished summary on stage (it stays in the journal section), an unverified-notes badge on stage (it stays in Sound & timing and the status chip), a single "Next take" button for uncountable takes (two buttons keep the comfort contract and Space default unchanged; the line under them says the tempo step stays as it is, because a trouble-spot offer can follow instead of the next take), advice text at the slowest step (no new pedagogy; the facts are stated instead), and a Go-to button for goal tempo on the chip.
- Round 2 (Fable, spec lock): conditional sign-off with four required changes, all applied in this version: the rung-0 "stays" line (the worked example said a second needs-more-room take would make room, which is false at 33 BPM), phone acceptance targets measured from the frame with a sticky NEXT TAKE block and viewport-relative lane height, the 2a / 2b split, and the GitNexus decision (D8). Also applied: help-level arithmetic for "certified before", the "two clean takes needed again" note when one clean take is lost, a review step-down chip, dropping the free-tempo calibration add-on, dropping a 350 ms Stop guard (Stop always works), collapsing the phone lane only after the reveal sweep, checking the offer's real conditions (spot.ts:32–46, 69–70), and this split into Part A and Part B.
- Mockup check, by a sweep I wrote independently of the worker (13 states at 390×844, 390×664 and 1280×800, controls strip hidden so every number is frame-relative): no sideways scroll anywhere, no exceptions, no external requests, no text under 12 px, every drawer opener opens with its sections closed (a chip opens only its own section), and no animation runs in Calm or with reduced motion. Targets: 390×844 passes in all 13 states (lane top 321 at most, no overlap, no page scroll). 390×664: the sticky block is visible in every state and the lane shows at least 111 px (152 px in ready); with a result card open the 350 px sticky block covers the 160 px lane, which the table above now allows. 1280×800: the lane is 357 px in ready, 287 px with NOTICE and 256 px with a result card, which the relaxed 250 px floor allows. The first mockup pass missed these because it measured from the page top with the strip showing.
- Round 3 (stage 2a, built): two independent Sonnet reviews of the code, one for logic against the engine and one for view, accessibility and compatibility, returned 23 findings and no blockers. Applied: the "Not counted" lines now say the tempo step stays as it is (a trouble-spot offer can follow the answer, so "either answer starts the next take" was false); the answer prompt yields to Wait for me; the placement wording shows only while a placement take plays; step-down lines use clamped rungs and the 20 BPM floor; the one-hand sentence in About this step; no regex lookbehind; the ladder pop never plays in a microphone take; spot takes show no ladder score card; the Course paragraph says "in a row"; answer buttons point at their consequence lines; focus stays on the HUD buttons; a status line per take; the welcome-card clamp; contrast; 44 px ladder targets (the ladder wraps to four columns at 383 px and below). Not done: renaming the duplicate `TakeFacts` type. Left for 2b by design: on a phone the lane still starts below the first screen (y 760 at 390×844) and Start keeps its old size.
