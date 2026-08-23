# sdlc2-enhance-2 — independence, and five things the engine says it does but does not

> Analysis of sdlc2 **v0.1.4** at `90131b9`, written 2026-08-23, before run 3.
>
> Two of the items below (**E2-01**, **E2-02**) came from a direct question: *is the plugin
> actually independent of the projects that use it?* The rest came from reading the engine against
> its own claims. Every item is cited to `file:line` and carries a confidence label:
>
> - **certain** — read directly from the code; deterministic, not a matter of opinion.
> - **judgement** — the fact is certain, the right fix is a call.
>
> **Nothing here has been fixed.** These are for after run 3. Several of them change how run 3's
> own results should be read, and those are flagged inline.

---

## Status — open

| Item | What | Severity | Confidence |
|---|---|---|---|
| **E2-03** | The plateau exit cannot fire. It needs 3 rounds of history; document nodes get 2 | high | certain |
| **E2-04** | The build loop tells its **scoring** reviewer to "default to FAIL" — the exact instruction E-03 removed everywhere else | high | certain |
| **E2-05** | A developer spawn that never answers is charged as bad work, not as transport — SD-05's fix never reached the build loop | high | certain |
| **E2-06** | `hasUiStories` is checkable from data the engine already holds, and is not checked; a gated `ux` lets a UI slice build anyway | high | certain |
| **E2-01** | The whole repository ships to every user, working notes and local paths included | medium | certain |
| **E2-02** | Four personas hardcode one technology stack (Java + Spring Boot + React) | medium | judgement |
| **E2-07** | The build loop has no cross-attempt memory — E-02 and E-05 were applied to document nodes only | medium | certain |
| **E2-08** | Worktree release is fire-and-forget, and is skipped entirely when the build node throws | medium | certain |
| **E2-09** | Every node has exactly **one** scoring checker, so "MIN across checkers" is the minimum of one number | medium | judgement |
| **E2-10** | The lane count is hardcoded at 4 | low | certain |
| **E2-11** | Show a plan — every step and every slice — before any agent starts | medium | request |

---

## E2-03 — the plateau exit is unreachable

**certain.** `new-feature.workflow.js:894` guards the plateau break with `if (history.length >= 3)`,
and needs three consecutive flat rounds inside that window. `history` gains exactly one entry per
round. Document nodes run `rounds: DOC_ROUNDS` and `DOC_ROUNDS = 2` (`:66`). So `history.length`
tops out at 2 and the branch is never entered.

`runLoop` is reached only by nodes with `kind: 'loop'` (`RUNNERS.loop`, `:1575`), which is `po`,
`architect` and `ux` — all three at 2 rounds. `build` is `kind: 'fanout'` and runs `buildSlices`,
which has no plateau logic at all. **There is no configuration of the shipped graph in which the
plateau exit can run.**

The check in `verify.mjs:875` passes because the probe overrides the node to `rounds: 9`, and its
own comment says why: *"Give the node more rounds than the plateau needs, so the BREAK is what ends
it, not the cap."* The probe proves the mechanism works. It cannot prove the mechanism is reachable,
and it is not.

**This changes how two documents should be read:**

- `HANDOFF.md` lists "the plateau exit (never fired)" as missing data that a future run might
  supply. It is not missing data. No run will ever produce it as the code stands.
- `SPEC.md:459` claims "the document nodes dropped from 5 rounds to 2 in v0.1.3, the plateau exit
  can end one sooner". The second clause is false, and it was false the moment the first clause
  landed — E-01 cut the rounds and added the plateau exit in the same change.

**Fix, pick one:**

1. **Delete it** and correct both documents. At 2 rounds a plateau exit saves at most zero rounds,
   because arbitration follows either way. This is the honest option if `DOC_ROUNDS` stays at 2.
2. **Make it 2-round-aware** — one flat round out of two is already the whole budget, so the
   condition would have to be "round 2 moved neither score nor open count", which saves nothing
   either. Not worth it.
3. **Keep it and raise `DOC_ROUNDS`**, which reopens the cost question E-01 closed.

