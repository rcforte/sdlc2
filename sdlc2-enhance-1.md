# sdlc2-enhance-1 — making the graph faster, cheaper and sharper

> Adversarial review of sdlc2 v0.1.2, prompted by one observation: **it takes a long time to run.**
> Every claim below is cited to `file:line` and labelled with a confidence. Numbers marked
> **measured** were produced by executing the engine's own declarations against stubs; numbers
> marked *estimated* are arithmetic on those measurements.
>
> **Read §5 first if you intend to act on the numbers** — it says exactly what was measured, what
> was assumed, and which part of this review is still outstanding.

---

## Status — all items implemented in v0.1.3 (2026-08-22)

Every item below is **implemented**. `node verify.mjs` exits **0** with **262 checks** (was 220),
including six new behavioural probes that drive the changed paths against stubbed agents.

| Item | State | Where |
|---|---|---|
| **E-01** rounds 5→2 + plateau exit | done | `DOC_ROUNDS`, `runLoop` plateau break; probe P18 |
| **E-02** repair brief carries scores; "first attempt" bug | done | `makerPrompt` 4th branch + `prevScores`; probe P15 |
| **E-03** thresholds → 0.80, tie-break split | done | `RUBRICS`, `checkerPrompt`; verifier asserts the binary tester still fails closed |
| **E-04** arbiter cannot commit; sha honesty | done | `buildArbiterPrompt`, `finalized:false` → escalate; probes P19/P20 |
| **E-05** cross-round checker memory | done | `checkerPrompt(…, prior)`; probe P16 |
| **E-06** interview-with-no-interviewee | done | **four** personas, not three — see below |
| **E-07** parallel slices in worktrees | done | dependency levels + lanes gated on `commands.install` |
| **E-08** namespaced VH ids | done | `VH-<node>-NN` / `VH-build-<slice>-NN`; arbitration moved inside the node |
| **E-09** effort gradient | done | tester `opus/medium`, reviewer `opus/high`, arbiters `opus/high`, resolver `sonnet/medium` |
| **E-10** severity anchors + doc veto scope | done | `blockingOpen(defects, docNode)`; probe P17 |
| **E-11** conditional mockup | done | `whenUi` output flag honoured by `auditMaker` |
| **E-12** per-slice design join | done | `ux` no longer feeds `build`; `runSlice` awaits `whenSettled('ux')` for a `ui` slice |
| **E-13** three small ones | done | po slice manifest, batched escalations, compact JSON |
| **B.2** worktree ignores | done | plugin + lab `.gitignore`, `SETUP.md`, pre-check 1 |

### Four things the implementation changed about the findings

1. **E-06 was four personas, not three.** Both reviews said three makers. `sdlc2-architect-critic`
   — a **checker** — also invoked the interview skill. While fixing it, all four *scoring* checkers
   turned out to carry "default to FAIL when uncertain" in their persona text too, contradicting
   E-03's engine-level fix; only the binary tester keeps it now.
2. **E-07 needed a config field nobody predicted.** A fresh worktree has no installed dependencies,
   so the test command cannot run in it. Lanes are therefore gated on a new optional
   `commands.install`; without it the engine stays sequential **and logs why**. This is the honest
   version of "independent slices build concurrently" — the parallelism is real, and it degrades
   safely where a lane could not be tested.
3. **The executor became a continuous scheduler.** E-12 is impossible under a wave barrier: `build`
   cannot start before `ux` if the executor waits for the whole wave. Nodes now start the moment
   their predecessors settle, which also delivers E-08's win.
4. **`SETUP.md`'s limitations 1 and 2 were stale** — they still said slices do not stack and that
   you commit the paperwork yourself, both fixed back in v0.1.2. Corrected while in there.

### What is deliberately NOT claimed

These are code changes verified against stubs. **None of this has run against real agents.** That
is the same trap as run 1 and v0.1.2, and it is why six probes were added rather than none — but a
probe proves the engine does what it says, never that an agent obeys a prompt. The estimates in §0
(−44 %, −62 %) remain **estimates** until run 2 is timed.

---

## 0. The measurement, before any opinions

### 0.1 Where the wall-clock actually goes

A **hop** is one sequential agent round-trip you must wait for. A loop-node round is
`maker (1 hop) → checkers in parallel (1 hop)` = **2 hops**. The graph is
`po → (architect ∥ ux) → build → report` (`new-feature.workflow.js:273,295,316,337`).

| Phase | Structure | Hops (run-1 shape) |
|---|---|---|
| `po` | 5 rounds × 2 + 1 arbiter | **11** |
| `architect ∥ ux` | 5 rounds × 2 + 1 arbiter, concurrent | **11** |
| `slices:resolve` | one `sonnet`/`low` call | 1 |
| `build` | 4 slices **sequential** × (dev + tester∥reviewer) | **8** |
| `report` | one call | 1 |
| | | **32 hops** |

**~47 agent invocations, 32 of them strictly sequential.** At a conservative 90 s per `opus`
`xhigh` call that reads files and writes artifacts, that is **~48 minutes of pure serial latency**
before any thinking time is counted. That is the complaint, quantified.

### 0.2 What is NOT the problem — ruled out by measurement, not by argument

I checked the usual suspects first and they are innocent. Do not spend effort here:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Prompt bloat | **Innocent** | **Measured:** engine-built prompts are 600–1 400 tokens. `po:maker` round 1 = 885 tok; round 2 with 6 defects = 1 421 tok; `build:developer` = 604 tok. |
| Quadratic per-round growth | **Innocent** | `defects` is *reassigned* each round (`:709`), never appended. Round 5 carries round 5's defects only. |
| Persona / skill prompt size | **Innocent** | **Measured:** all nine personas + four skills = 65 KB total, ~5–8 KB each. |
| Graph logic / crashes | **Innocent** | Run 1: no node crashed, the `ux` gate fired correctly, `build` passed 4/4 first attempt. |

