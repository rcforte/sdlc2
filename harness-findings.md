# sdlc2 harness findings

Defects in the **sdlc2 plugin** found by running it. Not defects in whatever code the graph was
pointed at — that is the target, and on the lab repo it is disposable by design, existing only to
give the graph something real to chew on.

This log lived in `sdlc2-lab/docs/` for runs 1–5, when there was only one target. It moved here
before run 6, which targets `dev/code/db`: a record of the plugin's own defects belongs with the
plugin, not with whichever repo happened to be in front of it.

> **Read the version line on every finding.** Runs 1 and 2 in this repo executed sdlc2 **0.1.1**
> while **0.1.2 was the installed version** — see SD-03, which is why. SD-01 and SD-02 were real
> in the engine that ran, and both were already fixed upstream in 0.1.2 before this lab
> reproduced them. They are kept because independent reproduction from outside the plugin is
> worth having, and because the evidence is the regression test.
>
> The third run — `nf-20260822T2305Z`, feature `saved-name` — executed **0.1.3**, verified before
> it started rather than after: the session's router text named the 0.1.3 directory, and a
> discriminating probe confirmed the plugin root reached the persona *already expanded* to that
> same directory. It is the first run in this repo whose engine version is evidence rather than
> assumption, and it is what turns SD-01 and SD-02 from "fixed upstream" into "verified fixed".

---

## SD-01 — The build node picks a slice's branch base by index, not by `Blocked by:`

**Affected:** sdlc2 0.1.1 · **Status:** **VERIFIED FIXED** in 0.1.3 (`baseFor()`, `[R-BUILD-04a]`)
— see *Verification* at the end of this finding
**Severity:** high · **Found in:** run `nf-20260816T0246Z` (`greet-visitor`)

### What happened

`build` stacked slice *N* on slice *N-1* in file order. `blockedBy` was parsed and used for skip
logic, but never consulted when choosing a branch base. Run 1 declared a genuine diamond —
issues 03 and 04 are **both** `Blocked by: 02-blank-name-alert`, making them siblings:

```
declared:  02 -+- 03            actual:  02 - 03 - 04
               +- 04
```

Verified against the merged SHAs (`02=368aed6 03=6a1efc4 04=a296fc8`):

```
$ git merge-base --is-ancestor 368aed6 a296fc8   # 02 is ancestor of 04 - required, true
$ git merge-base --is-ancestor 6a1efc4 a296fc8   # 03 is ALSO ancestor of 04 - never declared
```

Slice 04 was cut from 03 despite declaring no dependency on it, so it could not be reviewed or
reverted without 03 coming along. 0.1.2's own `SPEC.md` §12 describes this verbatim.

### Why run 2 could not catch it

`greeting-log`'s `po` declared a pure chain (`01<-none`, `02<-01`, `03<-02`), so there were no
sibling slices and no parallel edge to get wrong. **A gate that checks only for the *presence* of
`Blocked by:` lines passes that run while learning nothing. Presence is not the property that
matters; branching is.** Any gate should assert that two slices which are siblings in the
declared graph are siblings in git — neither an ancestor of the other.

### A diamond cannot be ordered up

An attempted replay of `greet-visitor` from its original seed (run `nf-20260822T2015Z`, aborted)
produced a **different slicing**: two slices in a chain, not four with a diamond. The `po` is not
deterministic about how it cuts a capability, so "re-run the feature that produced a diamond
last time" is not a reliable way to obtain one. Exercising this path end to end needs a seed
written so that two slices are genuinely independent of each other.

### The 0.1.1 spec could not have been satisfied

`SPEC.md:185` required branches "cut from the default branch" while `SPEC.md:160` required each
issue to carry `Blocked by:`. Those are mutually exclusive: a slice cut from the default branch
cannot contain the code of the slice it declares itself blocked by, so its acceptance test could
not pass. 0.1.2 resolves it by splitting the rule and making the **tester** prove the base with
`git merge-base --is-ancestor` against the base, the blockers and the non-blockers.

### Note for anyone writing that assertion

`git merge-base --is-ancestor` exits non-zero on a **deleted or unknown ref**, which is
indistinguishable from a true negative when consumed with `||`. Reproducing SD-01 initially
reported PASS for branches that no longer existed. Resolve the refs first.

### Verification — run `nf-20260822T2305Z`, feature `saved-name`

