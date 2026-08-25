# SPEC — sdlc2, the feature graph

> **Status:** v0.1.1 **executed once**, 2026-08-16 — one feature ("greet the visitor by name")
> through the whole graph in a lab repo. It shipped 4 slices, soft-passed at `po` and `architect`,
> and produced 14 human-verify records that a human then resolved. `verify.mjs` checks both the
> shape and — by running the real engine against stubbed agents — the failure paths. What that run
> found is folded into `[R-BUILD-04a]`, `[R-REP-02]`, `[R-REP-03]` and §12.
> **Authority:** this file is the contract. Where the code and this spec disagree, one of them is
> a bug — say which before changing either. `REVIEW-0.1.0.md` records the review that produced
> v0.1.1 and which side was the bug in each case.

sdlc2 is a **graph** of **loops**, packaged as a Claude Code plugin.

- The **workflow** is a graph: nodes and edges are data (`NODES` in `new-feature.workflow.js`);
  one generic executor walks them. Adding a node is a row here and a row there — never a
  control-flow edit.
- Each **node** is a loop: a **maker** persona produces artifacts, **adversarial checkers** score
  them against a rubric, and the maker gets a bounded number of rounds to answer them — **2** at
  the document nodes, **5** at `build`, whose extra attempts only cost anything when a slice
  actually fails. A loop that stops moving exits early rather than spending the rest. If the bar
  is still unmet, an **arbiter** makes the best available call, documents it, and the graph
  continues.
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
- `[R-PKG-06]` **MUST**: before anything is spent, the mode file resolves `${CLAUDE_PLUGIN_ROOT}`,
  reads the `VERSION` beside it, states both, and **refuses to run from a superseded plugin root**.
  A Claude Code session pins its plugin root at start, and the plugin cache keeps every installed
  version side by side in version-numbered directories — so after a mid-session
  `claude plugin update` the old path keeps resolving and keeps working, and every measurement
  taken is about an engine nobody is developing any more. Detection needs no harness internals and
  **MUST NOT** reach for any (`[R-PKG-03]` forbids a hardcoded `~/.claude` path): when the plugin
  root's own directory name is a version, a higher-sorting sibling means this session is stale.
  A non-version directory name is a local or dev install — carry the version forward and skip the
  comparison. Runs 1 and 2 of this plugin executed `0.1.1` while `0.1.2` was installed: ~6.3M agent
  tokens measuring a superseded engine, two defects "found" that were already fixed upstream, and
  nothing anywhere said so.
- `[R-PKG-07]` **MUST**: `VERSION` **MUST** be bumped in the same change that alters the engine.
  Concretely: when a tag named `v<VERSION>` exists, no runtime-read file may differ between that
  tag and the working tree. `[R-PKG-06]` catches a session pinned to an *older directory* while a
  newer one is installed, which a name comparison can see. It cannot see the other shape of the
  same failure — **two builds sharing one version number**, where the repo and the install cache
  are both `0.1.6` and differ in content. Nothing at run time can detect that: the directory names
  match, `VERSION` agrees with itself, and the engine path is correct, so the run proceeds on the
  older engine and its report names a version that is true and useless. It also leaves no tell —
  `[R-PKG-06]`'s case surfaced only because the two engines were far enough apart to contradict
  each other. The guard therefore lives in the **repo**, not the run: a tagged version whose
  engine has since moved is a release that was never cut. Runtime-read means
  `new-feature.workflow.js`, `commands/`, `modes/`, `agents/`, `skills/` and
  `.claude-plugin/plugin.json` — not `SPEC.md`, `verify.mjs` or the working notes, which no run
  reads. A version with no matching tag is a release in preparation and is not a violation; a
  checkout with no git is the install cache, where the check does not apply.
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
- `[R-GRAPH-02]` **MUST**: `architect` and `ux` run concurrently, and every node starts the moment
  its predecessors have settled — there is **no wave barrier**. `build` waits for `architect`
  alone; the join on `ux` is **per slice**, taken inside the build node by a slice the resolver
  marked `ui: true`. A backend slice therefore starts while `ux` is still running, and `report`
  waits for both `build` and `ux` so nothing is reported before every node has settled. This
  follows from the edges plus the per-slice join, never from a hand-written wave.
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
  **AND** no unresolved defect at **veto severity**. Veto severity is `critical`/`high` at `build`,
  where the tester's authority is executable, and **`critical` only at the document nodes**. A
  `high` already drags its criterion's score, so vetoing on it there counted it twice — and it
  counted it through **severity**, which is the one judgement in this system that has no anchors
  while every score has three. Severity is therefore anchored explicitly in the checker prompt. A binary checker states `pass` explicitly — it
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
- `[R-LOOP-07]` **MUST**: when a node's rounds run out **or its loop stops converging**, exactly
  one arbiter call runs — the maker's persona at `opus`/`high`, given every unresolved defect —
  and its verdict is `soft-pass`, never `pass`. The loop itself never arbitrates: it returns
  `needs-arbitration` and the **node runner** makes the call. It no longer has to be serialized —
  ids are namespaced per arbiter (`[R-VH-02]`), so two concurrent arbiters cannot collide on
  `VERIFY-WITH-HUMAN.md`, and an arbiter runs as soon as its own node needs one instead of queueing
  behind the slowest node in the graph. An arbiter that returns nothing is a
  `hard-fail`, never a silent soft-pass.
