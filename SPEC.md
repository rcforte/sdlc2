# SPEC — sdlc2, the feature graph

> **Status:** v0.1.0 implemented, **never executed**. Every file exists and is structurally
> verified; no feature has been run through it yet. The first real run is the acceptance test.
> **Authority:** this file is the contract. Where the code and this spec disagree, one of them is
> a bug — say which before changing either.

sdlc2 is a **graph** of **loops**, packaged as a Claude Code plugin.

- The **workflow** is a graph: nodes and edges are data (`NODES` in `new-feature.workflow.js`);
  one generic executor walks them. Adding a node is a row here and a row there — never a
  control-flow edit.
- Each **node** is a loop: a **maker** persona produces artifacts, **adversarial checkers** score
  them against a rubric, and the maker gets up to **5 rounds** to answer them. If the bar is still
  unmet, an **arbiter** makes the best available call, documents it, and the graph continues.
- Humans appear exactly twice: the **grilling** that produces the seed, and the **merge**.
  Nothing in between pauses.

```
HUMAN grilling ─▶ po ─┬─▶ architect ─┐
                      └─▶ ux ────────┴─▶ build (slice₁ → slice₂ → …) ─▶ report ─▶ HUMAN merge
                          ▲ when po.hasUiStories        ▲ sequential, one branch each
```

## 1. Independence (the founding constraint)

sdlc2 shares **nothing** at runtime with any other harness.

- `[R-IND-01]` **MUST**: no file in this repo references a path, skill, agent or artifact of
  another harness. Verified by grep, not by intent.
- `[R-IND-02]` **MUST**: personas live in `agents/` under `sdlc2-*` names, sub-skills in
  `skills/`, and prompts point at `${CLAUDE_PLUGIN_ROOT}/skills/...` — never at a globally
  installed skill of the same name.
- `[R-IND-03]` **MUST**: artifacts live under `.sdlc2/` in the target repo. No other harness's
  directory is read or written.
- `[R-IND-04]` **MUST**: uninstalling any other plugin or skill leaves sdlc2 fully functional.

## 2. Packaging

- `[R-PKG-01]` **MUST**: a valid `.claude-plugin/plugin.json` (name `sdlc2`) and a
  `.claude-plugin/marketplace.json` listing this directory as its one plugin.
- `[R-PKG-02]` **MUST**: one router command, `commands/sdlc2.md`, dispatching on the first
  argument word, so the invocation is `/sdlc2 new-feature "<idea>"` — a space, not a colon.
- `[R-PKG-03]` **MUST**: the router reads only the dispatched mode file (progressive disclosure)
  and resolves every plugin path through `${CLAUDE_PLUGIN_ROOT}`, never a hardcoded `~/.claude`.
- `[R-PKG-04]` **MUST**: an unknown or missing subcommand prints the table and stops. Never guess.

## 3. Configuration — the project's CLAUDE.md

- `[R-CFG-01]` **MUST**: per-project config is a fenced YAML block in the **project's own**
  `CLAUDE.md`, delimited by `<!-- sdlc2:config -->` / `<!-- /sdlc2:config -->`. It is the single
  source; there is no second config file to drift against.
- `[R-CFG-02]` **MUST**: `commands.test` is mandatory. Absent or empty ⇒ refuse to run — without
  it the `tester` has no oracle and the build gate is theatre.
- `[R-CFG-03]` **MUST NOT**: write to `CLAUDE.md` without explicit confirmation. Propose the
  block, show it, ask. It is the user's file and it loads into every session.
- `[R-CFG-04]` **MUST**: a `CLAUDE.md` nested in a subdirectory overrides the root block for
  slices whose `Dir:` falls under it (longest matching prefix wins) — this is how a monorepo gets
  per-area commands without a separate context map.
- `[R-CFG-05]` **MUST**: config is passed **inline** in `args`. The workflow script is sandboxed
  and cannot read files.

## 4. The graph

- `[R-GRAPH-01]` **MUST**: nodes are data with exactly: `id · phase · mandate · maker · checkers ·
  arbiter · rubric · rounds · inputs · outputs · when · next` (+ `fanout` where it applies).
- `[R-GRAPH-02]` **MUST**: `architect` and `ux` run concurrently (one `parallel()` barrier);
  `build` is their join.
- `[R-GRAPH-03]` **MUST**: `ux` runs only when the `po` node reports `hasUiStories: true`, and the
  predicate is evaluated by the executor, never by an agent.
- `[R-GRAPH-04]` **MUST**: a `hard-fail` at `po` aborts the graph; a `hard-fail` at `architect` or
  `ux` skips the build node; a hard-fail of **one slice** skips only its dependents.
- `[R-GRAPH-05]` **MUST NOT**: back-edges. A later node never re-opens an earlier one —
  disagreement becomes a `VERIFY-WITH-HUMAN` row.
- `[R-GRAPH-06]` **MUST**: adding a node requires no change to the executor.

## 5. The loop