The `saved-name` seed was written so the `po` could not produce a chain without contradicting it:
saving presupposes a greeting, while greeting again and the saved-name hint each presuppose a
saved name and need **nothing from each other**. The seed stated those as domain facts and named
no slices, so the `po` still had to find the shape. It found a larger one than predicted — five
slices with three siblings and a two-blocker join:

```
        +-- 02 greet again --+
01 -----+-- 03 hint at field-+-- 05 fresh visit
        +-- 04 replace
```

Issue 04 volunteered the negative in its own `Blocked by:` line: *"Not blocked by 02 or 03."*

The full ancestry matrix, every ref resolved first (see the note above):

```
            01    02    03    04    05
    01       -   YES   YES   YES   YES
    02       .    -     .     .    YES
    03       .    .     -     .    YES
    04       .    .     .     -     .
    05       .    .     .     .     -
```

Every negative holds: `02` and `03` are siblings, and `04` is an ancestor of nothing. Under 0.1.1
this matrix reads as a solid diagonal (`01 ⊂ 02 ⊂ 03 ⊂ 04 ⊂ 05`). **This is the assertion runs 1
and 2 could not express** — run 1's four slices were mutually independent, so every stacking was
vacuously consistent; run 2's `po` returned a pure chain, so there were no siblings at all.

The two-blocker join is handled by an actual merge rather than by picking one blocker and
re-implementing the other:

```
29c2817 Merge slice 02 into slice 05: inherit "Greet me again", never re-invent it
```

**The tester really did run the assertions** — all seven tester invocations call
`git merge-base --is-ancestor`, 3–7 times each. That was the open question: the invariant is only
real if something executes it.

All five branches were re-run independently of the tester and are green — 42 / 51 / 47 / 45 / 58
tests against a 31-test baseline.


---

## SD-02 — The run report is left untracked, dirtying the tree for the next run

**Affected:** sdlc2 0.1.1 · **Status:** **VERIFIED FIXED** in 0.1.3 (`[R-REP-03]`)
— see *Verification* at the end of this finding
**Severity:** medium · **Found in:** run `nf-20260822T0327Z` (`greeting-log`)

The build node committed the graph's artifacts (`7d12e31`), but the run report is written *after*
that commit and was never committed:

```
$ git status --porcelain
?? .sdlc2/features/greeting-log/runs/
```

`modes/new-feature.md` pre-check 1 requires a clean tree and stops otherwise, so a **successful**
run left the repo in a state where **the next run refuses to start** — cause and symptom one run
apart. In 0.1.1 no requirement covered committing it (`R-REP-01/02` cover only that it is
*written*). 0.1.2 adds `[R-REP-03]`: the report node commits `.sdlc2/` and `docs/adr/` to a
`sdlc2/<feature>` branch, and appends a `## Paperwork not committed` section when it cannot.

Run 1 committed *none* of its artifacts; run 2 committed all but the report. The gap was already
closing.

### Verification — run `nf-20260822T2305Z`

Clean. `sdlc2/saved-name` exists and carries the artifacts, `HEAD` is left on it,
`git status --porcelain` is empty, and the report contains no `## Paperwork not committed`
section. The next run is not blocked by this one.


---

## SD-03 — A session pins `${CLAUDE_PLUGIN_ROOT}` at start, so a mid-session plugin update is invisible

**Affected:** the Claude Code plugin harness, not sdlc2 · **Status:** open — **did not recur** in
`nf-20260822T2305Z`, because that session was started after the update and its resolved root was
checked before spending. The mechanism is untouched; only this run's exposure to it was.
**Severity:** high — silently runs a stale engine and invalidates everything measured with it

### What happened

This session began 2026-08-15. sdlc2 was updated to 0.1.2 on 2026-08-21 22:26. The session's
router text still carried the absolute path it was injected with:

```
/home/rcforte/.claude/plugins/cache/sdlc2-marketplace/sdlc2/0.1.1
```

while `installed_plugins.json` recorded:

```json
"sdlc2@sdlc2-marketplace": [{ "installPath": ".../sdlc2/0.1.2", "version": "0.1.2" }]
```

Both version directories exist side by side in the cache, so the stale path kept resolving and
kept working. Every graph run in this session — runs 1 and 2 and the aborted replay — executed
0.1.1's engine, its personas and its skills.

### Why it is worth filing

Nothing signalled it. The runs succeeded, the reports were written, the verdicts looked normal.
It surfaced only because a finding was filed against `SPEC.md` and the requirement IDs the human
expected (`R-BUILD-04a`, `R-REP-03`) were absent from the spec being read — they exist in 0.1.2.

