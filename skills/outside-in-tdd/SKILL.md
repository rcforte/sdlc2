---
name: outside-in-tdd
description: Strict outside-in TDD with Percival's double-loop (Obey the Testing Goat). Wraps the ordinary red-green-refactor unit cycle in an outer acceptance-test loop that stays red while the inner cycles drive it green. Use when the user wants outside-in TDD, mentions Percival or "Obey the Testing Goat", or asks for acceptance-test-first / double-loop TDD.
---

# Outside-in TDD (Percival double-loop)

Layer two loops, not one. Adapted from Harry Percival's *Obey the Testing Goat*.

## The two loops

**Outer loop (acceptance / functional test):**
1. Write ONE failing acceptance test that exercises the public API of the
   outermost module — the user's-eye view. It uses only the public surface.
2. Leave it red. It stays red for the entire slice.
3. The slice is done when this test goes green.

**Inner loop (unit test — the ordinary red-green-refactor cycle):**
1. Pick the next thing the acceptance test needs that doesn't exist yet.
2. Write a failing unit test for it, in the module that should own it.
3. Make the unit test pass with the minimum code.
4. Refactor.
5. Re-run the acceptance test. Still red? Pick the next missing piece. Green?
   The slice is done.

## Rules

- **Exactly one failing acceptance test at a time.** No second slice begins
  until the first is green and committed.
- **Acceptance test uses only the public API.** It cannot import internals.
  Module boundaries (Gradle subprojects, package-private) physically enforce
  this — lean on them.
- **Inner unit tests live in the module that owns the code.** Driving the
  acceptance test from the outside in means each missing piece reveals which
  module needs new behavior — write the unit test there, not in the
  acceptance test's module.
- **Commit at acceptance-green boundaries only.** Intermediate green-on-unit
  states are not commit points; they're intermediate beats.
- **Refactor on the inside, not the outside.** The acceptance test should
  rarely change shape during a slice — if it does, the slice's scope was
  wrong; abort and re-plan.
- **No production code without a failing test driving it.** Discipline.

## When the acceptance test is hard to write

If you can't write the acceptance test, the slice is too big or the public
API is unclear. Shrink the slice or sharpen the API before writing any code.
This is the most common failure mode and the most expensive to fix late.

## Relation to ordinary TDD

This *contains* plain red-green-refactor: the inner loop IS that cycle,
unchanged. The addition is the outer acceptance loop and the discipline that
it stays red until the slice is genuinely done.

## The architecture pass, before you commit

After the acceptance test goes green and before you commit, re-read the
slice's diff against the design you were given (`design.md`) and the
conventions in the project's own CLAUDE.md, and fix what drifted: a seam that
leaked, a rule that landed in the wrong module, a name that stopped matching
the ubiquitous language. Architecture review belongs inside the slice cycle,
not after it.

Do this yourself, here, with no other tool: an independent sdlc2 code-reviewer
judges this same diff for craft the moment you commit, and an sdlc2 architect
already owns the design it is judged against. Never reach for a
similarly-named review command installed globally — it answers to a different
rubric than the one you are about to be scored on.

## Anatomy of a slice

```
[RED]    Write acceptance test in outermost module's test/. Run. Confirm red.
[RED]    Identify smallest missing thing. Write failing unit test for it.
[GREEN]  Implement the minimum. Unit test passes.
[REF]    Refactor within the unit's scope.
[RED]    Re-run acceptance test. Still red. Identify next missing thing.
... repeat ...
[GREEN]  Acceptance test passes. Slice done.
[ARCH]   Re-read the diff against design.md + conventions. Fix the drift.
[COMMIT] Single commit for the slice.
```

## Anti-patterns

- Writing the acceptance test *after* the unit tests. That's inside-out
  pretending to be outside-in.
- Letting the acceptance test "be green" because it was never run during the
  slice. Run it after every inner GREEN. Confirm it stays red until done.
- Multiple acceptance tests in flight. Pick one, finish it, commit, then next.
- Making the acceptance test depend on internals to get it green faster.
  If you can't reach green via the public API, the public API is wrong.