- `[R-LOOP-01]` **MUST**: pass ⇔ every binary checker passes **AND** `step_score ≥ threshold`
  **AND** no unresolved `critical`/`high` defect.
- `[R-LOOP-02]` **MUST**: `step_score = MIN(weighted totals)` across scoring checkers — never a
  mean. Weights apply *within* one checker's rubric, never between checkers.
- `[R-LOOP-03]` **MUST**: checkers in a round run in parallel and are mutually blind; no checker
  prompt contains another's verdict.
- `[R-LOOP-04]` **MUST**: the **engine** computes the weighted total from the checker's
  per-criterion scores. A checker-asserted total is ignored.
- `[R-LOOP-05]` **MUST**: defects are deduped by `(criterion, location)`; the maker receives all
  of them, never a truncated top-N.
- `[R-LOOP-06]` **MUST**: a defect without quoted `evidence` is discarded by the engine.
- `[R-LOOP-07]` **MUST**: after `rounds` unsuccessful rounds exactly one arbiter call runs — the
  maker's persona at `opus`/`max`, given every unresolved defect — and its verdict is
  `soft-pass`, never `pass`.
- `[R-LOOP-08]` **MUST**: a null/failed agent return consumes a round and adds a synthetic
  `critical` defect; it never retries for free.
- `[R-LOOP-09]` **MUST**: every round logs `(round, score, defects, critical/high)` via `log()`.

## 6. Context hygiene

- `[R-CTX-01]` **MUST**: every round spawns a **new** agent. Nothing is continued or re-messaged.
- `[R-CTX-02]` **MUST**: prompts carry **paths**, not bodies. Artifacts move between nodes through
  disk; the engine holds only paths, scores and defects.
- `[R-CTX-03]` **MUST NOT**: any prompt contain a prior round's transcript, a prior maker's output
  body, or another checker's verdict text.
- `[R-CTX-04]` **MUST**: prompt layout is **mandate first, rubric + schema last**.
- `[R-CTX-05]` **MUST**: `makerPrompt` / `checkerPrompt` / `arbiterPrompt` are pure functions of
  `(node, round, defects)`. This is the testable form of R-CTX-01..04.
- `[R-CTX-06]` **MUST**: makers return a changelog of ≤ 20 lines plus paths — never a body.

## 7. Models

- `[R-MODEL-01]` **MUST**: every maker, checker and arbiter declares its own `model` and `effort`.
  There is no inherited default; a role without a declaration is a spec violation.
- `[R-MODEL-02]` **MUST**: model **aliases** (`sonnet`, `opus`), never dated ids.
- Current policy: doc makers `sonnet`/`high`; `architect` and `developer` `opus`; every checker
  `opus`/`xhigh`; every arbiter `opus`/`max`; mechanical steps (slice resolution, escalation,
  report) `sonnet`/`low`.

## 8. Nodes

**`po`** — `[R-PO-01]` **MUST** produce all three: `feature.md` (the seed **extended in place**),
`mockup.html` (one self-contained file, happy paths), `issues/NN-slug.md` (one per vertical
slice). `[R-PO-02]` **MUST**: issue acceptance criteria are Gherkin **copied verbatim** from
`feature.md`. `[R-PO-03]` **MUST**: each issue carries `Blocked by:` and `Dir:`.
`[R-PO-04]` **MUST**: `hasUiStories` set truthfully — it gates the `ux` node.

**`architect`** — `[R-ARCH-01]` **MUST** produce `design.md` naming the outer seam **per slice**,
plus ADRs under `docs/adr/`. `[R-ARCH-02]` **MUST NOT** modify `feature.md`, `mockup.html` or any
issue's acceptance criteria.

**`ux`** — `[R-UX-01]` **MUST** extend `mockup.html` **in place**; a new file is a violation.
`[R-UX-02]` **MUST** label each state variant with the story/AC it serves. `[R-UX-03]` **MUST**
run in **spec mode**: static review only, no browser — its persona is shipped without browser
tools so this is enforced, not merely requested.

**`build`** — `[R-BUILD-01]` **MUST NOT** commit a slice whose tester verdict is not `pass: true`,
under any arbiter decision. `[R-BUILD-02]` **MUST**: on tester red after 5 rounds, escalate (note
on the issue), leave the branch unmerged, skip dependents, continue other slices.
`[R-BUILD-03]` **MUST**: surviving **code-reviewer** defects go to the arbiter, which may accept
the debt — each accepted item naming `file:line` and the violated principle in a VH record.
`[R-BUILD-04]` **MUST**: slices build **sequentially**, one branch `slice/<feature>/<NN>-<slug>`
each, cut from the default branch; no worktrees, no lanes, no parallelism in v0.1.
`[R-BUILD-05]` **MUST**: the developer drives sdlc2's own `skills/outside-in-tdd`.
`[R-BUILD-06]` **MUST NOT**: move, merge into, rebase onto, or push the default branch. sdlc2
never merges.

