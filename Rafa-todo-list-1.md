# Rafa — todo list 1: harness changes

Settled 2026-08-25 over three grilling sessions. Items are referred to by **name** — the order has
moved several times, so it lives here rather than in the numbering.

| | |
|---|---|
| **Done — 0.1.10 complete** | timings · slice graph · labels · lane gate · merge order |
| **next** | one small `sdlc2-lab` run to prove 0.1.10 |
| **then** | run 6 on `instrument-service`, unchanged, and time it |
| **then** | the developer's 51% — measure, then decide |
| **0.1.11** | feature branch · speculative start |

**Run 6 stays clean.** It is the first Maven run and the test of the stack-agnostic claim, so
0.1.10 changes only things that cannot alter a verdict — labels and timings report, the lane gate
and the slice-graph fix correct behaviour that is already wrong. No model or effort change goes in
with it, or nothing run 6 shows can be attributed to anything.

---

**Every item ships with its conformance surface named** — before it is built, say which
requirement id it adds to `SPEC.md`, which `verify.mjs` check proves it, and which hardcoded list
it has to extend. `verify.mjs` cites requirement ids 220 times; a rule no check references is
decorative. Three lists are already known to bite:

| what | where | which item |
|---|---|---|
| the node-kind list `['loop','fanout','report']` | `verify.mjs:338` | feature branch (`assemble`) |
| the `EXPORTS` list | `verify.mjs:292` | labels (`labelFor`, `parseLabel`) |
| prompt-text assertions, in the style of the `SD-07` mandate check | `verify.mjs` | slice graph |

That last one matters most. Telling the tester to read `## Blocked by` without asserting that the
prompt says so is an instruction with no executable check behind it — the failure class `SPEC.md`
§12 already records this project being bitten by twice.

**0.1.10 gets a lab run before run 6.** `verify.mjs` proves shape and failure handling against
stubbed agents; it cannot show that a tester really opens an issue file, or that the consent path
really opens lanes. Take a two-slice feature in `sdlc2-lab`. Going straight to run 6 means
debugging four new behaviours and an unfamiliar stack at once, on the run whose purpose is to
answer a different question entirely.

## Timings — DONE

`bin/run-timing.mjs` ships. It reads a run's agent transcripts after the fact and reports where
the time went.

```bash
node bin/run-timing.mjs --feature due-date          # find the run by what it built
node bin/run-timing.mjs --dir <workflow-transcript-dir>   # exact, no searching
```

Per-agent rows plus four totals: wall-clock, summed agent time, the ratio between them, and the
largest stretch where nothing was running. Grouped by node and by slice. It writes
`runs/<id>-timing.md` beside the report when that directory exists.

`modes/new-feature.md` step 3 now records the workflow's transcript directory in the run summary
and points at the script — nothing else records that path, and without it finding a run's
transcripts means searching every session directory on the machine.

**It refuses to merge two directories that share a workflow id.** Resuming keeps the id and so
does re-running, so merging them produces a composite run that never happened. It lists what it
found and makes you choose.

**It claims no critical path.** It reads timestamps, not the graph, so any chain inferred from
overlap would be a guess wearing the clothes of a measurement.

**Correction to the original plan:** this does *not* work retroactively on six runs. Only the
`todo` project has transcripts on this machine — the six `sdlc2-lab` runs have none. Transcripts
are per-machine and can be pruned, so **a run nobody times may become untimeable.** Time each run
when it lands.

**Held back deliberately:** the report node could do this itself and write the table into the run
report — it is an agent, so it has shell access. Not yet: it puts a filesystem-scraping job inside
the one node that must survive every outcome, including the ones where scraping fails.

## Slice graph — the edges nobody checks · DONE, in 0.1.10

**Found by chasing a timing anomaly, and the timing is the smaller half.**

In the `due-date` run the product owner returned **no slice manifest at all**, so `E-13`'s fast
path never fired and the resolver ran. The resolver then declared:

```
04-change-due-date   blockedBy = ['02-list-ordered-by-due-date', '03-recognize-overdue-todo']
```

