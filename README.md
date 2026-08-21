# sdlc2 — the feature graph

A Claude Code **plugin** that takes a grilled feature idea to merge-ready slices through a graph of
**adversarial maker/checker loops**.

```
HUMAN grilling ─▶ po ─┬─▶ architect ─┐
                      └─▶ ux ────────┴─▶ build (slice₁ → slice₂ → …) ─▶ report ─▶ HUMAN merge
```

Every node runs a **maker** persona against **checkers** whose mandate is to *refute*, scored
against a weighted rubric. Five rounds, then an **arbiter** decides, writes down what it decided
and why, and the graph keeps going — it documents instead of stalling. One thing is never
arbitrable: a **red test suite**. No arbiter, no score, no deadline commits over it.

**Status: v0.1.2 — executed once.** One feature went through the whole graph on 2026-08-16: four
slices shipped, two nodes soft-passed, fourteen human-verify records came out the other end. It
also found two things 205 green checks had not — a developer that ignored which branch to build
on, and a bundled skill whose one line sent three personas to the host's skills — both fixed here,
both now asserted. Verified structurally (manifests, node table, rubric weights, prompt hygiene,
independence) and *behaviourally*: `verify.mjs` runs the real engine against stubbed agents and
drives it through its failure paths, so a dead checker, a vanished developer and a crashed node
are proven not to produce a green run. See `SPEC.md` §12, and `REVIEW-0.1.0.md` for the earlier
review.

## Install

**macOS, and Windows under WSL**

```bash
curl -fsSL https://raw.githubusercontent.com/rcforte/sdlc2/main/install.sh | bash
```

**Windows, native PowerShell**

```powershell
irm https://raw.githubusercontent.com/rcforte/sdlc2/main/install.ps1 | iex
```

Either one installs from GitHub through Claude Code's own plugin CLI, then **checks that
the host actually registered the nine personas and four skills** — the failure `SPEC.md`
§12 risk 2 names as the likeliest one on a first run. Re-running is safe: it updates
what is already there and re-checks, so it is also the repair path. Restart Claude Code
afterwards.

Prefer to do it by hand, or reading the script first? It is two commands:

```bash
claude plugin marketplace add rcforte/sdlc2
claude plugin install sdlc2@sdlc2-marketplace --scope user
```

Or, inside Claude Code, `/plugin marketplace add rcforte/sdlc2` then `/plugin install sdlc2`.

**Working on sdlc2 itself?** Point the marketplace at your clone instead, so your edits
are the installed plugin: `claude plugin marketplace add ~/dev/code/sdlc2`.

| | |
|---|---|
| Update | re-run the installer, or `claude plugin update sdlc2` |
| Repair / diagnose | re-run the installer — it re-checks the inventory |
| Uninstall | `claude plugin uninstall sdlc2@sdlc2-marketplace` then `claude plugin marketplace remove sdlc2-marketplace` |

Use the qualified `sdlc2@sdlc2-marketplace` id throughout: `claude plugin details` accepts
the bare `sdlc2`, but `claude plugin update` answers `Plugin "sdlc2" not found`.

The installers touch nothing but the `claude plugin` CLI: no clone, no writes under your
home directory, and never your project's `CLAUDE.md` — that file is proposed and
confirmed by `/sdlc2 new-feature`, never written behind your back (`SPEC.md` §3).

## Use

```
/sdlc2 new-feature "guest checkout"   # the graph: framing → design → build → report
/sdlc2 status                          # features, verdicts, open human-verify rows, slice branches
/sdlc2 help
```

> **Setting up a project?** `SETUP.md` is the full contract: what your repo must have before the
> graph will run, every config field and what actually reads it, a worked TypeScript + Spring Boot
> + Maven example, and a walkthrough of the first slice. **sdlc2 builds features into an existing
> project — it cannot create one**, because it refuses to start until your test command is green.

**First run in a repo** does two things interactively before anything autonomous starts:

1. **Grills you** (if there's no seed yet) and writes the shared understanding to
   `.sdlc2/features/<slug>/feature.md`. A workflow can never interview — subagents have no
   channel to you — so this is the one conversational step, and it happens up front.
2. **Proposes a config block** for the project's own `CLAUDE.md` and asks before writing it:

   ~~~markdown
   ## sdlc2
   <!-- sdlc2:config -->
   ```yaml
   commands:
     test:  "./mvnw -q test"     # MANDATORY — the tester's executable ground truth
   seam:
     backend: "REST via MockMvc (@SpringBootTest)"
   ```
   <!-- /sdlc2:config -->
   ~~~

   That block is the **only** config sdlc2 has. A nested `CLAUDE.md` in a subdirectory overrides it
   for slices under that directory — per-area commands in a monorepo, for free.

After that the graph runs unattended to the end.

## What lands in your repo

```
.sdlc2/features/<slug>/
  feature.md              the grilled seed, extended by the product owner
  mockup.html             happy paths from po, state variants added by ux — ONE file
  design.md               domain model, boundaries, the seam per slice
  issues/NN-slug.md       one vertical slice each, Gherkin acceptance criteria
  VERIFY-WITH-HUMAN.md    every call an arbiter made for you — append-only
  runs/<runId>.md         node table · slice table · open VH rows
docs/adr/NNNN-*.md        architecture decisions
slice/<feature>/NN-slug   one branch per slice — reviewing and merging them is YOURS
```

**sdlc2 never merges to your default branch, and never moves it.**

## Independence

sdlc2 shares nothing with any other harness. Its nine personas (`agents/sdlc2-*.md`), its
sub-skills (`skills/`), its engine (`new-feature.workflow.js`) and its artifacts (`.sdlc2/`) are
its own. Uninstall anything else and sdlc2 still works. `SPEC.md` §1 states the rules; §10 says how
to check them.

## Layout

| path | what |
|---|---|
| `.claude-plugin/plugin.json` · `marketplace.json` | plugin manifest + a one-plugin marketplace |
| `commands/sdlc2.md` | the `/sdlc2 <subcommand>` router |
| `modes/new-feature.md` | pre-checks, engine invocation, how to report the result |
| `modes/status.md` | read-only status |
| `new-feature.workflow.js` | the graph: node table, rubrics, loop engine, build node, executor |
| `agents/sdlc2-*.md` | the nine personas, with sdlc2's output contracts |
| `skills/` | grill-with-docs · grilling · domain-modeling · outside-in-tdd |
| `SETUP.md` | what a project must provide, the config-block reference, and the first slice |
| `SPEC.md` | the contract: numbered rules + rubrics + conformance matrix + deferred + risks |
| `REVIEW-0.1.0.md` | the review of v0.1.0 and the fixes it produced |
| `verify.mjs` | `node verify.mjs` — conformance check. Structure (manifests, node table, rubric weights, prompt hygiene, independence) **and** behaviour: it evaluates the engine with stubbed agents and drives the loop, the build node and the graph walk through their failure paths. Proves shape and failure handling — not that the graph produces good software. |
