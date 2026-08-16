# SPEC — sdlc2, the feature graph

> **Status:** v0.1.1 implemented, **never executed**. Every file exists; `verify.mjs` checks both
> the shape and — by running the real engine against stubbed agents — the failure paths. No
> feature has been run through it yet. The first real run is the acceptance test.
> **Authority:** this file is the contract. Where the code and this spec disagree, one of them is
> a bug — say which before changing either. `REVIEW-0.1.0.md` records the review that produced
> v0.1.1 and which side was the bug in each case.

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
- `[R-PKG-05]` **MUST**: the bundled installers (`install.sh`, `install.ps1`) install **only**
  through documented `claude plugin` subcommands. They **MUST NOT** run `git`, write any path
  under the user's home directory, or modify a project's `CLAUDE.md`; and they **MUST NOT**
  prompt, because the documented delivery pipes them into a shell, where the script itself is
  standard input. They **MUST** assert the installed component inventory — the counts they check
  are the counts this repo actually ships, so adding a persona fails verification until the
  installers are updated. They **MUST NOT** assert a `Commands` count: `claude plugin details`
  reports Skills, Agents, Hooks, MCP servers and LSP servers only, so the `/sdlc2` router is
  confirmed by running `/sdlc2 help`. Being shipped files, they are scanned by the independence
  checks like any other — `[R-IND-01]` is only worth having if it covers every extension the
  bundle contains.

## 3. Configuration — the project's CLAUDE.md

- `[R-CFG-01]` **MUST**: per-project config is a fenced YAML block in the **project's own**
  `CLAUDE.md`, delimited by `<!-- sdlc2:config -->` / `<!-- /sdlc2:config -->`. It is the single
  source; there is no second config file to drift against.
- `[R-CFG-02]` **MUST**: `commands.test` is mandatory. Absent or empty ⇒ refuse to run — without
  it the `tester` has no oracle and the build gate is theatre. Enforced **twice**: by the mode
  file before the engine is invoked, and by the engine itself (`assertArgs`), because the engine
  can also be invoked directly.
- `[R-CFG-03]` **MUST NOT**: write to `CLAUDE.md` without explicit confirmation. Propose the
  block, show it, ask. It is the user's file and it loads into every session.
- `[R-CFG-04]` **MUST**: a `CLAUDE.md` nested in a subdirectory overrides the root block for
  slices whose `Dir:` falls under it (longest matching prefix wins) — this is how a monorepo gets
  per-area commands without a separate context map.
- `[R-CFG-05]` **MUST**: config is passed **inline** in `args`. The workflow script is sandboxed
  and cannot read files.

## 4. The graph

- `[R-GRAPH-01]` **MUST**: nodes are data with exactly: `id · kind · phase · mandate · maker ·
  checkers · arbiter · rubric · rounds · inputs · outputs · when · next` (+ `fanout` where it
  applies). `kind` is one of `loop` · `fanout` · `report`, and it is what the executor dispatches
  on; a node whose `kind` has no runner is a spec violation.
- `[R-GRAPH-02]` **MUST**: `architect` and `ux` run concurrently (one `parallel()` barrier);
  `build` is their join. This follows from the edges, not from a hand-written wave: nodes become
  ready together and are run together.
- `[R-GRAPH-03]` **MUST**: `ux` runs only when the `po` node reports `hasUiStories: true`, and the
  predicate is evaluated by the executor, never by an agent. `hasUiStories` is a **required**
  field of the `po` maker's schema, so it cannot be silently omitted into a skip.
- `[R-GRAPH-04]` **MUST**: a node that hard-fails, crashes, or is skipped for want of budget
  blocks its successors — `po` failing therefore aborts the graph, and `architect` or `ux` failing
  skips `build`. A node skipped by its **gate** (`when`) does **not** block its successors: `ux`
  being irrelevant to this feature is not a failure. A hard-fail of **one slice** skips only its
  dependents. The `report` node runs under every outcome.
- `[R-GRAPH-05]` **MUST NOT**: back-edges. A later node never re-opens an earlier one —
  disagreement becomes a `VERIFY-WITH-HUMAN` row.
- `[R-GRAPH-06]` **MUST**: adding a node requires no change to the executor. The executor derives
  predecessors from `next`, runs every ready node in one barrier, and dispatches on `kind`; it
  names no node.
- `[R-GRAPH-07]` **MUST**: every node body runs inside `parallel()`, which converts a throw into a
  `null`. A node that dies is recorded as a `hard-fail` row and the graph continues to the report
  — a run that cannot be read is indistinguishable from a run that never happened.

## 5. The loop

