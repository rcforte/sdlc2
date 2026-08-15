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

**Status: v0.1.0 — implemented, never executed.** Structurally verified; the first real run is the
acceptance test. See `SPEC.md` §12 for what that means.

## Install

```bash
git clone <this repo> ~/dev/code/sdlc2      # or use it where it is
```

Then in Claude Code:

```
/plugin marketplace add ~/dev/code/sdlc2
/plugin install sdlc2
```

`git pull` + `/plugin update sdlc2` picks up changes.

## Use

```
/sdlc2 new-feature "guest checkout"   # the graph: framing → design → build → report
/sdlc2 status                          # features, verdicts, open human-verify rows, slice branches
/sdlc2 help
```

**First run in a repo** does two things interactively before anything autonomous starts:

1. **Grills you** (if there's no seed yet) and writes the shared understanding to
   `.sdlc2/features/<slug>/feature.md`. A workflow can never interview — subagents have no
   channel to you — so this is the one conversational step, and it happens up front.
2. **Proposes a config block** for the project's own `CLAUDE.md` and asks before writing it:

   ```markdown
   ## sdlc2
   <!-- sdlc2:config -->
   ```yaml
   commands:
     test:  "./mvnw -q test"     # MANDATORY — the tester's executable ground truth
   seam:
     backend: "REST via MockMvc (@SpringBootTest)"
   ```
   <!-- /sdlc2:config -->
   ```

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
| `new-feature.workflow.js` | the graph: node table, rubrics, loop engine, build node |
| `agents/sdlc2-*.md` | the nine personas, with sdlc2's output contracts |
| `skills/` | grill-with-docs · grilling · domain-modeling · outside-in-tdd |
| `SPEC.md` | the contract: numbered rules + conformance matrix + deferred + risks |
| `verify.mjs` | `node verify.mjs` — structural conformance check (manifests, node table, rubric weights, pure helpers, prompt hygiene, independence). Proves shape, not behaviour. |
