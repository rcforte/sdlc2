# HANDOFF — resume point, 2026-08-23

> Transient working state, not plugin content. **Delete this file when the arc below completes.**
>
> It ships with the plugin regardless, because the marketplace entry uses `source: "./"` and
> packages the whole repository — see `sdlc2-enhance-2.md` **E2-01**, which is the one item in
> that file no code change can close.

## Do this first

**0.1.9 is tagged, pushed and installed.** Verified this session: `VERSION` 0.1.9, tag `v0.1.9`
pushed at `183497a`, `main` clean and in sync, install cache at
the install cache for 0.1.9 byte-identical to the repo for
`new-feature.workflow.js`, `verify.mjs` and the agent files, `verify.mjs` all-green. Steps 1-4 of
the old list are genuinely done; this session is pinned to a real 0.1.9.

**Run 6's target changed: `~/dev/code/instrument-service`, NOT `~/dev/code/db`.** Decided
2026-08-25. The reason given was the better test, not blast radius: a real reactive Spring Boot
service is a truer exercise of the stack-agnostic claim (`E2-02`) than a hand-rolled database.
It removes the lab-maturity confound (`SD-10`) just as well as db would have.

**What the switch gives up, deliberately.** The `db/CLAUDE.md` methodology-collision experiment is
gone entirely — instrument-service had no `CLAUDE.md` at all. So is the set of human-written
Planned briefs in `db/docs/features/` that the `po` node's framing was going to be read against;
`instrument-service/IMPLEMENTATION.md` is a phased TODO roadmap and only partly substitutes.
instrument-service **does** have a UI (`ui/`, React 19 + Vite + Playwright), so the
`hasUiStories: false` skip path still never executes — it stays unrun after run 6 as well.

**Next, in this order:**

Run 6 now waits on 0.1.10 and a lab run — see `Rafa-todo-list-1.md` for the engine work and
the release plan. This table is the target-repo half.

| # | do | state |
|---|---|---|
| 1 | fix the two false-green hazards in instrument-service (see below) | **DECIDED 2026-08-25 — fix both, before 0.1.10 ships** |
| 2 | `git init` instrument-service, drop the `application-*.yml` ignore line, baseline commit | **TODO** — blocking; the engine cannot run without a repo |
| 3 | dry lane: one manual worktree outside the repo, run `mvn -B verify` in it | **TODO** — agreed; converts run-destroying surprises into five minutes |
| 4 | four screen-reader passes on the merged lab app | **TODO** — framing settled, see below |
| 5 | 0.1.10, then one small `sdlc2-lab` run to prove it | **TODO** — stubs cannot show a tester really reading an issue file |
| 6 | write the run 6 prediction **in your own words**, then mine separately | **TODO** |
| 7 | grill the seed in an instrument-service-rooted session, then run 6 | **TODO** — no seed chosen yet |

**Why item 1 can no longer wait.** The lane gate fix in 0.1.10 is what finally gives
instrument-service two lanes — today it declares no `commands.install` shape the gate accepts, so
it would have built serially and the fixed Playwright port would have stayed dormant. Fixing the
gate is what turns that hazard from theoretical into active. The two changes must land together or
run 6's UI slices will pass against each other's builds.

### instrument-service: what was found before the run

Blocking, in order of how quietly they fail:

- **It is not a git repository.** No `.git`, no history. The build node hands agents
  `git worktree add`, `git checkout -b`, `git merge-base --is-ancestor`
  (`new-feature.workflow.js:1207,1222`). Run 6 would die at slice 1, after po/architect/ux had
  already spent their rounds.
- **A naive `git init && git add -A` breaks every lane.** `.gitignore` line 22 is
  `application-*.yml`, which matches `src/test/resources/application-test.yml` (and the dev/prod
  profiles). A worktree checks out **tracked files only**, so that file is absent in every lane:
  the session checkout is green and all N slices fail on config. Nothing in pre-check 0 looks for
  it. **None of the three files contains a secret** — all use `${ENV:default}` indirection and the
  only literal is a local dev password — so the ignore line is generic Spring boilerplate
  protecting nothing. Delete it before the baseline commit.
- **Fixed Playwright port + `lanes: 2` = a silent false green.** `ui/playwright.config.ts` pins the
  webServer to `127.0.0.1:4173` with `reuseExistingServer: true`. Two UI slices building
  concurrently in separate worktrees both start it; the second **reuses the first lane's server**,
  serving the first lane's build, and its acceptance test passes against the wrong code. SD-04's
  shape on a port instead of a filesystem — and unlike SD-04 it fails toward green. Proposed fix:
  `reuseExistingServer: false`, so a clash fails loudly.