The costs were real: two full graph runs (~6.3M agent tokens) measured a superseded engine, two
defects were "found" that the author had already fixed, and a patch was written against a cache
directory that is both overwritten on update *and* already superseded.

### What to do about it

- **Print the version being executed.** A run report stating its own `pluginRoot` and `VERSION`
  would have caught this on run 1's first line. That is a cheap addition to `[R-REP-01]` and the
  single highest-value change suggested by this lab so far.
- Treat a long-lived session as pinned. After updating a plugin, restart the session, or pass the
  resolved path explicitly instead of relying on the injected router text.
- When a finding cites a requirement ID that is absent from the spec you are reading, suspect
  version skew before concluding the ID does not exist.

---

## SD-04 — Parallel lanes break the declared test command, and gitignoring the worktrees is only half the fix

**Affected:** sdlc2 0.1.3 · **Status:** open
**Severity:** high — turns a green project red the moment `commands.install` is declared
**Found in:** run `nf-20260822T2305Z` (`saved-name`), by the developer building slice 05

### What happened

`commands.install` unlocks parallel slice lanes: independent slices build concurrently, each in
its own git worktree under `.sdlc2/worktrees/<feature>/<slice>`. Those worktrees are **inside the
repository**, and each one gets its own `node_modules` from the install command.

The declared test command then collects them. `npm test -- --run` in the main checkout globs into
the sibling worktrees, loads their test files, and renders components against a **second copy of
React**. Measured in this repo while the lanes were live:

```
without the exclusion:  16 test files,  98 failures
                        every one: "Cannot read properties of null (reading 'useState')"
with the exclusion:      4 files,       all passing
```

`.gitignore` was already correct — `76c4831` ignores `.sdlc2/worktrees/` and `.claude/worktrees/`,
which is what `SETUP.md` asks for. That keeps the worktrees out of **git**. It does nothing about
the **test runner**, and the test runner is the thing sdlc2 uses as its oracle.

### Why it matters more than it looks

The failure is *self-inflicted by the feature that was just switched on*, it appears only while
lanes are running, and it makes every concurrent slice's suite red for a reason that has nothing
to do with the slice. A tester seeing 98 failures has no way to tell that from a genuinely broken
slice; the natural response is to escalate the slice as `tester-red`.

This run survived it only because the developer diagnosed it, fixed `vite.config.ts`, and
isolated the fix in its own commit with an explanation that it belongs on `main`:

```
29ca8fd chore: keep sibling git worktrees out of this project's vitest run
```

That is exemplary agent behaviour, and it should not be load-bearing. A different developer, or a
stack whose runner is less forgiving, escalates instead.

### What to do about it

- `SETUP.md` and pre-check 4 should say that declaring `commands.install` also requires the
  project's **test runner** to exclude the worktree path — not just git. Vitest needs
  `test.exclude`; jest `testPathIgnorePatterns`; pytest `norecursedirs`; Maven is unaffected.
- Better: put the worktrees **outside** the repository (a sibling temp dir), which removes the
  whole class. The engine's own comment at `WORKTREES` explains why they are not under
  `${DIR}` — the same reasoning extends one level further out.
- Failing both, the lane setup could verify the baseline suite still passes *inside a worktree*
  before handing slices to it, and fall back to sequential with a logged reason if not.

---

## SD-05 — A transport failure is scored as a content defect, and costs the node its pass

**Affected:** sdlc2 0.1.3 · **Status:** **CLOSED** — fixed in 0.1.4 (`[R-LOOP-11]`), proven by
probe P18b. Closed 2026-08-24 after five runs and ~150 agent spawns never once produced the
transport failure that would exercise it in the wild. Waiting for a live reproduction was costing
more than the probe was worth: the free retry, the `errored` history row and the harness-defect
path are each asserted directly, and the one thing a run would add — that real API errors take
that path — is the part the probe stubs faithfully.
**Severity:** medium — manufactures soft-passes and VH records out of infrastructure noise
**Found in:** run `nf-20260822T2305Z` (`saved-name`), `ux` node

### What happened

The run's **only** soft-pass was not a design failure. The workflow's own failure line reads:

```
[ux:make (2/2)] failed: API Error: Connection lost mid-response.
```

The round-2 checker saw an empty maker result and recorded its sole defect as *"maker agent
returned nothing"* — critical. With the round budget spent, the node arbitrated to **soft-pass at
0.79**, and the arbiter wrote `VH-ux-01`, which correctly reads the whole thing as *"an
engine/transport failure rather than a content defect"* and keeps round 2's `mockup.html`.