The issue file declares only `02`. **The resolver invented an edge.** Slice 04 waited ~9 minutes
for a slice it does not depend on — and, worse, `baseFor` takes the last blocker in dependency
order, so **04 was cut from 03's branch instead of 02's**. Its branch carries 03's code. Merging
it drags 03 in. The run went green on a graph nobody declared.

**Three holes, and they compound:**

1. **`slices` is not required** of the product owner (`MAKER_PO`, line 185 — only `ok`,
   `artifacts`, `hasUiStories`). Omitting the manifest is legal, so the unchecked resolver is not
   a fallback, it is the normal path.
2. **`blockedBy` is not required** either (`SLICE_ITEM`, line 141 — only `id`, `path`, `title`).
   A manifest with no edges is legal, and then every slice is level 0, every branch is cut from
   `main`, and the stacking invariant evaporates silently.
3. **The assertion that should catch this is circular.** `[R-BUILD-04a]` has the tester prove the
   base with `git merge-base --is-ancestor` — but `mustContain` and `mustNotContain` are derived
   from the same `blockedBy` the resolver invented. The tester proves the branch matches the graph
   it was handed, never the graph the issues declare.

**The fix, both halves.** The engine cannot read the disk, so it can never check edges against
`issues/` itself. Only an agent can.

- **Make `slices` and `blockedBy` required** in `MAKER_PO` and `SLICE_ITEM`. The po wrote the
  issue files; its manifest is first-hand. This deletes the re-derivation from the normal path.
- **Give the tester an independent read.** It already reads the working tree — have it read its
  own slice's `## Blocked by` section and assert it matches the `mustContain` it was handed. A
  mismatch is a critical defect, same class as `slice-branch-base`.

Neither alone is enough. Required fields still trust one agent's memory of a file it wrote; the
tester check alone leaves the resolver inventing edges that get rejected one slice at a time,
after the branch is cut. Together they are the maker/checker shape the rest of the system already
uses, applied to the one call `SPEC.md` §7 admits has no checker over it.

**The regression case is real and lives in `~/dev/code/todo`.**
`slice/due-date/04-change-due-date` is cut from 03's branch and carries the overdue-highlighting
code. **Leave it there.** Rebuilding it would destroy the only naturally-occurring instance of
this bug. Merging the leaves (05 and 06) gets every slice regardless, so the wrong base only bites
if you wanted 04 without 03 — check whether you do. When the fix lands, point the new tester check
at this branch and confirm it would have caught it.

**Done when:** a slice whose manifest disagrees with its issue file fails, and says which file it
disagrees with.


### What landed

`[R-BUILD-04b]` in `SPEC.md` §8, and eight checks in `verify.mjs` that prove it. `VERSION` is now
0.1.10 — `[R-PKG-07]` fired the moment the engine changed, which is the rule doing its job.

- `slices` is required of the po (`MAKER_PO`), `blockedBy` is required of every entry
  (`SLICE_ITEM`), and the manifest filter re-checks `Array.isArray(blockedBy)` so a malformed one
  falls back rather than being silently taken.
- The tester gets a new step **1a**, before the branch assertion: open the issue file, read
  `## Blocked by`, compare it with the blockers the engine handed it, and file a critical
  `slice-graph-mismatch` quoting both. A slice the engine believes is unblocked is told so
  explicitly — `NOTHING` — because silence would read as "not checked".
- Ordering is asserted: 1a must come before 1b, since `mustContain` is derived from the list 1a
  is checking.

**Mutation-tested.** Making `slices` optional, making `blockedBy` optional, and moving the graph
assertion after the branch assertion each turn `verify.mjs` red. A check that cannot fail is
decoration.

**Still open, same defect class:** `ui` is also optional in `SLICE_ITEM`, and `runSlice` tests
`slice.ui === true`. An absent `ui` therefore reads as false, and a slice that renders a screen
builds without waiting for the state matrix — silently. `[E2-06]` covers `ui:true` against a gated
ux node, but not this. Decide whether `ui` joins the required list.

