# /sdlc2 new-feature "<idea>" — run the feature graph

Takes a **grilled** idea to **merge-ready slices**: product framing → architecture ∥ UX → build →
report. Every node is a maker/checker loop; a node that can't reach its rubric threshold in 5
rounds is **arbitrated and documented**, never stalled. The graph is autonomous end-to-end — the
only human moments are the grilling that precedes it and the merge that follows it.

**Contract:** when this returns, every slice that passed is committed on its own
`slice/<feature>/<NN>-<slug>` branch, every slice that failed is marked for you, every unresolved
judgement call is a row in `VERIFY-WITH-HUMAN.md`, and the paperwork is committed to
`sdlc2/<feature>` so nothing is left loose in your tree. **sdlc2 never merges.**

---

## 1. Pre-checks — main thread, before invoking anything

Do these in order and **stop** on the first failure, saying exactly what to fix.

0. **Which engine is about to run.** Do this FIRST — it is the cheapest check here and the one
   whose absence cost the most. Resolve `${CLAUDE_PLUGIN_ROOT}`, read the `VERSION` beside it, and
   say both out loud before anything else:

   ```bash
   root="${CLAUDE_PLUGIN_ROOT}"
   ran=$(cat "$root/VERSION" 2>/dev/null || echo unknown)
   echo "sdlc2 $ran — engine at $root"
   ```

   Then check that this session is not **pinned to a superseded engine**. A Claude Code session
   fixes its plugin root at start, and the plugin cache keeps every installed version side by side
   in version-numbered directories — so after a mid-session `claude plugin update` the old path
   keeps resolving and keeps working, silently. If the plugin root's own directory name is a
   version, look for a newer sibling:

   ```bash
   here=$(basename "$root"); parent=$(dirname "$root")
   case "$here" in [0-9]*.[0-9]*.[0-9]*)
     newest=$(ls -1 "$parent" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
     [ -n "$newest" ] && [ "$newest" != "$here" ] && echo "STALE: running $here, but $newest is installed" ;;
   esac
   ```

   If that prints `STALE`, **stop**. Say that the session must be restarted to pick up `$newest`,
   because nothing else will: the run would succeed, write its report, and return normal-looking
   verdicts measured against an engine that is no longer the one being developed. That is not
   hypothetical — runs 1 and 2 of this plugin executed 0.1.1 while 0.1.2 was installed, ~6.3M agent
   tokens spent measuring a superseded engine, and it surfaced only because a finding cited
   requirement IDs that were absent from the spec being read.

   A non-version directory name (a local or dev install) is fine — skip the comparison and carry
   the version forward. Pass whatever you read as `version` in the engine's args either way; the
   engine reports it verbatim, and `unknown` is an honest answer where a guess is not.

1. **Git.** Your **session's working directory is the target repo** — sdlc2 has no `repoRoot`
   argument. The engine builds `featureDir` as a relative path and hands the developer bare
   `git checkout -b` / `git commit` commands, and subagents inherit the session's cwd. A session
   rooted anywhere else will cut `slice/*` branches and write `.sdlc2/` into *that* repo instead,
   silently and plausibly. `cd` in a shell command does not fix it; the session root reasserts
   itself on the next call. If you are not rooted at the repo you mean to build in, **stop** and
   say it must be relaunched there.

   Then: **worktree hygiene.** sdlc2 builds concurrent slices in worktrees **outside** this repo
   (`../.sdlc2-worktrees/`), so its own trees need no ignore rule and are invisible to your test
   runner. What still needs one is whatever path *this harness* puts its own agent worktrees in,
   commonly `.claude/worktrees/`: those are created inside the repository, so an un-ignored one
   shows up as untracked, fails the clean-tree check below on the next run, and can be swept into
   a slice commit on this one. If it is not ignored, say so and offer to add it to `.gitignore`
   before continuing.

   Also confirm the parent directory is writable — `../.sdlc2-worktrees/` is created there — and
   note that a *stale* `../.sdlc2-worktrees/` from an aborted run is harmless: each run stamps its
   own `<feature>-<runId>` container, so paths never collide.

   Then: the repo is a git repo and `git status --porcelain` is **empty**. A dirty tree stops
   the run (slices commit; stray changes would be swept into them). Resolve the default branch:

   ```bash
   git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||'   # → main
   ```

   **Strip the remote prefix.** That command prints `origin/main`, and the engine passes
   `defaultBranch` straight into the developer's git instructions — a slice cut from
   `origin/main` with "`origin/main` must not move" reads as nonsense and risks a detached HEAD.
   If there is no `origin/HEAD`, use the current branch when it is `main` or `master`, and
   otherwise **ask** rather than guess: every slice branch is cut from this.

2. **Feature slug.** Kebab-case the idea (`"guest checkout"` → `guest-checkout`) unless the
   argument already names an existing `.sdlc2/features/<slug>/`. All artifacts live under
   `.sdlc2/features/<slug>/`.