- `[R-LOOP-01]` **MUST**: pass ⇔ every binary checker passes **AND** `step_score ≥ threshold`
  **AND** no unresolved `critical`/`high` defect. A binary checker states `pass` explicitly — it
  is a required field of its schema — and a binary checker that passes the work while filing a
  `critical`/`high` defect against it has contradicted itself and is resolved as a **fail**.
- `[R-LOOP-02]` **MUST**: `step_score = MIN(weighted totals)` across scoring checkers — never a
  mean. Weights apply *within* one checker's rubric, never between checkers.
- `[R-LOOP-03]` **MUST**: checkers in a round run in parallel and are mutually blind; no checker
  prompt contains another's verdict. Verdicts are matched to checkers **by position**, so a
  checker that returns nothing is visible as a missing verdict rather than as an absent opinion.
- `[R-LOOP-04]` **MUST**: the **engine** computes the weighted total from the checker's
  per-criterion scores. A checker-asserted total is ignored, `criteria` is a required field, and
  a criterion the checker did not score counts as **zero**.
- `[R-LOOP-05]` **MUST**: defects are deduped by `(criterion, location)`, falling back to the
  defect's `evidence` when it carries no location — two distinct findings under one criterion must
  never collapse into one. The maker receives all of them, never a truncated top-N.
- `[R-LOOP-06]` **MUST**: a defect without quoted `evidence` is discarded by the engine, which
  says how many it dropped. `evidence` is a required field of the schema, so the discard is a
  backstop and not the primary gate.
- `[R-LOOP-07]` **MUST**: after `rounds` unsuccessful rounds exactly one arbiter call runs — the
  maker's persona at `opus`/`max`, given every unresolved defect — and its verdict is
  `soft-pass`, never `pass`. The loop itself never arbitrates: it returns `needs-arbitration` and
  the **executor** makes the call, **serially**, so that two concurrently-running nodes can never
  read-then-append `VERIFY-WITH-HUMAN.md` at the same moment. An arbiter that returns nothing is a
  `hard-fail`, never a silent soft-pass.
- `[R-LOOP-08]` **MUST**: a null or failed return — from a maker, a checker or an arbiter —
  consumes a round and adds a synthetic `critical` defect; nothing retries for free, and **no
  silence is ever scored as approval**. In particular a round in which a scoring checker failed to
  report scores **0**, never the vacuous `1`. A defect raised against the *harness* (an agent that
  did not answer) blocks the round like any other critical defect but is kept **out of the repair
  brief**: no maker is ever asked to fix a checker. The round is still spent, and the maker is told
  the round could not be scored rather than being handed a fresh "first attempt".
- `[R-LOOP-09]` **MUST**: every round logs `(round, score, defects, critical/high)` via `log()`.
- `[R-LOOP-10]` **MUST**: the engine checks the maker's declared `artifacts` against the node's
  declared `outputs`, and rejects a changelog over 20 lines. It cannot read the disk; it can hold
  the maker to what it claims.

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

- `[R-MODEL-01]` **MUST**: every maker, checker and arbiter declares its own `model` and `effort`
  **in `NODES`**, and the engine reads them from there — a hardcoded model at a call site is a
  spec violation, because it makes the node table decorative and the conformance check a lie.
  There is no inherited default; a role without a declaration is a spec violation.
- `[R-MODEL-02]` **MUST**: model **aliases** (`sonnet`, `opus`), never dated ids.
- Current policy: doc makers `sonnet`/`high`; `architect` and `developer` `opus`; every checker
  `opus`/`xhigh`; every arbiter `opus`/`max`; mechanical steps `sonnet`/`low` — the `report`
  node's role declares this like any other, while slice resolution and escalation are inline
  helper calls inside the build node rather than roles of their own.

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

