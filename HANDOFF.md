# HANDOFF — resume point, 2026-08-23

> Transient working state, not plugin content. **Delete this file when the arc below completes.**

## Do this first

**Step 6: run 3 — the acceptance test for v0.1.4.** v0.1.4 is **written and green** (289 checks,
was 262) but **has never run against real agents** — the same trap as run 1, v0.1.2 and v0.1.3,
three for three. Before run 3 exercises any of it: `git push`, then
`claude plugin marketplace update sdlc2-marketplace`, then
`claude plugin update sdlc2@sdlc2-marketplace`, then **restart** — a session pins its plugin root
at start (SD-03), so an update without a restart changes nothing.

What v0.1.4 changed, and what run 3 has to confirm about each:

| id | fix | what run 3 must show |
|---|---|---|
| **SD-04** | Worktrees moved **outside** the repo — `../.sdlc2-worktrees/<feature>-<runId>/<slice>`, `[R-BUILD-07a]` | Lanes still start concurrently; the declared test command reports the project's OWN file count, not N+1; `git worktree list` shows only the main checkout at the end; the empty container is `rmdir`ed |
| **SD-05** | Every spawn goes through `spawn()`, which retries a no-answer **once, free**, before a round is charged; the round is recorded `errored`, not `rejected`, and the defect is a *harness* defect. `[R-LOOP-11]` | A transport failure no longer costs a node its pass. The tell in the history is a round marked `errored` — and if one appears, check the node still had its full round budget for content |
| **SD-07** | `issues/` is the single source of truth for the queue: the architect mandate, the persona, `design.md`'s output note and the new **`AR-QUEUE`** rubric criterion all say so. `[R-ARCH-03]` | `design.md` asserts no `Blocked by:` edge absent from `issues/`. If the architect disagrees with the queue it must show up as a defect against the `po` node, not as an edge downstream |

Still NOT done, and still the cheapest fix outstanding:

- **SD-03** — the run report still does not name the engine it ran. No `pluginRoot`, no `VERSION`,
  verified by grep against run 2's report. This is the finding that cost ~6.3M tokens of runs
  measuring a superseded engine. One line in `[R-REP-01]`.


SD-06 (a background workflow makes no progress while the session sits idle — 3h 01m of dead time
inside a 4h 41m run) is a **harness** issue, not sdlc2's. Nothing to fix here; it does mean any
wall-clock number from run 2 is meaningless, and that a graph run should not be left unattended.

**Run 3 needs a seed of its own.** `saved-name` is spent, and its diamond has already made its
point. What v0.1.4 has not been given a shape to test: the **veto-round question** (still no data
after two runs), the **plateau exit** (never fired), and `hasUiStories` (still unenforced). None of
those need a diamond — they need a doc node that struggles, which is not something a seed can order
up. Reuse the diamond recipe under *What run 2 settled* anyway: it is what makes lanes do anything,
and lanes are what SD-04 changed.

## What run 2 settled

The run was worth paying for. **`[R-BUILD-04a]` is confirmed working against real agents for the
first time**, and it took three attempts to get a seed that could test it.

The `po` cut a genuine **diamond** — better than the fork the seed was engineered for:

```
        01 save the greeted name          (Blocked by: none,  cut from main)
       / |  \
     02  03   04                          (all three Blocked by: 01, all cut from 01)
       \ /
        05 fresh visit clears it          (Blocked by: 02 AND 03 — engine merged 02 into 05)
```

Independently re-verified here from the report's SHAs, resolving every ref first (SD-01's trap —
`--is-ancestor` exits non-zero on an unknown ref, which is indistinguishable from a true
negative). Full 5×5 matrix:

- **Every declared edge holds.** 01 ⊂ {02,03,04,05}; 02 ⊂ 05; 03 ⊂ 05.
- **Every negative holds.** 02 ⊄ 03, 03 ⊄ 02, 02 ⊄ 04, 04 ⊄ anything.

`git merge-base --is-ancestor <02> <03>` **fails**, as required. That is the assertion run 1 could
not make (four independent slices, every stacking vacuously consistent) and the 0327Z run could
not make (a pure chain). Third attempt, finally falsifiable, and it passed.

Also confirmed working, per the lab's findings file:

- **Tester base assertions** — all 7 tester invocations actually executed `git merge-base
  --is-ancestor`. The invariant is enforced, not merely instructed.