- `[R-LOOP-08]` **MUST**: a null or failed return — from a maker, a checker or an arbiter —
  consumes a round and adds a synthetic `critical` defect once `[R-LOOP-11]`'s free retry is spent,
  and **no silence is ever scored as approval**. In particular a round in which a scoring checker failed to
  report scores **0**, never the vacuous `1`. A defect raised against the *harness* (an agent that
  did not answer) blocks the round like any other critical defect but is kept **out of the repair
  brief**: no maker is ever asked to fix a checker. The round is still spent, and the maker is told
  the round could not be scored rather than being handed a fresh "first attempt".
- `[R-LOOP-09]` **MUST**: every round logs `(round, score, defects, critical/high)` via `log()`.
- `[R-LOOP-11]` **MUST**: every spawn goes through one wrapper, and a spawn that **never answered**
  is retried once, free, before any round is charged. An agent that did not answer has not made a
  mistake worth a defect record: `agent()` returns `null` when a subagent dies on a terminal API
  error after the harness's own retries, and may throw outright — neither is content. A maker that
  *does* answer and answers badly (`ok: false`, or a declared artifact missing) is untouched by
  this: that is content, it is what the checkers exist for, and it still costs a round.
  When the retry also fails, the round **MUST** be recorded as `errored`, distinct from
  `rejected`, so a score history reads as what happened rather than as a maker that collapsed, and
  the defect **MUST** be a *harness* defect under `[R-LOOP-08]` so no maker is handed
  "you returned nothing" as work to repair. Run 2 is why: one dropped connection
  (`Connection lost mid-response`) cost the `ux` node its clean pass at 0.79 against a 0.80 bar —
  one repair round from passing, and that round went to the network. A node's reported score must
  not be partly a measure of network luck.
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

## 6b. Labels and progress groups

What a watching human sees while a run is going, and — less obviously — an interface the
conformance harness depends on.

- `[R-LABEL-01]` **MUST**: every spawn label is produced by the single constructor `labelFor`, and
  no call site builds one by hand. Labels are not decoration: `verify.mjs` routes its stubbed
  agents by reading them, so a label typed at a call site is an undeclared interface. Renaming one
  makes a stub fall through and the engine record a silent agent — which is loud in a test that
  asserts a green run, and **silent in a test that asserts a failure path**, where the run still
  fails and nothing says it failed for the wrong reason. Enforced twice: a source check that every
  `label:` is a `labelFor(` call, and a behavioural check that `parseLabel(labelFor(...))`
  round-trips for every role.
- `[R-LABEL-02]` **MUST**: a label names a **role** and nothing else; the **unit** of work — which
  slice, which node — is carried by the progress group via `groupFor`. Stating the unit once in a
  group heading beats repeating it on every row, and it is what makes three rows legible as one
  slice's work. Roles are persona names (`developer`, `tester`, `code-reviewer`,
  `product-owner-critic`, …) or, for the inline helper calls that have no persona,
  `resolve-slices` · `release-worktrees` · `escalate` · `arbiter` · `report`. An activity name is a
  violation: `test:` read as a step in the developer's TDD cycle, which it never was — test-first
  happens inside the developer's own call, and that agent is the independent tester judging
  finished work.
- `[R-LABEL-03]` **MUST**: `architect` and `ux` share a phase, so a group is `<phase> · <unit>`.
  Without the unit their four rows interleave in one box, out of order, because the two nodes run
  concurrently — and every slice's rows land in a single flat `Build` box.

## 7. Models

- `[R-MODEL-01]` **MUST**: every maker, checker and arbiter declares its own `model` and `effort`
  **in `NODES`**, and the engine reads them from there — a hardcoded model at a call site is a
  spec violation, because it makes the node table decorative and the conformance check a lie.
  There is no inherited default; a role without a declaration is a spec violation.
- `[R-MODEL-02]` **MUST**: model **aliases** (`sonnet`, `opus`), never dated ids.
- Current policy: doc makers `sonnet`/`high`; `architect` and `developer` `opus`; the **binary
  tester** `opus`/`medium` — its authority is a green suite, not deliberation, and effort is cut
  there rather than the model, because a tester false-green is the one unrecoverable failure in
  the graph; other checkers `opus`/`xhigh` except the code reviewer at `opus`/`high`; every
  arbiter `opus`/`high`; mechanical steps `sonnet`/`low`, except slice resolution at
  `sonnet`/`medium` because that one call decides the entire branch topology and has no checker
  over it. The `report` node's role declares this like any other, while slice resolution,
  escalation and worktree release are inline helper calls inside the build node rather than roles
  of their own.

## 8. Nodes

**`po`** — `[R-PO-01]` **MUST** produce all three: `feature.md` (the seed **extended in place**),
`mockup.html` (one self-contained file, happy paths), `issues/NN-slug.md` (one per vertical
slice). `[R-PO-02]` **MUST**: issue acceptance criteria are Gherkin **copied verbatim** from
`feature.md`. `[R-PO-03]` **MUST**: each issue carries `Blocked by:` and `Dir:`.
`[R-PO-04]` **MUST**: `hasUiStories` set truthfully — it gates the `ux` node.

