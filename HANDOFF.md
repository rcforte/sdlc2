# HANDOFF — resume point, 2026-08-21

> Transient working state, not plugin content. **Delete this file when the arc below completes.**

## Do this first

**Step 4: re-run the lab against the fixed harness.** Start Claude Code in
`~/dev/code/sdlc2-lab` — not in this repo, and not with `/add-dir`. sdlc2 has no `repoRoot`, so
the graph builds in whatever repo the *session* is rooted in (pre-check 1, `SPEC.md` §12 risk 6).

The lab is ready: `main` carries run 1's four slices, its artifacts and the 14 resolved VH
records; the suite is green (31 tests, 4 files); the tree is clean and the `slice/*` branches are
deleted. `agentPrefix: "sdlc2:"`.

Run a **2–3 slice feature with a real `Blocked by:` chain** — that is what exercises the branch
stacking that run 1 got wrong and that `[R-BUILD-04a]` now asserts. Then check, in this order:

1. Did the tester actually run the `git merge-base --is-ancestor` assertions? They are the whole
   enforcement; if the tester skips them, the invariant is back to being a wish.
2. Was the blocked slice cut from its blocker, and the independent one from `main`?
3. Did the report node commit the paperwork to `sdlc2/<feature>`, leaving a clean tree?
4. Do the per-round score histories climb, flatline, or oscillate? Two more runs of that decides
   whether the doc-node makers are under-powered — see `SPEC.md` §12 risk 5.

One lab hygiene item first: `tsconfig.tsbuildinfo` is **tracked** in the lab, and `npm run build`
rewrites it. That dirties the tree and will either block the clean-tree gate or get swept into a
slice commit. `git rm --cached tsconfig.tsbuildinfo` and add it to `.gitignore` before running.

## Where we are

| Step | What | State |
|---|---|---|
| 1 | Build the minimal lab | **done** — `~/dev/code/sdlc2-lab`, green, committed |
| 2 | Run one thin feature through the graph as-is | **done** — run `nf-20260816T0246Z`, 4 slices, 2 soft-passes, 14 VH records, all resolved and merged to lab `main` |
| 3 | Fix what step 2 reveals, **plus Part 0** | **done** — v0.1.2, all three Part 0 items + the two defects run 1 exposed; 220 checks green |
| 4 | Re-run the lab, incl. a 2–3 slice feature to exercise stacking | **next** |
| 5 | The real project (TypeScript + Spring Boot + Maven) | not started — `SETUP.md` covers it |

The order held up. Running first was right: reading predicted three fixes and run 1 produced two
more that reading had missed for months — one of them on the first step of three personas. Every
bug in this project has now been found by executing something, without exception.

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

- **`~/dev/code/sdlc2`** — plugin. `main` at `40cc056` + **uncommitted** v0.1.2 work: the engine
  (`baseFor`, tester base assertions, reviewer base, round history, `[R-REP-03]`), both skill
  rewrites, `SPEC.md`, `modes/new-feature.md`, `verify.mjs` (+15 checks, P14), `VERSION` and
  `plugin.json` at `0.1.2`. `node verify.mjs` passes **220 checks**.
- **Installed vs local.** v0.1.1 is what is installed, from the GitHub marketplace clone at
  `b96f61c`. **The lab run will use v0.1.1 until v0.1.2 is pushed and updated** — none of the
  fixes above are live yet. Push, then `claude plugin update sdlc2@sdlc2-marketplace`, then
  restart, and re-probe resolution before spending the run.
- **`~/dev/code/sdlc2-lab`** — lab. `main` at `4169a34`, clean, 6 commits, suite green (31 tests,
  4 files, ~1.9s). Run 1's slice branches deleted; `vh-resolutions/greet-visitor` is now identical
  to `main` and can be deleted whenever.

## What to watch in run 2

- **Whether the tester actually runs the base assertions.** Everything else here rests on it.
- **Round counts and the new score histories.** Climbing vs flat is the whole question; see
  `SPEC.md` §12 risk 5.
- **Whether the report node's git steps work** — it is `sonnet`/`medium` doing branch surgery, and
  its failure mode is meant to be a `## Paperwork not committed` section, never a lost artifact.
- **`hasUiStories`.** If the `po` sets it false on a feature with a screen, `ux` is skipped with a
  single log line and `R-PO-04` is violated in the least visible way possible. Still unenforced.