- **`[R-REP-03]`** (SD-02's fix) — paperwork committed to `sdlc2/saved-name`, clean tree. The
  reflog shows the branch was created, committed to, and merged by the human. Run 1 committed
  nothing; the 0327Z run committed all but the report; run 2 committed everything.
- **Parallel lanes** — three developers started at the identical second (23:02:48) in three
  worktrees, and all worktrees were released at the end with every `slice/*` branch intact.
  *(The diamond is what gave lanes something to parallelise — a chain serialises trivially.)*
- **`DOC_ROUNDS = 2`** — `po` passed unaided (0.72 → 0.88) and `architect` passed unaided
  (round-1 rejection → 0.87), neither arbitrated. Run 1's "all three doc nodes burn all five
  rounds and arbitrate anyway" is gone. Both still spend both rounds, though.
- **`R-IND-02`** — all 32 persona spawns were `sdlc2:sdlc2-*`. A discriminating probe ran
  *before* any spending, on four markers the global lookalike could not fabricate.

### Still unanswered after two real runs

- **The veto-round question** (`sdlc2-enhance-1.md` §1.1) — is there a round with `score ≥ bar`
  and no pass? Run 2 produced **no such round**: `po` 0.72 and `ux` 0.79 were both *below* bar,
  and the two rejected rounds carried no score at all. No data either way. Needs another run.
- **The plateau exit** — did not visibly fire; all three doc nodes used exactly their 2 rounds.
- **`hasUiStories`** — set correctly here, but still unenforced. A `po` that sets it false on a
  feature with a screen still skips `ux` with one log line.

## Where we are

| Step | What | State |
|---|---|---|
| 1 | Build the minimal lab | **done** — `~/dev/code/sdlc2-lab`, green, committed |
| 2 | Run one thin feature through the graph as-is | **done** — `nf-20260816T0246Z`, 4 slices; later shown to have executed **0.1.1** (SD-03) |
| 3 | Fix what step 2 reveals, plus Part 0 | **done** — v0.1.2, 220 checks green |
| 3b | *(unplanned)* `greeting-log` run + v0.1.3 | **done** — `nf-20260822T0327Z`; revealed SD-03, prompted `sdlc2-enhance-1.md` → v0.1.3. Seed cut a pure chain, so it could not test the fix |
| 4 | **Run 2 proper: 0.1.3, lab session, diamond seed** | **done** — `nf-20260822T2305Z` (`saved-name`), 5 slices, 1 soft-pass, 6 VH records resolved and merged to lab `main`. `[R-BUILD-04a]` confirmed |
| 5 | **v0.1.4 — fix SD-04, SD-05, SD-07** | **done** — all three fixed, 289 checks green (was 262). SD-03's version line is NOT done |
| 6 | **Run 3 — the acceptance test for v0.1.4** | **next**, and it must be pushed + `claude plugin update`d + a session restart FIRST |
| 7 | The real project (TypeScript + Spring Boot + Maven) | not started — `SETUP.md` covers it |

The order held up, and the pattern is now four for four: **every bug in this project has been
found by executing something.** Run 2 adds four more that no amount of reading found — including
SD-04, where the feature that had never executed (parallel lanes, new in 0.1.3) broke the tester's
own ground truth the first time it ran.

## What run 1 found, and what v0.1.2 does about it

Run 1 is the evidence base. The graph logic was never the risk — no node crashed, the `ux` gate
fired correctly, `build` passed 4/4 slices on the first attempt at 0.85–0.86. Both real failures
were **an agent quietly not doing what a prompt said**, which is exactly what `SPEC.md` §12
predicted and exactly what no amount of reading finds.

1. **The developer stacked four independent slices.** `developerPrompt` said "off `main`"; the
   branches came out `02 ⊃ 01`, `03 ⊃ 02`, `04 ⊃ 03`. The reviewer then diffed slice 04 against
   `main` — three earlier slices' code included — and scored it 0.86 without noticing. *Fixed:*
   `baseFor()` gives a blocked slice its blocker's branch and an independent one `BASE`; the
   reviewer diffs against that same base; and the **tester now proves it** with
   `git merge-base --is-ancestor`, because an instruction with no executable assertion behind it
   is not an invariant. New `[R-BUILD-04a]`, probe P14 (10 assertions).
2. **`skills/grill-with-docs/SKILL.md` sent three personas to the host.** Its entire body was
   "Run a `/grilling` session, using the `/domain-modeling` skill" — both resolve to globally
   installed skills of those names, and this file is the FIRST thing `po`, `architect` and
   `ux-design` read. `skills/outside-in-tdd/SKILL.md` had the same problem with `/tdd` (4×) and
   `/improve-codebase-architecture` (3×). 205 green checks never looked inside `skills/`.
   *Fixed:* both rewritten; `verify.mjs` now walks `skills/*/*.md` for slash-commands, stray
   skill names and unrooted references — three new checks.
3. **The artifacts were left uncommitted** and a human hand-committed them (`506553e`).
   *Fixed:* `[R-REP-03]` — the report node commits `.sdlc2/` and `docs/adr/` to `sdlc2/<feature>`
   off the default branch, never resetting an existing one, and never stashing/cleaning if a git
   step fails.
4. **All three doc nodes burned all 5 rounds** (`po` 0.84 and `architect` 0.77 arbitrated, `ux`
   0.82 clean). *Deliberately NOT fixed:* one run cannot distinguish an under-powered maker from
   an adversarial panel working correctly, and the two want opposite fixes. The report now prints
   the **per-round score history** so runs 2 and 3 can answer it with data. Models unchanged.

Also fixed while in there: the "engine never merges" grep matched `git merge-base` (read-only
plumbing) and had to be taught the difference; the report node's effort went `low` → `medium`
now that it does branch surgery.

**Still open from run 1, in the lab, not the harness:** VH-07(c) and VH-10 — the latter needs a
real screen reader.

## The trap — read before touching agent resolution

Measured on this machine: the host offers `architect`, `architect-critic`, `code-reviewer`,
`developer`, `product-owner`, `product-owner-critic`, `tester`, `ux-auditor`, `ux-design` — a
global lookalike for **every one** of sdlc2's nine personas.

Dropping the `sdlc2-` prefix to make resolution "work" produces a complete, plausible, entirely
non-sdlc2 run: every artifact written, every verdict returned, and none of sdlc2's personas,
rubrics or output contracts involved. `R-IND-02` exists for this. Pre-check 7 says **stop**.

Two things already hold the line: pre-check 7 refuses to guess, and `agent()` *throws* on an
unknown type, so `[R-LOOP-08]` turns it into a critical defect rather than a false pass.

## Decisions from the grilling

- **sdlc2 cannot create a project.** Pre-check 5 needs a green `commands.test`. A walking skeleton
  with one real end-to-end slice comes first, by hand — not a bare scaffold, because `AR-SEAM`,
  `AR-FIT` and `CR-IDIOM` all score against conventions that must already exist.
- **One `commands.test` running every suite.** Whatever it does not run, sdlc2 does not verify.
  For the real project: `./mvnw -q verify && npm --prefix frontend test -- --run`. No nested
  `CLAUDE.md` blocks — a full-stack slice labelled `Dir: backend/` would ship its React half
  unverified.
- **Cucumber `@api` / `@ui` tag split** for the real project. One `.feature` per slice holding the
  issue's Gherkin verbatim; `@api` steps drive MockMvc, `@ui` steps drive Playwright against
  `@SpringBootTest(RANDOM_PORT)`. Two runners, because Cucumber-Spring allows one
  `@CucumberContextConfiguration` per glue path — which is exactly what keeps backend-only slices
  off the browser. Orchestration inside Maven, never in the shell string.
- **The lab is a sibling repo, not a subfolder.** sdlc2 is repo-scoped: clean-tree gate, default
  branch, `slice/*` namespace and `.sdlc2/` all belong to whichever repo it runs in. A subfolder
  would mean committing a harness change before being able to test it — backwards. (`source: "./"`
  also ships the whole repo to every user, but that was the weaker objection.)
- **Lab is React-only on purpose.** It exercises the *graph*; every harness bug so far has been
  graph-level. React earns its place only so the first feature can have a UI story and the `ux`
  node actually runs.
- **First feature is one thin slice.** This run is the harness's acceptance test; fail cheap.

## Repo states

- **`~/dev/code/sdlc2`** — plugin. **v0.1.3** implements every item in `sdlc2-enhance-1.md`:
  doc rounds 5→2 with a plateau exit, thresholds 0.80, the repair brief now carries the checker's
  per-criterion scores (a round that failed on score alone used to tell a round-3 maker it was its
  "first attempt"), the build arbiter can no longer commit, cross-round checker memory, severity
  anchors, four personas released from an interview they cannot run, parallel slice lanes in git
  worktrees gated on a new `commands.install`, namespaced VH ids, per-slice UX join, and a
  continuous executor in place of the wave barrier. `node verify.mjs` passes **262 checks**
  (was 220), including six new behavioural probes.

  **Run 2 was the acceptance test for these changes, and they largely held** — see *What run 2
  settled*. `[R-BUILD-04a]`, `[R-REP-03]`, the tester's base assertions, `DOC_ROUNDS = 2` and the
  parallel lanes all executed against real agents. The lanes brought SD-04 with them.

  **v0.1.4** (2026-08-23) fixes SD-04, SD-05 and SD-07: worktrees outside the repo
  (`[R-BUILD-07a]`), one `spawn()` wrapper that retries a no-answer free before charging a round
  (`[R-LOOP-11]`), and `issues/` as the queue's single source of truth (`[R-ARCH-03]`, `AR-QUEUE`).
  `node verify.mjs` passes **289 checks**, including 21 new ones across three probes. **None of it
  has run against real agents.**

  **STALE AS OF v0.1.4 — installed is 0.1.3, local is 0.1.4.** Push, update, restart before run 3.
  The v0.1.3 parity note, for method: `installed_plugins.json` records
  `version: "0.1.3"` at `gitCommitSha: a0dc296`. Repo HEAD is now `8f85245` — **one docs-only
  commit ahead**, touching `HANDOFF.md` and nothing else, so a recursive diff of the repo against
  the install cache reports exactly two differences: this file, and the harness's own `.in_use`
  marker. **Every executable path — `new-feature.workflow.js`, `modes/`, `skills/`, `agents/`,
  `VERSION` — is identical.** Do not read that one-file delta as version skew; re-check it the
  same way rather than assuming, and expect it to disappear the next time the marketplace clone
  updates. Resolve `${CLAUDE_PLUGIN_ROOT}` at runtime rather than hardcoding it —
  `[R-PKG-03]` forbids the literal path, and 0.1.1 and 0.1.2 are still cached as siblings, so the
  parent dir is not the answer. **Parity is not resolution**: the files matching says nothing
  about which persona answers to `sdlc2:sdlc2-po`, so still probe that from the lab session before
  spending the run. And per SD-03, parity at *install* time is not parity at *run* time — a
  session pins its plugin root at start, so the lab session must be launched **after** the
  update, not merely on a machine where the update happened.

  The v0.1.2 line, for history —
  the engine (`baseFor`, tester base assertions, reviewer base, round history, `[R-REP-03]`),
  both skill rewrites, `SPEC.md`, `modes/new-feature.md`, `verify.mjs` (+15 checks, P14).
  `node verify.mjs` passes **220 checks**.
- *(The 2026-08-21 "installed is 0.1.2, push before run 2" item is **done** — see the parity
  paragraph above.)*
  **Parity is not resolution** — the files matching says nothing about which persona answers to
  `sdlc2:sdlc2-po`, so still probe that from the lab session before spending the run.
- **`~/dev/code/sdlc2-lab`** — lab. `main` at `40cbfc0`, clean, suite green (**61 tests, 4 files,
  2.92s** — re-run 2026-08-23). Carries **run 2 merged**: `saved-name`'s five slices, its
  artifacts, and the six VH records resolved (`40cbfc0`); the `slice/saved-name/*` branches are
  deleted, so **resolve the report's SHAs before asserting anything about them** — SD-01's trap.
  Also carries `docs/harness-findings.md`, now **SD-01 … SD-07** plus a *confirmed working*
  section, which is the authoritative record of both runs. The three unmerged
  `slice/greeting-log/*` branches stay as SD-01's reproduction evidence.
  `vite.config.ts` now excludes `.sdlc2/worktrees/**` and `.claude/worktrees/**` — that is the
  lab-side half of SD-04, and it is a workaround, not the fix. Run 1's slice branches deleted; `vh-resolutions/greet-visitor` is now identical
  to `main` and can be deleted whenever. `tsconfig.tsbuildinfo` is untracked and gitignored, and
  `npm run build` was re-run to confirm it leaves the tree clean. **Now also** ignores
  `.sdlc2/worktrees/` and `.claude/worktrees/` — measured: one isolated agent takes the tree from
  clean to `?? .claude/`, which fails sdlc2's own pre-check 1 — and declares
  `install: "npm ci"`, which is what opens the parallel lanes.

## What run 2 answered, and what run 3 must watch

Run 2's checklist is resolved above under **What run 2 settled**. Carried forward for run 3:

- **The veto-round question and the plateau exit** — neither produced data. Run 3 is the third
  attempt at §1.1 of `sdlc2-enhance-1.md`.
- **`hasUiStories`.** If the `po` sets it false on a feature with a screen, `ux` is skipped with a
  single log line and `R-PO-04` is violated in the least visible way possible. Still unenforced,
  two runs later.
- **Whether SD-04's fix holds.** If worktrees move outside the repo, re-check that lanes still
  start concurrently and that worktrees are still released.
- **Whether a transport error still costs a node its pass** (SD-05). The tell is a round with no
  score in the history; after the fix it should read `errored` and not consume the budget.
- **Do not leave the run unattended** (SD-06), and treat any wall-clock figure as suspect unless
  agent time is stamped separately from elapsed time.