**`architect`** — `[R-ARCH-01]` **MUST** produce `design.md` naming the outer seam **per slice**,
plus ADRs under `docs/adr/`. `[R-ARCH-02]` **MUST NOT** modify `feature.md`, `mockup.html` or any
issue's acceptance criteria. `[R-ARCH-03]` **MUST NOT** assert a slice dependency that `issues/`
does not already declare: the `Blocked by:` lines in `issues/` are the **single source of truth**
for the queue, and they are what `baseFor()` actually reads. A disagreement with the queue is a
**defect raised against the `po` node** — in `disputed`, and as a VH record naming the issue file
to amend — never an edge declared downstream in `design.md` or an ADR. Enforced by the `AR-QUEUE`
criterion, because the engine cannot read the disk and a checker can. Run 2 is why: the architect
judged slice 04 to need slice 02 and wrote that into `design.md`/ADR-0025 while the issue said
`Not blocked by 02`. The engine ignored it and the run's diamond survived — but two artifacts of
one run asserted different graphs, only one of them executable, and had the engine consulted
`design.md` the diamond would have collapsed into a chain, silently reproducing `[R-BUILD-04a]`'s
original defect through a different door. A human was also being asked, in `VH-03`, to confirm an
edge the build had already ignored on a slice that had already shipped.

**`ux`** — `[R-UX-01]` **MUST** extend `mockup.html` **in place**; a new file is a violation.
`[R-UX-02]` **MUST** label each state variant with the story/AC it serves. `[R-UX-03]` **MUST**
run in **spec mode**: static review only, no browser — its persona is shipped without browser
tools so this is enforced, not merely requested.

**`build`** — `[R-BUILD-01]` **MUST NOT** record a slice as shipped without a build that actually
committed **and** a tester verdict of `pass: true`, under any arbiter decision. A green verdict
from an earlier attempt is not evidence about a later one — **and neither is one from before the
arbiter touched the branch**, so the build arbiter **MUST NOT commit**: it accepts the debt or it
escalates (`finalized: false`). The shipped `sha` and the sha a tester actually passed are one
commit. The arbiter used to be told to "commit any fix … and keep the suite green", which is an
instruction with no executable assertion behind it — the failure class this project has already
been bitten by twice. `[R-BUILD-02]` **MUST**: on failure
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
`[R-BUILD-04]` **MUST**: slices are scheduled by **dependency level**, one branch
`slice/<feature>/<NN>-<slug>` each. Levels are computed to a fixpoint from `Blocked by:`, never
assumed from the order the slices arrive in. Slices within a level are independent of one another
and **MAY** build concurrently, in lanes, each in its **own git worktree** under
`../.sdlc2-worktrees/<feature>-<runId>/<id>` — **outside the repository**, as a sibling of it.
`[R-BUILD-07a]` **MUST**: that location is outside the repo, not merely outside the feature
directory. Two earlier locations were wrong for two different reasons. Under the feature directory
the report node sweeps a worktree into the paperwork commit. Anywhere *inside* the repo, a
worktree is invisible to git once ignored and still perfectly visible to the project's **test
runner** — a full second checkout with its own dependencies, under the project root. Run 2
measured it: the declared test command collected three sibling worktrees and rendered every
component against a second copy of React, 16 files and 98 failures, every one of them noise
landing on the only executable oracle sdlc2 has. The container is stamped with the `runId` so a
tree stranded by an aborted run cannot collide with a live one.

Lanes open **only** when the project declares `commands.install`. A fresh worktree is a fresh
tree: it has no installed dependencies, so the test command cannot run in it, and a slice would
fail for a reason that has nothing to do with its code. Without that command the engine builds
sequentially in the session's own checkout and **MUST** say so in the log rather than degrading
silently. Worktrees **MUST** be released when building ends — left behind they fail the next run's
clean-tree pre-check, and the branch each one holds cannot be checked out anywhere else. Releasing
a worktree **MUST NOT** delete its branch: the branches are the deliverable.

The target repo **MUST** ignore any agent-worktree path *its harness* uses (commonly
`.claude/worktrees/`). This is a **target-repo** obligation, not a harness one — see `SETUP.md`.
sdlc2's own slice worktrees no longer impose either obligation: being outside the repo they need
no ignore rule and no test-runner exclusion. Releasing them **MUST** remove the now-empty
container with `rmdir`, never a recursive delete, and never its parent — the parent is the user's
directory, not sdlc2's.

An independent slice is cut from the default branch. A slice with `Blocked by:` is cut from its **blocker's branch** instead, because it needs
the blocker's *code*, not just its issue file — and the code reviewer diffs against that same base,
so a stacked slice's review shows only what the slice itself changed. Where a slice declares
several blockers, the base is the last of them in dependency order; the rest are asserted as
ancestors rather than merged.
`[R-BUILD-04a]` **MUST**: the **tester proves the base** with `git merge-base --is-ancestor` before
judging behaviour — the declared base is an ancestor of `HEAD`, every blocker's branch is, and no
other slice's branch is. A violation is a critical `slice-branch-base` defect. The developer's word
that it branched correctly is not evidence, and the instruction alone is not enforcement: on the
first real run the developer stacked all four independent slices anyway, and the reviewer scored a
diff containing three earlier slices' code at 0.86 without noticing.
`[R-BUILD-04b]` **MUST**: the queue the run builds is the queue `issues/` declares, and something
that is not the engine has to say so. `slices` is a **required** field of the `po` maker's schema
and `blockedBy` is a **required** field of each entry, so a run can no longer proceed on a graph
nobody stated: an absent manifest used to fall through to an agent re-deriving the queue with no
checker over it, and an absent `blockedBy` used to level every slice at 0, cut every branch from
the default branch, and dissolve the stacking invariant in silence. The **tester** then reads its
own issue file's `## Blocked by` section and compares it with the blockers the engine handed it; a
difference is a critical `slice-graph-mismatch` defect. This is separate from `[R-BUILD-04a]` and
must run **before** it, because `mustContain` and `mustNotContain` are derived from the same list
being checked — proving the branch against them confirms only that the branch matches the graph
the tester was given, never that the graph is the one the issues declare. Run 5's `due-date`
measured the gap: the resolver declared `04-change-due-date` blocked by `02` **and** `03` where
the issue named only `02`, so the slice was cut from `03`'s branch, carried code it does not own,
and every check passed.

