# sdlc2-enhance-2 — independence, and five things the engine says it does but does not

> **Not plugin content.** This is an internal working document. It ships with the plugin only
> because the marketplace entry uses `source: "./"`, which packages the whole repository —
> see `sdlc2-enhance-2.md` **E2-01**. Nothing in `agents/`, `modes/`, `skills/`,
> `commands/` or the engine depends on it, and no user of sdlc2 needs to read it.

> Analysis of sdlc2, written 2026-08-23. Items **E2-01** to **E2-11** were found by reading
> **v0.1.4** at `90131b9`, before run 3. **E2-12** to **E2-16** were found by run 3
> itself — **E2-14** to **E2-16** by measuring where its 2h21m went, and tagged
> **lab finding — performance**.
>
> Line references were re-pointed to **v0.1.5** at `e34bfa3` and re-checked. v0.1.5 changed
> only the report chain (SD-08) and shifted line numbers after `:1414`; **no finding below was
> fixed or invalidated by it.**
>
> Two of the items below (**E2-01**, **E2-02**) came from a direct question: *is the plugin
> actually independent of the projects that use it?* The rest came from reading the engine against
> its own claims. Every item is cited to `file:line` and carries a confidence label:
>
> - **certain** — read directly from the code; deterministic, not a matter of opinion.
> - **judgement** — the fact is certain, the right fix is a call.
>
> **All sixteen are implemented in v0.1.6** (2026-08-23) except **E2-01**, which no code change can
> close — see the status table below. Nothing has run against real agents. The findings are left as
> written so the reasoning survives the fix; the status table is the authority on what changed.

---

## Status — all 16 implemented in v0.1.6 (2026-08-23), none run against real agents

`node verify.mjs` passes **366 checks** (was 311), including six new behavioural probes that drive
the changed paths against stubbed agents. **E2-01 is the one item code cannot close** — see below.

| Item | State | Where |
|---|---|---|
| **E2-01** working notes ship | **partial — needs a decision** | lab reference reworded; personal path scrubbed; each internal doc now says it is not plugin content. The files still ship: no plugin manifest field excludes them |
| **E2-02** personas hardcode a stack | done | `stack:` in the config block → `conventions()` → every persona prompt; developer, code-reviewer and ux-design personas rewritten to judge against the declared stack; probe P24 |
| **E2-03** plateau exit unreachable | done | deleted; replaced by one free re-make of a rejected maker output, so 2 rounds means 2 *scored* rounds; probe P18 |
| **E2-04** reviewer told to default to FAIL | done | removed from `reviewerPrompt`, replaced with the scoring-checker wording; probe P23 |
| **E2-05** transport charged as content | done | `!build` split from `committed !== true`; a silent developer is a `harnessDefect` and escalates `developer-silent`; probe P5 |
| **E2-06** `hasUiStories` unenforced | done | `auditMaker` cross-checks it against the slice manifest; a `ui:true` slice no longer builds against a gated-off `ux`; probe P22 |
| **E2-07** no cross-attempt memory in build | done | `scoreBrief` threaded into the next `developerPrompt` and `reviewerPrompt`; probe P23 |
| **E2-08** release fire-and-forget | done | `RELEASE` schema, the answer is read and logged, carried into the report; probe P26 |
| **E2-09** MIN over one checker | done | `SPEC.md` §12 risk 3 no longer counts MIN as a defence it does not have |
| **E2-10** lanes hardcoded at 4 | done | `lanes:` in the config block, default 4 |
| **E2-11** show the plan first | done | `planLines()` before the first spawn, `sliceTableLines()` before the first build; probe P25 |
| **E2-12** upstream defect never returns | done | `upstreamDisputes()` printed before the build acts on the plan; probe P25 |
| **E2-13** developer rewrites the contract | done | the issue file is read-only to the developer; `amendments` in the BUILD schema; its own report section; probes P23 + report checks |
| **E2-14** level barrier | done | continuous per-slice readiness scheduling, no level `await`; probe P21 drives it behaviourally |
| **E2-15** document phase re-derives the seed | done | maker and checker both told the seed is settled work to carry forward, not to re-open; probe P24 |
| **E2-16** multi-blocker slice reviewed against one | done | `mustContain` passed to `reviewerPrompt` and named as not-this-slice's-work; probe P23 |