3. **The seed.** `.sdlc2/features/<slug>/feature.md` must exist and carry the shared understanding
   from a grilling. **This is the one interactive step, and it belongs here, not inside the
   graph** — subagents have no channel to the user, so a workflow can never interview.
   If the seed is missing, conduct sdlc2's own grilling now, in this conversation:
   read and follow `${CLAUDE_PLUGIN_ROOT}/skills/grill-with-docs/SKILL.md` (which drives
   `${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md` and
   `${CLAUDE_PLUGIN_ROOT}/skills/domain-modeling/SKILL.md`). Then write the seed with these
   sections — the `po` node is scored on covering every one of them:

   ```markdown
   # <Feature name>
   ## Capability            what the user will be able to do, and why it matters
   ## Agreed scope          what is in, decided during the grilling
   ## Out of scope          what is deliberately excluded (name it; silence reads as an omission)
   ## Decisions             each decision + the reasoning that settled it
   ## Ubiquitous language   terms this feature introduces or sharpens
   ## Open questions        anything the grilling could not settle
   ```

4. **Config.** Find the **nearest** `CLAUDE.md` from the repo root and read its
   `<!-- sdlc2:config -->` block:

   ~~~markdown
   ## sdlc2
   <!-- sdlc2:config -->
   ```yaml
   # The stack this project actually uses. sdlc2 has no house stack: this line is what the
   # developer writes in and what the reviewer judges idiom against. [E2-02]
   stack:  "<language + framework + test runner, as this repo actually uses them>"
   lanes:  4                       # optional; max slices built at once. Default 4. [E2-10]
   commands:
     test:    "<the command that runs this project's tests>"   # MANDATORY — the tester's oracle
     build:   ""                   # optional; omit what the stack lacks
     install: ""                   # optional; UNLOCKS PARALLEL SLICE LANES — see below
     run:     ""
     e2e:     ""
   seam:
     backend:  "<how an API-level acceptance test is driven here>"
     frontend: ""                  # empty until a frontend exists
   ```
   <!-- /sdlc2:config -->
   ~~~

   Every value above is a placeholder to fill from the project in front of you. Two worked
   examples, so the shape is clear and neither is a default:

   ~~~yaml
   # a JVM service                          # a TypeScript SPA
   stack: "Java 21, Spring Boot 3, JUnit 5" # stack: "TypeScript, React 19, Vitest + RTL"
   commands: { test: "./mvnw -q test" }     # commands: { test: "npm test -- --run", install: "npm ci" }
   seam: { backend: "REST via MockMvc" }    # seam: { frontend: "React Testing Library via Vitest (jsdom)" }
   ~~~

   - **Missing block** → detect the stack (build files, test runner, existing test layout),
     **propose** the block including a truthful `stack:` line, show it, and **ask for confirmation before appending it** to
     `CLAUDE.md`. Never write it silently: that file is the user's, and it is loaded into every
     session. If there is no `CLAUDE.md`, offer to create one containing just this section.
   - **`commands.test` empty or absent** → stop. Without it the `tester` has no oracle and the
     whole build gate is theatre. The engine refuses on the same condition, so a run that
     somehow gets past you fails immediately rather than half-way through.
   - **Lanes open when you say a fresh worktree is testable**, and you can say it two ways:
     declare **`commands.install`**, or deliberately declare **`lanes: N > 1`**. The second exists
     for Maven, Gradle, Go and anything else that resolves from a shared cache and needs no install
     step — those projects used to build strictly sequentially for having nothing to install.
     Nothing in the engine verifies the claim, so **try it once by hand before the first run**:

     ```bash
     git worktree add ../lane-probe HEAD && (cd ../lane-probe && <your test command>)
     git worktree remove --force ../lane-probe
     ```

     Five minutes, once per project, and it converts a run-destroying surprise into a known fact.
     If it fails, declare an install command that makes it pass, or leave lanes at 1.
   - **`commands.install`** is what opens parallel slice lanes. Independent slices build
     concurrently, each in its own git worktree, and a fresh worktree has **no installed
     dependencies** — so without this command the suite cannot run there and the engine stays
     sequential (it logs that it did, and why). Give it the command that makes a freshly-checked-out
     tree testable: `npm ci`, `./mvnw -q dependency:go-offline`, `uv sync`, and so on. Leave it
     empty if you would rather keep slices sequential.
   - **Malformed YAML** → stop and show the block; do not guess.
   - A `CLAUDE.md` **nested** in a subdirectory overrides the root block for slices whose files
     live under that directory. Record the map of `dir → config` and pass it along.

5. **Baseline.** Run `commands.test` once. It must be **green** before the graph starts — a red
   baseline makes every later tester verdict meaningless. If it's red, stop and say so.

6. **Stamp `runId`** yourself: `nf-<UTC>` e.g. `nf-20260815T2130Z`. The workflow script is
   sandboxed and cannot read the clock.

