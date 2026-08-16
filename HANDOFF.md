# HANDOFF — resume point, 2026-08-16

> Transient working state, not plugin content. **Delete this file when the arc below completes.**

## Do this first

Claude Code has been restarted so the `sdlc2-*` agents resolve. Confirm, then run the first
feature through the graph:

```bash
cd ~/dev/code/sdlc2-lab
```
```
/sdlc2 new-feature "greet the visitor by name"
```

The seed already exists, so it will **not** grill you — it goes straight to the config check,
the baseline, and then the graph. Expect `po → architect ∥ ux → build → report`, roughly 11
agent calls if everything passes first time, ~45 worst case.

**Before spending the run**, confirm the personas resolve. Neither `sdlc2-product-owner` nor
`sdlc2:sdlc2-product-owner` resolved before the restart; the cheap probe is a one-agent workflow
calling `agent(..., { agentType: 'sdlc2-product-owner' })` and seeing whether it throws. Set
`agentPrefix` in the workflow args to `""` for the bare form or `"sdlc2:"` for the namespaced one.

**If they still do not resolve, stop.** Do not drop the `sdlc2-` prefix. See "The trap" below.

## Where we are

| Step | What | State |
|---|---|---|
| 1 | Build the minimal lab | **done** — `~/dev/code/sdlc2-lab`, green, committed |
| 2 | Run one thin feature through the graph as-is | **next** — blocked only by the restart |
| 3 | Fix what step 2 reveals, **plus Part 0** | not started |
| 4 | Re-run the lab, incl. a 2–3 slice feature to exercise stacking | not started |
| 5 | The real project (TypeScript + Spring Boot + Maven) | not started — `SETUP.md` covers it |

The order is deliberate: Part 0 fixes problems predicted by *reading*. `SPEC.md` §12 says the
likeliest real failure is an agent misreading a prompt contract, which only running finds. Every
bug in this project so far was found by running something — the review's stub probes, and
`install.sh`'s three on first execution.

## Part 0 — scoped, not built

1. **Stack dependent slice branches.** `developerPrompt` cuts every branch off `BASE`, so a slice
   with `Blocked by:` does not contain its blocker's code. Record each shipped slice's branch;
   base a dependent slice on its blocker. **`reviewerPrompt` needs the same base** or it replays
   the blocker's diff into the dependent's review. Amend `R-BUILD-04`.
2. **Report node commits the paperwork** to `sdlc2/<feature>` — `.sdlc2/` and `docs/adr/`. `main`
   never moves. Removes the clean-tree friction on the next run and makes the human-verify record
   durable. New `R-REP-03`.
3. **Close the `skills/` independence hole.** `skills/outside-in-tdd/SKILL.md` points at `/tdd`
   (4×) and `/improve-codebase-architecture` (3×), neither bundled. `verify.mjs`'s stray-skill
   check walks `agentFiles` only — extend it to `skills/*/*.md`. Same class as H13.

~60–80 lines of engine change, three spec edits, one skill rewrite, ~8 new checks.

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

- **`~/dev/code/sdlc2`** — plugin. `main` at `b96f61c` + this handoff commit. `node verify.mjs`
  passes 205 checks. sdlc2 v0.1.1 installed at user scope.
- **`~/dev/code/sdlc2-lab`** — lab. `main`, clean, two commits, baseline green in ~600ms.
  React + TS + Vitest + RTL. Seed at `.sdlc2/features/greet-visitor/feature.md`.

## What to watch in the first run

Predictions worth checking against reality:

- **Round counts.** Sonnet makers vs opus/`xhigh` checkers. `SPEC.md` §12 risk 5: a node
  persistently at 4–5 rounds means its maker is under-powered.
- **Whether the doc nodes converge or thrash.** A soft-pass on the first run is information, not
  failure.
- **Whether the developer respects the git isolation invariant** — the one instruction with no
  automated enforcement behind it.
- **`hasUiStories`.** The feature plainly has a screen; if the `po` sets it false, the `ux` node is
  skipped with a single log line and `R-PO-04` is violated in the least visible way possible.
- **Artifact clean-up.** Until Part 0 item 2 lands, `.sdlc2/` is left uncommitted and the *next*
  run is blocked by the clean-tree gate. Commit or delete it after the run.