## Labels — make the workflow view readable · DONE, in 0.1.10

**What was actually wrong.** Not the slice names. `SD-11` (`canonicalSliceIds`, line 295) already
recovers `NN-slug` from the issue filename, and it works — the `due-date` developer prompt reads
`slice/due-date/01-add-todo-with-due-date`. Two other things are wrong.

**(a) Roles are named inconsistently.** A document node's maker is `${node}:make` (line 972) while
its checkers are named by persona (line 1020), so you see `po:make` beside
`po:product-owner-critic`. The build node uses a third convention: `build:` (1554), `test:` (1589),
`review:` (1593) — two roles and one activity. `test:` reads as a TDD step, which it is not:
test-first happens *inside* the `build:` call, where the developer drives `skills/outside-in-tdd`.
The `test:` agent is the independent tester checking finished work.

**(b) The rows don't say how they relate.** Every spawn passes `phase: node.phase`, so six slices
x three personas land as eighteen rows in one flat `Build` box. Same one level up: `architect` and
`ux` both declare `phase: 'Design'` (lines 413, 435), so their four rows interleave, out of order,
because the two nodes run concurrently.

### The change

1. **Persona names everywhere.** `developer` · `tester` · `code-reviewer` · `product-owner` ·
   `product-owner-critic` · `architect` · `architect-critic` · `ux-design` · `ux-auditor`.
   No `make`, no `test`, no `review`.
2. **Group by unit of work, everywhere.** `Product · po`, `Design · architect`, `Design · ux`,
   `Build · <slice>`, `Report`. A row becomes `developer (1/5)` inside a box named for the slice.
   This does not touch the run report — that reads `phase` from the node table, not spawn options.

   ```
   Build · 01-add-todo-with-due-date        (today: one flat "Build" box)
     developer      (1/5)                     build:01-add-todo-with-due-date (1/5)
     tester         (1/5)                     test:01-add-todo-with-due-date (1/5)
     code-reviewer  (1/5)                     review:01-add-todo-with-due-date (1/5)
   ```

3. **The unit lives in the phase only**, so the constructor is `labelFor(role, round, rounds)` and
   never repeats the group header on every row. `verify.mjs` then routes on two fields with one
   job each: `o.label` for the role, `o.phase` for the unit. Its stubs already receive the whole
   options object; they just don't read `phase` today.

   **Untested surface, knowingly:** no current `verify.mjs` test tells two slices apart — they all
   stub a single slice — so slice routing ships without a consumer. The round-trip check below
   should exercise a unit-bearing phase anyway.

4. **One constructor, one parser.** `labelFor` in the engine, `parseLabel` beside it, replacing 21
   hand-written `startsWith` branches in `verify.mjs`. Both must be added to the `EXPORTS` list
   (`verify.mjs:292`) — it is hand-maintained, and a function missing from it is invisible to
   every check.

   **Why not a structured `role` field on the spawn options:** `verify.mjs` injects its stub as
   `agent`, *below* `spawn` (`new Function('args','agent',…)`), and `spawn` forwards `opts` to
   `agent()` untouched (line 643). A field would either be stripped in `spawn` and never reach the
   stubs, or reach the *real* `agent()`, whose options are a fixed documented set.

5. **All eleven sites, one pass** — 972, 1020, 1131, 1410, 1554, 1589, 1593, 1668, 1817, 1844,
   2100. The six with no persona get role names through the same constructor: `resolve-slices`,
   `release-worktrees`, `escalate`, `report`, `arbiter`. `escalate` and the slice arbiter sit in
   their slice's group; `resolve-slices` and `release-worktrees` are Build-phase and unit-less.
   Note the arbiter is `${node}:arbiter` at a document node and `arbiter:${slice}` at a slice —
   the same role written both ways round.
6. **Make it a rule, not a rename.** A numbered requirement in `SPEC.md` that every spawn label
   comes from the one constructor, enforced two ways: a regex over the engine source asserting
   every `label:` is a `labelFor(` call, and a behavioural check that `parseLabel(labelFor(...))`
   round-trips for every role. The regex catches the realistic failure — a string literal typed at
   a new call site; the round-trip catches a constructor that drifts from its parser. Same
   belt-and-braces as `[R-LOOP-06]`.