So the graph reached the right artifact. But on the way it burned a round, lost the node's clean
pass, produced two VH records a human now has to read, and reported the run as not clean — all
from one dropped connection.

### Why it is worth filing

`ux` scored **0.79** in round 1 against a 0.80 bar. It was one repair round from passing on
content, and that repair round is exactly what the transport error consumed. The reported score
of a node is therefore partly a measure of network luck.

It also corrupts the very data 0.1.3 added the round histories to collect: `ux`'s history reads
`0.79 → (no score)`, which is indistinguishable in shape from a maker that genuinely collapsed.

### What to do about it

- **Retry a maker/checker call that fails at the transport layer before charging it a round.**
  The engine can already tell the difference — the failure arrives as a thrown API error, not as
  a returned-but-empty result — so this is a `catch` around the spawn, not a heuristic.
- Failing that, do not let an empty result from a *thrown* call reach the checker as an artifact
  to score. An agent that never answered has not made a mistake worth a defect record.
- The run report should mark such a round as `errored`, distinct from `rejected`, so the score
  history stays readable.

---

## SD-06 — A background workflow makes no progress while the session sits idle

**Affected:** the Claude Code harness, not sdlc2 · **Status:** open
**Severity:** medium — no wrong results, but every wall-clock measurement is meaningless
**Found in:** run `nf-20260822T2305Z`

### What happened

The graph was launched as a background `Workflow` and the session was then left idle awaiting
user input. Agent completions stop dead for **three hours and one minute**, then resume within
about a minute of the session becoming active again:

```
19:45:14   architect (opus)        <- last completion before the gap
           ......  3h 01m, nothing  ......
22:46:26   ux-design (sonnet)      <- first completion after the session woke
```

Total elapsed for the run was 4h 41m. Actual agent work was roughly 1h 40m.

### Why it is worth filing

Nothing about it is visible from inside the run. The report's timings, and any conclusion drawn
from "how long does a graph take", are dominated by how often a human happened to type. A run
that looks hung after an hour may simply have had nobody in the room.

It also directly contradicts the natural operating model for a 35-agent graph — launch it and
come back later — and it is the reason this run took an evening rather than two hours.

### What to do about it

- Do not walk away from a graph run; keep the session doing something, or drive it from a context
  that stays active.
- The run report already stamps a `runId`; stamping **agent wall-clock** separately from elapsed
  time would make the distortion visible instead of silent.

---

## SD-07 — The architect can declare a dependency edge that contradicts the `po`'s issues, silently

**Affected:** sdlc2 0.1.3 · **Status:** open
**Severity:** medium — near-miss here; would have collapsed the diamond had the engine honoured it
**Found in:** run `nf-20260822T2305Z` (`saved-name`), `VH-03`

### What happened

The `po` wrote issue 04 with an explicit negative:

```
Blocked by: 01-save-the-greeted-name (replacing presupposes an existing save). Not blocked by 02
or 03 — this story exercises only the save control and the region it writes to.
```

The `architect` disagreed — it judged that one of issue 04's assertions needs slice 02's
"Greet me again" control — and rather than amend the issue, **declared slice 04 blocked by 01 and
02 in `design.md`/ADR-0025**, then raised `VH-03` asking a human to confirm the edge.

The engine ignored it. `baseFor()` reads `issues/`, so slice 04 was cut from 01 alone, and the
ancestry matrix confirms 04 is a descendant of 01 only. The developer resolved the tension inside
the test instead, encoding the permitted controls as a closed list and noting in a comment that
`"Greet me again"` ships with issue 02 and is not on this branch.

### Why it is worth filing

The outcome was right and the slicing survived — but two artifacts of the same run disagree about
the dependency graph, and only one of them is executable. Had the engine consulted `design.md`,
slice 04 would have been stacked on 02 and **this run's diamond would have collapsed into a
chain** — silently reproducing SD-01's symptom through a different door.

Note also what it implies about `VH-03`: a human reading it is being asked to confirm an edge that
the build already ignored, on a slice that already shipped.

### What to do about it

- Make `issues/` the single source of truth for the queue, and say so in the architect's prompt:
  a dependency disagreement is a **defect to raise against the `po` node**, not an edge to
  declare downstream.
- Or let the architect amend the issue file, and have the `po`-critic score the amendment. Either
  is fine; having both artifacts assert a graph, with only one consulted, is not.
- Cheapest guard: after the design node, assert that every `Blocked by:` edge mentioned in
  `design.md` exists in `issues/`, and fail the node if it does not.