Option 1 is the recommendation. A guard that cannot fire is worse than no guard: it made two
documents claim a saving that was never available.

---

## E2-04 — the build loop's scoring reviewer is told to default to FAIL

**certain.** `new-feature.workflow.js:1080`, inside `reviewerPrompt`:

    Every finding cites file:line and a NAMED principle. Default to FAIL when unsure.

The code reviewer is a **scoring** checker — `binary` is unset and `arbitrable: true` (`:381`), and
its verdict goes through `weightedTotal` (`:1319`). E-03 removed exactly this instruction from
scoring checkers, for a stated reason preserved in the engine at `:684`:

    "Default to FAIL when uncertain" belongs to a BINARY checker, whose ground truth is
    executable. For a rubric scorer it silently biases every criterion it did not fully
    examine toward 0.5, which is how genuinely good work lands under the bar round after round.

`checkerPrompt` branches correctly on `checker.binary` (`:687-691`). The build loop does not use
`checkerPrompt` — it has its own hand-written `reviewerPrompt`, and that one never got the fix.

The persona file says the opposite of the prompt. `agents/sdlc2-code-reviewer.md:86`:

    You are a **scoring** checker, not a binary one, so do **not** default to FAIL when uncertain

The engine's prompt is the instruction actually delivered in the task, so it wins. Round 1 of the
enhancements caught this same contradiction in four persona files and fixed them; the engine's own
build-loop prompt was missed.

**Fix:** delete the sentence from `:1080`. Consider routing `reviewerPrompt` through the same
binary/scoring branch as `checkerPrompt` so the two cannot drift again.

**Read run 3 with this in mind:** every code-review score it produces was generated under a
fail-biased instruction. A slice that soft-passes on craft debt may be paying for this, not for its
code.

---

## E2-05 — SD-05's transport/content split never reached the build loop

**certain.** SD-05 established the rule: an agent that never *answered* has not made a mistake worth
a defect record, so it must not be handed back to the next round as work to repair. `runLoop`
implements it at `:804-809` — a null maker becomes a `harnessDefect`, is recorded `errored: true`,
and `actionable()` keeps it out of the repair brief.