**Labels are load-bearing, which is why this needs the rule.** `verify.mjs` routes its stubbed
agents by matching label strings — 21 branches keying on `:make`, `build:`, `test:`, `review:`,
`arbiter:`, `escalate:`, `slices:resolve`, `po:`, `architect`. Renaming `test:` alone makes
`L.startsWith('test:')` stop matching; the stub falls through and the engine records a silent
tester. In the tests asserting a green run that fails loudly. In the tests asserting a *failure*
path, the run still fails — for the wrong reason, and nothing says so.

**Done when:** someone who has not read `SPEC.md` can watch `/workflows` and say what is
happening, **and** `verify.mjs` fails if a label is built anywhere but the constructor.


### What landed

`[R-LABEL-01..03]` in `SPEC.md` §6b, ten checks in `verify.mjs`, and this is what a build now
looks like:

```
Build
    resolve-slices
    release-worktrees
Build · 01-add-a-due-date
    developer      (1/5)
    tester         (1/5)
    code-reviewer  (1/5)
Build · 02-list-by-due-date
    developer      (1/5)
    tester         (1/5)
    code-reviewer  (1/5)
```

`labelFor(role, round, rounds)` and `parseLabel` live in the engine and are exported, so
`verify.mjs` routes on the **real** parser — no second copy to drift. All 11 call sites go through
the constructor; `groupFor(node, unit)` builds every progress group and no bare `node.phase`
survives.

**Bigger than estimated.** The router was ~60 branches, not the 21 `o.label` occurrences suggested
— `startsWith`, exact `===`, capture helpers keyed on `<prefix>:<id>`, and two places that sliced
the slice id out of the label with `L.slice(6)`. Converting the router before renaming anything was
the right call; doing it the other way round would have meant debugging both halves at once.

**Mutation-tested.** One label typed by hand → 1 failure. Groups losing the unit → 26. The
constructor drifting from the parser → **57** — which is the coupling this rule exists to make
visible, measured.

## Lane gate · DONE, in 0.1.10

`LANES = install ? MAX_LANES : 1` (line 1710). With no declared `commands.install` there are no
parallel lanes and no worktrees at all. Maven and Gradle resolve from a shared `~/.m2` or Gradle
cache, so a JVM project genuinely needs no install step and gets serialised for having nothing to
install — silently losing `E2-14` and the worktree isolation of `SD-04`.

**Fix: consent, not a probe.** A declared `lanes: N > 1` means the project asserts a fresh
worktree is testable. One line in `buildSlices`, no new runtime failure mode, wrong only if the
human lies. **Log it when the consent path is taken** — the current code already says so when it
stays sequential, and the new branch should be as loud.

A probe was considered and rejected: the engine cannot run commands, only spawn agents, so a probe
is either an agent call inside every run or a full test-suite run in the pre-checks, and both pay
forever. Instead **add one line to the pre-checks telling the user to try a worktree manually,
once, per project.** `HANDOFF.md` already schedules exactly that dry lane for run 6.

**`lanes` being root-only is not a bug.** It caps one scheduler that runs every slice regardless
of directory, so a per-directory value has no coherent meaning — unlike `commands` and `seam`,
which are per-slice facts. State it in `SETUP.md` and stop carrying it as an open defect.

**Temper the expected payoff.** The `due-date` run had `lanes: 4` *and* an install command, so
lanes were fully available — and six slices still ran nearly one at a time, because the graph is a
chain: 01 → 02 → {03, 04} → {06, 05}, maximum width two. This fix matters for JVM projects that
declare no install. It cannot parallelise a chain. See the open question at the bottom.


### What landed

`[R-BUILD-04c]` in `SPEC.md` §8, five source checks and a behavioural probe in `verify.mjs`,
plus the pre-check and the `SETUP.md` §2b/2c rewrite.