**The cost is the *number* of agent calls, not the size of any one of them.** Every optimisation
below therefore targets call count and serialisation. Anything that merely shortens a prompt is
noise.

---

## 1. Root cause: five serial rounds of opus-grade judgment under a bar good work misses

### 1.1 A claim I got wrong, and the correction

My first draft called the pass gate at `:722` "close to unreachable" and blamed the
`open.length === 0` veto term (`:413-415`) — the one that fails a node on any **critical or high**
defect. **The adversarial review refuted that, using recorded data rather than argument, and it is
right.** The correction matters because it reorders the fixes.

The gate is `!binaryFailed && score >= bar && open.length === 0`. For the veto to be the binding
term you need rounds where `score >= bar` **and** `open > 0`. Every observable point in run 1 shows
the opposite:

| Node | Final score | Bar | Which term failed |
|---|---|---|---|
| `po` | 0.84 | 0.85 | **the score term** — by 0.01 |
| `architect` | 0.77 | 0.85 | **the score term** — by 0.08 |
| `ux` | 0.82 | 0.80 | neither — **passed clean on round 5** |

`ux` is the decisive one: a zero-open-defect round from an `opus`/`xhigh` checker under a
refutation mandate **is empirically achievable**, so the veto is not structurally unpassable.
Removing it entirely would not have passed `po` or `architect` — their scores were simply under
the bar.

> **Shared caveat, and how run 2 settles it.** Run 1 predates the per-round history feature
> (`:633-636` notes only the final score used to survive), so neither of us can see rounds 1–4. The
> veto *could* bind mid-loop — a `high` on a 0.10-weight criterion scored 0.5 still yields ~0.95,
> above the bar, with the veto alone blocking. Run 2 records history per round (`:637,:711`): any
> round with **`score ≥ bar` and no pass** is a veto round. That is the measurement to take.

**The surviving, sharper version of my point** — and it is the adversary's, not mine: **severity is
the only unanchored judgment in the system.** Scores get 0.0/0.5/1.0 anchors per criterion
(`:209-243`); severity gets no calibration at all in `checkerPrompt` (`:577-578` demands a severity
and never defines one), and one sentence in the persona. So on the rounds where the veto *does*
bind, it binds on the least-calibrated signal the checker emits. That is **E-10**, and it is a
correctness-of-judgment fix rather than a speed one.

### 1.2 What the cost actually is

Run 1's real asymmetry: the node with an **executable** oracle passed 4/4 slices first attempt,
while the three **opinion** oracles produced **one clean pass in fifteen rounds** — at the lowest
bar, on the last possible round. The graph's cost centre is not the build. It is five serial rounds
of `opus`-grade adversarial judgment per document, under a bar that good work misses, while:

- the loop **withholds the checker's per-criterion scores from the maker** (E-02), and
- **re-rolls a fresh, memoryless judge every round** (E-05),

so successive rounds are partly re-rolling judge variance rather than converging. `po` heads the
critical path, so every round it does not need shortens the whole run 1:1.

**On SPEC §12 risk 5.** It is titled *"Sonnet makers vs opus checkers"*, but the **architect maker
is `opus`** (`:282`) and scored **worst** (0.77); both `sonnet` makers scored higher. That is the
opposite of the under-powered-maker prediction. The register defers this pending runs 2–3; E-01
collects the same history three `opus` rounds per node cheaper, so deferring costs data rather than
buying it.

## 2. The items

Ranked by **win ÷ effort**. Each names the SPEC rule and the `verify.mjs` check that must move with
it — several are deliberate v0.1 decisions, not oversights, so changing them is a spec amendment
rather than a bug fix.

---

### E-01 — Doc rounds 5 → 2, plus a plateau exit
**Axis:** FASTER · EFFICIENT **Confidence:** HIGH

**Evidence:** `:39` `ROUNDS = 5`; the loop at `:638-729` has **no early exit** — only pass, `hard`,
or cap. Run 1: doc nodes hit the cap **3/3** while `build` passed **4/4** first attempt.

**The defect:** when the cap is the *modal* outcome, every doc node costs its **worst case** — ~11
serial agent runs each, roughly 32 of ~46 spawns per run, all ending at arbitration anyway. A node
whose history reads 0.77 → 0.77 → 0.77 still spends rounds 4 and 5 (2 makers + 2 `opus`/`xhigh`
checker panels) to reach an arbitration it was always going to reach.

**The fix:** set `rounds: 2` on `po`/`architect`/`ux` — the field is already per-node
(`:265,:288,:310`) — and add a plateau exit (Appendix A.2). **Keep `build` at 5**: its extra
attempts only cost anything when a slice actually fails, and its oracle is executable.

**Win:** *estimated* ~35–40 % of run cost and about half the pre-build wall clock. `po` heads the
critical path, so its rounds shorten the run 1:1.
**Risk:** more VH rows for you to read — but that is the documented-decision path the design already
has, not a new failure mode.
**Also move:** the prose "5 rounds" in `SPEC.md:18`, `meta` (`:4`), and the hardcoded
*"After 5 rounds"* in persona contracts (`sdlc2-product-owner-critic.md:240-241`).

---

### E-02 — The repair brief drops the checker's scores, and a score-only failure says "first attempt"
**Axis:** EFFECTIVE · EFFICIENT **Confidence:** HIGH (mechanical, verified)

