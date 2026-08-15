---
description: The sdlc2 feature graph — grilled idea to merge-ready slices via adversarial maker/checker loops
argument-hint: "new-feature \"<idea>\" | status [<feature>] | help"
---

# /sdlc2 — router

Dispatch on the **first word** of `$ARGUMENTS`. Read the matching mode file under
`${CLAUDE_PLUGIN_ROOT}/modes/` and follow it exactly; everything after the first word is that
mode's argument. This router is a dispatcher, not a brain — the logic lives in the mode files
and in `${CLAUDE_PLUGIN_ROOT}/new-feature.workflow.js`.

| First word | Mode file | What it does |
|---|---|---|
| `new-feature` | `modes/new-feature.md` | Run the full graph: product framing → architecture ∥ UX → build → report |
| `status` | `modes/status.md` | Read-only: features, node verdicts, open human-verify items, slice branches |
| `help` (or nothing) | — | Print the table below and stop |

Rules:

- **No argument, or an unrecognized first word** → print the table above with a one-line gloss
  each, plus the two facts a new user needs (below), and stop. Never guess a mode.
- Read **only** the dispatched mode file — progressive disclosure; don't pre-load the others.
- `${CLAUDE_PLUGIN_ROOT}` is this plugin's install directory. **Always** resolve plugin files
  through it; never hardcode a path under `~/.claude`.
- sdlc2 is **self-contained**: its personas live in `${CLAUDE_PLUGIN_ROOT}/agents/`, its
  sub-skills in `${CLAUDE_PLUGIN_ROOT}/skills/`. Never reach for a skill or agent from another
  harness, even when one of the same name is installed globally.

Two facts to state when printing help:

1. **Per-project config lives in the project's own `CLAUDE.md`**, inside an
   `<!-- sdlc2:config -->` fenced YAML block (test command + acceptance seam). `new-feature`
   proposes one and asks before writing it, and a nested `CLAUDE.md` in a subdirectory overrides
   the root one for slices under that directory.
2. **sdlc2 never merges.** Slices land on `slice/<feature>/<NN>-<slug>` branches; reviewing and
   merging them is yours.