`LANES = install ? MAX_LANES : byConsent ? declaredLanes : 1`, where `byConsent` is a deliberately
declared `lanes: N > 1` with no install command. The behavioural probe builds a JVM-shaped project
— real test command, no install step, `lanes: 2` — and asserts both slices get their own worktree
and the run records `opened: 'declared-lanes'`.

**Both paths are logged, and the consent path says nothing verified it.** That sentence is
asserted, because a slice failing on missing dependencies otherwise reads as a slice with a bug
rather than as a claim the project got wrong.

**Two checks encoded the old rule and were rewritten, not deleted** —
`lanes open only when the project declares an install command` was the bug, not the guard.
`SPEC.md` §13 says to name which of the two is wrong before changing either; it was the rule.

**Mutation-tested.** Reverting to the install proxy → 3 failures. Dropping the "nothing here
verifies it" sentence → 2.

**`lanes` root-only is documented, not fixed** (`SETUP.md` §2c) — it caps one scheduler that runs
every slice whatever directory it touches.

## The developer's 51% — measure, then decide · after run 6

The single largest cost in a run, and nothing on this list touched it until now: **64.9 of 127.1
minutes of agent time, six calls at 6.7–13.3 minutes each**, at `opus`/`xhigh`. Every other
performance item fights over the other half.

**Measure first.** It is unknown how much of an 11-minute developer call is model time and how
much is waiting on the project's test suite — and `due-date`'s suite is
`(cd backend && mvn -q -B test) && (cd frontend && npm test)`, which is not fast. Add an
`--agent <id>` drill-down to `bin/run-timing.mjs` that breaks one call into tool-call spans and
totals the project's own `commands.test` separately. Keep it out of the default report; the four
summary numbers are what that view is for.

**Then decide.** If it is mostly model time, cutting effort to `high` is the `E-09` argument
applied where an executable oracle exists — the tester and reviewer catch a worse result. Measure
before and after, because a developer that fails more often costs a whole extra attempt, and an
attempt is two more calls plus a full suite run.

**Not in 0.1.10.** Run 6 must vary as little as possible.

## Feature branch — build with many, deliver one · leaves DONE, assemble node in 0.1.11

**What you actually handle should be one branch per feature.** The graph keeps slice branches as
how it *builds* — isolation, lanes, per-slice granularity — and gains a step that assembles them
into `feature/<slug>` as what it *delivers*.

### The leaves half landed in 0.1.10

`[R-REP-09]` in `SPEC.md` §9, `mergePlan` in the engine, nine checks in `verify.mjs`. On the real
run-5 graph it returns `leaves: 05, 06` — merging 06 brings 01, 02, 03; merging 05 brings 01, 02,
04. The report node is told to print a **What to merge** section whenever anything shipped, lead
with the count, and say the other branches are for review rather than merging.

Leaves are taken over the **shipped** subgraph, so an escalated branch is never proposed. A
defensive case is pinned too: a leaf never claims to bring a branch that did not ship. That test
exists because the first mutation run left that mutant alive — unreachable today, but it would
have told a human to expect code that was never built.

**The `EXPORTS` gotcha bit, exactly as this file predicted.** `mergePlan` was invisible to every
check until it was added to the hand-maintained list at `verify.mjs:292`. Second time in one
session; the note stays.

**First, a fact that makes today less bad, and it shipped in 0.1.10.** The branches you must merge
are the **leaves of the dependency graph, not the slices**. In `due-date`, slice 06's branch
already contains 03, 02 and 01, and slice 05's already contains 04, 02 and 01 — so merging those
two gets all six. Today's real cost is two merges, not six; the report just never says so. Put the
merge order and the leaf set in the run report. It cannot change a verdict, so it belongs in
0.1.10, and it is the same computation the assembler needs — write it once, prove it in the
report, reuse it in the node.

### The assemble node · 0.1.11