---

## SD-08 — The report could not say how the slices were built

**Affected:** sdlc2 0.1.4 · **Status:** fixed in 0.1.5 (`[R-REP-05]`)
**Severity:** medium · **Found in:** run `nf-20260823T1333Z` (`remembered-names`)

Recorded here for continuity — the finding was worked in the plugin repo rather than this file.
The scheduler knew whether it opened lanes and `log()`ed it, which reaches the person watching
the run and nobody else. The report, the artifact that outlives the run, was never handed the
fact, so run 3's report is silent in both directions: it does not say lanes fired, and they did.
`[R-REP-05]` carries `lanes` from the scheduler through the build node to the report prompt, which
is told to state it either way.

---

## SD-09 — Two different engines can both call themselves the same version, and pre-check 0 cannot tell

**Affected:** sdlc2 0.1.6, and every version before it · **Status:** **repo-side half FIXED** in
0.1.8 (`[R-PKG-07]`); the reporting half is **open**
**Severity:** high — it defeats SD-03's fix through the one door that fix cannot watch
**Found:** 2026-08-23, **not by a run.** Found by diffing the plugin repo against the install
cache while setting up run 5, after run 4's own fix had been committed.

### What happened

Run 4 (`nf-20260823T2033Z`, `saved-at`) executed a correctly installed engine. Its report header
reads `Engine: sdlc2 0.1.6`, engine path `.../cache/sdlc2-marketplace/sdlc2/0.1.6`, and both were
true: `v0.1.6` was tagged at `09839cf` and installed at that same sha.

The run then found a defect — a fan-out node's row rendered as `build | pass | — | 0`, which reads
as a node nobody measured when build had in fact been measured once per slice. It was fixed and
pushed the same evening as `9966578` (`[R-REP-06]`), touching `new-feature.workflow.js`,
`verify.mjs` and `SPEC.md`.

`VERSION` was left at `0.1.6`.

So from 18:35 EDT there were two trees calling themselves 0.1.6:

| | commit | `[R-REP-06]` |
|---|---|---|
| plugin repo `main` | `9966578` | yes |
| install cache `sdlc2/0.1.6` | `09839cf` | **no** |

### Why pre-check 0 cannot see it

Pre-check 0 resolves `${CLAUDE_PLUGIN_ROOT}`, reads the `VERSION` beside it, then compares the
root's **directory name** against version-numbered siblings with `sort -V`. Executed against this
state it prints:

```
sdlc2 0.1.6 — engine at /home/rcforte/.claude/plugins/cache/sdlc2-marketplace/sdlc2/0.1.6
```

and stops there. `0.1.6` is the newest sibling, so no `STALE` line fires, and the run proceeds on
an engine three files behind the repo. The check is not broken — it is answering a different
question. SD-03 was *older directory, newer one installed*, which a name comparison catches. This
is *same directory name, different contents*, which no name comparison can catch.

The next report would read `Engine: sdlc2 0.1.6` — true, and useless. It names the version, not
the build.

### Why it is worse than SD-03

SD-03 cost ~6.3M agent tokens measuring a superseded engine, and surfaced only because a finding
cited requirement IDs absent from the spec being read. That tell existed because the two engines
were far enough apart to contradict each other. Same-version drift gives no such tell: the version
line agrees with itself, the engine path is correct, and the delta is whatever was pushed since
the last install — typically the newest fix, i.e. exactly the change the next run was meant to
exercise.

Note the shape of it. The thing that has actually been holding this line is a human convention —
bump `VERSION` with every engine change, which is why the `v0.1.4` tag was created in the first
place. The convention is sound and has held for five releases. It is not a check, and here it
slipped for four hours across a commit that changes the engine.

### What to do about it

- **Catch it in the repo, at the moment of the mistake.** ✅ **Built as `[R-PKG-07]` in 0.1.8.**
  `verify.mjs` now fails when any runtime-read file has moved since the tag named by `VERSION` was
  cut. Runtime-read is `new-feature.workflow.js`, `commands/`, `modes/`, `agents/`, `skills/` and
  `.claude-plugin/plugin.json` — deliberately not `SPEC.md`, `verify.mjs` or the working notes,
  which no run reads. Committed and uncommitted drift both count. Two documented skips keep it
  inert where it would be wrong rather than merely quiet: a `VERSION` with no matching tag is a
  release in preparation, and a checkout with no git is the install cache.

  Proven rather than asserted, against the real case among others: replaying `9966578` with
  `VERSION` at `0.1.6` fails and names `new-feature.workflow.js`. And the false-positive direction
  was checked live — `SPEC.md` and `verify.mjs` both moved after `v0.1.7` was tagged and the probe
  stayed green.

  **What it does not do:** fire on its own. It is a probe in a suite someone has to run. That is
  a real limit, not a quibble — the convention it replaces also only worked when someone
  remembered.