**`build`** — `[R-BUILD-01]` **MUST NOT** record a slice as shipped without a build that actually
committed **and** a tester verdict of `pass: true`, under any arbiter decision. A green verdict
from an earlier attempt is not evidence about a later one. `[R-BUILD-02]` **MUST**: on failure
after 5 attempts, escalate (note on the issue), leave the branch unmerged, skip dependents,
continue other slices — naming the reason the **last attempt** actually ended in: `no-commit` (the
developer never reached a green commit, so nothing was tested and there is no branch to review),
`tester-red` (it committed and the suite stayed red), `tester-silent` (the tester never returned —
the slice is *unverified*, which is not the same as failing), or `unjudgeable` (a checker reported
it could not judge the slice). A slice that never compiled is never reported as a failing test
suite. The build node's own verdict is `pass` · `soft-pass` (debt accepted) · `partial` (some
slices shipped, some did not) · `hard-fail` (none shipped).
`[R-BUILD-03]` **MUST**: surviving **code-reviewer** defects go to the arbiter, which may accept
the debt — each accepted item naming `file:line` and the violated principle in a VH record.
`[R-BUILD-04]` **MUST**: slices build **sequentially**, one branch `slice/<feature>/<NN>-<slug>`
each, cut from the default branch; no worktrees, no lanes, no parallelism in v0.1.
`[R-BUILD-05]` **MUST**: the developer drives sdlc2's own `skills/outside-in-tdd`.
`[R-BUILD-06]` **MUST NOT**: move, merge into, rebase onto, or push the default branch. sdlc2
never merges. `[R-BUILD-07]` **MUST**: the tester and the code-reviewer inspect the **same working
tree concurrently**, so both are read-only on git — the developer leaves `HEAD` on the slice
branch, the tester asserts it rather than switching to it, and the reviewer reads the diff without
checking anything out.

## 9. `VERIFY-WITH-HUMAN.md`

`.sdlc2/features/<slug>/VERIFY-WITH-HUMAN.md`, **append-only**.

- `[R-VH-01]` **MUST**: every arbiter decision produces one index row and one Decision Record
  (Issue · Options · Decision · Rationale · Risk if wrong · What would change my mind ·
  unresolved defects).
- `[R-VH-02]` **MUST**: ids are `VH-NN`, monotonic per feature, never reused or renumbered. The
  ids are assigned by the arbiter after reading the file, which is only safe because arbitration
  is **serialized by the executor** (`R-LOOP-07`); two arbiters running at once would read the
  same highest id and one append would be lost.
- `[R-VH-03]` **MUST NOT**: rewrite or delete a row; a superseded decision gets a new row.
- `[R-VH-04]` **MUST**: the file exists only once a record exists — its absence means no
  soft-passes.
- `[R-VH-05]` **MUST**: it is an input to every downstream node, so caveats propagate.
- `[R-REP-01]` **MUST**: the run report states in its first summary line if anything soft-passed.
  A run with a soft-pass is never described as clean, and a `hard-fail`, `escalated`, `skipped` or
  `not-run` verdict is reported as itself and never softened.
- `[R-REP-02]` **MUST**: the report is written on **every** outcome, including an aborted graph;
  it carries a row per node, a row per slice, the open `VH` rows, and the makers' recorded
  `disputed` items — a maker's reasoned disagreement is a finding, not noise.

## 10. Conformance matrix

`✅` = `node verify.mjs` fails if the rule is broken. `👁` = verified by reading; the verifier does
not cover it. Nothing here claims a rule is machine-checked when it is not.