- **`mvn verify` goes green without touching the database.** The integration tests carry
  `@Testcontainers(disabledWithoutDocker = true)`. No Docker in a lane, tests silently disable,
  suite passes. That makes the whole point of choosing `verify` over `test` conditional on an
  environment fact nobody checks. Proposed fix: drop the flag so it goes red.

**Why fixing both was recommended rather than letting run 6 find them:** neither is the graph's to
catch. The tester runs the declared command and reads its output; a pass that quietly skipped three
tests is indistinguishable from a real pass. No rubric asks, no defect would ever be filed. Leaving
them in does not test the graph — it poisons every verdict run 6 produces on exactly the axis the
target was switched to examine. **The session stopped before this was decided.**

### An engine finding, filed from reading the code, not from a run

**The lane gate assumes npm-style dependencies**, so instrument-service would build serially for
having nothing to install. **Described and owned in `Rafa-todo-list-1.md`, the "Lane gate" item** — do not
restate it here; two files describing one fix is how they drift apart.

Worked around for run 6 by declaring `mvn -B -DskipTests dependency:go-offline`, which is what
SETUP.md itself suggests. The lane gate ships in 0.1.10, ahead of run 6, so that declaration stops being
load-bearing once it lands.

### Config written this session (uncommitted, and instrument-service is not yet a repo)

Two new files, both containing an `<!-- sdlc2:config -->` block:

- **`instrument-service/CLAUDE.md`** — `stack` declared; `lanes: 2`; `test: "mvn -B verify"`;
  `install: "mvn -B -DskipTests dependency:go-offline"`; `build`, `run`, `e2e`; `seam.backend` is
  the real one (`@SpringBootTest(RANDOM_PORT)` + `@AutoConfigureWebTestClient` -> `WebTestClient`,
  Testcontainers Postgres via `PostgresIntegrationTestSupport`, `mockJwt()` for auth).
- **`instrument-service/ui/CLAUDE.md`** — the per-directory override. This is the path the comment
  at `new-feature.workflow.js:734` describes as the reason per-directory config exists, and it has
  **never been exercised**. Nested `CLAUDE.md` wins by longest matching path prefix (`configFor()`).

`mvn verify` was chosen over `mvn test` deliberately: `test` skips
`InstrumentApiIntegrationTest`, `InstrumentRepositoryIntegrationTest` and
`PostgresIntegrationTestSupport`, so on a reactive R2DBC service the tester's green would exclude
the persistence layer — building the soft checker of SD-10 into the config by hand.

**Environment verified:** Maven 3.9.9 (installation on `/mnt/c`, running the Linux JDK 21, `~/.m2`
on the Linux filesystem at 1.1G and shared across worktrees), Docker running, Java 21. No `mvnw`
wrapper in the project — commands use bare `mvn`.

### The screen-reader pass: framing settled, not yet run

Agreed this session, and it changes what the pass is for:

- **It is evidence, not remediation.** If it finds something, that is a separate job that belongs
  after run 6.
- **The target is the unoracled-claim chain, not the `ux` node's score.** The ux-auditor is static
  — it reads the mockup and the stories and never drives a browser — so `UX-A11Y` (weight 0.20)
  has always scored *structural* accessibility and never claimed "a screen reader announces this".
  A silent NVDA would indict the **architect** (ADR-0046, the `aria-relevant` argument), not the
  auditor. The real finding shape is: **the architect asserts a mechanism, the ux node scores a
  mockup embodying it, the tester verifies in jsdom which structurally cannot observe it, and the
  report prints green across all three.** Nobody lied; there is no oracle anywhere in the chain for
  the claim the feature is about, and the run does not say so. Under that framing **both outcomes
  pay**: clean means the architect's mechanism reasoning is trustworthy unverified; dirty means
  five runs shipped a headline requirement nothing checked.
- **SD-13 is wrong about the shape of the backlog.** It says "the six are one question asked six
  times". Reading the records: `saved-name` VH-02 names six lettered checks (a)-(f) plus VH-04 as a
  sub-check of (f) plus a hint-read-as-description check; `saved-at` VH-02 is two things (does a
  ticking row stay silent, is the row label heard); `remembered-names` VH-04 asks whether a swap is
  re-announced; `undo-a-removal` VH-02 is (a) arrival, (b) silence on age-out, (c) press. That is
  ~12 distinct observations across four features. **One pass would close six records on evidence
  covering about a third of them** — SD-13's own failure recurring one level down, in the act of
  resolving it. **Decision: four passes, one per feature, each record closed only against its own
  checks.** Timebox by session, not by record count; close two and say so if appetite runs out.