- **Make the report name the build, not just the version.** ⬜ **Still open — this is what keeps
  SD-09 unclosed.** Stamp the commit sha into the plugin at release (a `BUILD` file beside
  `VERSION`, or `0.1.7+9966578`) and have pre-check 0 print it and pass it through as `version`.
  It does not prevent drift, but it makes a stale run identifiable from its own report afterwards,
  which today it is not. `[R-PKG-07]` guards the repo; nothing yet guards a run launched from a
  cache that drifted for any other reason.
- `installed_plugins.json` already records `gitCommitSha` per install, so the provenance exists on
  the harness side — but the cache is a copy, not a git checkout, so the plugin has nothing to
  compare against until it stamps itself. That is why the stamp comes first.

### Immediate state

`[R-REP-06]` ships as **0.1.7** and the guard as **0.1.8**, both tagged and pushed. Neither was
ever installed separately — they collapse into one `claude plugin update` and one restart, which
is the human half and is what SD-03 already requires.

The finding stays open on its second half. `[R-PKG-07]` makes the next recurrence *fail loudly in
the repo*; it does not make a run that already started on a drifted cache say so.

---

## What run `nf-20260822T2305Z` confirmed working

Recorded because a findings file that lists only defects loses the evidence that the fixes landed.

- **`baseFor()` / `[R-BUILD-04a]`** — see SD-01's *Verification*. First real-agent confirmation.
- **Tester base assertions** — all 7 tester invocations executed `git merge-base --is-ancestor`.
- **`[R-REP-03]`** — paperwork committed to `sdlc2/saved-name`, clean tree, `HEAD` parked there.
- **Parallel lanes** — three developers started at the identical second (23:02:48) in three
  worktrees, and `git worktree list` showed only the main checkout when the run ended, with all
  five `slice/*` branches intact.
- **`DOC_ROUNDS = 2`** — `po` passed unaided (0.72 → 0.88) and `architect` passed unaided
  (round-1 rejection → 0.87), both without an arbiter. Run 1's "all three doc nodes burn all five
  rounds and arbitrate anyway" is gone. Both still spend their full 2 rounds, though — neither
  passed in one.
- **Agent independence (`R-IND-02`)** — all 32 persona spawns were `sdlc2:sdlc2-*` types. A
  discriminating probe run *before* any spending confirmed the `po` was the plugin persona and not
  the global lookalike, on four markers the lookalike could not fabricate.

### Still unanswered

- **The veto-round question (`sdlc2-enhance-1.md` §1.1).** It asks whether any round scores
  `>= bar` yet fails to pass. This run produced **no such round** — `po` 0.72 (below bar, no
  pass), `ux` 0.79 (below bar, no pass), and the two rejected rounds carried no score at all. No
  data either way; it needs another run.
- **The plateau exit.** It did not visibly fire: all three doc nodes used exactly their 2 rounds.
- **`hasUiStories`.** Set correctly here, but still unenforced — a `po` that sets it false on a
  feature with a screen still skips `ux` with one log line.

---

## SD-10 — Every node passes on its first round, and nothing can tell a sharp checker from a soft one

**Affected:** sdlc2 0.1.4 through 0.1.8 · **Status:** **instrumented** in 0.1.9 (`[R-REP-08]`);
the question itself is **open** until a run answers it
**Severity:** high — if it is real, the adversarial half of the architecture has quietly stopped
running, and five runs of green verdicts mean less than they appear to
**Found:** 2026-08-24, reading run 5 (`nf-20260824T0050Z`, `undo-a-removal`) against its four
predecessors.

### What happened

Rounds used by the three document nodes, oldest run to newest:

| run | feature | po | architect | ux | total |
|---|---|---|---|---|---|
| 1 | `greet-visitor` | 5 | 5 | 5 | **15** |
| 2 | `greeting-log` | 5 | 2 | 3 | **10** |
| 2b | `saved-name` | 2 | 2 | 2 | **6** |
| 3 | `remembered-names` | 1 | 2 | 1 | **4** |
| 4 | `saved-at` | 1 | 1 | 1 | **3** |
| 5 | `undo-a-removal` | 1 | 1 | 1 | **3** |