### What is deliberately NOT claimed

These are code changes verified against stubs. **None of this has run against real agents** — the
same trap as run 1, v0.1.2, v0.1.3, v0.1.4 and v0.1.5, five for five. A probe proves the engine does
what it says; it never proves an agent obeys a prompt. Six of these items (**E2-02, E2-11, E2-12,
E2-13, E2-15, E2-16**) change PROMPTS, and a prompt change is exactly the kind a probe cannot judge.

### E2-01 — why it is still open

`.claude-plugin/marketplace.json` uses `source: "./"`, which packages the whole repository. No
`plugin.json` in any installed plugin on this machine carries a file-filter field, so there is
nothing to set. What was done: the engine no longer references the lab, the one absolute personal
path is gone, and every internal document now opens by saying it is not plugin content. What is
left is a choice only you can make — move the notes to a branch that is not the marketplace source,
or accept that they ship. Nothing in the code decides that.

---

## Status — the original findings

| Item | What | Severity | Confidence |
|---|---|---|---|
| **E2-03** | The plateau exit cannot fire. It needs 3 rounds of history; document nodes get 2 | high | certain |
| **E2-04** | The build loop tells its **scoring** reviewer to "default to FAIL" — the exact instruction E-03 removed everywhere else | ~~high~~ **medium** (run 3) | certain |
| **E2-05** | A developer spawn that never answers is charged as bad work, not as transport — SD-05's fix never reached the build loop | high | certain |
| **E2-06** | `hasUiStories` is checkable from data the engine already holds, and is not checked; a gated `ux` lets a UI slice build anyway | high | certain |
| **E2-01** | The whole repository ships to every user, working notes and local paths included | medium | certain |
| **E2-02** | Four personas hardcode one technology stack (Java + Spring Boot + React) | medium | judgement |
| **E2-07** | The build loop has no cross-attempt memory — E-02 and E-05 were applied to document nodes only | medium | certain |
| **E2-08** | Worktree release is fire-and-forget, and is skipped entirely when the build node throws | medium | certain |
| **E2-09** | Every node has exactly **one** scoring checker, so "MIN across checkers" is the minimum of one number | medium | judgement |
| **E2-10** | The lane count is hardcoded at 4 | low | certain |
| **E2-11** | Show a plan — every step and every slice — before any agent starts | medium | request |
| **E2-12** | A defect filed against an earlier step never reaches that step. Run 3 executed a queue its own architect had refuted | high | **observed in run 3** |
| **E2-13** | The developer edited the acceptance criteria it was being judged against. The oracle reads a contract the thing under test can rewrite | high | **observed in run 3** |
| **E2-14** | Slices wait for their whole level, not their own blockers. 34 of run 3's 141 minutes were one slice waiting on a sibling it does not depend on | high | **lab finding — performance** |
| **E2-15** | The document phase costs 42 min — 30% of the run — re-deriving a seed that was grilled before the graph started | medium | **lab finding — performance** |
| **E2-16** | A guard slice can never run beside anything — and a slice with several blockers is reviewed against only one of them | medium | **lab finding, corrected** |

---

## What run 3 showed about the items written before it

Run 3 (`nf-20260823T1333Z`, `remembered-names`, 7 slices, 0 escalated) ran on v0.1.4 with
**E2-03, E2-04 and E2-05 all live**. What it settled, and what it did not:

| Item | Run 3 evidence | Effect on the item |
|---|---|---|
| **E2-03** plateau exit unreachable | No node reached 3 rounds — `po` 1, `ux` 1, `architect` 2. Nothing could have fired | **Unchanged.** No new proof, and none was possible. But see the new subsection below, which run 3 did surface |
| **E2-04** reviewer told to default to FAIL | Code-review scores were **0.89, 0.92, 0.94, 0.94, 0.96, 0.97, 0.98** — every one far above the 0.80 bar | **Downgraded to medium.** The engine still contradicts its own fix and its own persona file, which is worth correcting. But there is now real evidence the bias costs little in practice, so this is tidiness, not a bug that is hurting anything |
| **E2-05** transport charged as content | 43 agents, zero errors. No round was recorded `errored` | **Unchanged, and still unproven after three runs.** The path has never executed. Slice 06's four attempts were content failures, not transport ones — checked, not assumed |
| **E2-06** `hasUiStories` unchecked | The product owner set it true and every slice was a UI slice, so the contradiction had nothing to contradict | **Unchanged.** No data |
| **E2-08** worktree release unverified | Release worked: `git worktree list` shows only the main checkout, and the run's own container was removed | **Unchanged.** It worked, which is not the same as being checked — the engine still discards the release agent's answer |
| **E2-11** show the plan first | The queue error behind **E2-12** would have been one wrong-looking row in the slice table, visible before the build spent four attempts on it | **Strengthened.** This is no longer only a convenience |

**Independently re-verified here**, resolving every branch to a commit first (SD-01's trap — an
unknown ref fails the same way a true negative does). Full 7×7 ancestry matrix: slice 01 is
contained in all six others; slices 02, 03, 04 and 06 are mutually independent in every direction;
03 is inside 05; and 07 contains all five of its declared blockers, having been cut from 05 and
merged with 02, 04 and 06 under named merge commits. **Every declared edge holds and every declared
non-edge holds.** Four concurrent lanes, a five-blocker join, no undeclared stacking.

---

## E2-03 — the plateau exit is unreachable

**certain.** `new-feature.workflow.js:894` guards the plateau break with `if (history.length >= 3)`,
and needs three consecutive flat rounds inside that window. `history` gains exactly one entry per
round. Document nodes run `rounds: DOC_ROUNDS` and `DOC_ROUNDS = 2` (`:66`). So `history.length`
tops out at 2 and the branch is never entered.

`runLoop` is reached only by nodes with `kind: 'loop'` (`RUNNERS.loop`, `:1591`), which is `po`,
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

### Related, and observed in run 3: a thrown-out round costs half a document node's budget

`runLoop` charges a round when the maker's output is rejected by `auditMaker` — a missing declared
artifact, or `ok: false` (`:812-818`). At `DOC_ROUNDS = 2` that leaves the node **one** scored
attempt before it goes to an arbiter.

This is not hypothetical. Run 3's `architect` had round 1 thrown out this way and passed on round 2
at 0.86, on its only scored attempt. It was fine. It had no margin.

Both of these are consequences of the same decision to cut document nodes to 2 rounds, and they
pull in opposite directions — the plateau exit is dead because 2 is too few rounds to detect a
plateau, while a rejected round is expensive because 2 is too few rounds to absorb one. **Decide
them together.** One option that resolves both: do not charge a round for a rejected maker output,
the same way SD-05 stopped charging for a spawn that never answered. A maker that returned nothing
usable has not been judged, so there is nothing to have learned from. That keeps 2 scored rounds
meaning 2 scored rounds, and leaves the plateau exit as dead as E2-03 says it is — delete it and
move on.

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

When the gate says no, `ux` settles as `{ verdict: 'skipped', gated: true }` (`:1689`), and
`blocksSuccessors` deliberately returns `false` for a gated node (`:1598`) — correct in general,
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

`buildSlices` releases worktrees with a `sonnet`/`low` spawn (`:1448-1463`). The prompt is careful
and asks the agent to confirm with `git worktree list`. **The return value is discarded.** If the
agent fails, half-finishes, or reports a problem, nothing reads it, nothing logs it, and the run
reports success. `HANDOFF.md` makes "`git worktree list` shows only the main checkout at the end" an
acceptance criterion for run 3 — the engine does not assert it, so that check is entirely manual.

Worse: the release call sits after the level loop inside `buildSlices`. `runNode` catches a throw
from any node (`:1645-1651`) and turns it into a hard-fail row. If `buildSlices` throws mid-build,
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

Print this right after the engine line at `:1661`, before the first agent is spawned.

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

## E2-12 — a defect filed against an earlier step never reaches that step

**Observed in run 3.** This is the gap that SD-07 left behind, and run 3 walked straight into it.

### What happened