**Evidence:** `makerPrompt` `:528-544`. The only inter-round state is `defects = dedupe(found)`
(`:709`). The checkers' per-criterion `{id, score, why}` array — **the very data the verdict is
computed from** (`:369-379`) — is never forwarded to the maker.

**Two defects in one place:**

1. A maker sitting at 0.5 on `PO-INVEST` learns *why* only if some defect happens to mention it,
   while being told *"do not regress what already passed"* (`:537`) **without being told what
   passed.**
2. **A latent bug.** If a round fails on score alone — the checker files no defects, or
   `cleanDefects` (`:383-392`) discards them all for missing evidence — then `real` and `stalled`
   are both empty and the `:544` else-branch fires: round 3 is told
   **`— first attempt.`** A burned round carrying zero bits.

**The fix:** ~10 lines. Forward `criteria` + `why` on rounds 2+, and give the third branch its own
"scored below the bar, no defects cited" text instead of letting it fall through to "first attempt".

**Win:** unquantified but plausibly large — this is a live mechanism behind the five-round
flatlines, and it compounds with E-01 (fewer rounds only help if each round carries signal).
**Risk:** minimal. More input per maker round, but §0.2 shows prompt size is not the constraint.

---

### E-03 — Drop `po` / `architect` thresholds to 0.80
**Axis:** EFFECTIVE · FASTER **Confidence:** MEDIUM-HIGH

**Evidence:** `po` 0.85 (`:207`), `arch` 0.85 (`:217`), `ux` 0.80 (`:227`). MIN across checkers
(`:708`), *"Default to FAIL when uncertain"* (`:568`), and 1.0-anchors written as absolutes
(*"every story, every path"*, `:209`).

**The defect:** run 1's **only unaided pass happened at the 0.80 bar.** `po` missed 0.85 by **0.01**
and paid an `opus`/`max` arbiter for the gap. MIN + a refutation mandate + absolute anchors put 0.85
inside judge noise for genuinely good work.

> **This is the item I under-rated in my first draft.** I measured that 0.85 → 0.80 only widens the
> passing region from 9/32 to 12/32 half-credit combinations and called it secondary. True but
> beside the point: **`po`'s actual 0.84 passes at 0.80 and fails at 0.85.** The distribution
> matters less than where the observed scores landed, and they landed in the gap.

**The fix:** `po` and `arch` → **0.80** in `RUBRICS` **and** SPEC §13 together (`SPEC.md:382,392`;
`[R-RUB-01]` compares them threshold-for-threshold). Soften `:568` for scoring checkers only —
add *"a clean pass with zero defects is a legitimate verdict"*. **Leave the binary tester failing
closed**; its ground truth is executable.

**Win:** converts cap-outs into round-1/2 passes — compounding directly with E-01.
**Risk:** marginally weaker artifacts pass. The severity veto still stands as a backstop.

---

### E-04 — A slice can ship a sha that predates the arbiter's own commits
**Axis:** CORRECTNESS (not speed) **Confidence:** HIGH — verified

**Evidence:** `buildArbiterPrompt` `:903-904` instructs: *"commit any fix on
'slice/`<feature>`/`<id>`' and keep the suite green (re-run the test command)"*. Then `:1107`
ships `sha: lastGood.sha` — **the sha from the last good build, before those commits** — and no
tester ever re-runs over the new tip.

**The defect:** `[R-BUILD-01]`'s "a tester verdict of `pass: true`" is satisfied by a verdict that
**predates the code now on the branch.** The arbiter is asked to re-run the suite, and nothing
asserts that it did. That is run 1's exact failure class, and the project's own doctrine names it
(`SPEC.md:324-325`): *an instruction with no executable assertion behind it is not an invariant.*

**The same hole sits above `build`:** `arbitrate()` (`:750-770`) lets a doc arbiter "finalize the
artifacts" (`:602-604`) that **every downstream node builds on**, and nothing re-checks what it
wrote.

**The fix — cheapest first:** forbid arbiter commits outright (accept-or-escalate only). Otherwise
re-run the tester once over the tip and ship **the tip's** sha.
**Win:** none in speed. Fix it because it is wrong.
**Risk:** the accept-or-escalate variant escalates slices that a one-line fix would have shipped.

---

### E-05 — A fresh, memoryless judge is re-rolled every round
**Axis:** EFFECTIVE · EFFICIENT **Confidence:** HIGH mechanism / MEDIUM attribution

**Evidence:** `checkerPrompt` (`:564-587`) carries no memory of prior rounds. Each round's checker
re-reads seed + artifacts + VH cold and re-scores **all five criteria**. The maker's `addressed`
field (`:121`) is collected by the schema and **read nowhere in the engine** — verified by grep;
`changelog` is length-audited (`:451-453`) and likewise never consumed.

**The defect:** judge-to-judge variance re-rolls the verdict every round, so a criterion that was
clean can drop against **unchanged text**. That is precisely the oscillation SPEC §12 risk 5 worries
about — manufactured by the loop itself, with the anchoring data paid for and then discarded.

**The fix:** on rounds 2+, give the checker the prior round's scores and open defects, framed:
*"verify claimed fixes with fresh evidence; no score may drop without a quoted regression."*
*Amends `[R-CTX-01/03]` — decide explicitly which side is the bug (`SPEC.md:8-10`).*

**Risk:** real, and it is the reason the mutual blindness exists — anchoring a checker to the prior
verdict trades independence for stability. `[R-LOOP-03]`'s mutual blindness *within* a round must
survive; this changes only memory *across* rounds.

---

