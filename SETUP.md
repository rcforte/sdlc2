# SETUP — what your project must provide, and how to run the first slice

sdlc2 builds features **into an existing project**. It does not create one. This file is the
contract in the other direction: what your repo has to have before the graph will run, exactly
what goes in your `CLAUDE.md`, and what the first run looks like.

> Documents behaviour as built. Where the harness has a known gap, it is named in
> [Known limitations](#known-limitations) rather than papered over.

---

## 1. What sdlc2 needs before it will run

`/sdlc2 new-feature` refuses on the first failure and tells you what to fix. In order:

| # | Requirement | Why it is a hard gate |
|---|---|---|
| 1 | A **git repo** with a **clean tree** (`git status --porcelain` empty) | Slices commit; uncommitted work would be swept into them |
| 2 | A resolvable **default branch** | Every slice branch is cut from it, and it must not move |
| 3 | A **seed** at `.sdlc2/features/<slug>/feature.md` | The shared understanding the whole graph is scored against. Missing? sdlc2 grills you and writes it — see §4 |
| 4 | An **sdlc2 config block** in your `CLAUDE.md` with **`commands.test`** | Without it the tester has no oracle and the build gate is theatre |
| 5 | **`commands.test` green** right now | A red baseline makes every later tester verdict meaningless |
| 6 | The **plugin installed**, Claude Code **restarted**, and its nine personas resolving | Running against globally-installed lookalikes would break sdlc2's independence |

> ### Restart after installing — and never "fix" a name that won't resolve
>
> Installing a plugin does not register its agents in a session that is already running. Until
> you restart Claude Code, `sdlc2-product-owner` and friends do not exist, and the run stops at
> pre-check 7.
>
> **This is the one failure worth being paranoid about.** sdlc2's nine personas have obvious
> unprefixed names — `architect`, `developer`, `tester`, `code-reviewer`, `product-owner`,
> `ux-design`, `ux-auditor` and both critics — and if you have a general-purpose agent pack
> installed, every one of those names is already taken by something else. Observed on a real
> machine, all nine collided.
>
> So if the graph reports it cannot resolve `sdlc2-*`, **restart Claude Code**. Do not drop the
> prefix to make it work: the graph would run to completion against generic agents, produce every
> artifact, return every verdict, and look entirely successful while none of sdlc2's personas,
> rubrics or output contracts were involved. `R-IND-02` exists for exactly this, and
> `modes/new-feature.md` pre-check 7 is instructed to **stop** rather than guess.

Points 4 and 5 are the ones that bite. **You cannot start from an empty repo** — there is
nothing for `commands.test` to run, so gate 5 can never pass.

### The walking skeleton you need first

Before the first run, build — by hand or with plain Claude Code — a project that compiles and has
**one working end-to-end path** with its acceptance test. Not a bare scaffold: one real slice,
however trivial (a health endpoint rendered on a page is enough).

That hour buys you what sdlc2's rubrics assume already exists:

- **`AR-SEAM`** (weight 0.25) scores whether the acceptance-test seam is *"named and reachable"*.
  A seam nothing has ever been driven through is not demonstrably reachable.
- **`AR-FIT`** (0.15) scores *"consistent with the existing codebase and its conventions"*. On an
  empty scaffold there are no conventions, so the criterion scores against nothing.
- **`CR-IDIOM`** (0.20) scores code *"indistinguishable in style from the best existing code"*.
  Same problem.

Start from nothing and you are asking a maker/checker loop to invent your architecture while
being graded on conforming to it.

---

## 2. The config block

One fenced YAML block in your project's **own** `CLAUDE.md`, delimited by HTML comments. It is
the only configuration sdlc2 has.

~~~markdown
## sdlc2
<!-- sdlc2:config -->
```yaml
commands:
  test:    "./mvnw -q test"    # MANDATORY
  build:   ""                   # optional
  install: ""                   # optional — unlocks parallel slice lanes
  run:     ""                   # optional
  e2e:     ""                   # optional
seam:
  backend:  "REST via MockMvc (@SpringBootTest)"
  frontend: ""
```
<!-- /sdlc2:config -->
~~~

`/sdlc2 new-feature` detects your stack, **proposes** this block, shows it, and **asks before
writing it**. It is your file and it loads into every session, so sdlc2 never edits it silently.

### What each field actually does

Be aware that only one field is enforced. The rest are advisory — they shape prompts, they do not
gate anything.

| Field | Required | What reads it |
|---|---|---|
| `commands.test` | **Yes** | Everything. Run once as the baseline gate; quoted into every maker and checker prompt; run by the **tester**, whose `pass` is the only verdict no arbiter can overrule; the developer commits only when it is green. |
| `commands.build` | No | Printed in prompts. The **code-reviewer** *may* run it to read build output. Nothing depends on it. |
| `commands.install` | No, but it makes runs faster | **The only optional field that changes behaviour.** Declaring it lets independent slices build **concurrently**, each in its own git worktree. A fresh worktree has no installed dependencies, so this is the command that makes one testable — `npm ci`, `./mvnw -q dependency:go-offline`, `uv sync`. Without it every slice builds one after another and the run says so in its log. |
| `commands.e2e` | No | Printed in prompts only. **The engine never commands it** — `testerPrompt` runs `commands.test` and nothing else. An E2E suite that is not inside `commands.test` is never a gate. |
| `commands.run` | No | Printed in prompts. Nothing reads it. Purely informational. |
| `seam.backend` | No, but do it | Printed in prompts. The **architect** is scored on naming a seam *"matching the project's declared seam"* (`AR-SEAM`, 0.25). |
| `seam.frontend` | No, but do it | Same, for UI slices. Leave empty only while you genuinely have no frontend. |

**The rule that follows from this table: whatever `commands.test` does not run, sdlc2 does not
verify.** There is no second gate.

### Two lines your `.gitignore` must have

```gitignore
.sdlc2/worktrees/
.claude/worktrees/
```

Git worktrees are created **inside** the repository. sdlc2 puts a concurrently-built slice's tree
under `.sdlc2/worktrees/`, and the Claude Code harness puts its own agent worktrees under
`.claude/worktrees/`. Either one, un-ignored, shows up in `git status --porcelain` — which is
exactly the check sdlc2's own pre-check 1 requires to be **empty**. Left out, the symptom is a run
that refuses to start with a dirty tree it did not obviously dirty, or worse, a worktree swept into
a slice commit.

This is measured behaviour, not a precaution: launching one isolated agent in a repo without these
lines takes `git status --porcelain` from empty to `?? .claude/`.

Also make sure whatever `commands.install` produces is ignored — `node_modules/`, `target/`,
`.venv/`. Each lane installs into its own worktree, so an un-ignored dependency directory becomes
untracked noise in every one of them.

### Monorepos

A `CLAUDE.md` nested in a subdirectory overrides the root block for slices whose `Dir:` line falls
under it — longest matching **path segment** prefix wins, so `frontend` never claims
`frontend-legacy/`. Commands and seams merge over the root block.

The trap: `Dir:` names *one* directory, but a vertical slice crosses both ends. A full-stack slice
labelled `Dir: backend/` runs only the backend suite, and its React half ships unverified. Unless
you have a strong reason, **use one root command that runs both suites** and add no nested blocks.

---

## 3. Worked example — TypeScript frontend, Spring Boot backend, Maven

Layout:

```
repo/
  CLAUDE.md              <- the config block, at the root
  backend/   pom.xml     Spring Boot · JUnit · Cucumber-JVM · Playwright-Java
  frontend/  package.json  Vite · React · TS · Vitest · RTL · MSW
```

~~~markdown
## sdlc2
<!-- sdlc2:config -->
```yaml
commands:
  test:  "./mvnw -q verify && npm --prefix frontend test -- --run"
  build: "./mvnw -q package -DskipTests && npm --prefix frontend run build"
seam:
  backend:  "Cucumber @api scenario -> MockMvc (@SpringBootTest)"
  frontend: "Cucumber @ui scenario -> Playwright (@SpringBootTest RANDOM_PORT)"
```
<!-- /sdlc2:config -->
~~~

Why it is shaped this way:

- **`verify`, not `test`** — so Maven's failsafe phase runs the Cucumber functional tests, not
  just surefire's unit and integration tests. They have to be inside `commands.test` or nothing
  gates on them.
- **Both suites in one command** — the tester runs exactly one command, so anything outside it is
  unverified, and the tester is instructed to treat an unverified acceptance criterion as a defect.
- **Orchestration inside Maven** — `@SpringBootTest(webEnvironment = RANDOM_PORT)` starts and
  stops the server itself. A `commands.test` that shells out to `docker compose up` and `wait-on`
  pays that cost on **each of up to five attempts per slice**, and the harness does no lifecycle
  management to help you.

### The two Cucumber runners

Your issue's Gherkin becomes the executable test with no translation — `R-PO-02` requires each
issue's `## Acceptance criteria` to be Gherkin copied verbatim from `feature.md`, and `CR-TEST`
scores *"the acceptance test maps to its Gherkin scenario"*.

Cucumber-Spring allows exactly one `@CucumberContextConfiguration` per glue path, which is
precisely what lets you split cost by tag:

```java
// @api — MockMvc, no server, no browser: milliseconds
@Suite @IncludeEngines("cucumber")
@SelectClasspathResource("features")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME,       value = "com.shop.steps.api")
@ConfigurationParameter(key = FILTER_TAGS_PROPERTY_NAME, value = "@api")
class RunApiFeaturesIT { }

// @ui — real server on a random port, Playwright against it
@Suite @IncludeEngines("cucumber")
@SelectClasspathResource("features")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME,       value = "com.shop.steps.ui")
@ConfigurationParameter(key = FILTER_TAGS_PROPERTY_NAME, value = "@ui")
class RunUiFeaturesIT { }
```

Same `.feature` file, two step-definition packages. A backend-only slice never launches a browser.

> The tester ships with `Read, Grep, Glob, Bash` and **no browser tools** — that is deliberate, so
> sdlc2 depends on no other plugin. It does not stop you using Playwright: the *suite* drives the
> browser, and the tester just runs the suite.

### A simpler project

Single-stack repos need far less:

```yaml
commands:
  test: "npm test -- --run"
seam:
  frontend: "React Testing Library + MSW via Vitest"
```

---

## 4. Running the first slice

**Scope it to one slice.** The graph has three document nodes at up to five rounds each before the
build node even starts. A thin first feature costs roughly 11 agent calls if everything passes
first time, against ~45 worst case — and this run is how you learn what the harness does on your
project.

```
/sdlc2 new-feature "show the order confirmation number"
```

**Step 1 — it grills you.** If there is no seed, sdlc2 interviews you *in the conversation* and
writes `.sdlc2/features/<slug>/feature.md`. This is the only interactive step in the whole graph,
and it happens up front because a workflow's subagents have no channel to you. Expect real
questions about scope, exclusions and terminology; the `po` node is scored on carrying every one
of your answers through (`PO-GRILL`, 0.15).

**Step 2 — it proposes the config block** if you have none, and waits for your yes.

**Step 3 — it runs the baseline.** `commands.test` must be green.

**Step 4 — the graph runs unattended** to the end:

```
po ─┬─▶ architect ─┐
    └─▶ ux ────────┴─▶ build ─▶ report
```

Each node is a maker persona against an adversarial checker, scored on a rubric, up to five
rounds. Unresolved after five, an arbiter decides, writes down what it decided and why, and the
graph continues rather than stalling. A red test suite is the one thing no arbiter may overrule.

**Step 5 — you review and merge.** sdlc2 never merges and never moves your default branch.

### What you get

```
.sdlc2/features/<slug>/
  feature.md              your seed, extended with epics, stories, Gherkin, out-of-scope
  mockup.html             one self-contained file; happy paths, then state variants
  design.md               domain model, boundaries, the seam named per slice
  issues/NN-slug.md       one per vertical slice; its Gherkin IS the contract
  VERIFY-WITH-HUMAN.md    every call an arbiter made for you — append-only
  runs/<runId>.md         node table · slice table · open human-verify rows
docs/adr/NNNN-*.md        architecture decisions
slice/<feature>/NN-slug   one branch per slice
```

### Reading the result

Check the node table first. `pass` is clean; **`soft-pass` means an arbiter decided something on
your behalf** and there is a `VH-NN` row waiting for you to confirm or overrule. A run with a
soft-pass is never a clean run.

Then the slice table. An escalated slice names why, and the reasons mean different things:

| Reason | What it means |
|---|---|
| `no-commit` | The developer never reached a green commit. There is no branch to review. |
| `tester-red` | It committed, but the suite never went green. |
| `tester-silent` | The tester never returned a verdict. The slice is **unverified**, not proven broken. |
| `unjudgeable` | A checker reported it could not evaluate the slice at all. |

Then: review the `slice/` branches, merge what you accept, and answer the open `VH-NN` rows.

`/sdlc2 status` shows all of this for the repo at any time, without running anything.

---

## Known limitations

Real, current, and worth knowing before you plan a feature.

1. **Slices stack, and merge order matters.** A slice with `Blocked by:` is cut from its
   **blocker's branch**, so it contains the blocker's code and merging it merges the blocker too.
   Merge in slice order. The tester proves this with `git merge-base --is-ancestor` rather than
   taking the developer's word for it — an instruction alone did not hold on the first real run.
   *(Fixed in v0.1.2; this entry used to say the opposite.)*
2. **The paperwork is committed for you**, to a `sdlc2/<feature>` branch cut from the default
   branch, leaving your tree clean. If the report carries a `## Paperwork not committed` section,
   that step failed and the artifacts are still untracked — read it, because a lost
   `VERIFY-WITH-HUMAN` record is unrecoverable. *(Fixed in v0.1.2.)*
2b. **Parallel lanes need `commands.install`.** Without it, independent slices build one after
   another. With it, they build concurrently in separate worktrees — which also means their test
   suites run at the same time, so anything binding a **fixed port** will collide. Random-port
   test setups are fine; a dev server pinned to 5173 is not.
3. **`commands.e2e` is never run by the engine.** It is printed into prompts and nothing more. Put
   E2E inside `commands.test` or accept that it is not a gate.
4. **`hasUiStories` gates the whole `ux` node** on the product owner's judgement. If it decides a
   feature has no UI stories, UX is skipped with a single log line.
5. **The graph always starts at `po`.** There is no way to re-run only the build node, so a second
   run on the same feature redoes product framing and architecture.
6. **One repo, one default branch.** Multi-repo and multi-service features are deferred
   (`SPEC.md` §11).