`[R-BUILD-04c]` **MUST**: lanes open when the **project** says a fresh worktree is testable, and
the project may say so two ways — by declaring `commands.install`, or by deliberately declaring
`lanes: N > 1`. The old gate asked only the first, which is a *proxy* for the real question and
false for a whole ecosystem: Maven and Gradle resolve from a shared cache, so a JVM project
genuinely needs no install step and was serialised for having nothing to install, silently losing
`[E2-14]` and `[SD-04]`'s worktree isolation on every run. The engine **MUST NOT** probe: it
spawns agents, it does not run commands, so probing means a full test-suite run in the pre-checks
on every run forever. The pre-checks ask the human to try one worktree by hand instead, once per
project. Whichever path is taken **MUST** be logged, and the consent path **MUST** say that
nothing verified it — a slice failing on missing dependencies otherwise reads as a slice with a
bug. `lanes` is **root-only**: it caps one scheduler that runs every slice regardless of
directory, so `configFor` rightly merges `commands` and `seam` per directory and not this.

`[R-BUILD-05]` **MUST**: the developer drives sdlc2's own `skills/outside-in-tdd`.
`[R-BUILD-06]` **MUST NOT**: move, merge into, rebase onto, or push the default branch. sdlc2
never merges. `[R-BUILD-07]` **MUST**: the developer, the tester and the code-reviewer of one
slice inspect the **same working tree** — the session's checkout on the sequential path, or that
slice's own worktree in a lane, addressed with `git -C <path>` by all three. This is a **per-slice**
invariant, which is what allows sibling slices to run at once; it is **not** satisfied by giving
each agent its own tree. The tester and reviewer read that tree concurrently, so both are read-only
on git — the developer leaves `HEAD` on the slice branch, the tester asserts it rather than
switching to it, and the reviewer reads the diff without
checking anything out.

## 9. `VERIFY-WITH-HUMAN.md`

`.sdlc2/features/<slug>/VERIFY-WITH-HUMAN.md`, **append-only**.

- `[R-VH-01]` **MUST**: every arbiter decision produces one index row and one Decision Record
  (Issue · Options · Decision · Rationale · Risk if wrong · What would change my mind ·
  unresolved defects).
- `[R-VH-02]` **MUST**: ids are **namespaced per arbiter** — `VH-<node>-NN` for a document node,
  `VH-build-<slice>-NN` for a slice — monotonic **within that prefix**, never reused or
  renumbered. Each arbiter reads the file, finds the highest id carrying **its own** prefix, and
  continues from there, so two arbiters appending at the same moment cannot collide.
  Arbitration is consequently **no longer serialized**: it runs inside the node that needed it.
  It was serialized before precisely because a single flat `VH-NN` sequence had to be discovered
  by reading the file, which made the architect's arbiter idle until `ux` finished and put the two
  most expensive calls in the run back to back.
- `[R-VH-03]` **MUST NOT**: rewrite or delete a row; a superseded decision gets a new row.
- `[R-VH-04]` **MUST**: the file exists only once a record exists — its absence means no
  soft-passes.
- `[R-VH-05]` **MUST**: it is an input to every downstream node, so caveats propagate.
- `[R-REP-01]` **MUST**: the run report states in its first summary line if anything soft-passed.
  A run with a soft-pass is never described as clean, and a `hard-fail`, `escalated`, `skipped` or
  `not-run` verdict is reported as itself and never softened.
- `[R-REP-04]` **MUST**: the report names **the engine that produced it** — `sdlc2 <version>` and
  the plugin root it ran from — in its header, verbatim as passed, including when that reads
  `unknown`. The engine is sandboxed and cannot read its own `VERSION`, so the mode file reads it
  beside the plugin root it resolved and passes it in (`[R-PKG-06]`). The same line is logged as
  the **first line of the run**. A report that does not say which engine wrote it cannot be trusted
  to be about the engine its reader thinks was installed, and a run report is the artifact that
  outlives the log.
- `[R-REP-05]` **MUST**: the report says **how the slices were built** — concurrently in their own
  worktrees, naming which ran together, or one at a time with the reason. The scheduler already
  knew this and only `log()`ed it, which reaches the person watching and nobody else; a reader
  coming to the report afterwards could not tell a run that used its lanes from one that silently
  did not. When lanes stayed shut because the project declares no `commands.install`, the report
  names that as the one-line config change that opens them (`[SD-08]`, found by run 3).