## 9. `VERIFY-WITH-HUMAN.md`

`.sdlc2/features/<slug>/VERIFY-WITH-HUMAN.md`, **append-only**.

- `[R-VH-01]` **MUST**: every arbiter decision produces one index row and one Decision Record
  (Issue · Options · Decision · Rationale · Risk if wrong · What would change my mind ·
  unresolved defects).
- `[R-VH-02]` **MUST**: ids are `VH-NN`, monotonic per feature, never reused or renumbered.
- `[R-VH-03]` **MUST NOT**: rewrite or delete a row; a superseded decision gets a new row.
- `[R-VH-04]` **MUST**: the file exists only once a record exists — its absence means no
  soft-passes.
- `[R-VH-05]` **MUST**: it is an input to every downstream node, so caveats propagate.
- `[R-REP-01]` **MUST**: the run report states in its first summary line if anything soft-passed.
  A run with a soft-pass is never described as clean.

## 10. Conformance matrix

| rule | implementation | how to verify |
|---|---|---|
| R-IND-01..04 | whole repo | `grep -rn "sdlc[^2]" --include=* .` returns nothing meaningful; `.sdlc2/` is the only artifact root |
| R-PKG-01/02 | `.claude-plugin/*.json`, `commands/sdlc2.md` | both parse as JSON; the command file exists and dispatches on `$ARGUMENTS` |
| R-PKG-03 | `commands/sdlc2.md`, `modes/*.md` | grep: `${CLAUDE_PLUGIN_ROOT}` present, `~/.claude` absent |
| R-CFG-01..05 | `modes/new-feature.md` §1.4, `configFor()` | read the mode's config step; `configFor` picks the longest dir prefix |
| R-GRAPH-01/06 | `NODES` literal | every node has the 12 fields; the executor references none of them by name |
| R-GRAPH-02/03 | the graph-walk section | `architect`/`ux` in one `parallel()`; `NODES.ux.when(state)` |
| R-LOOP-02 | `runLoop` → `Math.min.apply` | no `reduce`/average anywhere in scoring |
| R-LOOP-04 | `weightedTotal()` | totals derive from `rubric.criteria` weights only |
| R-LOOP-06 | `cleanDefects()` | filters on non-empty `evidence` |
| R-LOOP-07 | `runLoop` tail | exactly one `arbiterPrompt` call; returns `soft-pass` |
| R-CTX-05 | `makerPrompt`/`checkerPrompt`/`arbiterPrompt` | read them: no closure over prior rounds, no transcript argument |
| R-MODEL-01/02 | `NODES` | every role literal has `model`+`effort`; aliases only |
| R-PO-01..04 | `NODES.po.outputs`, `agents/sdlc2-product-owner.md` | three outputs declared; persona names all three |
| R-UX-03 | `agents/sdlc2-ux-auditor.md` frontmatter | `tools:` has no browser tool |
| R-BUILD-01 | `buildSlices()` | the `!testerPass` branch escalates and never records a sha |
| R-BUILD-04 | `buildSlices()` | a plain `for` over slices; no `parallel()` in the build node |
| R-VH-01..05 | arbiter prompts | each instructs read-then-append and continues the VH-NN sequence |

Run `node verify.mjs` to check §10 mechanically; it exits non-zero on any failure.

## 11. Deferred (named, not forgotten)

| deferred | why |
|---|---|
| Main-thread fallback engine (no `Workflow` tool) | v0.1 targets the fast path; `new-feature` says so and stops rather than improvising |
| Parallel slice lanes / worktrees | sequential first; parallelize with real timing data, not a guess |
| Live post-build UX audit | needs a running app; the spec-mode auditor covers design time |
| `/sdlc2 init` | folded into `new-feature`'s config pre-check — one fewer command to explain |
| Resumable graph state | use `Workflow`'s `resumeFromRunId` |
| Multi-repo / multi-service features | one repo, one default branch |

## 12. Known risks

1. **Never executed.** Structural verification is not proof. The first `/sdlc2 new-feature` is the
   real test, and the likeliest failures are agent-name resolution and an agent misreading a
   prompt contract — not the graph logic.
2. **Plugin agent namespacing** is host-dependent; `agentPrefix` exists so the mode can adapt
   without a code change. If neither form resolves, the mode stops rather than silently using a
   global lookalike.
3. **No executable oracle above `build`.** `po`, `architect` and `ux` are LLM judging LLM. MIN +
   severity veto + fresh context reduce rubber-stamping; they do not eliminate it.
4. **Cost.** Worst case ≈ (5 maker + 5 checker) × 3 doc nodes + (5 dev + 5 tester + 5 reviewer) ×
   N slices, checkers at `opus`/`xhigh`. `buildSlices` stops taking new slices under ~60k
   remaining budget; the doc nodes have no such guard.
5. **Sonnet makers vs opus checkers.** Watch round counts: a node persistently at 4–5 rounds means
   its maker is under-powered for the job.