Run 5 also shipped all three slices on their first attempt, review scores 0.97–0.99. Scores drifted
up across the same span, roughly 0.81 average to 0.88.

The design is maker → checkers → **repeat**. If round two never happens, the repeat never happens,
and everything built to serve it has stopped executing: the repair brief (`[E-02]`), the checker's
memory of last round's verdict (`[E-05]`), the carried per-criterion scores (`[E2-07]`), and the
free re-make (`[E2-03]`). None has run since run 3. That is the condition the plateau exit was in
when `[E2-03]` deleted it — present, paid for, never fires.

### Why it is worth filing

There are two readings and no way to choose between them from any artifact a run currently
produces.

The innocent one is real: 0.1.3 dropped the bar from 0.85 to 0.80, fixed a tie-break that defaulted
to FAIL, and added a free re-make. One-round passes could be exactly those fixes working.

The other is that a checker panel which never fails anything is indistinguishable from no checker
panel. **A weighted total cannot tell the two apart.** 0.87 is produced equally by a panel marking
every criterion near 0.87 and by one marking almost everything 1.0 with a single criterion at 0.4.
The first is a mild reviewer; the second is a reviewer biting hard on one specific thing and being
outvoted by weights. Opposite findings, same number.

There is also a confound that no amount of instrumentation fixes: **the lab codebase got easier at
the same rate the engine got better.** Five runs, 48 ADRs, a settled ubiquitous language, 151 tests
on a greeting screen. A seventh feature passing in one round is what a well-trodden codebase
produces regardless of how sharp its reviewers are. The trend line tracks both explanations equally
well, and running on the same codebase a sixth time cannot separate them.

### What to do about it

Two things, and the second matters more than the first.

1. **`[R-REP-08]`, shipped in 0.1.9.** The per-criterion scores already exist — `scoreBrief()`
   assembles them with each checker's stated reason and hands them to the *next* round's prompts.
   A node that passes on round one computes the whole breakdown and returns, discarding it. Run 5
   passed every one of its six loops on the first attempt, so it threw away all six. Both loops now
   record the margin and the criteria that cost it, and the report prints them.
2. **Run 6 targets a different codebase** (`dev/code/db`, Java 21 + Gradle). Fresh ground is the
   only way to remove the maturity confound, and it tests the stack-agnostic claim at the same
   time — five runs, one stack, and `[E2-02]` has never been exercised anywhere but React.

**Explicitly rejected: raising the bar to 0.90.** It is hardcoded in `RUBRICS` and pinned by
`[R-RUB-01]` against SPEC §13, so it is not an experiment you can toggle — it is a shipped change
to the engine every future run uses, made to answer a measurement question. The margins answer the
same question without betting on the engine's quality, and leave the bar available afterwards as a
decision made on evidence.

---

## SD-11 — An optimisation dropped the only place a slice id's format was specified

**Affected:** sdlc2 0.1.3 (when `[E-13]` landed) through 0.1.8 · **Status:** **FIXED** in 0.1.9
(`[R-BUILD-07]`), probe P17d
**Severity:** medium — it degrades the one step sdlc2 deliberately leaves to a human
**Found:** 2026-08-24, reading run 5's branch list.

### What happened

Run 5 shipped `slice/undo-a-removal/01`, `02` and `03`. Every earlier run shipped names like
`slice/saved-at/01-every-saved-name-shows-when-it-was-saved`. Both `SPEC.md` and the mode file
state the contract as `slice/<feature>/<NN>-<slug>`.

Two paths produce slice ids. The fallback resolver spawn is told `id — the NN-slug from the
filename`. The **manifest fast path**, added by `[E-13]` to skip that round-trip because "the po
already knows what it wrote", filters the po's own list for truthiness and nothing more. The po's
instruction tells it to *write* `issues/NN-slug.md` files and return the same list; it never says
what the **id** should be. `SLICE_ITEM.id` is `{ type: 'string' }` carrying the comment `// NN-slug`.

Run 5 took the fast path. The issue files were named `01-bring-back-the-last-removed-name.md`. The
ids came back `01`.

### Why it is worth filing

The comment above `SLICE_ITEM` says the shared shape means the two paths "can never drift into
describing the same thing differently". The *shape* is shared. The *instructions* are not. They
drifted on precisely the field that becomes a git branch name — and the branch list is what a
human reads at the one step sdlc2 refuses to automate, because sdlc2 never merges.