**A new `kind`, with its own runner.** Edges `build → assemble → report`. `[R-GRAPH-06]` — adding
a node needs no executor change — holds only for a kind that already has a runner, and
`[R-GRAPH-01]` fixes the kinds at `loop · fanout · report`. Assembly genuinely is loop-shaped (the
assembler is the maker, the suite on the assembled branch is a binary checker, rounds 1, a red
suite hard-fails without arbitration exactly as the rule already says) — but `runLoop` reads
`RUBRICS[node.rubric].threshold` unconditionally (line 941), so reusing `loop` would need a rubric
that scores nothing, and the node table is meant to read as the truth about what each node does. A
kind *without* a runner is the violation; a kind added alongside its runner is not.

**Roles.** Maker `agent: null` at `sonnet`/`low` — the `report` node already shows that shape.
Checker is the existing **tester** persona, binary, `opus`/`medium`: the merging is mechanical and
must stay so, all the judgement is in the suite result, and the tester is already the role whose
authority is a green suite, already runs the declared command, and stays read-only on git.
Reusing it means the integration verdict carries the same weight as a slice verdict.

**Merge, never rebase.** `[R-BUILD-01]` says the shipped sha and the sha a tester passed are one
commit — which is why the arbiter may not commit. Cherry-picking or rebasing produces new shas no
tester ever saw, reintroducing that hole through a different door. Merging keeps every verified
commit reachable. A pure chain assembles entirely by fast-forward, so the common case creates no
merge commits at all.

**Merge the leaves of the *shipped* subgraph, in dependency order.** Correct because a stacked
branch contains its ancestors. A middle slice whose dependent escalated is itself a leaf of what
shipped. **Skip the node entirely when nothing shipped** — an empty `feature/<slug>` identical to
the default branch would read as a delivered feature.

**Never resolve a conflict.** Two independent slices touching one file will collide. Resolving
means writing code no tester has verified — the arbiter-commits problem wearing a different hat.
On conflict: abort the merge, leave the branch at the last clean slice, and report which two
slices collided on which files. You are then left with a partial feature branch *and* every slice
branch, which is strictly more than today.

**Refuse an existing `feature/<slug>`.** Never overwrite, never force. A second run of the same
feature will find the previous run's assembly, which you may be mid-review on, and the run cannot
know. Report the collision and leave the slice branches as that run's deliverable. Silently moving
a branch someone may be reviewing is the one thing this design already refuses to do for the
default branch; the reasoning does not stop being true one namespace over.

**Test the assembled branch once, and report it as its own verdict.** This is what makes assembly
worth building rather than a convenience. Every slice was green alone; two green slices can still
be broken together, and no textual conflict reveals it. Six runs have never produced that signal.
It is cheap — testers on `due-date` ran 1.3 to 2.3 minutes.

- Red **makes the run non-clean**, on the same principle that a soft-pass never reports as clean.
- Red **never un-ships a slice.** The slice branches stay exactly as they were, `feature/<slug>`
  is handed over red with the failure quoted, and the combination becomes a `VERIFY-WITH-HUMAN`
  record. Silently withdrawing a slice a tester passed is the one thing it must not do.

**Documentation this contradicts.** "sdlc2 never merges" becomes "never merges *to your default
branch*" — which is what `[R-BUILD-06]` has always actually said. Four places say it today:
`modes/new-feature.md`, `README.md`, `SPEC.md` §8, and `docs/harness.html` (twice).

**Not run 6.** It is the largest behavioural addition on this list — a new node, a new kind, a new
verdict and a new failure mode — and it would land on the first Maven run alongside a lane-gate
change. Run 6 also tells you what it is worth: if `instrument-service` comes out as another chain,
the leaves fact alone nearly covers it; if it comes out wide, the integration test is where the
real bugs will be.

## Speculative start · 0.1.11

Kept, but below the developer question — it is the largest and riskiest change, and no longer the
biggest number.

**Its evidence, corrected.** It was justified as "half the document phase". On the complete
`due-date` run the document phase is 24.8 of 96.6 minutes and the critic wait inside it about 13 —
roughly **13% of the run**, not half of it. The mechanism is still sound; the prize is smaller
than the first measurement suggested.

