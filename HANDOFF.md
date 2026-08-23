# HANDOFF — resume point, 2026-08-23

> Transient working state, not plugin content. **Delete this file when the arc below completes.**

## Do this first

**Step 5: v0.1.4 — fix what run 2 found.** Run 2 is **done**: `saved-name`,
run `nf-20260822T2305Z`, five slices, executed against **0.1.3** in a lab session. The findings
are filed in the lab at `~/dev/code/sdlc2-lab/docs/harness-findings.md` (SD-01 … SD-07). Three of
them are sdlc2 defects and belong here, plus one carried-over recommendation:

| id | severity | what to change here |
|---|---|---|
| **SD-04** | high | Parallel lanes break the declared test command. Worktrees live **inside** the repo (`.sdlc2/worktrees/`), each with its own `node_modules`, so the project's own test runner collects them: measured **16 files / 98 failures**, every one `Invalid hook call` from a second React copy. Gitignoring them was only half the fix. **Preferred: move worktrees outside the repo** (sibling temp dir) and the whole class disappears. Otherwise `SETUP.md` + pre-check 4 must require a runner-level exclusion (`test.exclude` / `testPathIgnorePatterns` / `norecursedirs`), and the lane setup should verify the baseline suite passes *inside* a worktree before handing slices to it. |
| **SD-05** | medium | A **transport failure is scored as a content defect**. `[ux:make (2/2)] failed: API Error: Connection lost mid-response` reached the checker as an empty artifact; it recorded "maker agent returned nothing" as critical, the round budget was spent, and the node soft-passed at 0.79 with two VH records. The engine can tell the difference — a thrown API error, not a returned-empty result — so **retry at the transport layer before charging a round**, and mark such a round `errored`, distinct from `rejected`, so the score history stays readable. |
| **SD-07** | medium | The **architect can declare a dependency edge that contradicts the `po`'s issues, silently.** It judged slice 04 to need slice 02 and wrote that into `design.md`/ADR-0025 instead of amending the issue. `baseFor()` reads `issues/`, so the engine ignored it — **had it not, this run's diamond would have collapsed into a chain**, reproducing SD-01's symptom through a different door. Make `issues/` the single source of truth and say so in the architect's prompt; cheapest guard is to assert after the design node that every `Blocked by:` edge in `design.md` exists in `issues/`. |
| **SD-03** | — | Still unimplemented: **the run report does not name the engine it ran.** Verified by grep against run 2's report — no `pluginRoot`, no `VERSION`. This is the finding that cost ~6.3M tokens of runs 1 and the 0327Z run measuring a superseded engine. Cheapest high-value change left. |

SD-06 (a background workflow makes no progress while the session sits idle — 3h 01m of dead time
inside a 4h 41m run) is a **harness** issue, not sdlc2's. Nothing to fix here; it does mean any
wall-clock number from run 2 is meaningless, and that a graph run should not be left unattended.

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
| 5 | **v0.1.4 — fix SD-04, SD-05, SD-07 + print the engine version** | **next** |
| 6 | The real project (TypeScript + Spring Boot + Maven) | not started — `SETUP.md` covers it |

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

  **Installed = local, verified 2026-08-22 22:35 UTC.** `installed_plugins.json` records
  `version: "0.1.3"` at `gitCommitSha: a0dc296`, which is this repo's HEAD with a clean tree, and
  a recursive diff of the repo against the install cache is identical apart from the harness's own
  `.in_use` marker. Resolve `${CLAUDE_PLUGIN_ROOT}` at runtime rather than hardcoding it —
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
