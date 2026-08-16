# /sdlc2 status [<feature>] — read-only

No mutations, no `Workflow`, no agents. Report what sdlc2 has done in this repo and what it is
waiting on. With a `<feature>` argument, scope to that one; otherwise cover them all.

Report, in this order:

1. **Config** — which `CLAUDE.md` supplied the `<!-- sdlc2:config -->` block (root or a nested
   one), the resolved `commands.test`, and the declared seam. If no block exists, say so first:
   nothing else can run until it does.

2. **Features** — for each `.sdlc2/features/<slug>/`:
   - which artifacts exist (`feature.md` · `mockup.html` · `design.md` · `issues/` · how many),
   - the newest run's node table if `runs/*.md` exists (node · verdict · score · rounds),
   - whether any node **soft-passed**, **hard-failed** or was **skipped** — call these out; a
     soft-pass is the thing most easily missed, and a skipped node means part of the graph never
     ran at all. Distinguish a node skipped by its *gate* (`ux` on a feature with no UI — normal)
     from one skipped because an upstream node failed or the budget ran out (not normal).

3. **Human-verify** — open rows across every feature's `VERIFY-WITH-HUMAN.md`: id, node,
   severity, the one-line decision. These are judgement calls the arbiter made on your behalf and
   nobody has confirmed.

4. **Slices** — `git branch --list 'slice/*'`, each with ahead-count vs the default branch and
   whether it is merged. Unmerged slice branches are the work waiting on your review. An
   **escalated** slice in the run report has a reason worth repeating verbatim: `no-commit` means
   there is no branch to review at all, `tester-red` means there is a branch whose suite is red,
   `tester-silent` means the branch exists but was never verified, and `unjudgeable` means a
   checker could not evaluate it.

5. **Readiness** — is the working tree clean, is `commands.test` green (say when it was last
   observed green, don't re-run it here), and is the `Workflow` tool available to you (fast path)
   or absent (v0.1 has no fallback, so `new-feature` cannot run).

End with the single most useful next action — e.g. *"3 unmerged slice branches → review and
merge"*, or *"2 open VH rows on `guest-checkout` → confirm or overrule"*, or *"no config block →
run `/sdlc2 new-feature` and accept the proposed block"*.