The critic must pass before the node **ships**. It does not have to pass before the next node
**starts**. Start `architect` on the product owner's round-one output while the po critic is still
running. If the critic rejects, throw the architect's work away and re-run it against the repaired
artifact — the cost you would have paid anyway, plus tokens on the discarded path.

**Why it is safe.** No gate moves. The critic still has to pass before the node settles, its
verdict still lands in the report, nothing ships on an unchecked artifact. Only what the graph
*waits on* changes — the same shape as `E2-14`.

**The evidence, and its limits.** The document nodes passed at round one in every run measured so
far. That is a thin base. If doc nodes start failing round one on harder features the trade
inverts. **State the trade in `SPEC.md`** rather than leaving it to be rediscovered.

---

## The measurement this rests on

`due-date` on `~/dev/code/todo`, engine 0.1.9, 27 agent calls, via `bin/run-timing.mjs`:

```
wall-clock 96.6 min · agent time 127.1 min · ratio 1.31x · largest idle gap 0.2 min

  node        calls   span        agent time
  po              2   6.4 min      6.4 min
  ux              2   7.5 min      7.4 min
  architect       2  18.3 min     18.2 min
  build          21  71.8 min     95.0 min

  role                 n   min    max    total
  developer            6   6.7   13.3    64.9      <- 51% of all agent time
  code-reviewer        6   1.9    3.6    16.4
  tester               6   1.3    2.3    11.2
  architect            1  10.5   10.5    10.5
  architect-critic     1   7.7    7.7     7.7
  resolve-slices       1   0.5    0.5     0.5
```

1. **Call cost is not uniform** — it runs from 0.3 to 13.3 minutes. An earlier note in this file
   claimed "every agent call costs 5.5–7.6 minutes; there is no cheap call". That was generalised
   from the document phase of one incomplete run and is **wrong**. Checkers are cheap; developers
   are not.
2. **Building is three quarters of the run** — 71.8 of 96.6 minutes, and the developer is most of
   that.
3. **Rounds were at the floor.** Every node passed on its first round, so cutting `DOC_ROUNDS`
   saves nothing on a clean run.
4. **Concurrency barely happened** — 1.31x, with six slices and four lanes available, because the
   slice graph is a chain.

## Open question — for `SPEC.md` §11, not for this list

**Nobody has measured whether a feature's slice graph could be wider.** Run length is serial depth
x per-call cost, and the product owner sets the depth when it cuts the story map. `PO-INVEST`
rewards "walking skeleton first", which builds a chain by construction — `due-date` came out six
slices deep and two wide. No lane fix and no scheduling change can parallelise that. Whether the
same feature could have been cut wider *without hurting the slices* is unknown, and it is the
largest unexplored lever in the system. Name it in the Deferred section; do not act on it yet.

## Dead ends — do not re-try these

- **Cutting rounds.** Already at the floor on a clean run. It only helps runs that were retrying,
  and those are the runs where the extra round is doing its job.
- **Shrinking prompts.** Engine prompts are 600-1400 tokens. Measured before v0.1.3; never where
  the time went.
- **Cutting critic effort to `high`.** The critics' authority *is* deliberation, and on the
  measurement above they are the cheap calls — 11.2 and 16.4 minutes against the developer's 64.9.
  `E-09` cut the tester's effort because its authority is a green suite, not judgement; the
  argument does not carry to the critics, and the numbers say it would not pay anyway.
- **Making `lanes` per-directory.** See the lane gate item — it has no coherent meaning.
- **A structured `role` field on the spawn options.** See the labels item — the stub seam sits
  below `spawn`, so the field is either invisible to `verify.mjs` or handed to the real `agent()`.
- **Inferring a critical path from transcript timestamps.** The timing script deliberately does
  not: it has the clock, not the graph.

## Packaging

`bin/` and `docs/harness.html` ship inside the plugin on purpose — the marketplace entry uses
`source: "./"`, so everything in the repo does. **This file should not.** Same category as
`HANDOFF.md`, which flags the identical problem about itself (`E2-01`).