- `[R-REP-06]` **MUST**: the report renders a **fan-out node's row from its units, never as
  blanks**. A fan-out node runs its maker/checker loop once per unit rather than once, so it has no
  score and no rounds of its own; printing the `null` and the `0` verbatim gives a reader `—` and
  `0`, which says the node went unmeasured when in fact it was measured once per unit. The row
  carries the per-unit review spread and the worst attempts against the cap instead, and the table
  is followed by a line naming the slice table as where the per-unit detail lives. Found in the
  `saved-at` run, where `build | pass | — | 0` sat beside three scored nodes and read as missing
  data.
- `[R-REP-07]` **MUST**: the report states how many rounds were **veto rounds** — rounds that
  scored at or above their bar and were stopped by an open defect anyway — and states it **even
  when the count is zero**. A veto round is the only case where severity decides an outcome on its
  own, and severity is the one judgement here with no anchors (`[E-10]` narrowed what it may veto
  on for exactly that reason). §12 asked whether the veto ever binds by itself and four runs
  answered nothing, because a score and a round count cannot separate a round stopped by severity
  from one that simply scored badly. Zero is a real answer and must reach the page: an omitted line
  reads as unmeasured, and unmeasured and zero call for opposite decisions about keeping the veto.

- `[R-REP-08]` **MUST**: every scored node and slice reports its **margin** — the score minus its
  bar — and the criteria that cost it, with the checker's stated reason. The engine already builds
  this for the next round's prompts and discards it when a node passes on its first round, which is
  exactly the case where it is the only record that will ever exist. An aggregate cannot separate a
  panel marking everything near the total from one marking almost everything 1.0 with a single
  criterion low, and those say opposite things about how hard the checkers are pushing. A criterion
  no checker scored is reported as a **gap**, never as a zero: it already counts as zero in the
  total, and printing it as a low mark hides that nobody judged it.
- `[R-REP-09]` **MUST**: the report says **what to merge**, not merely what was built. A stacked
  slice's branch already contains its blockers' — `baseFor` cuts it from the last of them and the
  tester proves the rest are ancestors — so the branches a human has to merge are the **leaves of
  the shipped dependency graph**, and there are usually fewer of them than there are slices. Run
  5's `due-date` shipped six slices whose real cost was two merges; the report listed six branches
  and left the reader to derive that from the `Waits for` column, or to merge six by hand and meet
  "already up to date" four times. The engine computes the plan (`mergePlan`) rather than leaving
  the report agent to derive it, for the same reason `[R-REP-07]`'s veto tally is computed: a
  number nobody can recompute from the report is a number the run did not measure. Leaves are
  taken over the **shipped** subgraph only — a slice whose blocker escalated was skipped, so every
  shipped slice's blockers shipped too.
- `[R-BUILD-07]` **MUST**: a slice's id is `NN-slug`, recovered from its issue **filename** when
  the product owner's manifest supplies something else, and every `Blocked by:` reference is
  rewritten in the same pass. The id becomes a git branch name, and only the fallback resolver was
  ever told its format — the manifest fast path (`[E-13]`) was not, so run 5 shipped branches named
  `slice/undo-a-removal/01`. Renaming without rewriting the references would flatten the dependency
  graph and unstack slices that must stack, so a rewrite that would collide two ids is abandoned
  whole rather than half-applied (`[SD-11]`).

- `[R-REP-02]` **MUST**: the report is written on **every** outcome, including an aborted graph;
  it carries a row per node, a row per slice (including the base each was cut from), the open `VH`
  rows, and the makers' recorded `disputed` items — a maker's reasoned disagreement is a finding,
  not noise. For any node that spent more than half its rounds it also prints the **per-round score
  history**, because a final score alone cannot distinguish a loop converging slowly from one
  thrashing, and those want opposite fixes.