### E-06 — Three personas are told to run an interview that cannot happen
**Axis:** EFFICIENT · EFFECTIVE **Confidence:** HIGH on the contradiction / MEDIUM on the cost

**Evidence:** `sdlc2-product-owner.md:52`, `sdlc2-architect.md:35` (both *"**always first**"*) and
`sdlc2-ux-design.md:36` send the maker to `skills/grill-with-docs/SKILL.md`, which drives
`skills/grilling/SKILL.md` — whose body is *"Interview me relentlessly… Ask the questions one at a
time, **waiting for feedback on each question** before continuing."* But `modes/new-feature.md:46-47`
states the ground truth: **"subagents have no channel to the user, so a workflow can never
interview."**

**The defect:** the **first instruction** of up to ~15 doc-maker spawns per run is a contradiction.
Best case ~11 KB of skill files are read and silently skipped; worst case the maker burns turns on
self-interview theatre.

> **Why this survived.** Run 1 found this file sending three personas to the *host's* skills and
> v0.1.2 rewrote it — but the rewrite fixed the **paths** and left the **semantics**. The file now
> correctly points at sdlc2's own interactive interview, which still cannot run inside a subagent.
> A second-order instance of the same bug, in the same file, three weeks later.

**The fix:** in each persona's sdlc2 contract section, state that inside the graph there is no user,
**the seed IS the finished grilling**, and `domain-modeling` is to be read for its formats only.
**Win:** ~11 KB × ~15 spawns of dead reading, plus whatever the theatre costs.

---

### E-07 — Build independent slices concurrently
**Axis:** FASTER **Confidence:** HIGH mechanism / MEDIUM magnitude

**Evidence:** `:966` `for (const slice of slices)`; `:951` logs *"building sequentially"*;
`:772-775` says *"Sequential by design … no worktrees"*. `[R-BUILD-04]` (`SPEC.md:198`) forbids
parallelism explicitly, and `verify.mjs:392-393` hard-asserts it.

> **Correction to my first draft.** I proposed giving each slice the runtime's
> `isolation: 'worktree'`. **That is wrong and would break `[R-BUILD-07]`.** Runtime isolation is
> **per agent call**, so the developer, tester and reviewer would each get *their own* tree — and
> `[R-BUILD-07]` requires all three to inspect *the same* one. Worse, git refuses to check out a
> branch already checked out in a sibling worktree, so the checkers would sit detached and the
> tester's `git branch --show-current` assertion (`:840-841`) would break.

`[R-BUILD-07]`'s substance is *"both checkers judge exactly the tree the developer produced, and
nobody moves it."* That is a **per-slice** invariant, not a global one. Two designs preserve it:

**(A) Per-slice shared worktree, plain git — full overlap.** The engine names a path per slice
(`.sdlc2/wt/<id>`); the developer opens it with `git worktree add <path> -b slice/<f>/<id> <base>`;
developer, tester and reviewer all operate via `git -C <path>`. All three see **one** tree, so
`[R-BUILD-07]` holds verbatim per slice, and different slices' trios run concurrently. **Assert it,
do not trust it** — have the tester check `git rev-parse --show-toplevel` equals the worktree path;
run 1 proved instruction-without-assertion fails. *Real costs:* worktrees do **not** share
`node_modules`, so one dependency install per slice; and concurrent suites collide on fixed ports
(Spring `RANDOM_PORT` is safe, Vite/Playwright defaults are not).

**(B) Parallel developers, serial verification — the minimal amendment.** Each developer builds in
an isolated tree and commits its slice branch; verification then runs serially in the session's main
tree exactly as today, one slice at a time, tester ∥ reviewer on the same tree. `[R-BUILD-07]`
survives **word for word**; only `[R-BUILD-04]`'s "no parallelism" and the `verify.mjs` assertion
need amending, and only for the dev stage. Wall clock goes from `Σ(dev+verify)` to
`max(dev) + Σ(verify)` — most of the win, because the developer is a slice's long pole.
**PROBED 2026-08-22 — (B)'s assumption holds. See Appendix B for the transcript.** The runtime
creates a **linked git worktree, not a clone**: `.git` is a *file* containing
`gitdir: <repo>/.git/worktrees/agent-<id>`, and that directory's `commondir` resolves to the main
`.git`. Refs and objects are therefore shared, and a branch committed inside the isolated tree is
**immediately visible from the main tree** — verified by resolving the probe commit and reading its
diff from the main checkout. **(B) is viable.**

The probe also returned two things neither review predicted — both in Appendix B, and both of which
change how E-07 must be built.

Blocked slices still wait for their blockers either way — a genuine dependency, gated per item
rather than globally. **Run 2's shape (02 and 03 both blocked by 01 only) gets 02 ∥ 03 for free.**

**Risks:** the VH race — concurrent build arbiters appending one file (land E-08 first, or keep
arbitration serial) — **plus the two probe findings in Appendix B, of which B.2 is a hard blocker
that must be fixed in every target repo before E-07 can work at all.**

---

### E-08 — Arbitration is deferred behind the wave barrier, then serialized
**Axis:** FASTER **Confidence:** HIGH mechanism / MEDIUM magnitude

**Evidence:** `walk()` barriers the wave at `:1276`, then arbitrates serially at `:1278-1291` —
*"on purpose: every arbiter read-then-appends the one `VERIFY-WITH-HUMAN.md`"*.

**The defect:** a race the engine manufactured for itself. If `architect` exhausts its rounds while
`ux` grinds on, architect's `opus`/`max` arbiter **idles until `ux` finishes**, and then the two
most expensive calls in the run execute back to back. The serialization exists **only** because
VH-NN ids are discovered by reading the file (`[R-VH-02]`, `SPEC.md:225-228`).