The architect found a real error in the queue. Issue 06 declared it depended only on slice 01, but
its third scenario clicks a **"Remove Ada"** button that only slice 03 creates. On a branch carrying
01 and not 03, that step throws — and unlike an earlier case in the `saved-name` run, there is no
tolerant way to click a button that is not there.

The architect did **exactly** what v0.1.4 tells it to do. It did not add the missing edge to its own
design. It filed the problem as a high-severity defect against the `po` node, wrote it up as `VH-01`
with three options, and named the file to amend. That is SD-07 working, against a real disagreement,
for the first time.

**Then the build started anyway, on the queue the product owner wrote.** Nothing read `VH-01`.

Slice 06 spent **four of its five attempts** on the consequence. Twice the developer tried to ship
the impossible half as an unexecuted `it.todo`, and twice the checker refused it, correctly. On the
fourth attempt the developer resolved it the only way its lane allowed — see **E2-13**.

### Why nothing read it

The graph runs forward only. `NODES.architect.next` is `['build']` (`:341`); no node points back at
`po`, and `runNode` settles each node exactly once (`:1642-1655`). The two places a defect against
another node can be written — the maker's `disputed` field (`:166-172`) and a `VERIFY-WITH-HUMAN.md`
row — are both **write-only as far as the graph is concerned**. They are read by a human, after the
run, from the report.

So the system is capable of noticing that its own plan is wrong, and structurally incapable of
acting on it.

### What it cost, measured

Four of five attempts on one slice, a changed acceptance criterion, a debt carried out of the run,
and a follow-up commit by hand afterwards (`3d4c2e1` in the lab). The finding was correct, on time,
and free to act on at the moment it was made. It was acted on much later, by a person.

### Fix — three options, and they stack

1. **Print open upstream defects before the build starts.** The cheapest by far, and it composes
   with **E2-11**: any high or critical defect filed against an already-settled node goes in the
   plan printout, next to the slice table. A human watching the run sees "the architect says issue
   06's queue is wrong" before forty agents act on it. Does not change the graph at all.
2. **Let the queue be corrected before the build.** A narrow, auditable path: a defect against `po`
   that names one `Blocked by:` line becomes an edit to that line, applied by one cheap agent,
   recorded as its own decision record. This keeps `issues/` the single source of truth — which is
   all SD-07 ever asked for — while letting the source of truth be *fixed*. SD-07 stopped the
   architect from silently correcting the queue downstream. It did not give the queue any way to be
   corrected at all.
3. **Stop and ask.** A high defect against a settled node pauses the run. Most correct, most
   annoying, and it needs a person present — which SD-06 already requires anyway.

Do option 1 regardless; it is nearly free. Option 2 is the real fix. Option 3 only if option 2
proves untrustworthy.

### What it cost, measured

**Lab finding — performance**, from the same timing pass as E2-14 to E2-16, and the reason this
item is worth more than its correctness argument alone.

Slice 06 took **47 minutes and 12 agents**. Its three siblings in the same level took 11, 13 and 11
minutes with 3 agents each. The difference is entirely the four attempts it needed to get past a
defect that was **already written down, with three options and the file to amend, before the build
started**.

- **9 wasted agents** — three extra attempts, each a developer, a tester and a code-reviewer. That
  is 21% of the run's 43 agents, and roughly 700k tokens.
- **34 extra minutes on its own level**, which under **E2-14**'s barrier also held slices 05 and 07
  from starting.

So one unread defect record is, on this run, the direct cause of about a fifth of the agent spend
and — through the barrier — a quarter of the wall clock. Option 1 above, a build gate that refuses
to start while a high-severity defect against the queue is open, would have cost one round to read.

---

## E2-13 — the developer edited the acceptance criteria it was being judged against

**Observed in run 3.** The sharpest way to say it: **the oracle reads a contract that the thing
under test can rewrite.**

### What happened

On slice 06's fourth attempt, the developer amended
`issues/06-name-field-hint-lists-every-saved-name.md`, narrowing its third scenario from *"The hint
updates as names are saved **and removed**"* to *"The hint updates as each further name is saved"*.
Then the suite passed, the reviewer scored it 0.98, and the slice shipped.