This is the recurring shape: a fix improves one path and leaves the other unspecified, and a
comment asserts an invariant the code does not enforce.

### What to do about it

`[R-BUILD-07]` recovers the id from the issue filename, which is what the contract actually names
and is already a required field. Two properties make it safe rather than clever:

- **`blockedBy` holds ids too.** Renaming without rewriting the references leaves every dependency
  edge pointing at a name that no longer exists, `levelOf` flattens the graph to one level, and
  slices that must stack build in parallel off the base. That is run 1's stacking defect,
  reintroduced by the fix for a branch name. The rename map is applied to `blockedBy` in the same
  pass, and **the probe asserts the resulting branch bases, not just the strings.**
- **It is all or nothing.** A rewrite that would collide two slices on one id renames nothing.

The probe is driven against run 5's actual manifest shape rather than invented data.

---

## SD-12 — The report stated a fact no field backed, and it was false

**Affected:** every version through 0.1.8 · **Status:** **FIXED** in 0.1.9, probe P17f
**Severity:** high — not for the cleanup step, which is harmless, but for what it says about how
much of a report can be trusted
**Found:** 2026-08-24, checking run 5's report against the disk.

### What happened

Run 5's report, section 6: *"the container directory was empty and removed."*

`../.sdlc2-worktrees/` is still there. Empty, but present.

The release prompt has always instructed the agent to `rmdir` the emptied container. The `RELEASE`
schema had four fields — `released`, `remaining`, `branches`, `notes` — and **none of them was
about the container.** So the release agent had no way to report whether it did that step, the
engine had no way to know, and report instruction 4c never mentioned it.

The report node's prompt opens: *"Use exactly this data — invent nothing."*

### Why it is worth filing

This is the first time in this project that a prompt-level prohibition has been caught failing in a
real artifact. Five releases have been argued from the reasoning that a prompt is not a guarantee
and only a probe or a field can hold a claim down. That reasoning has been correct in theory and
untested in practice. Here it is, in the run report itself: a confident, specific,
verifiable-sounding, false sentence about work nobody could check, produced under an explicit
instruction not to.

It also sets the trust level for everything else in a report. Section 6's other assertions — three
worktrees asked, three released, prune run, `git worktree list` clean — are all **true**. That is
known only because the commands were re-run by hand afterwards.

An instruction the engine cannot observe is an instruction that will be reported as done.

### What to do about it

`container: boolean` on `RELEASE`; the release agent is told to report it false if the directory
survives **for any reason**, including one it correctly declined to delete. Report instruction 4c
states it from that field and from nothing else, and carries the general rule: **every sentence
must trace to a field, and where no field covers something, write nothing rather than the likely
answer.**

---

## SD-13 — The graph manufactures human-only work at a steady rate and nothing tracks whether any is done

**Affected:** every version · **Status:** open
**Severity:** medium — it makes "arbitrated and documented, never stalled" weaker than it reads
**Found:** 2026-08-24, across runs 1–5.

### What happened

Six human-verify records asking for a real screen-reader pass are open across four features:
`saved-name` VH-02 and VH-04, `remembered-names` VH-04, `saved-at` VH-02 and VH-03, and
`undo-a-removal` VH-02. **None has ever been closed.** Run 5's VH file opens by listing the
inherited ones and noting it "does not restate them", which is a polite way of saying the pile is
now load-bearing.

Every UI feature produces at least one of these, because the acceptance suite runs in jsdom and
jsdom cannot hear anything.

### Why it is worth filing

SPEC claims a node that cannot reach its rubric is "arbitrated and documented, never stalled". If
documented items are never worked, the difference between *documented* and *stalled* is
bookkeeping. Nothing in the system counts open VH records, ages them, or reports the backlog across
features — each run only sees its own.

It also bears on the `ux` node's scores. `UX-A11Y` carries weight 0.20 and the node has passed every
run, once by soft-pass at 0.79 — and the executable oracle beneath it cannot check the thing that
criterion is mostly about.

### What to do about it

Nothing in the engine yet; the first move is to find out whether the backlog represents real debt.
The six are one question asked six times — does this screen announce its state changes — and the
lab app is merged, so a single pass with a real screen reader closes all of them and says whether
five runs have been accumulating accessibility debt behind green testers. Do that before run 6
moves to a target with no UI at all.

If the answer is that the output was sound all along, the finding becomes a reporting one: the
graph should say how much human-only work it has created and how much is outstanding, rather than
leaving each run to discover the pile independently.