**The fix:** namespace the ids — `VH-<node>-NN`, with the engine handing each arbiter its prefix.
Arbitration then runs inside the node thunk, immediately and concurrently.
**Win:** up to one doc-loop tail plus one `opus`/`max` call off the design wave.
*Amends `[R-VH-02]` and `[R-LOOP-07]`.* **Note E-01 shrinks this by removing most arbiter calls.**

---

### E-09 — The effort gradient is inverted relative to blast radius
**Axis:** EFFICIENT **Confidence:** MEDIUM

**Evidence:** tester `opus`/`xhigh` (`:327`), reviewer `opus`/`xhigh` (`:328`), arbiters
`opus`/`max` (`:263,:286,:308,:330`) — but `slices:resolve` runs **`sonnet`/`low` with no checker**
(`:944`), and it is the step that **determines the entire branch topology**.

**The defect:** the tester's authority is *executable ground truth*, not model depth — `xhigh` buys
deliberation the task does not use. And run 1's single worst checker miss (the reviewer scoring a
three-slice-contaminated diff at 0.86) happened at the **highest** tier, so tier demonstrably was
not what quality hinged on.

**The fix:** tester `opus`/**`medium`** (cut effort, keep the model), reviewer `opus`/`high`,
arbiters `opus`/`high`, `slices:resolve` `sonnet`/**`medium`**. Update SPEC §7 (`SPEC.md:163-166`).
**Risk:** tester false-greens are unrecoverable — **cut effort there, never the model.**

---

### E-10 — Severity is the one unanchored judgment in the system
**Axis:** EFFECTIVE **Confidence:** HIGH

**Evidence:** every rubric criterion carries 0.0/0.5/1.0 anchors (`:209-243`); `checkerPrompt`
`:577-578` demands a `severity` on every defect and **never defines the levels**. The persona
offers one sentence (*"use them for real blockers and not for taste"*,
`sdlc2-product-owner-critic.md:237-238`). Meanwhile `blockingOpen` (`:413`) turns `critical`/`high`
into an absolute veto.

**The defect:** the veto fires on the least-calibrated signal the checker emits. A `high` also
already drags its criterion's score, so today it is **double-counted** — once in the score, once as
a veto.

**The fix:** (a) add severity anchors to `checkerPrompt` — *"`high` = building against this would
produce wrong software; wording and taste are `medium`/`low`"*; (b) for **doc nodes only**, veto on
`critical` alone. Keep `critical`/`high` for `build`, where the tester's veto is executable.
**Note:** `blockingOpen` does **not** exclude harness defects (`harnessDefect` is `critical`,
`:430-432`) — deliberate under `[R-LOOP-08]`, but it means rounds inflated by harness noise look
like veto rounds in any post-hoc analysis. Worth a separate label in the history.

---

### E-11 — Do not generate `mockup.html` when there are no UI stories
**Axis:** EFFICIENT **Confidence:** HIGH

**Evidence:** `MOCKUP` is an unconditional `po` output (`:269`) and `auditMaker` (`:445-449`) files
a defect if a declared non-templated output is missing — so the `po` **must** write a full
self-contained mockup. `ux` is separately gated on `hasUiStories` (`:315`).

**The defect:** for a backend-only feature the `po` generates a complete HTML mockup, `ux` is
skipped, and nothing ever reads the file.
**The fix:** make `MOCKUP` conditional on `hasUiStories`.
**Win:** zero for the lab and for run 2. **Matters for step 5 — the real Spring Boot project, where
backend-only features are the common case.**

---

### E-12 — Backend slices wait for `ux`
**Axis:** FASTER **Confidence:** MEDIUM

**Evidence:** both design nodes feed `build` (`:295,:316`); the backend tester and reviewer never
read `MOCKUP` (`:837-838,:878-879`); `Dir:` is already per-issue (`:270`), so the split is knowable
early.

**The fix:** per-slice join — backend slices eligible on `architect`, frontend on
`architect` + `ux`. Rides on E-07's scheduler; do not attempt separately.
**Risk:** a `ux` hard-fail (which blocks `build`) is discovered after backend spend. Bounded — the
branches survive for the re-run.

---

### E-13 — Three small ones
**Axis:** EFFICIENT **Confidence:** HIGH mechanics / LOW win

1. **`slices:resolve` is a serial round-trip** (`:934-945`) to re-read files the `po` maker just
   wrote. Extend `MAKER_PO` (`:137`) with the slice metadata; keep the spawn as a fallback.
2. **Escalation notes** (`:1087-1089`) are awaited **serially inside the slice loop**. Batch them
   into the report node, which runs under every outcome anyway.
3. **`JSON.stringify(defects, null, 2)`** at `:538`, `:596`, `:793`, `:902` — pretty-printing
   roughly doubles the defect block. Drop the `null, 2`.

---

### No defect found

Recorded so nobody re-audits them: path-not-body context discipline (`:550-557`, `[R-CTX-02]`) —
genuinely prevents quadratic growth; the non-arbitrable binary tester veto (`:725-728`) — correct;
the evidence gate and dedupe (`:383-411`) — a real filter; the data-driven executor (`:1198-1296`) —
clean. Both reviewers measured the engine-built prompts independently and agree they are lean.

## 3. What to implement, in order

| # | Item | Axis | Effort | Do it when |
|---|---|---|---|---|
| 1 | **E-02** repair brief carries scores; kill the "first attempt" bug | EFFECTIVE | ~10 lines | **Now** |
| 2 | **E-01** rounds 5 → 2 + plateau exit | FASTER | small | **Now** |
| 3 | **E-03** thresholds → 0.80 | EFFECTIVE | small (+SPEC §13) | **Now** |
| 4 | **E-04** stale sha after arbiter commits | **CORRECTNESS** | small | **Now — it is a bug** |
| 5 | **E-06** interview-with-no-interviewee | EFFICIENT | small (persona text) | **Now** |
| 6 | **E-10** severity anchors | EFFECTIVE | small (prompt text) | With E-03 |
| 7 | **E-11** conditional mockup | EFFICIENT | small | Before step 5 (Spring Boot) |
| 8 | **E-13** three small ones | EFFICIENT | trivial | Any time |
| 9 | **E-05** cross-round checker memory | EFFECTIVE | medium (+`[R-CTX]`) | After run 2 |
| 10 | **E-09** effort tiers | EFFICIENT | small (+SPEC §7) | After run 2 |
| 11 | **E-07** parallel slices — **probe (B) first** | FASTER | **large** (+SPEC, +`verify.mjs`) | After run 2 lands |
| 12 | **E-08** namespaced VH ids | FASTER | medium | Only with E-07 |
| 13 | **E-12** per-slice design join | FASTER | medium | Rides on E-07 |

**Items 1–5 are the batch.** They are small, they aim at the measured cost centre, and E-02 is the
one to land *first* — E-01 shortens the loop, but shortening a loop whose rounds carry no signal
just gets you to arbitration sooner. Fix the signal, then cut the rounds.

**The sequencing decision you actually have to make.** `HANDOFF.md` says run 2 exists to validate
the branch-stacking fix (`[R-BUILD-04a]`), which has never executed. E-07 changes slice scheduling —
**the exact thing run 2 is meant to measure.** Do not change both at once. Two coherent orders:

- **Run 2 first, on the current harness** *(my recommendation)* — you get the stacking evidence
  against a known shape, plus the per-round histories that settle the veto question in §1.1 and the
  maker-strength question in SPEC §12 risk 5.
- **Land items 1–5 first** — none of them touches slice scheduling or branch bases, so run 2's
  stacking assertions stay valid. It costs you comparability of round counts against run 1, and buys
  a cheaper, faster run 2.

Either is defensible. **What is not defensible is E-07 before run 2.**

## 4. Guardrails for whoever implements this

- `node verify.mjs >/dev/null; echo $?` — **read the exit code, not the tick count.**
- **E-03** changes SPEC §13 thresholds (`SPEC.md:382,392`). `[R-RUB-01]` compares `RUBRICS` to §13
  *threshold-for-threshold* — change both or verify goes red. `verify.mjs:290` only range-checks.
- **E-10** changes `[R-LOOP-01]` (`SPEC.md:108`), which currently mandates the `critical`/`high`
  conjunction.
- **E-01** must also move the prose "5 rounds" in `SPEC.md:18`, `meta` (`:4`), and the hardcoded
  *"After 5 rounds"* in `sdlc2-product-owner-critic.md:240-241`.
- **E-05** amends `[R-CTX-01/03]`; **E-08** amends `[R-VH-02]` and `[R-LOOP-07]`.
- **E-07** changes `[R-BUILD-04]` (`SPEC.md:198`) and **breaks `verify.mjs:392-393` by design.**
  Those two checks must be **rewritten to assert the new invariant, never merely deleted** — they
  are the only executable guard on branch topology.
- **Every fix in this document is an unexecuted fix** — the same trap as run 1 and v0.1.2, and the
  reason E-06 exists at all (v0.1.2 fixed that file's paths and left its semantics wrong). Extend
  `verify.mjs`'s stub-driven probes (`:240-280`) for each: the loop, the build node and the executor
  can all be driven through their failure paths without spawning a single agent.

## 5. Provenance — how this was produced, and where the two reviews disagreed

Two independent passes over the same source: **an adversarial subagent on `fable`**, mandated to
refute sdlc2's design on latency, cost and effectiveness, and **my own analysis**. Findings were
merged only after I re-verified each mechanically against the code. **Where we disagreed, the
disagreement is recorded rather than smoothed over** — §1.1 is the substantive one.

| Claim | First draft (mine) | After the adversarial pass | Who was right |
|---|---|---|---|
| The `open.length === 0` veto is the binding constraint | asserted as root cause | **refuted** — the *score* term failed in both observable cap-outs; `ux` passed clean, proving the veto is passable | **Adversary.** Corrected in §1.1; the surviving point became E-10 |
| Threshold drop is "secondary, worthless alone" | argued from a 9/32→12/32 combination count | **promoted to E-03** — `po`'s actual 0.84 passes at 0.80 and fails at 0.85 | **Adversary.** The distribution was beside the point |
| Slices parallelize via `isolation: 'worktree'` | proposed | **refuted** — runtime isolation is *per agent call*, so it breaks `[R-BUILD-07]`'s shared-tree requirement | **Adversary.** Replaced with designs (A)/(B) in E-07 |
| Prompt bloat is not the cost driver | measured | **agreed independently**, with the caveat that per-spawn *input* (persona + skills + re-reads) is where tokens go — which is what makes E-05 and E-06 matter | Both |

**What was measured vs assumed:**

| Claim class | How established | Trust |
|---|---|---|
| Prompt and persona sizes | **Measured** — engine declarations evaluated against stubs (`verify.mjs:240-280`) | High |
| Rubric pass/fail arithmetic | **Measured** — the engine's own `weightedTotal()` over all 32 half-credit combinations | High |
| Code structure, `file:line` | Read directly; every adversary citation re-checked with `grep -n` before inclusion | High |
| Run 1 outcomes | From `HANDOFF.md` — *recorded*, not re-derived from the run report | Medium |
| Hop counts, wall-clock minutes | *Estimated* — arithmetic at an assumed **90 s/hop** | **Low on absolute minutes; higher on ratios** |

**The 90 s/hop figure is an assumption.** Treat the ratios as the finding and the minutes as
illustration; timing run 2 end to end is what would confirm them.

**Two corrections I made to my own work while writing this**, both from executing rather than
reading: the score gate tolerates **two** half-credit criteria, not one (`:378` rounds 0.875 up to
0.88); and the root-cause claim in §1.1 was wrong. Consistent with this project's record — every
real defect in it has come from executing something.

**Since resolved by execution:** E-07 design (B) rested on an unprobed assumption about the
runtime's worktree isolation. **It was probed on 2026-08-22 — see Appendix B.** The assumption
holds, and the probe additionally turned up a hard blocker (B.2) that neither review predicted. The
probe's own state was cleaned up afterwards and the repo verified back to its `b22e5c3` baseline.

**Still not verified:** the adversary did not read `verify.mjs` (it took my `:392-393` citation on
trust), `REVIEW-0.1.0.md`, `sdlc2-code-reviewer.md`, `sdlc2-ux-auditor.md`, or the installers.
Nothing in this document depends on those, but a claim about them would be unsupported.

---

## Appendix A — the "now" batch, concretely

Edits for items 1–5 of §3. Line numbers are `new-feature.workflow.js` at `42831a8`.

### A.1 — E-02: carry the scores forward, and kill the "first attempt" bug (`:528-544`)

The highest-value edit in this document, and the smallest. Today the third branch fires whenever a
round produced no *usable* defects — including a round that simply scored below the bar — and tells
a round-3 maker it is on its first attempt.

```js
// :534-544, replacing the three-way `repair` expression
const repair = real.length
  ? `\nROUND ${round} of ${node.rounds} — an independent adversarial checker REFUTED the previous round.\n` +
    `Fix EVERY defect below and do not regress what already passed.\n` +
    `${JSON.stringify(real)}\n` + scoreBrief(prevCriteria)
  : stalled.length
  ? `\nROUND ${round} of ${node.rounds} — the previous round could not be SCORED: ` + /* …unchanged… */ ``
  : round > 1
  ? `\nROUND ${round} of ${node.rounds} — the previous round scored BELOW THE BAR but cited no\n` +
    `defect the engine could use. Raise the weakest criteria below; nothing here is a first draft.\n` +
    scoreBrief(prevCriteria)
  : `\nROUND ${round} of ${node.rounds} — first attempt.\n`