- `[R-REP-03]` **MUST**: the report node **commits the paperwork** — `.sdlc2/` and `docs/adr/` — to
  a `sdlc2/<feature>` branch cut from the default branch, on top of that branch's existing history
  when a previous run made one. The default branch does not move and no slice branch is touched.
  Left uncommitted, the artifacts block the next run's clean-tree gate and the human-verify record
  is one `git clean` from gone. If any git step fails the node records why in the report and stops:
  it never stashes, resets, forces or cleans.

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
| R-PKG-06 | `modes/new-feature.md` pre-check 0 | greps: reads VERSION beside the plugin root, detects a higher-sorting sibling, stops on it, and passes `version` in the args | ✅ |
| R-PKG-07 | `VERSION`, `.claude-plugin/plugin.json`, every runtime-read path | probe diffs the runtime-read set between tag `v<VERSION>` and the working tree; skips when the tag is absent (release in preparation) or git is (the install cache) | ✅ |
| R-PKG-05 | `install.sh`, `install.ps1` | greps: only `claude plugin` for installation, no `git`, no home-dir path, no `CLAUDE.md` write, no prompt, no `Commands` assertion; the asserted agent/skill counts equal the shipped persona/skill counts; both documented in the README with a matching raw URL | ✅ |
| R-CFG-01/03/05 | `modes/new-feature.md` §1.4 | read the mode's config step | 👁 |
| R-CFG-02 | `assertArgs()` | the engine throws when `commands.test` is empty, and runs when it is not | ✅ |
| R-CFG-04 | `configFor()`, `conventions()` | longest **path-segment** prefix wins; `frontend` does not claim `frontend-legacy/`; doc-node prompts list the overrides | ✅ |
| R-GRAPH-01 | `NODES` literal | every node has all 13 fields and a `kind` the executor dispatches | ✅ |
| R-GRAPH-02 | `next` edges, `runSlice` | `architect` and `ux` share one predecessor; `build`'s predecessor is `architect` alone; `report` waits for both `build` and `ux`; a `ui` slice awaits `whenSettled('ux')` | ✅ |
| R-GRAPH-03 | `NODES.ux.when` | true/false both exercised; a walk probe proves no `ux` agent spawns when the gate is closed | ✅ |
| R-GRAPH-04 | `walk()`, `blocksSuccessors()` | walk probes: `po` hard-fail skips everything downstream; a gate-skip does not | ✅ |
| R-GRAPH-05 | `next` edges | every edge increases graph depth | ✅ |
| R-GRAPH-06 | `walk()` | read it: the executor names no node — but adding a node is still only proven by adding one | 👁 |
| R-GRAPH-07 | `walk()` | a walk probe crashes a node and asserts a `hard-fail` row plus a written report | ✅ |
| R-LOOP-01 | `runLoop`, `buildSlices`, `blockingOpen` | a probe returns `pass: true` with a critical defect and asserts RED; another asserts a doc node passes on a `high` but never on a `critical`, while `build` still blocks on both | ✅ |
| R-LOOP-02 | `Math.min.apply` | no `reduce`/average anywhere in scoring | ✅ |
| R-LOOP-03 | `checkerPrompt`, `runLoop` | prompt greps + positional verdict matching | ✅ |
| R-LOOP-04 | `weightedTotal()`, `VERDICT` | totals derive from rubric weights; a missing criterion is 0; `criteria` is required | ✅ |
| R-LOOP-05 | `dedupe()`, `defectKey()` | two evidence-distinct defects under one criterion both survive | ✅ |
| R-LOOP-06 | `cleanDefects()`, `DEFECT` | filters on non-empty `evidence`, which the schema also requires | ✅ |
| R-LOOP-07 | `runLoop` → `arbitrate()` | the loop returns `needs-arbitration` and calls no arbiter; `arbitrate` runs exactly one, returns `soft-pass`, and hard-fails on silence | ✅ |
| R-LOOP-08 | `runLoop`, `buildSlices`, `auditMaker` | probes kill the checker, the maker and the developer in turn and assert no green | ✅ |
| R-LOOP-09 | `log()` calls | read the loop | 👁 |
| R-LOOP-11 | `spawn()` | probes assert one free retry, that a recovered spawn costs no round, and that an unanswered maker is recorded `errored` and kept out of the repair brief | ✅ |
| R-LOOP-10 | `auditMaker()` | a missing artifact and a 30-line changelog each produce a defect | ✅ |
| R-CTX-02 | `pathList()`, prompts | no artifact body inlined; each path listed once | ✅ |
| R-CTX-05 | `makerPrompt`/`checkerPrompt`/`arbiterPrompt` | pure: same inputs, same output; arity bounded; no transcript | ✅ |
| R-CTX-01/03/04/06 | prompts, `MAKER` | greps for transcript leakage and mandate-first ordering; `artifacts` required | ✅ |
| R-MODEL-01/02 | `NODES` | every judged role declares agent+model+effort, aliases only, naming a bundled persona | ✅ |
| R-PO-01/04 | `NODES.po.outputs`, `MAKER_PO` | three outputs declared; `hasUiStories` required | ✅ |
| R-PO-02/03 | `agents/sdlc2-product-owner.md` | read the persona's node section | 👁 |
| R-ARCH-01/02, R-UX-01/02 | node mandates + personas | read them | 👁 |
| R-ARCH-03 | `architect` mandate + `AR-QUEUE` | probes assert the mandate forbids the edge, names issues/ as the source of truth, and that the rubric carries a criterion scoring it | ✅ |
| R-UX-03 | `agents/sdlc2-ux-auditor.md`, `sdlc2-ux-design.md` | neither grants a browser tool | ✅ |
| R-BUILD-01 | `buildSlices()` | probes: a red suite consults no arbiter and ships nothing; a stale green from an earlier attempt ships nothing | ✅ |
| R-BUILD-02 | `escalationPrompt()`, `buildSlices` | `no-commit` / `tester-red` / `tester-silent` / `unjudgeable` are distinguished in the note and the row | ✅ |
| R-BUILD-03 | `NODES.build.checkers` | the reviewer is `arbitrable: true` | ✅ |
| R-BUILD-04 | `buildSlices()`, `runSlice()`, `baseFor()` | one callable unit per slice; dependency-level scheduling; lanes only with a declared install command; a blocked slice's base is its blocker's branch and the reviewer diffs against that base; a probe asserts a lane slice gets its own worktree and that the worktrees are released | ✅ |
| R-BUILD-04a | `testerPrompt()` | the tester prompt carries `git merge-base --is-ancestor` assertions for the base, the blockers and the non-blockers | ✅ |
| R-BUILD-05/07 | developer/tester/reviewer prompts | read them | 👁 |
| R-BUILD-06 | whole engine | greps for a merge into the base branch | ✅ |
| R-VH-01/03/04/05 | arbiter prompts | read them: append-only, read-then-append, VH is an input everywhere | 👁 |
| R-VH-02 | `arbiterPrompt`, `buildArbiterPrompt` | ids are namespaced per arbiter (`VH-<node>-NN`, `VH-build-<slice>-NN`), so concurrent arbiters cannot collide; the loop still never arbitrates itself | ✅ |
| R-REP-01/02 | the report prompt, `walk()` | a probe asserts the report node runs after an aborted graph; its wording is read | ✅ 👁 |
| R-REP-04 | `VERSION_RAN`, `walk()`, the report prompt | a probe asserts the version reaches the report prompt, that an unstamped run says `unknown` rather than guessing, and that the run's first log line names the engine | ✅ |
| R-REP-05 | the lane scheduler, the report prompt | the scheduler records `lanes` (batches, widest, install) and the build node carries it; the report prompt is handed it and told to state it either way | ✅ |
| R-REP-06 | `writeReport()`'s node rows, the report prompt | probes assert a fan-out row carries `fanout` with its unit counts, review spread and attempts-against-cap, and that the prompt forbids the bare `—`/`0` cells | ✅ |
| R-REP-07 | `runLoop`'s history rows, the slice loop, `writeReport()`'s tally | probes assert a round at or above bar with a critical open is flagged `veto` while a round that failed on SCORE is not, and that the tally reaches the report prompt — reading zero rather than going absent when nothing vetoed | ✅ |
| R-REP-08 | `criterionLows()`, both loops' rows, the report prompt | probes assert the margin and the costing criteria survive a ONE-round pass, that the harshest lens is the one recorded, and that an unscored criterion reads as a gap rather than a zero | ✅ |
| R-BUILD-07 | `canonicalSliceIds()`, the manifest intake | driven against run 5's real manifest shape: ids recover their slug, `blockedBy` is rewritten with them, a blocked slice is still cut from its blocker, and a colliding rewrite is abandoned whole | ✅ |
| R-REP-03 | the report prompt | the prompt commits `.sdlc2/`+`docs/adr` to `sdlc2/<feature>` off the default branch, never `-B`, never stash/reset/force/clean | ✅ |
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