| rule | implementation | how it is verified | |
|---|---|---|---|
| R-IND-01..03 | whole repo | greps for another harness's paths, for `~/.claude`, and for any `mcp__` tool grant | ✅ |
| R-IND-02 | `agents/*.md` | every persona pins `tools:`, every granted tool is a core tool, no persona names a skill sdlc2 does not bundle, and bundled skills are referenced by `${CLAUDE_PLUGIN_ROOT}` path | ✅ |
| R-IND-04 | whole repo | follows from the above: nothing outside this repo is named | ✅ |
| R-PKG-01/02 | `.claude-plugin/*.json`, `commands/sdlc2.md` | both parse as JSON, the plugin is named `sdlc2`, its version matches `VERSION`, the router exists | ✅ |
| R-PKG-03 | `commands/sdlc2.md`, `modes/*.md` | `${CLAUDE_PLUGIN_ROOT}` present, `~/.claude` absent | ✅ |
| R-PKG-04 | `commands/sdlc2.md` | read the router's rules | 👁 |
| R-PKG-05 | `install.sh`, `install.ps1` | greps: only `claude plugin` for installation, no `git`, no home-dir path, no `CLAUDE.md` write, no prompt, no `Commands` assertion; the asserted agent/skill counts equal the shipped persona/skill counts; both documented in the README with a matching raw URL | ✅ |
| R-CFG-01/03/05 | `modes/new-feature.md` §1.4 | read the mode's config step | 👁 |
| R-CFG-02 | `assertArgs()` | the engine throws when `commands.test` is empty, and runs when it is not | ✅ |
| R-CFG-04 | `configFor()`, `conventions()` | longest **path-segment** prefix wins; `frontend` does not claim `frontend-legacy/`; doc-node prompts list the overrides | ✅ |
| R-GRAPH-01 | `NODES` literal | every node has all 13 fields and a `kind` the executor dispatches | ✅ |
| R-GRAPH-02 | `next` edges | `architect` and `ux` share one predecessor; `build`'s predecessors are exactly those two | ✅ |
| R-GRAPH-03 | `NODES.ux.when` | true/false both exercised; a walk probe proves no `ux` agent spawns when the gate is closed | ✅ |
| R-GRAPH-04 | `walk()`, `blocksSuccessors()` | walk probes: `po` hard-fail skips everything downstream; a gate-skip does not | ✅ |
| R-GRAPH-05 | `next` edges | every edge increases graph depth | ✅ |
| R-GRAPH-06 | `walk()` | read it: the executor names no node — but adding a node is still only proven by adding one | 👁 |
| R-GRAPH-07 | `walk()` | a walk probe crashes a node and asserts a `hard-fail` row plus a written report | ✅ |
| R-LOOP-01 | `runLoop`, `buildSlices` | a probe returns `pass: true` with a critical defect and asserts RED | ✅ |
| R-LOOP-02 | `Math.min.apply` | no `reduce`/average anywhere in scoring | ✅ |
| R-LOOP-03 | `checkerPrompt`, `runLoop` | prompt greps + positional verdict matching | ✅ |
| R-LOOP-04 | `weightedTotal()`, `VERDICT` | totals derive from rubric weights; a missing criterion is 0; `criteria` is required | ✅ |
| R-LOOP-05 | `dedupe()`, `defectKey()` | two evidence-distinct defects under one criterion both survive | ✅ |
| R-LOOP-06 | `cleanDefects()`, `DEFECT` | filters on non-empty `evidence`, which the schema also requires | ✅ |
| R-LOOP-07 | `runLoop` → `arbitrate()` | the loop returns `needs-arbitration` and calls no arbiter; `arbitrate` runs exactly one, returns `soft-pass`, and hard-fails on silence | ✅ |
| R-LOOP-08 | `runLoop`, `buildSlices`, `auditMaker` | probes kill the checker, the maker and the developer in turn and assert no green | ✅ |
| R-LOOP-09 | `log()` calls | read the loop | 👁 |
| R-LOOP-10 | `auditMaker()` | a missing artifact and a 30-line changelog each produce a defect | ✅ |
| R-CTX-02 | `pathList()`, prompts | no artifact body inlined; each path listed once | ✅ |
| R-CTX-05 | `makerPrompt`/`checkerPrompt`/`arbiterPrompt` | pure: same inputs, same output; arity bounded; no transcript | ✅ |
| R-CTX-01/03/04/06 | prompts, `MAKER` | greps for transcript leakage and mandate-first ordering; `artifacts` required | ✅ |
| R-MODEL-01/02 | `NODES` | every judged role declares agent+model+effort, aliases only, naming a bundled persona | ✅ |
| R-PO-01/04 | `NODES.po.outputs`, `MAKER_PO` | three outputs declared; `hasUiStories` required | ✅ |
| R-PO-02/03 | `agents/sdlc2-product-owner.md` | read the persona's node section | 👁 |
| R-ARCH-01/02, R-UX-01/02 | node mandates + personas | read them | 👁 |
| R-UX-03 | `agents/sdlc2-ux-auditor.md`, `sdlc2-ux-design.md` | neither grants a browser tool | ✅ |
| R-BUILD-01 | `buildSlices()` | probes: a red suite consults no arbiter and ships nothing; a stale green from an earlier attempt ships nothing | ✅ |
| R-BUILD-02 | `escalationPrompt()`, `buildSlices` | `no-commit` / `tester-red` / `tester-silent` / `unjudgeable` are distinguished in the note and the row | ✅ |
| R-BUILD-03 | `NODES.build.checkers` | the reviewer is `arbitrable: true` | ✅ |
| R-BUILD-04 | `buildSlices()` | a plain `for` over slices; no `parallel()` over slices | ✅ |
| R-BUILD-05/07 | developer/tester/reviewer prompts | read them | 👁 |
| R-BUILD-06 | whole engine | greps for a merge into the base branch | ✅ |
| R-VH-01/03/04/05 | arbiter prompts | read them: append-only, read-then-append, VH is an input everywhere | 👁 |
| R-VH-02 | `arbitrate()` called from `walk()` | a probe asserts the loop never arbitrates, so ids cannot race | ✅ |
| R-REP-01/02 | the report prompt, `walk()` | a probe asserts the report node runs after an aborted graph; its wording is read | ✅ 👁 |
| R-RUB-01 | `RUBRICS` vs §13 | weights sum to 1.00, thresholds in range, every criterion anchored — the criterion **texts** are compared by reading | ✅ 👁 |

Run `node verify.mjs`; it exits non-zero on any failure. It proves shape and failure handling.
It cannot prove the graph produces good software — the first real run is that acceptance test.

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