7. **Resolve the agent prefix.** sdlc2 ships nine personas whose frontmatter names are
   `sdlc2-product-owner`, `sdlc2-tester`, and so on. Depending on the host, plugin agents may be
   registered under those bare names or namespaced as `sdlc2:sdlc2-product-owner`. Check which
   form appears in your available agent types and pass `agentPrefix` accordingly — `""` for the
   bare form, `"sdlc2:"` for the namespaced one. If neither resolves, **stop**: the plugin's
   agents are not installed, and running the graph against globally-installed lookalikes would
   violate sdlc2's independence.

---

## 2. Invoke the engine

Check whether the **`Workflow` tool** is available to you.

- **Available** → call it with:
  - `scriptPath`: `${CLAUDE_PLUGIN_ROOT}/new-feature.workflow.js`
  - `args`:
    ```jsonc
    {
      "feature": "<slug>",
      "title": "<the idea, verbatim>",
      "featureDir": ".sdlc2/features/<slug>",
      "pluginRoot": "<the resolved ${CLAUDE_PLUGIN_ROOT}>",
      "version": "<the VERSION read beside it in pre-check 0 — verbatim, or \"unknown\">",
      "runId": "nf-<UTC>",
      "defaultBranch": "<resolved>",
      "config": { "stack": "…", "lanes": 4, "commands": { "test": "…", "…": "…" }, "seam": { "backend": "…", "frontend": "…" } },
      "configByDir": { "frontend/": { "commands": { "test": "npm test" } } },
      "agentPrefix": ""
    }
    ```
    Pass the config block through **whole**, `stack` and `lanes` included: the engine puts `stack`
    in front of every persona (`[E2-02]`) and reads `lanes` as the concurrency cap (`[E2-10]`).
    Dropping a key here silently restores the old hardcoded behaviour.

    Pass `config` **inline** — the sandboxed script has no filesystem access, and every agent
    prompt it builds needs the test command.
- **Not available** → say so plainly and stop. The main-thread fallback engine is **deferred**
  in v0.1; do not improvise one, and do not fall back to another harness.

---

## 3. After it returns

The result's `nodes` array already carries one row per node; report it as it stands, in this
order:

1. **Node table** — `po · architect · ux · build`, each with verdict, score and rounds consumed.
   The verdicts are `pass` · `soft-pass` (an arbiter decided) · `partial` (build only: some slices
   shipped, some did not) · `hard-fail` · `skipped` (with the reason — a gate that did not fire, a
   dead upstream, or budget) · `not-run`. Say plainly if anything soft-passed; a run with a
   soft-pass is **never** reported as clean, and neither is one with a skipped or hard-failed node.
2. **Slices** — shipped (`branch @ sha`), escalated (+ the reason and the unresolved defects),
   skipped (+ why). The escalation reasons are distinct and mean different things: `no-commit`
   (the developer never reached a green commit — there is no branch to review), `tester-red` (it
   committed but the suite never went green), `tester-silent` (the tester never answered — the
   slice is *unverified*, not proven broken) and `unjudgeable` (a checker could not judge it).
3. **Human-verify** — the count and one-line summary of each new `VH-NN` row.
3b. **Lanes** — if the report says slices built concurrently, say which ran together and that each
   had its own worktree. If it says they built sequentially because no `commands.install` is
   declared, pass that on: it is a one-line config change that shortens every future run.
4. **Next action** — review the `slice/<feature>/…` branches and
   `.sdlc2/features/<slug>/VERIFY-WITH-HUMAN.md`, then merge yourself. State that sdlc2 has not
   merged and will not. Note which slices were **stacked**: a slice with `Blocked by:` is cut from
   its blocker's branch, so merging it merges the blocker too — merge in slice order.
5. **The paperwork branch** — the artifacts and any ADRs are committed to `sdlc2/<feature>`, cut
   from the default branch, and `HEAD` is left there. Say so: the working tree is clean and the
   next run is not blocked. If the report carries a `## Paperwork not committed` section, that
   step failed — quote it, because the artifacts are then still untracked.

6. **Where the run's transcripts are.** The `Workflow` tool's result names the directory it
   wrote its agent transcripts to. **Record that path in your summary**, because nothing else
   does: the run report has no timing at all, and the only clock-bearing record of the run is
   those transcripts. Without the path, finding them again means searching every session
   directory on the machine for a workflow that mentions this feature.

   Then say that `bin/run-timing.mjs` reads them:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/run-timing.mjs" --feature <slug>
   node "${CLAUDE_PLUGIN_ROOT}/bin/run-timing.mjs" --dir <the path above>   # exact, no searching
   ```

   It prints where the time went — per node, per slice, per call — plus wall-clock, summed agent
   time, the ratio between them, and the largest stretch where nothing was running. Transcripts
   are per-machine and can be pruned, so a run nobody timed may become untimeable.

Point at the run report: `.sdlc2/features/<slug>/runs/<runId>.md`. It is written on **every**
outcome, including a graph that aborted — if it is missing, the workflow itself failed to start
(bad args or a missing test command), and the error text says which.