1. **Executed once.** The first run confirmed the prediction that the graph logic was not the
   risk: no node crashed, the gate fired correctly, `build` passed 4/4 slices first attempt. Both
   failures were agents quietly not doing what a prompt said. (a) The developer ignored "cut from
   `main`" and stacked all four independent slices, and the reviewer then scored a diff containing
   three earlier slices' code without noticing — now caught by `[R-BUILD-04a]`, and the reason an
   instruction with no executable assertion behind it should not be counted as an invariant.
   (b) `skills/grill-with-docs/SKILL.md` — the FIRST thing three personas read — said "Run a
   `/grilling` session, using the `/domain-modeling` skill", both of which resolve to the host's
   globally installed skills of those names. 205 green checks never looked inside `skills/`.
2. **Plugin agent namespacing** is host-dependent; `agentPrefix` exists so the mode can adapt
   without a code change. If neither form resolves, the mode stops rather than silently using a
   global lookalike. **Measured, 2026-08-16:** installing the plugin does *not* register its
   agents in an already-running session — neither `sdlc2-product-owner` nor
   `sdlc2:sdlc2-product-owner` resolved until Claude Code restarted. On that same machine the
   host offered `architect`, `architect-critic`, `code-reviewer`, `developer`, `product-owner`,
   `product-owner-critic`, `tester`, `ux-auditor` and `ux-design` — a global lookalike for
   **every one** of the nine personas. Dropping the `sdlc2-` prefix to make resolution "work"
   would produce a complete, plausible, entirely non-sdlc2 run. Two mitigations hold: pre-check 7
   stops rather than guesses, and `agent()` *throws* on an unknown type, so `[R-LOOP-08]` turns
   it into a critical defect rather than a silent pass. **Measured again after the restart, same
   machine:** `agentPrefix: "sdlc2:"` resolves through the workflow's own `agent()` path, and the
   bare form is absent. The probe asked the resolved persona what its instructions say, and it
   answered `feature.md` for both the ubiquitous-language source and the document it extends, and
   `…/plugins/cache/sdlc2-marketplace/sdlc2/0.1.1/skills/` for its skills root — sdlc2's own
   wording, where the global lookalike says `CONTEXT.md` and "the Feature Brief". Resolution
   probes should discriminate like this; a probe that only proves *a* name resolves cannot tell
   the two apart.
3. **No executable oracle above `build`.** `po`, `architect` and `ux` are LLM judging LLM. The
   severity veto and fresh context reduce rubber-stamping; they do not eliminate it. **The MIN
   across checkers is not currently one of these defences and should not be counted as one**
   (`[E2-09]`): every node in the shipped graph declares exactly ONE scoring checker, so the
   minimum is taken over a single number. MIN is what makes a panel weakest-link *when there is a
   panel*; adding a second lens to a node is an open, costed question, not something the graph
   does today. v0.1.3 gives the
   checker last round's scores (`[E-05]`), which trades a little independence across rounds for
   stability — mutual blindness *within* a round is untouched (`[R-LOOP-03]`). And a document
   arbiter still finalizes artifacts that nothing re-checks: the `build` arbiter was stopped from
   committing (`[R-BUILD-01]`), but above `build` there is no oracle to re-run, so that residual
   stands and is the human's to catch at merge.
