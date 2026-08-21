---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Run the grilling, and record what it settles, using **sdlc2's own copies of both**:

1. `${CLAUDE_PLUGIN_ROOT}/skills/grilling/SKILL.md` — the interview itself. Read that file and
   follow it.
2. `${CLAUDE_PLUGIN_ROOT}/skills/domain-modeling/SKILL.md` — read it alongside, and use it to
   capture the ubiquitous language and any decision worth an ADR **as the interview produces
   them**, not afterwards. Its formats live next to it:
   `${CLAUDE_PLUGIN_ROOT}/skills/domain-modeling/ADR-FORMAT.md` and
   `${CLAUDE_PLUGIN_ROOT}/skills/domain-modeling/CONTEXT-FORMAT.md`.

Read both by that path. Do **not** invoke them as slash commands: a bare command name resolves
against whatever the host has installed, and skills of both these names commonly are. sdlc2 is
self-contained, and an interview run to another harness's rubric is not the one the personas
downstream are scored against.