- **Every record frames the audible checks as binary — announced or swallowed — and misses a third
  outcome: announced TWICE.** The removal moves focus into the region (so the reader reads the
  region and its contents) *and* the offer is a node added to a polite live region (so it queues
  its own announcement). On a long list that is worse than either outcome any record contemplates,
  and none would catch it, because none asks *how much* is said.
- **Predictions must be written into SD-13 before the pass.** The ones currently on the table are
  *mine, adopted* — (a) announced, with real risk of duplication; (b) silent and correct, because
  `aria-relevant` defaulting to `additions text` genuinely excludes removals; (c) announced
  normally. **That is a methodology weakness, and it is the same one as SD-10 and E2-13:** a
  prediction authored by an instance of the same model that runs the graph predicts the things the
  graph is built to handle. It matters less here because NVDA is an external oracle, and much more
  for run 6, which is judged by reading the graph's own report.
- **Tooling:** `npm run dev` in `~/dev/code/sdlc2-lab`, open from Windows, NVDA in Chrome. WSL2
  forwards localhost. NVDA is the right bet — the most idiosyncratic live-region-plus-focus
  behaviour, so duplication shows there first.

### The run 6 prediction — write yours first

**You write it, in your own words, before I say what I expect. Then I write mine separately and
both go into `harness-findings.md` before the run starts.** Two predictions from different sources
is the only cheap way to make the disagreement visible; where they differ is where the run is worth
watching, and where they agree and the run defies both is the finding. Prompts, now that the target
has changed:

1. **Does the two-stack, two-`CLAUDE.md` config hold?** Root Maven, `ui/` Vite — the per-directory
   override path, first execution ever.
2. **Testcontainers under two lanes.** Two Postgres containers, Docker in the loop. `SD-05` — a
   transport failure scored as a content defect, never once fired in five runs, closed as
   proven-by-probe — is genuinely live in this environment for the first time.
3. **The per-criterion margins** (`[R-REP-08]`, new in 0.1.9) on unfamiliar ground.
4. **Rounds used.** Five runs trended 15 -> 3. On a codebase with no ADR history and no settled
   ubiquitous language, does it go back up? This is `SD-10`'s actual question.

**No seed chosen yet.** It still needs what run 5 could not produce and `E2-14` needs: three or
more slices that are **independent** — none blocking another — with **visibly uneven weights**, so
the barrier's cost is observable. `IMPLEMENTATION.md`'s phased TODO list is the place to look.

**`hasUiStories` is enforced now** — `[E2-06]` at `new-feature.workflow.js:695`, with the artifact
skip at `:685` and the build-time refusal at `:1504`. Any note below calling it unenforced is
stale. What has never executed is the `false` branch, and instrument-service has a UI, so it still
will not.

**0.1.9's theme is: the run can be read.** Four items, all observability — the veto tally
(`R-REP-07`), the per-criterion margins (`R-REP-08`), slice ids that name their branch
(`R-BUILD-07`), and a release step that reports what it actually did (SD-12). Only the third
changes engine behaviour, and its probe is driven against run 5's real manifest shape.

**SD-09 is CLOSED.** The sha stamp is dropped, not deferred: `R-PKG-07` catches the fault where it
is made, the engine is sandboxed and cannot read a clock or a filesystem, the install cache is not
a git checkout, and a file written at release time would name its own parent commit. VERSION plus
`R-PKG-07` already identifies the build, because no runtime-read file may move after the tag
without failing verify.

**SD-09 — two engines can both call themselves 0.1.6, and pre-check 0 cannot tell.** Run 4's own
fix (`[R-REP-06]`, `9966578`) was pushed with `VERSION` left at `0.1.6`, so the repo and the
install cache were both "0.1.6" and three engine files apart. Pre-check 0 compares directory
*names* against version-numbered siblings — both are literally `0.1.6`, nothing newer exists, so
it passes and the run proceeds on the older engine. SD-03 catches *older directory, newer one
installed*; this is *same name, different contents*, which no name comparison can catch. Unblocked
by shipping `[R-REP-06]` as **0.1.7**, and the guard is now built: **`[R-PKG-07]`** in 0.1.8 fails
`verify.mjs` when a runtime-read file has moved since the tag named by `VERSION` was cut. It is
proven against the real case — replay `9966578` with `VERSION` at `0.1.6` and it names
`new-feature.workflow.js`. **The second half is still open:** a report names the *version*, not the
*build*, so a stale run is still not identifiable from its own report. Stamping the commit sha into
the plugin at release is what closes that.