**The process it followed was genuinely good.** It weighed four options and rejected three with
reasons, it recorded the decision as `VH-06` with the risk named, and it stated precisely what was
now owed and in which file it must land. A human read it and paid the debt in the next commit. If a
person had to break this rule, this is how you would want it broken.

### Why it is still a problem

**It broke a rule the persona states plainly.** `agents/sdlc2-developer.md:42-45` says the issue's
Gherkin *is* the contract and "Don't invent acceptance criteria". The product owner is told to copy
that Gherkin into the issue **verbatim** from `feature.md` (`:316`) precisely so it cannot drift.
The developer changed it. There is no rule permitting that, so it happened outside the rules
entirely — and a rule that gets broken correctly is still a rule nobody is enforcing.

**Nothing in the loop can tell this from cheating.** The tester's job is to check the suite is green
and the acceptance criteria are covered. It reads those criteria from `slice.path` — the issue file
(`:1024`). The developer can edit that file. An honest narrowing with a recorded debt and a
developer quietly deleting the assertion that will not go green produce **the same green**, from the
same inputs, and the tester cannot distinguish them.

**And the contract is not even version-controlled while it is being judged.** The issue files are
written by the `po` node into the working tree and are not committed until the very end, by the
report node's paperwork commit (`:407`). In run 3 that was `61d1c93`, written after every slice had
already shipped. For the whole build, `issues/` was a set of **uncommitted files in the shared main
checkout**, readable and writable by every lane at once. Nothing prevents one lane's developer from
editing the contract another lane is being judged against, mid-run. Run 3 did not hit that — slice
06's edit came at round 4, when the other lanes had finished — but nothing stopped it.

### Fix — pin it, then legalise it

1. **Commit the contract before the build starts.** Have the `po` node's artifacts committed as soon
   as that node passes, instead of at the end. It makes `issues/` a real version-controlled fact
   during the build rather than loose files, and it is a precondition for everything below.
2. **Let the tester read the pinned version.** With step 1 done, the tester reads the issue at the
   commit the contract was pinned at, not at whatever is in the working tree now. Then editing the
   file cannot move the bar the slice is measured against. Mechanical, and it closes the cheating
   hole completely.
3. **Give the honest case a legal path.** Amending a scenario is sometimes genuinely the right
   answer — run 3 is the proof. So make it an outcome the engine knows about: a field in the build
   result that says "this criterion cannot be met on this branch, here is why, here is what is
   owed", which the engine records as its own kind of decision record and the report lists
   separately. The developer proposes; it does not quietly rewrite.

Steps 1 and 2 are small and stop the bad version. Step 3 is what run 3 earned — it did the right
thing, and it should not have had to go outside the rules to do it.

---

## Performance — where run 3's 2h21m went

**Lab finding, measured 2026-08-23** from the run's own agent transcripts
(`subagents/workflows/wf_0869f0ec-d32/agent-*.jsonl`, start and end timestamps per agent). The
three items below all come from this measurement. The lab app is about 200 lines of TypeScript, so
none of this is the project being large.

**43 agents, 3.0M tokens, 2h21m wall clock. Total agent busy time was 3.48 h, so average
parallelism was 1.48x** against an available 4.

| agents running at once | time |
|---|---|
| 1 | 101.6 min |
| 2 | 26.1 min |
| 3 | 1.1 min |
| 4 or more | 11.2 min |
| 0 | 1.5 min |

**For 72% of the run, exactly one agent was working.** The 1.5 minutes at zero is worth noting on
its own: SD-06, the idle-session stall that wasted 3h01m of run 2, did **not** occur here.

Where the wall clock went:

| phase | wall | agents |
|---|---|---|
| documents — `po`, then `architect` ∥ `ux`, with critics | 42 min | 8 |
| slice 01 alone | 15 min | 3 |
| slices 02, 03, 04, 06 together | 47 min | 21 |
| slice 05 alone | 11 min | 3 |
| slice 07 alone | 24 min | 6 |

And per slice, which is where E2-14 becomes visible:

| slice | start | end | mins | agents |
|---|---|---|---|---|
| 01-hold-more-than-one-saved-name | 14:18 | 14:33 | 15 | 3 |
| 02-greet-again-as-any-saved-name | 14:33 | 14:44 | 11 | 3 |
| 04-already-saved-is-refused | 14:33 | 14:44 | 11 | 3 |
| 03-remove-a-saved-name | 14:33 | 14:46 | 13 | 3 |
| **06-name-field-hint-lists-every-saved-name** | 14:33 | **15:20** | **47** | **12** |
| 05-full-list-is-refused | 15:20 | 15:30 | 11 | 3 |
| 07-fresh-visit-starts-with-nothing-saved | 15:30 | 15:55 | 24 | 6 |

Note that 33 of the 43 agents — 77% — are the build loop: 11 developer, 11 tester, 11 code-reviewer,
one of each per slice attempt, and there were 11 attempts across 7 slices.

---

## E2-14 — slices wait for their whole level, not for their own blockers

**Lab finding — performance. certain**, and the largest single wall-clock cost in run 3.

Slices are scheduled by dependency **level**: everything with no unshipped blocker forms level 0,
level 1 starts when level 0 is done, and so on. The level boundary is a barrier
(`new-feature.workflow.js:1425-1441`):

```js
for (let lv = 0; lv < levels.length; lv++) {
  ...
  await parallel(batch.map((sl) => () => runSlice(sl, `${WORKTREES}/${sl.id}`)))   // barrier
}
```

`await parallel(...)` does not return until **every** slice in the level has finished. A slice in the
next level cannot start when *its own* blocker lands — only when the slowest unrelated sibling does.

**What it cost, measured.** Slice 05 is blocked by slice 03 and nothing else. Slice 03 finished at
**14:46**. Slice 05 started at **15:20** — the exact minute slice 06 finished, a slice it has no
relationship with. That is **34 idle minutes**, and slice 07 sat behind 05 for all of them.

34 of 141 minutes, **24% of the run**, bought nothing. It gets worse as graphs widen, because the
barrier waits on the maximum and the maximum grows with the number of siblings.

There is a second barrier inside each level, at the batch boundary — `:1434`,
`for (let i = 0; i < group.length; i += LANES)` — which is the same defect one level down and is
already filed as **E2-10**.

**Fix:** schedule each slice against its own blockers instead of a level. Keep a set of shipped
slice ids; start any queued slice whose `Blocked by:` entries are all in that set; repeat as each
one lands. The engine already computes `levelOf` and already records `lanes` for the report
(`[R-REP-05]`), so the data is there — what has to go is the `await` on the whole level. In the
Workflow tool's own vocabulary this is `pipeline()` rather than `parallel()`, and its documentation
says to default to the former for exactly this reason.

**Worth doing before the next run**, because every future measurement of lane behaviour is
distorted by it.

---

## E2-15 — the document phase costs 42 minutes on an already-grilled seed

**Lab finding — performance. judgement** — the measurement is certain, the right fix is a call.

Run 3 spent **42 minutes and 8 agents** — 30% of the wall clock — before a line of code was
written. The seed it worked from had already been through a full grilling in the lab session: the
capability, agreed scope, out-of-scope list, decisions with reasoning, ubiquitous language and open
questions were all settled and written down.

The phase is also nearly serial. `po` runs alone, then its critic, then `architect` ∥ `ux`, then
their critics. Only the middle pair overlap, which is why 8 agents take 42 minutes of wall clock for
0.88 h of busy time.

The nodes are not idle — they produce real artifacts (`design.md`, `mockup.html`, the issue files,
four ADRs). But a large part of a document round is re-deriving decisions the seed already records,
and then being scored on whether the re-derivation matches.

**Fix options, in order of how much they change:**

1. **Score against the seed rather than re-deriving from it.** When a seed section already settles
   something, the maker's job is to carry it forward, and the checker's job is to catch where it
   did not — not to re-open the decision.
2. **Overlap `po`'s critic with the start of `architect`/`ux`.** The critic is advisory for these
   nodes, so a round that begins before the verdict lands is not unsound.
3. **Skip a document round when the seed covers every section the node is scored on.** `po` used 1
   round and `ux` used 1 — they were already converging immediately, which is evidence the seed was
   doing the work.