`runSlice` does not. At `:1284`:

    if (!build || build.committed !== true) {
      ...
      defects = [engineDefect(slice.id, (build && build.notes) || 'developer did not reach a green commit', ...)]

Two very different events are collapsed into one branch:

- the developer spawn **never answered** (transport — `spawn` already retried once and failed), and
- the developer **answered** and reported it could not commit (content).

Both produce an `engineDefect`, which carries no `harness` flag (`:522`), so `actionable()` keeps it
(`:539`) and `developerPrompt` puts it in the repair brief under this heading (`:969`):

    Repair attempt N of M. The independent checkers refuted the previous attempt.
    Fix EVERY defect; do not regress what passed: [{"evidence":"developer did not reach a green commit"...

A dropped connection is reported to the next developer as a checker refutation of work that was
never judged. That is precisely the failure SD-05 was written to end, still live one layer down.

The tester and reviewer paths in the same loop **do** use `harnessDefect` correctly (`:1308-1309`),
which shows the split was understood here — the developer branch was simply not revisited.

**Fix:** split the branch. `!build` → `harnessDefect`, recorded `errored`. `build.committed !== true`
→ the existing `engineDefect`. Mirror `runLoop`'s history row so the score history stays readable.

---

## E2-06 — `hasUiStories` is checkable and unchecked, and a gated `ux` has a hole behind it

**certain**, and this is two problems that share a cause.

### (a) The engine already holds the evidence

`hasUiStories` gates the entire `ux` node (`:361`). It has been "unenforced" through two runs, on
the stated grounds that only an agent could tell whether a feature has screens. **That is no longer
true.** Since E-13 the product owner also returns a slice manifest, and `SLICE_ITEM` carries a `ui`
boolean per slice (`:149`). The engine receives both in the same object.

So this contradiction is detectable in pure data, with no disk access:

    maker.hasUiStories === false && (maker.slices || []).some(s => s.ui === true)

Nothing checks it. `auditMaker` (`:544-570`) validates artifact paths and changelog length and
stops there.

**Fix:** add the cross-check to `auditMaker`. A product owner that declares no UI stories while
queueing UI slices has contradicted itself inside one structured result, and that is a `critical`
defect by the engine's own severity anchor — *"it contradicts itself"* (`:713`).

### (b) A gated `ux` does not stop a UI slice

When the gate says no, `ux` settles as `{ verdict: 'skipped', gated: true }` (`:1673`), and
`blocksSuccessors` deliberately returns `false` for a gated node (`:1584`) — correct in general,
since a feature with no screens must not block its build.

But `runSlice` reuses that same predicate for the per-slice UX join (`:1244-1252`):

    if (slice.ui === true) {
      const uxResult = await whenSettled('ux')
      if (blocksSuccessors(uxResult)) { ...skip... }
    }

For a gated `ux` this is `false`, so a slice explicitly marked `ui: true` proceeds to build with no
state matrix and no mockup — and the log says nothing. The one case the join exists to catch is the
one it lets through.

**Fix:** in `runSlice`, treat `uxResult.gated === true` on a `ui: true` slice as a distinct
condition. Skipping the slice is one answer; building it with a loud warning is defensible. Silence
is not.

---

## E2-01 — the whole repository ships to every user

**certain.** `.claude-plugin/marketplace.json` declares `"source": "./"`, so `claude plugin install`
clones the entire repository into the user's plugin cache. Everything git-tracked is delivered,
including:

- **`HANDOFF.md`** — transient working state. Ten references to the private lab repo, absolute paths
  under a personal home directory, run identifiers, and a running commentary on unshipped work. Its
  own first line says it is not plugin content and should be deleted when the arc completes. It has
  been shipping to strangers since v0.1.0.
- **`REVIEW-0.1.0.md`** and **`sdlc2-enhance-1.md`** — internal review documents. No private paths,
  but 1 100 lines of working notes presented as if they were plugin documentation. This file will
  join them unless something changes.

SPEC already noticed the mechanism and dismissed it: *"`source: \"./\"` also ships the whole repo to
every user, but that was the weaker objection"* (`HANDOFF.md`, lab-is-a-sibling rationale). The
objection was weaker than the one being argued at the time. It is not weak on its own.

There is also one project reference inside a runtime file: `new-feature.workflow.js:50` explains the
worktree relocation with *"Measured in the lab: vitest collected three sibling worktrees' suites…"*.
That is provenance for a design decision, not a dependency, and it is the only one — but it is a
reference to a specific project in shipped executable code.

**Fix, in order of cost:**

1. Move the working notes out of the packaged set — a `docs/internal/` directory excluded from the
   package, or a branch that is not the marketplace source. Cheapest, and it is the one that
   actually exposes a personal machine.
2. Reword `:50` to "measured during development".
3. Decide what the shipped documentation set actually is. Right now it is "whatever is in the repo",
   which is how `HANDOFF.md` got there.

**Not a problem, do not change:** the `rcforte/sdlc2` strings in `install.sh:21`, `install.ps1:26`,
`verify.mjs:215-216` and both manifests. That is the plugin's own identity and download location.

---

## E2-02 — four personas hardcode one technology stack

**judgement** on the fix; the facts are certain.

The engine is genuinely stack-neutral. Every command is read from the project's own `CLAUDE.md`
(`configFor`, `conventions`), the tester is told *"never assume `./mvnw` or any other runner"*
(`agents/sdlc2-tester.md:30`), and the developer persona carries the same warning
(`agents/sdlc2-developer.md:28`). That part is well built and should not change.

The **personas** are not neutral:

| File | Line | What it assumes |
|---|---|---|
| `agents/sdlc2-developer.md` | 4, 15-16 | The persona's identity is "Java 21 + Spring Boot (backend) and React 19 + TypeScript + Vite (frontend)" |
| `agents/sdlc2-developer.md` | 22-23 | Its two modes are named after JDBC/Flyway adapters and React components |
| `agents/sdlc2-developer.md` | 42 | A UI acceptance test *is* "a Playwright E2E" |
| `agents/sdlc2-code-reviewer.md` | 41-44 | Four of five review dimensions are DDD-in-Java, Spring Boot, and TypeScript/React |
| `agents/sdlc2-ux-design.md` | 31, 57, 62 | "rebuilt React is expensive"; the handoff criterion is what "the Playwright test must prove" |
| `modes/new-feature.md` | 118, 124 | The only configuration example shown is `./mvnw -q test` with `@SpringBootTest` |

`agents/sdlc2-developer.md:29` shows this was deliberate — *"House default is Maven/Gradle + npm,
but the profile is authoritative"*. The commands defer to the project. The persona's **identity and
judgement** do not. Run this on a Go or Python project and the code reviewer is scoring `CR-IDIOM`
with a rubric whose examples are all Spring annotations.

**The consequence is scoring, not just wording.** `CR-IDIOM` asks for "idiomatic for this stack",
and the persona that scores it has been told which stack that is.

**Fix — a real design decision, not a text edit.** Three options, in increasing cost:

1. **Declare the scope.** Rename the personas' stack section "reference stack" and say plainly in
   `README.md` that sdlc2 targets JVM + TypeScript projects. Honest, cheap, and closes the question.
2. **Move the stack into the project profile.** Extend the `sdlc2:config` block with a `stack:`
   field and inject it into the persona prompts the way `conventions()` already injects commands.
   The personas keep their role and lose their language bias.
3. **Ship stack packs.** One persona per stack, selected by the profile. Most faithful, most work,
   and probably premature.

Option 2 is the recommendation, and `conventions()` is the seam it already fits.

---

## E2-07 — the build loop has no cross-attempt memory

**certain.** E-02 gave the maker the previous round's per-criterion scores; E-05 gave the checker
the same. Both were implemented in `runLoop` via `prevScores` (`:776`, `:869`) and threaded
into `makerPrompt(node, round, defects, extra)` and `checkerPrompt(node, checker, round, prior)`.

The build loop received neither:

- `developerPrompt(slice, cfg, defects, attempt, rounds, base, wt)` (`:965`) has no score parameter.
  A developer on attempt 3 sees the surviving defects but never which rubric criterion cost it the
  attempt.
- `reviewerPrompt(slice, cfg, base, wt)` (`:1075`) does not even receive the attempt number. Every
  attempt is scored cold, which is exactly the judge-variance oscillation E-05 was written to stop —
  and the build loop runs up to **5** attempts, where `runLoop` runs 2.

The reasoning that justified E-02 and E-05 applies with more force here, not less.

**Fix:** thread `scoreBrief(rv)` from each attempt into the next `developerPrompt` and
`reviewerPrompt`, with the same "you may raise a score freely; do not lower one without quoting the
regression" wording used at `:701-702`.

---

## E2-08 — worktree release is unverified, and skipped when the build node throws

**certain**, two failure modes.

`buildSlices` releases worktrees with a `sonnet`/`low` spawn (`:1441-1456`). The prompt is careful
and asks the agent to confirm with `git worktree list`. **The return value is discarded.** If the
agent fails, half-finishes, or reports a problem, nothing reads it, nothing logs it, and the run
reports success. `HANDOFF.md` makes "`git worktree list` shows only the main checkout at the end" an
acceptance criterion for run 3 — the engine does not assert it, so that check is entirely manual.

Worse: the release call sits after the level loop inside `buildSlices`. `runNode` catches a throw
from any node (`:1629-1635`) and turns it into a hard-fail row. If `buildSlices` throws mid-build,
the release never runs, every worktree created so far is stranded outside the repository holding a
branch checked out, and the report says only that the build node crashed.

**Fix:** capture the release result and log it; on a non-answer, record it as a human-verify item
rather than dropping it. Wrap the level loop so release runs in a `finally`-equivalent path. Both
are small.

---

## E2-09 — the "adversarial panel" is a panel of one

**judgement.** `score = scorers === 0 ? 1 : scored.length === scorers ? Math.min.apply(null, scored) : 0`
(`:867`). The comment above it reads *"an adversarial panel is only as green as its harshest lens"*.

Count the lenses. `po` has one checker (`:304`). `architect` has one (`:330`). `ux` has one (`:352`).
`build` has two, but one is the binary tester, so `scorers` is 1 there too (`:380-381`, counted at `:772`). **Every node
in the graph has exactly one scoring checker.** `Math.min` over one number is that number, and the
weakest-link property the engine describes is not currently doing anything.

This is not a bug — a single strong adversarial checker is a legitimate design, and E-09 already
spends real money on `opus`/`xhigh` for it. But `SPEC.md:453` lists "MIN + severity veto + fresh
context" as the three mitigations for having no executable oracle above `build`, and one of those
three is currently inert. The spec overstates the defence.

**Fix, pick one:**

1. **Correct the documentation.** Say that doc nodes run one checker and that MIN exists for when
   they do not. Free, and it stops the spec claiming a mitigation it does not have.
2. **Add a second lens to one node** and measure. `po` is the candidate — its output feeds
   everything downstream, and a second lens on testability-versus-value would be genuinely
   different, not redundant. Costs one extra `opus` call per round per node.

Do option 1 regardless. Option 2 is worth a single experiment, and run 3 is not it — it would change
two variables at once.

---

## E2-10 — the lane count is hardcoded

**certain**, minor. `const LANES = install ? 4 : 1` (`:1404`). Four is not derived from anything and
is not configurable. A project with six independent slices gets two batches with a barrier between
them (`:1428-1433`), which is the wave barrier E-07's continuous executor was built to remove,
reintroduced at the batch level.

**Fix:** read it from `commands`/config with 4 as the default, and consider replacing the batching
loop with a token-bucket so lanes refill as slices finish rather than at a batch boundary. Low
priority — it only bites at five or more independent slices, which no run has produced yet.

---

## E2-11 — show the plan before any agent starts

**Requested, not a defect.** Today a run tells you what it is doing only while it does it. You find
out what work exists by watching it happen. Two summaries would fix that, and every number in both
of them is already sitting in memory at the moment they would be printed.

### First summary — the steps, printed as the run starts

Print this right after the engine line at `:1645`, before the first agent is spawned.

    sdlc2 0.1.4 — run nf-20260823T1400Z on "Remember more than one name" (base: main)

    THE PLAN — 4 steps

      Step             What it produces                        Written by       Checked by             Max rounds
      Product          stories, acceptance criteria, queue     product-owner    product-owner-critic   2
      Architecture     domain model, test seam per slice       architect        architect-critic       2
      User experience  state matrix and mockup                 ux-design        ux-auditor             2
      Build            one branch per slice                    developer        tester, code-reviewer  5 per slice

      Architecture and User experience run at the same time.
      User experience runs only if the product owner says this feature has screens.
      Worst case before building starts: 16 agent calls. Then up to 16 per slice.

Everything here is already declared as data in `NODES` (`:296-410`) — the step name is `phase`, the
writer is `maker.agent`, the checkers are `checkers[].agent`, and the round cap is `rounds`. The
call count is arithmetic on those same fields: `rounds × (1 writer + N checkers) + 1 arbiter` per
step. **Let the code compute it from `NODES`.** A number typed by hand into a log line is a number
that goes stale the first time someone edits the graph.

### Second summary — the slices, printed once they are known

The slices do not exist until the product owner cuts them, so this one is printed later: in
`buildSlices`, right where the existing one-line summary sits at `:1200`, before the first slice is
built.

    5 slices to build, in 3 waves

      Slice              Title                     Screens  Waits for  Built on top of  Wave  Test command
      01-save-a-list     Save more than one name   yes      —          main             1     npm test
      02-remove-a-name   Remove a saved name       yes      01         01               2     npm test
      03-cap-the-list    Stop at five names        yes      01         01               2     npm test
      04-most-recent     Show newest first         yes      01         01               2     npm test
      05-clear-the-list  Clear every saved name    yes      02, 03     03               3     npm test

      Wave 2 holds 3 slices that do not depend on each other. They will be built at the
      same time, each in its own working folder.

Where each column comes from, all of it already computed a few lines above the print:

| Column | Plain meaning | Source |
|---|---|---|
| Slice | the issue file's id | `slice.id` |
| Title | what the slice delivers | `slice.title` |
| Screens | does a person see this on screen | `slice.ui` — the flag that decides whether it waits for the UX step |
| Waits for | slices that must finish first | `slice.blockedBy` |
| Built on top of | which branch it starts from | the last blocker in dependency order, or the default branch — the same rule `baseFor` (`:958`) uses at build time |
| Wave | which group it builds in | `levelOf`, computed at `:1181-1196` |
| Test command | how this slice is proved | `configFor(slice.dir).commands.test` |

Use plain column headings like the ones above, not the field names. "Waits for" is understandable;
`blockedBy` needs the reader to already know the system.

### Why this is worth doing beyond convenience

Three of the failures already on this list would have been **visible in that second table before any
money was spent**:

- Run 1 cut four slices that depended on nothing. The "Waits for" column would have been empty for
  every row, and one glance would have shown that the stacking rule was about to be tested against
  nothing. It took two more runs to notice.
- A slice marked `Screens: no` that obviously has a screen is the `hasUiStories` problem in E2-06,
  visible as a wrong word in a table rather than as a silently skipped design step.
- "Built on top of" printed up front is the dependency graph the run is actually going to execute.
  E2-06 and SD-07 are both cases of two documents disagreeing about that graph. A printed table is a
  third statement of it, and the one a human will actually read.

So this is a cheap oracle. It puts the run's own plan in front of a person while stopping it still
costs nothing.

### One thing to check before building it

**No log line in the engine is currently more than one line** — all 39 calls to `log()` emit a single
line. Whether a multi-line block renders cleanly in the progress display is unknown and untested.
Check it first. If it does not, print one `log()` per row; a table across many lines still reads far
better than no table.

### Optional, if it proves useful

Print the same two summaries into the run report as well. The report already has a slice table, but
it is written at the **end** and records what happened. This one records what was **planned**, and
the difference between the two is itself worth reading — a slice that was planned into wave 2 and
ended up skipped tells a story that neither table tells alone.

---

## What was checked and found sound — do not spend effort here

| Checked | Verdict | Evidence |
|---|---|---|
| Project coupling in the engine | **Clean** | No runtime file names any consuming project. Commands, seams and per-directory overrides all come from the project's `CLAUDE.md` |
| The stacking rule `baseFor` | **Sound** | `:958-963` picks the last blocker in dependency order, and run 2's full 5×5 ancestry matrix held |
| The `blockingOpen` veto scope | **Correct** | `runLoop` passes `docNode: true` (`:870`) and only doc nodes reach it; `runSlice` uses the strict form (`:1321`). The hardcoded `true` looks wrong and is not |
| Tester self-contradiction | **Handled** | `pass: true` alongside a critical defect is forced to RED (`:1315-1318`) |
| Arbiter cannot commit | **Holds** | `:1387` — the shipped sha is `lastGood.sha`, the exact commit the tester verified |
| Defect growth across rounds | **Innocent** | `defects` is reassigned each round, never appended (`:868`) |
| Silence from a checker | **Handled everywhere** | `harnessDefect` at `:847`, `:1308-1309`; missing binary verdict sets `binaryFailed` |

## What this analysis did NOT cover

- **The nine persona files as prompts.** Read for stack coupling only (E2-02). Their instructions
  were not audited for internal contradiction — E2-04 was found from the engine side, and finding it
  suggests that audit is worth doing.
- **`verify.mjs`'s 304 checks.** One probe was examined (P18, and it is what proved E2-03). The
  other probes were not reviewed for the same class of problem: a probe that passes by configuring
  the node into a state production never reaches. **E2-03 is one confirmed instance, so assume
  there are others until checked.**
- **`SPEC.md` conformance.** The rubric literals were not compared criterion-by-criterion against
  §13, which `[R-RUB-01]` requires.
- **Anything about agent behaviour.** Every item above is static reading. None of it is a
  prediction about what run 3 will do.
