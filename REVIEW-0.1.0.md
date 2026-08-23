# Review — sdlc2 v0.1.0 harness

> **Not plugin content.** This is an internal working document. It ships with the plugin only
> because the marketplace entry uses `source: "./"`, which packages the whole repository —
> see `sdlc2-enhance-2.md` **E2-01**. Nothing in `agents/`, `modes/`, `skills/`,
> `commands/` or the engine depends on it, and no user of sdlc2 needs to read it.

> **Status: closed. Every finding below is fixed in v0.1.1**, plus one more (H13) found while
> fixing. `node verify.mjs` grew from 88 structural checks to 165 covering structure *and*
> behaviour under agent failure. See the [Resolution log](#resolution-log) at the end for what
> changed per finding. The findings are kept as written — they are the record of what was wrong,
> and several of them explain why the code now looks the way it does.

Scope: `new-feature.workflow.js` (the engine), `verify.mjs`, `commands/`, `modes/`, `agents/`,
checked against `SPEC.md`. `node verify.mjs` passes 100%, so everything below is something the
structural verifier cannot see.

**Method.** The engine's declarations (everything above the graph-walk marker) were evaluated in a
harness with stubbed `agent` / `parallel` / `log` / `budget`, and `runLoop` / `buildSlices` were
driven through their failure paths. Findings marked **CONFIRMED** were reproduced that way; the
rest are from reading.

---

## Verdict

The design holds up. Maker/checker/arbiter separation, `MIN` instead of a mean, evidence-gated
defects, the tester's non-arbitrable veto, sequential slices, never merging — all of that is
implemented as specified, and `weightedTotal` correctly treats a missing criterion as 0 and clamps
out-of-range scores.

The problems are concentrated in **what happens when an agent misbehaves**. The engine assumes
every agent returns a well-formed object. When one doesn't, three of the failure paths land on the
wrong side of the safety argument:

- a doc node **passes at 1.00** when its checker dies (C1),
- the build node **crashes the entire run** on a plausible sequence (C2),
- and there is **no `try`/`catch` anywhere**, so any terminal agent error kills the run before the
  report is written (C3).

Secondarily: several things the spec asserts are, in the code, **dead** — `hard`, `NODES.build`,
`next`, `fanout`, and every hard-fail branch in the graph walk. `verify.mjs` green-lights them
because it checks the node *table*, not the code path that runs.

---

## Critical

### C1 — A doc node passes at score 1.00 when its checker fails to return · **CONFIRMED**

`new-feature.workflow.js:504,521,535`

`parallel()` yields `null` for a thunk that throws — per the Workflow contract that includes an
agent erroring, and it is exactly what budget exhaustion does (`agent()` throws once the token
target is reached). `verdicts.filter(Boolean)` then drops that entry entirely, so the `if (!v)`
synthetic-defect branch never fires:

```js
for (const r of verdicts.filter(Boolean)) { ... }   // a dead thunk is silently gone
score = scored.length ? Math.min.apply(null, scored) : 1   // no scores ⇒ 1.00
```

With one checker per doc node, one dead checker means `scored` is empty, `score` is **1**,
`open.length` is **0**, and the node returns `pass` on round 1.

```
A) all checkers died -> {"verdict":"pass","score":1,"rounds":1,"defects":0}
```

This is the worst possible failure mode for an adversarial harness: the checker vanishing produces
a *cleaner* verdict than the checker working. The `score: 1` default is only correct for a node
whose checkers are all binary — no such node exists.

**Fix**

```js
const returned = verdicts.filter(Boolean)
if (returned.length !== node.checkers.length) {
  found.push({ criterion: 'engine', severity: 'critical', location: node.id,
    evidence: `${node.checkers.length - returned.length} checker(s) did not return`,
    fix: 're-run the checker' })
}
const expectedScorers = node.checkers.filter((c) => !c.binary).length
score = expectedScorers === 0 ? 1 : (scored.length === expectedScorers ? Math.min.apply(null, scored) : 0)
```

### C2 — `buildSlices` throws and kills the run when a repair attempt loses the developer · **CONFIRMED**

`new-feature.workflow.js:707-790`, crash at `787`

`testerPass` and `build` fall out of sync. `testerPass` is assigned only on an attempt that
committed, but `build` is overwritten every attempt. So: attempt 1 commits and goes tester-green
with a low review score; attempts 2–5 the developer agent returns `null`. The loop exits with
`testerPass === true` (stale) and `build === null`, skips the `!testerPass` escalation, calls the
arbiter, and then:

```js
shipped.push({ id: slice.id, branch: build.branch, sha: build.sha, ... })   // build is null
```

```
*** buildSlices THREW: TypeError: Cannot read properties of null (reading 'branch')
```

The exception propagates out of the top-level `await`, so the run dies: no report, no VH summary,
and slices already shipped in earlier iterations are lost from the return value.

**Fix** — track the last *successful* build and require it:

```js
let lastGood = null
// ... inside the loop, after a committed build: lastGood = build
if (!testerPass || !lastGood) {
  const reason = lastGood ? 'tester-red' : 'no-commit'
  // escalate with `reason`
}
// then use lastGood, never build, in shipped/rows
```

### C3 — One terminal agent error aborts the run before anything is reported

`new-feature.workflow.js:805,820,829,840`

There is no `try`/`catch` in the script. The maker call in `runLoop` and the developer call in
`buildSlices` are *not* inside a `parallel()`, so a throw from either (budget ceiling, terminal API
error) unwinds straight out of the workflow. The report agent at line 840 never runs, so
`.sdlc2/features/<slug>/runs/<runId>.md` is never written and `/sdlc2 status` shows nothing for a
run that may have shipped several slices.

**Fix** — wrap the walk so the report is always attempted:

```js
let built = { shipped: [], escalated: [], skipped: [], rows: [] }
let fatal = null
try { /* po → design → build */ } catch (e) { fatal = String(e && e.message || e) }
// report node runs regardless; include `fatal` in the report data and in the return value
```

Also worth noting: `budget.remaining()` is guarded only in `buildSlices` (line 692). The three doc
nodes can exhaust the budget with no guard at all, and the way they find out is C3.

---

## High

### H1 — `hard` is unreachable for every doc node and unread in the build node · **CONFIRMED**

`new-feature.workflow.js:512`

```js
if (v.hard === true && r.checker.arbitrable === false) hard = true
```

Every doc-node checker is `arbitrable: true`, so the conjunct can never be satisfied. The only
`arbitrable: false` checker is the tester — which runs in `buildSlices`, where `hard` is never read
at all. Consequences:

- `checkerPrompt` instructs *"Set `hard` only if the work cannot be judged at all"* and the
  personas repeat it — the engine ignores the answer.
- `R-GRAPH-04` ("a hard-fail at `po` aborts the graph; a hard-fail at `architect` or `ux` skips the
  build node") is unreachable, so lines 807-813 and 824-828 are dead code.
- A node whose required input is missing burns 5 rounds and then soft-passes:

```
C) checker set hard:true -> {"verdict":"soft-pass","rounds":5}
```

**Fix** — `if (v.hard === true) hard = true`, and break the `buildSlices` attempt loop on
`tv.hard`. If the `arbitrable` gate was deliberate, then `R-GRAPH-04` needs to say so.

### H2 — `VERDICT.criteria` is optional, so a clean review scores 0 · **CONFIRMED**

`new-feature.workflow.js:53-71` vs `303-313`

`VERDICT` requires only `defects`. A checker that finds nothing wrong and returns
`{"defects": []}` is schema-valid, and `weightedTotal` scores it **0.00** — below every threshold.
The node then burns 5 opus/`xhigh` rounds and soft-passes work that was clean on round 1, planting
a spurious VH row.

```
B) clean verdict, no criteria -> {"verdict":"soft-pass","score":0,"rounds":5} arbiter calls: 1
```

**Fix** — make `criteria` required in `VERDICT` (the tool layer will force a retry on omission),
and log when a returned `criteria` array matches no rubric id, which is the same failure wearing a
different hat.

### H3 — `DEFECT.evidence` is optional but the engine discards defects without it

`new-feature.workflow.js:41-51` vs `316-319`

`required: ['criterion','severity','fix']` — `evidence` is not required, yet `cleanDefects` drops
every defect lacking it. A checker that follows the schema exactly can have its entire findings list
silently deleted, and the node then passes. The prompts warn about this in prose; the schema, which
is the layer that actually enforces, does not.

**Fix** — add `evidence` to `DEFECT.required`. Keep `cleanDefects` as the belt-and-braces check,
and `log()` how many defects it dropped instead of dropping them silently.

### H4 — The build node synthesizes no defect when a checker dies · **CONFIRMED**

`new-feature.workflow.js:731-745`

`runLoop` handles a null verdict with a synthetic critical defect (R-LOOP-08). `buildSlices` does
not: `cleanDefects(null)` returns `[]`, so `defects` becomes empty and the next attempt gets the
**first-attempt** prompt again.

```
E) checkers died every round -> developer prompts: FIRST-BUILD × 5 | verdict: escalated tester-red
```

Five identical opus/`xhigh` builds, then an escalation that blames the tester. Fix by mirroring
`runLoop`: a null `tv`/`rv` becomes a critical `engine` defect.

### H5 — "Developer never committed" is reported as "tester-red" · **CONFIRMED**

`new-feature.workflow.js:765-778`

When no attempt ever commits, `testerPass` is `false` because the tester never ran — and the code
reads that as a red suite. The escalation agent is then told to write, on the issue,
*"the tester never went green"*.

```
D) developer never committed -> ["tester-red"]
```

The human reading that issue will look for a failing test that does not exist. Fix alongside C2 by
distinguishing `no-commit` from `tester-red`.

### H6 — `NODES.build` is dead data; the build path hardcodes everything

`new-feature.workflow.js:273-291` vs `709-739`

`runLoop` is never called for the build node. `buildSlices` hardcodes `at('sdlc2-developer')`,
`'opus'`, `'xhigh'`, `ROUNDS` and `RUBRICS.build.threshold` instead of reading them from the table.
So `NODES.build`'s `maker` / `checkers` / `arbiter` / `rounds` declarations are decorative and can
drift from the calls without any signal — and `verify.mjs` checks R-MODEL-01/02 and R-BUILD-01/03
**against the table the executor does not use**.

**Fix** — have `buildSlices` read `NODES.build` (`const N = NODES.build`, then
`N.maker.model`, `N.checkers.find(c => c.binary)`, `N.rounds`, `RUBRICS[N.rubric].threshold`).
Cheap, and it makes the verifier's claims true.

### H7 — `next` and `fanout` are never read; the graph is not data-driven

`new-feature.workflow.js:229,250,270,289-290,805-830`

The walk hardcodes `po → parallel(architect, ux) → buildSlices() → report`. `next` and `fanout` are
written and never consulted; `report` appears in `NODES.build.next` but is not a node at all. So
`R-GRAPH-06` ("adding a node requires no change to the executor") is false as written — adding a
node needs an edit to the walk. Either implement a real edge-following executor or amend
`R-GRAPH-06` to describe what is actually true (adding a node needs a row *and* a walk edit).

### H8 — Concurrent VH-NN assignment between the architect and ux arbiters

`new-feature.workflow.js:820`, `arbiterPrompt:435-444`

`architect` and `ux` run in one `parallel()` barrier. If both exhaust their rounds, both arbiters
run concurrently and both are told to *"read it FIRST to find the highest existing VH-NN id"* on the
same file. They will read the same highest id, assign the same next ids, and append concurrently to
an append-only file — duplicate ids and a lost write. That violates R-VH-02 (never reused) and
R-VH-03 (never rewritten).

**Fix** — either namespace ids per node (`VH-ARCH-01`, `VH-UX-01`, with a matching amendment to
R-VH-02), or have `runLoop` return the arbiter's records without writing and append them from a
single serialized agent call after the `parallel()` barrier.

### H9 — `dedupe` collapses distinct defects that share a criterion and have no location · **CONFIRMED**

`new-feature.workflow.js:321-331`

`location` is optional in `DEFECT`, and the key is `${criterion}|${location || ''}`. Two genuinely
different findings under the same criterion with no location collapse into one:

```
F) dedupe, same criterion + no location -> 1 of 2 kept: ["story 1 has no Gherkin"]
```

R-LOOP-05 says the maker receives *all* defects. Fix the key:
`${d.criterion}|${d.location || String(d.evidence).slice(0, 80)}`.

### H10 — A design node that dies does not block the build

`new-feature.workflow.js:820-830`

`designed.filter(Boolean)` drops a node whose `runLoop` threw. `designHardFail` is then empty, so
the build proceeds without `design.md` — every developer and reviewer prompt points at a file that
does not exist — and the report shows the node as `not-run` rather than failed. A `null` from that
`parallel()` should be treated as a hard fail.

### H11 — `hasUiStories` is read from the last round only and is optional in the schema

`new-feature.workflow.js:95,806`

```js
state.po = { hasUiStories: !!(results.po.maker && results.po.maker.hasUiStories) }
```

`MAKER` requires only `ok`. If the round that happens to be last omits the flag — or if that round's
maker returned `null` and the node still soft-passed — `hasUiStories` is `false` and the **ux node is
silently skipped** on a feature full of screens, with one `log()` line as the only trace. Make the
flag required for the `po` node, or carry the last non-undefined value across rounds and record the
skip in the run report.

### H12 — The tester persona hard-depends on the playwright plugin (R-IND-04)

`agents/sdlc2-tester.md:10`

```
tools: Read, Grep, Glob, Bash, mcp__plugin_playwright_playwright__browser_navigate, ...
```

Those tools exist only if the user has installed a *different* plugin. R-IND-04 says uninstalling
any other plugin leaves sdlc2 fully functional, and nothing in `SPEC.md` or `README.md` declares the
dependency. It is also unused: no prompt asks the tester to drive a browser, and SPEC §11 defers the
live UX audit precisely because it needs a running app.

**Fix** — drop the MCP tools from the persona (`Read, Grep, Glob, Bash` is what the tester prompt
actually needs), or declare the dependency in SPEC §1 and make it optional. Then extend
`verify.mjs`'s independence check to fail on any `mcp__plugin_` reference — this is the finding the
verifier should have caught.

---

## Medium

| # | finding | location |
|---|---|---|
| M1 | The tester and code-reviewer run in **parallel against one working tree**. `testerPrompt` says "run the test command from the slice branch", inviting a `git checkout` while the reviewer runs `git diff BASE...branch`. Reword to "HEAD is already on the slice branch; assert with `git branch --show-current`, never switch", or run the two checkers sequentially. | `731-740`, `609` |
| M2 | `modes/new-feature.md` resolves the default branch with `git symbolic-ref --short refs/remotes/origin/HEAD`, which prints **`origin/main`**, not `main`. That value becomes `BASE`, so prompts read "'origin/main' must not move" and slices are cut off a remote-tracking ref. Strip the remote prefix. | `modes/new-feature.md:19-20` |
| M3 | No argument validation in the engine. Missing `commands.test` produces prompts that literally say `(none — STOP, there is no oracle)` rather than refusing (R-CFG-02 is enforced only on the main thread). `FEATURE` defaults to `'feature'` and `RUN_ID` to `'nf-unstamped'`, so two unstamped runs overwrite the same report. Fail fast at the top of the script. | `17-30` |
| M4 | `makerPrompt` / `checkerPrompt` always call `conventions(CONFIG)` — the **root** config. The per-directory override (R-CFG-04) reaches only the build node, so an architect designing a frontend slice is shown the backend test command. | `390`, `412` |
| M5 | `configFor` matches raw string prefixes: a `frontend` key matches `frontend-legacy/x`. **CONFIRMED.** Normalize and match on a path-segment boundary. | `338-352` |
| M6 | A `blockedBy` id that matches no slice is silently ignored, so a dependent builds anyway. Validate blocker ids against the resolved slice set and skip on an unknown one. | `684-690` |
| M7 | Dead variable `blocked` — computed, never used, and its expression mixes `&&`/`\|\|` without parentheses. Delete it. | `684` |
| M8 | The engine never compares the maker's returned `artifacts[].path` against `node.outputs[].path`, and never enforces R-CTX-06's ≤20-line changelog. Both are pure string checks the sandbox permits — currently `{ok: true}` with no artifacts is indistinguishable from success. | `78-86` |
| M9 | `disputed` is collected in the `MAKER` schema and surfaced nowhere: not logged, not in the report, not in VH. A maker's reasoned disagreement is discarded. | `88-94` |
| M10 | The `po` hard-fail early return has a different shape than the success path (`nodes: results` vs `nodes: nodeRows`) and writes no run report — `/sdlc2 status` sees nothing. (Unreachable today because of H1.) | `807-813` |
| M11 | `nodeRows` covers `po · architect · ux`; `modes/new-feature.md` §3.1 promises a node table of `po · architect · ux · build`. Add a synthesized build row or fix the mode doc. | `833`, `modes/new-feature.md:121` |

---

## Low / documentation

- **L1** — `new-feature.workflow.js:161` names *"SPEC.md §Rubrics"* as the rubrics' source of truth.
  There is no such section. `verify.mjs:98` tags its weight check `[R-RUB]`, an id `SPEC.md` never
  defines. Either add the section (it is the one piece of the contract that lives only in code) or
  fix both references.
- **L2** — SPEC §10 says *"Run `node verify.mjs` to check §10 mechanically"*, but R-GRAPH-02,
  R-GRAPH-06, R-LOOP-07, R-PO-01..04, R-VH-01..05 and the `buildSlices` half of R-BUILD-01 are not
  checked by it. Mark the unchecked rows "by reading" so the matrix does not overclaim.
- **L3** — `SEED` and `${DIR}/feature.md` are the same string, so the architect's READ list prints
  `feature.md` twice; `VH` is in `node.inputs` *and* appended again by `makerPrompt`. Harmless, but
  it is the sort of sloppiness the rubrics penalize.
- **L4** — `sdlc2-ux-design` (and the other three makers) declare no `tools:`, so they inherit
  everything available, including browser tools. R-UX-03's spec-mode enforcement covers only the
  auditor. Pin the makers' tool lists.
- **L5** — `verify.mjs`'s independence patterns target only the older `/sdlc` harness. Nothing
  catches a cross-plugin MCP dependency (H12) or an agent naming a tool the plugin does not ship.
- **L6** — README and `modes/new-feature.md` nest ` ``` ` fences inside a ` ```markdown ` block; the
  inner fence terminates the outer one. Use `~~~` for the outer fence.

---

## Fix order

1. **C1** — the false green. Everything else in the harness is an argument about rigor, and this one
   quietly discards it.
2. **C2 + H5** — the crash and the mislabelled escalation; one change to how the last good build is
   tracked fixes both.
3. **C3** — always write the report.
4. **H2 + H3** — the two schema fields (`criteria`, `evidence`). Two lines, and they move enforcement
   from prose to the tool layer.
5. **H4** — synthetic defect on a dead checker in `buildSlices`.
6. **H1** — make `hard` reachable, or amend R-GRAPH-04.
7. **H9, H11, H10** — defect loss, silent UX skip, design-node death.
8. **H8** — the VH id race, before two nodes ever arbitrate in the same run.
9. **H12 + L5** — independence, and the verifier check that would have caught it.
10. **H6, H7** — make the node table load-bearing, or stop claiming it is.
11. **M1–M11**, then the docs.

## Suggested additions to `verify.mjs`

The verifier is good at shape and blind at behaviour. The probes used for this review are cheap to
keep: evaluate the head of the script with stubbed `agent`/`parallel`/`log`/`budget`, then assert

- a dead checker never yields `pass` (C1),
- a `null` developer return after a green attempt does not throw (C2),
- `hard: true` from any checker ends the loop (H1),
- `dedupe` keeps two evidence-distinct defects that share a criterion (H9),
- `buildSlices` distinguishes `no-commit` from `tester-red` (H5).

That turns five of the confirmed findings into regression tests, and it is the same trick the file
already uses to reach the pure helpers.

---

## Resolution log

All fixed in **v0.1.1**. Where the spec was the thing that was wrong, that is said explicitly.

| # | what changed |
|---|---|
| C1 | Verdicts are matched to checkers **by position**, so a checker that never returns is a missing slot rather than a filtered-away one. It becomes a critical defect, and the score is `0` unless *every* scoring checker reported. The vacuous `score = 1` default now applies only to a node with no scoring checkers at all. |
| C2 | `buildSlices` tracks `lastGood` — the last build that actually committed — and never reads `branch`/`sha` off the latest agent return. `testerPass` is reset the moment an attempt fails to commit, so a stale green cannot survive into a later attempt. |
| C3 | Every node body now runs inside `parallel()`, which converts a throw into a `null`, and the `report` node is terminal: it runs under every outcome, including an aborted graph. The budget guard was generalized from the build node to every node. |
| H1 | `hard` is honoured from **any** checker (the `arbitrable === false` conjunct is gone) and ends the loop immediately; `buildSlices` reads it too, escalating as `unjudgeable`. R-GRAPH-04 is now reachable and probe-covered. |
| H2 | `criteria` is required in `VERDICT` (with `minItems: 1`), and the engine logs when a checker scores no recognised rubric id. |
| H3 | `evidence` is required in `DEFECT`; `cleanDefects` stays as a backstop and now reports how many it dropped. |
| H4 | `buildSlices` synthesizes a defect for a silent tester or reviewer, exactly as `runLoop` does. |
| H5 | The escalation reason is whatever the **last attempt** ended in: `no-commit`, `tester-red`, `tester-silent` (new — the tester never answered, so the slice is unverified rather than failing) or `unjudgeable`. The issue note quotes it in plain words. |
| H6 | `buildSlices` reads `NODES.build` for its agents, models, efforts, rounds and threshold. The node table is load-bearing, so what `verify.mjs` checks is what runs. |
| H7 | The executor is now generic: predecessors are derived from `next`, every ready node runs in one `parallel()` barrier, and dispatch is on a new `kind` field (`loop` · `fanout` · `report`). `report` is a real node. R-GRAPH-01 gained `kind`; R-GRAPH-06 is true as written. |
| H8 | The loop no longer arbitrates. It returns `needs-arbitration` and the **executor** makes the single arbiter call **serially**, so two concurrent nodes can never read-then-append `VERIFY-WITH-HUMAN.md` at the same instant. `VH-NN` ids stayed as specified — the code was the bug, not R-VH-02. |
| H9 | `defectKey` falls back to the defect's evidence when it carries no location. |
| H10 | A `null` from the node barrier is a `hard-fail` row, and `blocksSuccessors` stops its dependents — while a node skipped by its **gate** deliberately does not (that distinction was missing and would have skipped `build` whenever `ux` was gated off). |
| H11 | `hasUiStories` is required in the po maker's schema, and the executor reads state from the last **good** maker, not the last return. |
| H12 | The tester ships with `Read, Grep, Glob, Bash`. Its persona now runs the project's own `commands.e2e` and treats a UI criterion it cannot exercise as an unverified criterion — a defect, never an assumed pass. |
| H13 | *(found while fixing)* Personas told agents to reach for `ux-flow-map`, `ux-heuristic-audit`, `improve-codebase-architecture`, `diagnose`, `prototype`, `to-prd`, `triage` and a `code-review` workflow — none of which sdlc2 bundles, all of which would resolve against the host's globally installed skills. Every one is now either a `${CLAUDE_PLUGIN_ROOT}/skills/…` path or an inlined technique. The ux-auditor's browser-driven method became the static spec-mode method it was always supposed to run. |
| M1 | The developer is told to leave `HEAD` on the slice branch; the tester asserts the branch instead of switching to it; the reviewer is read-only on git. New rule R-BUILD-07. |
| M2 | The mode file strips the `origin/` prefix, and says why: the value becomes `defaultBranch` in the developer's git instructions. |
| M3 | `assertArgs()` refuses to run without `feature`, `runId` and `commands.test` — the same gate as the mode file, because the engine can be invoked directly. |
| M4 | Doc-node prompts render the per-directory overrides alongside the root config. |
| M5 | `configFor` normalizes and matches on path **segments**: `frontend` no longer claims `frontend-legacy/`. |
| M6 | An unknown `blockedBy` id skips the dependent with reason `blocker-unknown` instead of silently building it. |
| M7 | The dead `blocked` variable is gone. |
| M8 | `auditMaker` checks the maker's declared `artifacts` against the node's declared `outputs` and rejects a changelog over 20 lines. New rule R-LOOP-10. |
| M9 | `disputed` is logged when it appears and carried into the run report as its own section. |
| M10 | There is one return path and one result shape; the report is always written. |
| M11 | The node table is derived from `NODES`, so `build` is in it. |
| L1 | `SPEC.md` §13 Rubrics exists and defines `[R-RUB-01]`; the code comment and the verifier now point at something real. |
| L2 | The conformance matrix marks every row `✅` (the verifier fails if broken) or `👁` (verified by reading). No row overclaims. |
| L3 | `pathList()` lists each path once; `SEED` is used instead of a second spelling of the same path. |
| L4 | All nine personas pin `tools:`, and the verifier fails on any grant outside the core tool set. |
| L5 | The independence check greps for `mcp__` tool grants and for skill names sdlc2 does not bundle — the two holes that let H12 and H13 through. |
| L6 | Nested fences use `~~~` for the outer block in `README.md` and `modes/new-feature.md`. |

Two further fixes fell out of the above and had no finding of their own: a tester that returns
`pass: true` alongside a critical defect is resolved as **red** (an oracle contradicting itself
should not ship a slice), and a node whose maker never produced its artifacts **hard-fails**
instead of being arbitrated over — a "best available decision" about a file that does not exist is
theatre. Both are probe-covered.