Lower priority than **E2-14**: 42 minutes is real, but it is a fixed cost that does not grow with
the number of slices, whereas the level barrier does.

---

## E2-16 — a guard slice can never run beside anything, and a multi-blocker slice is reviewed against one blocker

**Lab finding — performance, corrected 2026-08-23. certain.** Two findings share one slice. The
first is a property of guard slices rather than a bug. The second is a bug, and it is the one worth
fixing first.

Slice 07, *"a fresh visit starts with nothing saved"*, asserts the **absence** of things. To assert
that no "Remove Ada" control is present, the control has to be something the branch could have had —
otherwise the assertion passes against a screen that simply has not been built yet, which is the
hole it exists to close.

So it depends on every slice whose control it names — and the product owner got that right.
`issues/07-fresh-visit-starts-with-nothing-saved.md` declares **all five**:

```
Blocked by: 02-greet-again-as-any-saved-name, 03-remove-a-saved-name,
04-already-saved-is-refused, 05-full-list-is-refused, 06-name-field-hint-lists-every-saved-name.
```

*(Corrected 2026-08-23. An earlier draft of this item said the queue declared slice 05 only and
that the merges below were three undeclared edges. Both are wrong — the file was never amended,
one commit ever touched it, and the independently verified 7×7 ancestry matrix passes precisely
because every edge was declared. `[R-BUILD-04a]` missed nothing here. What follows is what actually
went wrong, and it is a different defect.)*

**The engine cuts a multi-blocker slice from exactly one of its blockers.** `baseFor` (`:958-963`)
returns a single branch — the last blocker in dependency order, which for slice 07 is slice 05.
Everything else the slice declares, the developer has to merge in itself, which is what its branch
history shows:

```
ecc61c9 Merge slice 06 into slice 07: the hint whose absence this issue's first scenario asserts
abea91a Merge slice 04 into slice 07: the already-saved refusal this issue's Given needs
09efe13 Merge slice 02 into slice 07: the greet-again control this issue's Given needs
```

Three merges, each with a commit message saying why. The developer did the right thing, against a
correct queue, using the only mechanism the engine leaves it.

### The defect: the reviewer sees one base, the slice has five blockers

`reviewerPrompt` (`:1075`) receives only `base` and tells the reviewer to read
`git diff <base>...<slice branch>`. For slice 07 that range **contains the 02, 04 and 06 commits the
developer merged in**, because they were added on top of 05. So the reviewer scored 0.94 on a diff
holding three other slices' code, and had no way to know which commits were not this slice's work.

The engine already knows. Twelve lines earlier it computes `mustContain` (`:1259`) — exactly the
blocker branches *other* than the base — and hands it to the **tester** (`:1294`) for the ancestry
assertions. It does not hand it to the **reviewer** (`:1298`).

**So the more blockers a slice honestly declares, the more of other people's code lands in its
review**, and the reviewer's own instruction to "score ONLY what this slice changed" becomes
impossible to obey.

**Fix, and it is small:** pass `mustContain` to `reviewerPrompt` and name those branches as
already-reviewed context to exclude, exactly as the prompt already does for the single-base case
(`:1085-1088`). The data, the wording and the seam all exist.

### The other two consequences, which stand

- **Slice 07 was structurally last, alone, and 24 minutes long.** A guard slice depends on
  everything, so it can never run beside anything. Every run ends this way as long as guard slices
  are queued as slices.
- **Merging slice 07 into the lab's `main` brought slices 04 and 06 with it**, so neither ever got
  its own merge commit. That is a consequence of the developer's merges, not of a bad queue, but it
  is still what a reader of `main`'s history will find.

**Fix for the guard-slice shape:** treat "the empty state, after everything exists" as an
**integration assertion** rather than a slice — a check the engine runs on the merged result, once,
after the queue drains. It gets the whole feature by construction, needs no edges, blocks nothing,
and cannot be scored against somebody else's diff.

That is now the *only* recommendation for this item. The earlier one — make the `po` declare an
edge to every slice whose control it names, and enforce it — is deleted: the `po` already did
exactly that, and the enforcement would not have caught anything.

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