4. **Cost.** Worst case ≈ (2 maker + 2 checker) × 3 doc nodes + (5 dev + 5 tester + 5 reviewer) ×
   N slices. The document nodes dropped from 5 rounds to 2 in v0.1.3 and arbiters came down from
   `opus`/`max` to `opus`/`high`. **The plateau exit that used to be claimed here was deleted in
   v0.1.6** (`[E2-03]`): it required three rounds of history to detect a flat run, and the same
   change that added it cut document nodes to two rounds, so it could never fire. It never saved
   anything. What replaced it is a free re-make — a maker output rejected before it could be scored
   no longer costs a round, so two rounds now means two *scored* rounds. The executor stops taking
   **any** new node — doc nodes included — under ~60k remaining budget, and records the skip; it
   does not stop a node already in flight, so the ceiling can still be overrun by one node's worth
   of work.
5. **Why the doc nodes never converged — and what is still unmeasured.** **Measured on run 1:**
   all three doc nodes used all 5 rounds — `po` 0.84 and `architect` 0.77 both went to an arbiter,
   `ux` reached 0.82 unaided. This risk used to be titled *"sonnet makers vs opus checkers"*, which
   the data does not support: the **`architect` maker is `opus`** and scored **worst**, while both
   `sonnet` makers scored higher. v0.1.3 therefore left maker models alone and changed the things
   the evidence did point at — the bar (0.85 → 0.80), the double-counted `high` veto, the
   default-to-FAIL tie-break on scoring checkers, and two mechanical faults that made rounds carry
   no signal (`[E-02]`, `[E-05]`).

   **Whether the veto ever binds *on its own* — asked since v0.1.2, and now actually counted.**
   Run 1 predates the per-round history, so its rounds 1–4 are invisible; in the three rounds we
   can see, the **score** term is what failed. Four runs added nothing to that, and the reason was
   never that the veto stayed quiet — it was that nobody could tell. A score and a round count
   cannot separate a round stopped by severity from one that simply scored badly, so four runs of
   silence were read as "no data" when they may have been four runs of zero, and those two call for
   opposite decisions. `[R-REP-07]` counts them: a round at or above bar with an open defect is
   flagged as it happens, and the report carries the tally whether it reads zero or not. If veto
   rounds turn out to be common, the severity anchoring in `[R-LOOP-01]` is the lever; if the tally
   reads zero across a run, the bar was the whole story. **Still unmeasured until a run reports
   it** — the counter is built and proven against a stub, which is not the same as having the
   number.
6. **The run is scoped to the session's cwd, and nothing enforces that it is the repo you meant.**
   There is no `repoRoot` argument: `featureDir` is relative and the developer's git instructions
   are bare `git checkout -b` / `git commit`, so subagents build wherever the session is rooted.
   Launching from the wrong directory does not fail — it produces a complete, plausible run
   against the wrong repo, the same shape of failure as the agent-lookalike trap. Pre-check 1
   states the assumption; only the human can check it.
7. **Silence is the failure mode to watch.** Every path where an agent returns nothing is now
   scored as a defect rather than as assent, which means an unstable model or an exhausted budget
   shows up as a node that will not go green — expensive, but never as a false pass. If round
   counts spike with `engine` defects in the log, suspect the harness, not the work.

## 13. Rubrics

`[R-RUB-01]` **MUST**: `RUBRICS` in `new-feature.workflow.js` matches this section
criterion-for-criterion, weight-for-weight, threshold-for-threshold. This section is the source of
truth the code comment points at; drift between the two is a conformance failure, and one of them
is a bug — say which before changing either.

Every criterion is scored 0..1 against stated anchors (`0.0` / `0.5` / `1.0`), weights within one
rubric sum to `1.00`, and the pass bar is *weighted total ≥ threshold* **and** no unresolved defect
at veto severity — `critical`/`high` at `build`, `critical` only at the document nodes
(`[R-LOOP-01]`).

The document thresholds are **0.80**, not 0.85. Measured over all 32 half-credit combinations of a
five-criterion rubric, a 0.85 bar admits 9 of them and a 0.80 bar 12; neither changes the shape
(at most two half-credits, and only the lightest two). What decided it was the observed scores
rather than the distribution: run 1's `po` reached **0.84** and paid an arbiter for the missing
0.01, while the only unaided pass in the entire run happened at the 0.80 bar. MIN across checkers,
a refutation mandate, and anchors written as absolutes together put 0.85 inside judge noise for
work that is genuinely good.

**`po` — threshold 0.80**

| id | weight | judges |
|---|---|---|
| PO-AC | 0.30 | Gherkin per story, concrete and testable, happy path **and** edge/error/empty/permission; one scenario ↔ one acceptance test |
| PO-INVEST | 0.25 | INVEST-compliant **vertical** slices cut from a story map, walking skeleton first |
| PO-GRILL | 0.15 | every seed decision, constraint and exclusion lands in a story, an AC, or an explicit out-of-scope line |
| PO-LANG | 0.15 | the seed's ubiquitous language, no invented synonyms |
| PO-MOCK | 0.15 | `mockup.html` bijective with the stories' happy paths, self-contained |

**`arch` — threshold 0.80**

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