```

`scoreBrief(prevCriteria)` renders the previous round's per-criterion `{id, score, why}` — the array
the verdict is already computed from at `:369-379` and currently thrown away. Thread it out of
`runLoop` alongside `defects` at `:709`.

> **There is already a hook for this, unused.** `makerPrompt` takes a fourth parameter `extra`
> (`:528`) which **is** wired into the body — `(extra ? \`\n${extra}\n\` : '')` at `:554` — but the
> sole caller passes `null` (`:643`). So the minimal version of E-02 needs **no signature change at
> all**: compute the brief in `runLoop` and pass it as `extra`. That is close to a two-line fix for
> the highest-value item in this document.

**Note the `round > 1` guard.** Without it a genuine first round with a silent checker would be told
it is a repair, which is the mirror-image bug.

### A.2 — E-01: plateau exit (inside `runLoop`, after the `history.push` at `:711`)

```js
// Two rounds that move neither the score nor the open-defect count are not converging.
// Continuing spends a maker plus a full checker panel that cannot change the outcome.
if (history.length >= 3) {
  const [a, b, c] = history.slice(-3)
  const flat = (x, y) => x.score !== null && y.score !== null &&
                         y.score <= x.score + 0.03 && y.open >= x.open
  if (flat(a, b) && flat(b, c)) {
    log(`${label}: flat for 3 rounds — arbitrating now instead of burning ${node.rounds - round} more.`)
    break
  }
}
```

`break` falls into the existing `needs-arbitration` return at `:737-746`, so `[R-LOOP-07]`, the VH
records and the reporting all behave exactly as they do today. Set `rounds: 2` at `:265,:288,:310`.

### A.3 — E-03: thresholds and the scoring tie-break

`0.85` → `0.80` at `:207` and `:217`, **and** the matching lines in `SPEC.md:382,392`.
Then split the tie-break at `:568` so it applies to scoring checkers only — the binary tester must
keep failing closed:

```js
(checker.binary
  ? `Default to FAIL when uncertain. Your lens: ${checker.lens}.\n`
  : `Score what you can evidence; do not penalise for what you did not check. ` +
    `A clean pass with zero defects is a legitimate verdict. Your lens: ${checker.lens}.\n`) +
```

### A.4 — E-04: close the stale-sha hole (`:903-904`, `:1107`)

Cheapest correct fix — make the build arbiter accept-or-escalate, never commit:

```diff
-1. Fix what is cheap and safe; commit any fix on 'slice/…' and keep the suite green
-   (re-run the test command; a red suite means you must revert the fix).
+1. Do NOT commit. You are deciding, not building: for each finding, either ACCEPT it as recorded
+   debt or ESCALATE the slice. The sha already verified by the tester is what ships.
```

If you keep arbiter commits instead, then `:1107` must ship the **tip** sha and a tester must re-run
over it — the point is that `sha` and "the sha a tester actually passed" must be the same commit.

### A.5 — E-06: the personas (three files)

In `sdlc2-product-owner.md:52`, `sdlc2-architect.md:35`, `sdlc2-ux-design.md:36`, replace the
"always first" grill-with-docs line with:

> Inside the graph **there is no user to interview** — the seed `feature.md` **is** the finished
> grilling. Do not run `grill-with-docs`. Read
> `${CLAUDE_PLUGIN_ROOT}/skills/domain-modeling/SKILL.md` for the ubiquitous-language and ADR
> **formats** only.

### Probes to add to `verify.mjs` before any of this ships

Every fix above is an **unexecuted fix** — the trap that produced run 1's two defects, v0.1.2's
untested patches, and E-06 itself. The stub harness at `verify.mjs:240-280` drives the loop without
spawning an agent, so each of these is free:

1. **E-02:** a round with a below-bar score and zero usable defects → the next maker prompt does
   **not** contain `first attempt`, and **does** contain the prior criterion scores.
2. **E-02 mirror:** round 1 with a silent checker → the prompt **does** say `first attempt`.
3. **E-01:** three rounds at an identical score and open count → the loop breaks at round 3, returns
   `needs-arbitration`, and calls the arbiter **exactly once** (`[R-LOOP-07]` intact).
4. **E-03:** a verdict totalling 0.82 on `po` now passes; the binary tester's prompt still contains
   `Default to FAIL when uncertain` while a scoring checker's does not.
5. **E-04:** the build-arbiter prompt contains no instruction to commit; a soft-passed slice's
   reported `sha` equals the sha the tester verified.
6. **E-10:** a `critical` defect at a passing score still blocks — the regression guard without
   which narrowing the veto is indistinguishable from deleting it.

---

## Appendix B — probe: what `isolation: 'worktree'` actually does

Run 2026-08-22 against this repo (`sdlc2` @ `b22e5c3`) by launching one subagent with
`isolation: "worktree"` and observing **from the main tree** — the decisive side, since the question
is what the main checkout can see. The subagent's own transcript agreed independently.

### B.1 — The mechanism: a linked worktree, so **E-07 design (B) is viable**

| Observation | Value | Means |
|---|---|---|
| Worktree path | `<repo>/.claude/worktrees/agent-<id>` | **inside the repo** — see B.2 |
| `.git` there | a **file**: `gitdir: <repo>/.git/worktrees/agent-<id>` | linked worktree, **not a clone** |
| `--git-common-dir` | `<repo>/.git` | object store and refs are **shared** |
| `git worktree list` from main | lists both entries | registered in the main repo |
| Branch it starts on | `worktree-agent-<id>`, at the base commit | **not** `main` — see B.3 |

The probe created `probe/worktree-isolation` and committed `64de87f` inside the isolated tree. From
the **main** checkout, with no fetch or push:

```
$ git rev-parse probe/worktree-isolation      → 64de87f3e734ba607056e6f5417a999adeb7bf12
$ git show --stat probe/worktree-isolation    → WORKTREE-PROBE.txt | 1 +
```

**Refs and objects propagate. The assumption behind E-07 design (B) holds** — a developer can build
in an isolated tree, commit its slice branch, and the main tree can then verify it.

### B.2 — **Blocker: the worktree dirties the repo and trips sdlc2's own clean-tree gate**

Neither review predicted this. The worktree is created **inside the repository**, at
`.claude/worktrees/`, and `.claude/` is **not** covered by any ignore rule here:

```
# baseline, before the probe
$ git status --porcelain        → ?? sdlc2-enhance-1.md
# with one live agent worktree
$ git status --porcelain        → ?? .claude/
                                  ?? sdlc2-enhance-1.md
$ git check-ignore -v .claude/worktrees  → (no match — NOT ignored)
```

`modes/new-feature.md` pre-check 1 requires `git status --porcelain` to be **empty**, and the
clean-tree gate runs before and between slices. **So adopting worktree isolation would make sdlc2
fail its own pre-check** — and worse, a stray `.claude/` could be swept into a slice commit.

**Required before E-07:** every target repo must ignore `.claude/worktrees/` (the lab and the real
project both). This is a change to each **target repo**, not to the harness — a deployment step that
has to be part of E-07, and one worth adding to `SETUP.md` for step 5.

> This is the third time on this project that executing something produced a defect that reading
> did not. It also would have been found the *expensive* way — as a pre-check failure partway
> through a paid run.

### B.3 — Refinement: the main tree cannot check out a branch a live worktree holds

```
$ git checkout probe/worktree-isolation
fatal: 'probe/worktree-isolation' is already used by worktree at
       '/home/rcforte/dev/code/sdlc2/.claude/worktrees/agent-a32235ac22589b95b'
```

The adversarial review predicted this, and it is confirmed. It constrains E-07 design (B)
specifically: the plan was *"developers build in parallel, then verification runs serially in the
main tree."* That checkout **fails while the developer's worktree still holds the branch.** So (B)
needs an explicit release step — `git worktree remove` (or `worktree prune` after the agent exits)
— between the parallel dev stage and serial verification. Design (A) sidesteps it, since the
checkers use `git -C <worktree>` and never check the branch out anywhere else.

Two smaller notes: each isolated agent leaves an extra `worktree-agent-<id>` branch in the repo's
namespace (cosmetic, but N concurrent slices means N of them); and `git branch --list` marks a
worktree-held branch with a leading `+`, which any parsing of branch output must tolerate.

### B.4 — Net effect on E-07

Design (B) is **viable and now evidence-backed**, with two added obligations: **gitignore
`.claude/worktrees/` in the target repo (B.2, a hard blocker)** and **release the worktree before
serial verification (B.3)**. Neither is difficult; both are invisible until you run it.