1. **Never executed.** Verification of shape and of failure handling is not proof of behaviour.
   The first `/sdlc2 new-feature` is the real test, and the likeliest failures are agent-name
   resolution and an agent misreading a prompt contract — not the graph logic.
2. **Plugin agent namespacing** is host-dependent; `agentPrefix` exists so the mode can adapt
   without a code change. If neither form resolves, the mode stops rather than silently using a
   global lookalike.
3. **No executable oracle above `build`.** `po`, `architect` and `ux` are LLM judging LLM. MIN +
   severity veto + fresh context reduce rubber-stamping; they do not eliminate it.
4. **Cost.** Worst case ≈ (5 maker + 5 checker) × 3 doc nodes + (5 dev + 5 tester + 5 reviewer) ×
   N slices, checkers at `opus`/`xhigh`. The executor now stops taking **any** new node — doc
   nodes included — under ~60k remaining budget, and records the skip; it does not stop a node
   already in flight, so the ceiling can still be overrun by one node's worth of work.
5. **Sonnet makers vs opus checkers.** Watch round counts: a node persistently at 4–5 rounds means
   its maker is under-powered for the job.
6. **Silence is the failure mode to watch.** Every path where an agent returns nothing is now
   scored as a defect rather than as assent, which means an unstable model or an exhausted budget
   shows up as a node that will not go green — expensive, but never as a false pass. If round
   counts spike with `engine` defects in the log, suspect the harness, not the work.

## 13. Rubrics

`[R-RUB-01]` **MUST**: `RUBRICS` in `new-feature.workflow.js` matches this section
criterion-for-criterion, weight-for-weight, threshold-for-threshold. This section is the source of
truth the code comment points at; drift between the two is a conformance failure, and one of them
is a bug — say which before changing either.

Every criterion is scored 0..1 against stated anchors (`0.0` / `0.5` / `1.0`), weights within one
rubric sum to `1.00`, and the pass bar is *weighted total ≥ threshold* **and** no unresolved
`critical`/`high` defect.

**`po` — threshold 0.85**

| id | weight | judges |
|---|---|---|
| PO-AC | 0.30 | Gherkin per story, concrete and testable, happy path **and** edge/error/empty/permission; one scenario ↔ one acceptance test |
| PO-INVEST | 0.25 | INVEST-compliant **vertical** slices cut from a story map, walking skeleton first |
| PO-GRILL | 0.15 | every seed decision, constraint and exclusion lands in a story, an AC, or an explicit out-of-scope line |
| PO-LANG | 0.15 | the seed's ubiquitous language, no invented synonyms |
| PO-MOCK | 0.15 | `mockup.html` bijective with the stories' happy paths, self-contained |

**`arch` — threshold 0.85**

| id | weight | judges |
|---|---|---|
| AR-BOUND | 0.30 | every invariant owned in exactly one place; no cross-aggregate transaction |
| AR-SEAM | 0.25 | the outer acceptance-test seam named and reachable **per slice**; ports/adapters explicit |
| AR-ADR | 0.20 | each significant decision an ADR with options, decision, consequences, rejected alternatives |
| AR-FIT | 0.15 | consistent with the existing codebase; any new pattern or dependency justified |
| AR-SLICE | 0.10 | each queued slice implementable end-to-end against that seam in one sitting |

**`ux` — threshold 0.80**

| id | weight | judges |
|---|---|---|
| UX-STATE | 0.30 | empty / loading / error / partial / success (+ over-limit) per screen, each with a way out |
| UX-FLOW | 0.25 | happy path and recovery complete; no dead ends; every screen reachable |
| UX-A11Y | 0.20 | structural WCAG AA: labels, heading order, keyboard path, visible focus, contrast tokens, never colour alone |
| UX-IA | 0.15 | "where am I / where can I go" holds; routes real and deep-linkable |
| UX-MOCK | 0.10 | extends `mockup.html` in place without contradicting an AC; no orphan screens |

**`build` — threshold 0.80** (the code-reviewer only; the tester is binary and never averaged)

| id | weight | judges |
|---|---|---|
| CR-CLEAN | 0.30 | intention-revealing names, small functions, one level of abstraction, no flag arguments, comments say why |
| CR-DDD | 0.25 | no anemic entities, no domain logic in adapters, the ubiquitous language in the code |
| CR-IDIOM | 0.20 | idiomatic for the stack, consistent with the surrounding code |
| CR-TEST | 0.15 | tests assert behaviour; the acceptance test maps to its Gherkin scenario |
| CR-DUP | 0.10 | no duplication, dead code, or commented-out code introduced |