**Run 4 is DONE** — `nf-20260823T2033Z`, feature `saved-at`, 4 slices, all merged to lab `main`.
Report header reads `Engine: sdlc2 0.1.6`, so **SD-03 holds for the second time**. `git worktree
list` ended with only the main checkout, so **SD-04 holds again**. It was the first execution of
both 0.1.5 and 0.1.6 — five releases' worth of unrun fixes finally ran.

**What run 4 found: the fan-out row.** The report printed `build | pass | — | 0` beside three
scored nodes, which reads as a node nobody measured; build had been measured once per slice and
the row threw all four away. Fixed by `[R-REP-06]`: the row now carries unit counts, review-score
spread and worst-attempts-against-cap. Shipped as **0.1.7**, **not yet run**.

**What run 5 must still look at.** Every item below outlived run 4 and is unchanged:

- **The six prompt-only items of `sdlc2-enhance-2.md`** (E2-02 declared stack, E2-11 the plan
  printout, E2-12 surfaced disputes, E2-13 the read-only contract, E2-15 carry the seed forward,
  E2-16 the reviewer's exclusion list). A probe cannot judge a prompt.
- **E2-14, the removed level barrier.** `saved-at` cut 4 slices; check the run log for a slice
  starting while an unrelated sibling was still building.
- **The veto round and the plateau exit** — still no data after four runs. Per the note below,
  stop waiting for a run to settle these and build them as probes.
- **`hasUiStories`** — still unenforced, four runs later.
- **SD-05**, the free transport retry — still never fired. Close it as proven-by-probe (P18b).

**SD-03's refusal fired for real, for the first time.** The handoff for run 4 said pre-check 0's
stale-root refusal "has never fired against a real run, so verify it rather than trust it".
Executed against the live cache from a 0.1.6-pinned session it prints
`STALE: running 0.1.6, but 0.1.8 is installed`. That is a true positive against real state, not a
stub — and it is exactly why the restart below is not optional.

**Seed for run 5: pick one whose slices are of visibly uneven length** — the barrier only costs
you when siblings finish at different times, so equal slices hide both success and failure.

**Step 6: run 3 is DONE** — `nf-20260823T1333Z`, feature `remembered-names`, 2h 21m, 43 agents,
3.0M subagent tokens, 0 agent errors. Seven slices shipped, none escalated, no soft-passes, four
VH rows left open. The seed was the proposed one below, grilled in the lab session.

**What it settled, fix by fix.** **SD-04 holds**: 25 agents built in
`../.sdlc2-worktrees/remembered-names-nf-20260823T1333Z/<slice>`, the suite reported the project's
own 4 test files every time and never N+1, and `git worktree list` ended with only the main
checkout. **SD-03 holds**: the report opens `Engine: sdlc2 0.1.4`. **SD-07 holds, and visibly**:
the architect refused to add an undeclared `Blocked by:` edge for issue 06 and filed it against the
`po` node instead, which is exactly the behaviour the fix was for. **SD-05 is still unproven** —
43 agents, zero errors, so the free-retry path never fired. Three runs in, it has never been
exercised.

**What it found: SD-08** (below), fixed and shipped as **v0.1.5** — `[R-REP-05]`, 311 checks
green, was 304. **It has not itself been run**, so it joins the same queue every other fix has sat
in. It rides its own version rather than becoming a second tree calling itself 0.1.4, which is the
thing the `v0.1.4` tag was created to prevent.

**Next is step 6b**, `sdlc2-enhance-2.md`, now **13 items**. Run 3 added two of them and settled
the status of several more — see its own *What run 3 showed about the items written before it*
section, and the note below.

The two run 3 found are both about the same blind spot — **the graph can notice its plan is
wrong and cannot act on it**:

- **E2-12** — a defect filed against an earlier step never reaches that step. The architect
  refuted issue 06's queue, correctly and on time, filed it as `VH-01` against the `po` node,
  and the build then executed the refuted queue anyway. Slice 06 spent four of five attempts on
  the consequence. This is the gap SD-07 left: it stopped the architect from silently
  correcting the queue downstream, and gave the queue no way to be corrected at all.
- **E2-13** — the developer amended the acceptance criteria it was being judged against
  (`VH-06`). It did so well: options weighed, debt named and located, a human paid it in
  `3d4c2e1`. But the tester reads those criteria from the issue file, the developer can edit
  that file, and an honest narrowing and a quiet deletion produce the same green. The issue
  files are also uncommitted and shared across every lane until the report node's paperwork
  commit at the very end.

**The version gates are closed** (2026-08-23). `main` is pushed and matches `origin/main` at
`90131b9`; `installed_plugins.json` records `version: "0.1.4"` at that same sha; a recursive diff
of the repo against the install cache reports only the harness's own `.in_use` marker; and the lab
session was launched after the update and **confirmed running 0.1.4**. That last clause is the one
that matters — a session pins its plugin root at start (SD-03), so parity at *install* time is not
parity at *run* time. Nothing left to push, update or restart.

The seed and the persona probe are both spent: the run resolved `agentPrefix: "sdlc2:"` from the
available agent types and the nine namespaced personas answered throughout. The unprefixed global
lookalikes were never reachable, because only the plugin's are namespaced.

**Read `sdlc2-enhance-2.md` before interpreting run 3.** Three of its items change what the run's
own numbers mean: the plateau exit **cannot fire** (E2-03), so "it never fired" is not a data gap;
every code-review score is produced under a fail-biased instruction the engine was supposed to have
removed (E2-04); and a developer spawn that never answers is reported to the next attempt as a
checker refutation (E2-05). **All three were live during run 3**, so read its report knowing they
are there: no plateau exit could have fired, every code-review score in the slice table was
produced under the fail-biased instruction, and slice 06's four attempts should be re-read with
E2-05 in mind before its score is treated as a judgement about the code.

What v0.1.4 changed, and what run 3 has to confirm about each:

| id | fix | what run 3 must show |
|---|---|---|
| **SD-04** | Worktrees moved **outside** the repo — `../.sdlc2-worktrees/<feature>-<runId>/<slice>`, `[R-BUILD-07a]` | Lanes still start concurrently; the declared test command reports the project's OWN file count, not N+1; `git worktree list` shows only the main checkout at the end; the empty container is `rmdir`ed |
| **SD-05** | Every spawn goes through `spawn()`, which retries a no-answer **once, free**, before a round is charged; the round is recorded `errored`, not `rejected`, and the defect is a *harness* defect. `[R-LOOP-11]` | A transport failure no longer costs a node its pass. The tell in the history is a round marked `errored` — and if one appears, check the node still had its full round budget for content |
| **SD-03** | The run **names the engine that produced it** — first line of the run and the report header, `sdlc2 <version>` plus the plugin root, `unknown` when unstamped (`[R-REP-04]`). And **pre-check 0 refuses to start from a superseded plugin root** (`[R-PKG-06]`): version-numbered sibling dirs are compared with `sort -V`, no harness internals touched | The report opens with `Engine: sdlc2 0.1.4`. If it says anything else — or `unknown` — the run measured something other than what you pushed, and the rest of the report is about that other thing |
| **SD-07** | `issues/` is the single source of truth for the queue: the architect mandate, the persona, `design.md`'s output note and the new **`AR-QUEUE`** rubric criterion all say so. `[R-ARCH-03]` | `design.md` asserts no `Blocked by:` edge absent from `issues/`. If the architect disagrees with the queue it must show up as a defect against the `po` node, not as an edge downstream |


**SD-08 — the report could not say how the slices were built.** Found by run 3, fixed in the
working tree. The scheduler knew whether it opened lanes and which slices shared a level, and
`log()`ed it — which reaches the person watching the run and nobody else. The report, the artifact
that outlives the run, was never handed the fact, so run 3's report is silent in both directions:
it does not say lanes fired, and they did (four slices off `01` built together; a dozen agents
finished within five minutes of each other), and it does not say they did not. `modes/new-feature.md`
step 3b tells the main thread to read this *out of the report*, so that instruction had nothing to
read. Fixed by `[R-REP-05]`: the scheduler records `lanes`, the build node carries it out with its
rows, and the report prompt is handed it and told to state it either way — naming `commands.install`
as the one-line change when lanes stayed shut. Seven checks assert the chain at every hop, because a
break anywhere leaves the report silent exactly as it was. Shipped as **v0.1.5**.
**Not yet confirmed against a real run.**

**Not a defect, though it reads like one:** an empty `../.sdlc2-worktrees` container is left behind
after a run. Each run stamps and removes its own `<feature>-<runId>` directory inside it; the release
instruction says `rmdir` that container and **never its parent**, because a concurrent run may hold a
sibling. The 4KB directory is the price of that safety — do not 'fix' it.

SD-06 (a background workflow makes no progress while the session sits idle — 3h 01m of dead time
inside a 4h 41m run) is a **harness** issue, not sdlc2's. Nothing to fix here; it does mean any
wall-clock number from run 2 is meaningless, and that a graph run should not be left unattended.

**Run 3 needs a seed of its own.** `saved-name` is spent, and its diamond has already made its
point. What v0.1.4 has not been given a shape to test: the **veto-round question** (still no data
after two runs), the **plateau exit** (never fired), and `hasUiStories` (still unenforced). None of
those need a diamond — they need a doc node that struggles, which is not something a seed can order
up. Reuse the diamond recipe under *What run 2 settled* anyway: it is what makes lanes do anything,
and lanes are what SD-04 changed.

**Proposed seed (2026-08-23, not yet run):** *"Remember more than one name, not just the last
one."* The lab saves a single name today; replacing that one slot with a short list should cut a
base slice (save a list), three independent slices off it (remove one, cap the list at five,
most-recent-first) and a rejoin (clear the list — it needs the removal work, and the full-list
message has to disappear after it). That is the diamond, and it has screens, so `ux` runs. It also
carries one genuinely contested rule — **what happens when the same name is saved twice**
(ignore / replace / move to top) — left deliberately unsettled during the interview, because a doc
node with something real to fumble on is the only lever there is on the veto-round and plateau
questions.

## What run 2 settled

The run was worth paying for. **`[R-BUILD-04a]` is confirmed working against real agents for the
first time**, and it took three attempts to get a seed that could test it.

The `po` cut a genuine **diamond** — better than the fork the seed was engineered for:

```
        01 save the greeted name          (Blocked by: none,  cut from main)
       / |  \
     02  03   04                          (all three Blocked by: 01, all cut from 01)
       \ /
        05 fresh visit clears it          (Blocked by: 02 AND 03 — engine merged 02 into 05)
```

Independently re-verified here from the report's SHAs, resolving every ref first (SD-01's trap —
`--is-ancestor` exits non-zero on an unknown ref, which is indistinguishable from a true
negative). Full 5×5 matrix:

- **Every declared edge holds.** 01 ⊂ {02,03,04,05}; 02 ⊂ 05; 03 ⊂ 05.
- **Every negative holds.** 02 ⊄ 03, 03 ⊄ 02, 02 ⊄ 04, 04 ⊄ anything.

`git merge-base --is-ancestor <02> <03>` **fails**, as required. That is the assertion run 1 could
not make (four independent slices, every stacking vacuously consistent) and the 0327Z run could
not make (a pure chain). Third attempt, finally falsifiable, and it passed.

Also confirmed working, per the lab's findings file:

- **Tester base assertions** — all 7 tester invocations actually executed `git merge-base
  --is-ancestor`. The invariant is enforced, not merely instructed.
- **`[R-REP-03]`** (SD-02's fix) — paperwork committed to `sdlc2/saved-name`, clean tree. The
  reflog shows the branch was created, committed to, and merged by the human. Run 1 committed
  nothing; the 0327Z run committed all but the report; run 2 committed everything.
- **Parallel lanes** — three developers started at the identical second (23:02:48) in three
  worktrees, and all worktrees were released at the end with every `slice/*` branch intact.
  *(The diamond is what gave lanes something to parallelise — a chain serialises trivially.)*
- **`DOC_ROUNDS = 2`** — `po` passed unaided (0.72 → 0.88) and `architect` passed unaided
  (round-1 rejection → 0.87), neither arbitrated. Run 1's "all three doc nodes burn all five
  rounds and arbitrate anyway" is gone. Both still spend both rounds, though.
- **`R-IND-02`** — all 32 persona spawns were `sdlc2:sdlc2-*`. A discriminating probe ran
  *before* any spending, on four markers the global lookalike could not fabricate.

### Still unanswered after two real runs

- **The veto-round question** (`sdlc2-enhance-1.md` §1.1) — is there a round with `score ≥ bar`
  and no pass? Run 2 produced **no such round**: `po` 0.72 and `ux` 0.79 were both *below* bar,
  and the two rejected rounds carried no score at all. No data either way. Needs another run.
- **The plateau exit** — did not visibly fire; all three doc nodes used exactly their 2 rounds.
- **`hasUiStories`** — set correctly here, but still unenforced. A `po` that sets it false on a
  feature with a screen still skips `ux` with one log line.

## Where we are

| Step | What | State |
|---|---|---|
| 1 | Build the minimal lab | **done** — `~/dev/code/sdlc2-lab`, green, committed |
| 2 | Run one thin feature through the graph as-is | **done** — `nf-20260816T0246Z`, 4 slices; later shown to have executed **0.1.1** (SD-03) |
| 3 | Fix what step 2 reveals, plus Part 0 | **done** — v0.1.2, 220 checks green |
| 3b | *(unplanned)* `greeting-log` run + v0.1.3 | **done** — `nf-20260822T0327Z`; revealed SD-03, prompted `sdlc2-enhance-1.md` → v0.1.3. Seed cut a pure chain, so it could not test the fix |
| 4 | **Run 2 proper: 0.1.3, lab session, diamond seed** | **done** — `nf-20260822T2305Z` (`saved-name`), 5 slices, 1 soft-pass, 6 VH records resolved and merged to lab `main`. `[R-BUILD-04a]` confirmed |
| 5 | **v0.1.4 — fix SD-03, SD-04, SD-05, SD-07** | **done** — all four fixed, 304 checks green (was 262) |
| 6 | **Run 3 — the acceptance test for v0.1.4** | **done** — `nf-20260823T1333Z` (`remembered-names`), 7 slices, 0 escalated, 0 soft-passes, 4 VH rows open. SD-03/04/07 confirmed against real agents; **SD-05 never fired** (43 agents, 0 errors) and stays unproven. Found SD-08 |
| 6a | **v0.1.5 — SD-08, the report never said whether lanes fired** | **done** — `[R-REP-05]`, 311 checks green (was 304). Not yet run against real agents |
| 6b | **Round 2 of enhancements** — `sdlc2-enhance-2.md` | **written 2026-08-23, none implemented.** Ten items: four engine defects found by reading v0.1.4 against its own claims, the two packaging/independence items, and four judgement calls. To be worked AFTER run 3 |
| 6c | **v0.1.6 — the `sdlc2-enhance-2` batch** | **done** — sixteen items, all but E2-01. 366 checks green (was 311) |
| 6d | **Run 4 — the acceptance test for 0.1.5 AND 0.1.6** | **done** — `nf-20260823T2033Z` (`saved-at`), 4 slices, all merged. SD-03 and SD-04 hold again. Found the fan-out row |
| 6e | **v0.1.7 — `[R-REP-06]`, the fan-out row; SD-09 filed** | **done** — 371 checks green (was 366). Not yet run against real agents |
| 6f | **v0.1.8 — `[R-PKG-07]`, the SD-09 guard** | **done** — 372 checks green. Repo-side only; the build stamp is still open. Not yet run against real agents |
| 7 | The real project (TypeScript + Spring Boot + Maven) | not started — `SETUP.md` covers it |

The order held up, and the pattern is now four for four: **every bug in this project has been
found by executing something.** Run 2 adds four more that no amount of reading found — including
SD-04, where the feature that had never executed (parallel lanes, new in 0.1.3) broke the tester's
own ground truth the first time it ran.

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

- **`~/dev/code/sdlc2`** — plugin. **v0.1.3** implements every item in `sdlc2-enhance-1.md`:
  doc rounds 5→2 with a plateau exit, thresholds 0.80, the repair brief now carries the checker's
  per-criterion scores (a round that failed on score alone used to tell a round-3 maker it was its
  "first attempt"), the build arbiter can no longer commit, cross-round checker memory, severity
  anchors, four personas released from an interview they cannot run, parallel slice lanes in git
  worktrees gated on a new `commands.install`, namespaced VH ids, per-slice UX join, and a
  continuous executor in place of the wave barrier. `node verify.mjs` passes **262 checks**
  (was 220), including six new behavioural probes.

  **Run 2 was the acceptance test for these changes, and they largely held** — see *What run 2
  settled*. `[R-BUILD-04a]`, `[R-REP-03]`, the tester's base assertions, `DOC_ROUNDS = 2` and the
  parallel lanes all executed against real agents. The lanes brought SD-04 with them.

  **v0.1.4** (2026-08-23) fixes SD-03, SD-04, SD-05 and SD-07: worktrees outside the repo
  (`[R-BUILD-07a]`), one `spawn()` wrapper that retries a no-answer free before charging a round
  (`[R-LOOP-11]`), and `issues/` as the queue's single source of truth (`[R-ARCH-03]`, `AR-QUEUE`).
  It also closes **SD-03**: the run names its own engine (`[R-REP-04]`) and pre-check 0 refuses to
  start from a superseded plugin root (`[R-PKG-06]`). `node verify.mjs` passes **304 checks**,
  including 42 new ones across five probes. **None of it
  has run against real agents.**

  **RESOLVED 2026-08-23 — installed is 0.1.4 at `gitCommitSha: 90131b9`, the same sha as repo
  HEAD**, and the lab session was launched after the update and confirmed running 0.1.4. A
  recursive diff of the repo against the install cache reports exactly one difference: the
  harness's own `.in_use` marker. **Every executable path — `new-feature.workflow.js`, `modes/`,
  `skills/`, `agents/`, `VERSION` — is identical.**

  Method, for the next time this has to be checked. A one-file delta against the cache is normally
  this file plus the `.in_use` marker, not version skew; re-check it the same way rather than
  assuming. Resolve `${CLAUDE_PLUGIN_ROOT}` at runtime rather than hardcoding it —
  `[R-PKG-03]` forbids the literal path, and 0.1.1, 0.1.2 and 0.1.3 are all still cached as
  siblings, so the parent dir is not the answer. **Parity is not resolution**: the files matching
  says nothing about which persona answers to `sdlc2:sdlc2-po`, so still probe that from the lab
  session before spending the run. And per SD-03, parity at *install* time is not parity at *run*
  time — a session pins its plugin root at start, so the lab session must be launched **after**
  the update, not merely on a machine where the update happened.

  The v0.1.2 line, for history —
  the engine (`baseFor`, tester base assertions, reviewer base, round history, `[R-REP-03]`),
  both skill rewrites, `SPEC.md`, `modes/new-feature.md`, `verify.mjs` (+15 checks, P14).
  `node verify.mjs` passes **220 checks**.
- *(The 2026-08-21 "installed is 0.1.2, push before run 2" item is **done**, and so is the
  2026-08-23 "installed is 0.1.3" one — see the parity paragraph above.)*
- **`~/dev/code/sdlc2-lab`** — lab. `main` at `40cbfc0`, clean, suite green (**61 tests, 4 files,
  2.92s** — re-run 2026-08-23). Carries **run 2 merged**: `saved-name`'s five slices, its
  artifacts, and the six VH records resolved (`40cbfc0`); the `slice/saved-name/*` branches are
  deleted, so **resolve the report's SHAs before asserting anything about them** — SD-01's trap.
  Also carries `docs/harness-findings.md`, now **SD-01 … SD-07** plus a *confirmed working*
  section, which is the authoritative record of both runs. The three unmerged
  `slice/greeting-log/*` branches stay as SD-01's reproduction evidence.
  `vite.config.ts` now excludes `.sdlc2/worktrees/**` and `.claude/worktrees/**` — that is the
  lab-side half of SD-04, and it is a workaround, not the fix. Run 1's slice branches deleted; `vh-resolutions/greet-visitor` is now identical
  to `main` and can be deleted whenever. `tsconfig.tsbuildinfo` is untracked and gitignored, and
  `npm run build` was re-run to confirm it leaves the tree clean. **Now also** ignores
  `.sdlc2/worktrees/` and `.claude/worktrees/` — measured: one isolated agent takes the tree from
  clean to `?? .claude/`, which fails sdlc2's own pre-check 1 — and declares
  `install: "npm ci"`, which is what opens the parallel lanes.

## What run 2 answered, and what run 3 must watch

Run 2's checklist is resolved above under **What run 2 settled**. Carried forward for run 3:

- **The veto-round question and the plateau exit** — neither produced data. Run 3 is the third
  attempt at §1.1 of `sdlc2-enhance-1.md`.
- **`hasUiStories`.** If the `po` sets it false on a feature with a screen, `ux` is skipped with a
  single log line and `R-PO-04` is violated in the least visible way possible. Still unenforced,
  two runs later.
- **Whether SD-04's fix holds.** If worktrees move outside the repo, re-check that lanes still
  start concurrently and that worktrees are still released.
- **Whether a transport error still costs a node its pass** (SD-05). The tell is a round with no
  score in the history; after the fix it should read `errored` and not consume the budget.
- **Do not leave the run unattended** (SD-06), and treat any wall-clock figure as suspect unless
  agent time is stamped separately from elapsed time.
