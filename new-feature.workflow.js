export const meta = {
  name: 'sdlc2-new-feature',
  description:
    'Run the sdlc2 feature graph: product framing → architecture ∥ UX → outside-in TDD slices built in dependency lanes → report. Every node is a maker/checker loop scored against a rubric; when its rounds run out, or it stops converging, an arbiter decides and documents instead of stalling. A red tester verdict is never arbitrable.',
  phases: [
    { title: 'Product', detail: 'product-owner ⇄ product-owner-critic → feature.md · mockup.html · issues/' },
    { title: 'Design', detail: 'architect ⇄ architect-critic ∥ ux-design ⇄ ux-auditor (spec mode)' },
    { title: 'Build', detail: 'per slice, in dependency lanes: developer ⇄ tester + code-reviewer → commit on pass' },
    { title: 'Report', detail: 'node table + slices + human-verify index' },
  ],
}

// ─────────────────────────────────────────────────────────────── args ────
// Supplied by modes/new-feature.md after its main-thread pre-checks. The script is sandboxed —
// no filesystem, no clock — so everything it needs is passed in, and every artifact moves
// between nodes through DISK (agents read paths; the engine only ever holds paths).
const A = args || {}
const FEATURE = A.feature || 'feature'
const TITLE = A.title || FEATURE
const DIR = A.featureDir || `.sdlc2/features/${FEATURE}`
const ROOT = A.pluginRoot || '${CLAUDE_PLUGIN_ROOT}'
const RUN_ID = A.runId || 'nf-unstamped'
// [SD-03] Which engine is actually executing. A Claude Code session pins `${CLAUDE_PLUGIN_ROOT}`
// at start, and version directories sit side by side in the plugin cache — so after a mid-session
// `claude plugin update` the stale path keeps resolving and keeps working. Runs 1 and 2 executed
// 0.1.1 while 0.1.2 was the installed version: ~6.3M agent tokens measuring a superseded engine,
// two defects "found" that were already fixed upstream, and nothing anywhere said so. The script
// cannot read its own VERSION file (no filesystem), so the mode file reads it next to the plugin
// root it resolved and passes it in. Unstamped is reported as unknown, never guessed.
const VERSION_RAN = A.version || 'unknown'
const BASE = A.defaultBranch || 'main'
const CONFIG = A.config || { commands: {}, seam: {} }
const CONFIG_BY_DIR = A.configByDir || {}
// Plugin agents may be registered bare (`sdlc2-developer`) or namespaced by the host
// (`sdlc2:sdlc2-developer`). The mode file resolves which and passes the prefix, so the engine
// never guesses at a name it cannot verify.
const AGENT_PREFIX = A.agentPrefix || ''
function at(name) { return AGENT_PREFIX + name }

// ───────────────────────────────────────────────── labels and groups ────
// [R-LABEL-01] Every spawn label is built HERE, and nowhere else. Labels are not decoration: the
// conformance harness routes its stubbed agents by reading them, so a label typed by hand at a
// call site is an undeclared interface that breaks `verify.mjs` silently — and in the tests that
// assert a FAILURE path, it breaks them into passing for the wrong reason.
//
// A row names a ROLE and nothing else. The unit of work — which slice, which node — is carried by
// the progress GROUP instead, so it is stated once in a heading rather than repeated on every row.
const roleOf = (agent) => String(agent || '').replace(/^sdlc2-/, '')
function labelFor(role, round, rounds) {
  return round ? `${role} (${round}/${rounds})` : String(role)
}
function parseLabel(label) {
  const m = /^([a-z0-9][a-z0-9-]*)(?: \((\d+)\/(\d+)\))?$/.exec(String(label || ''))
  return m
    ? { role: m[1], round: m[2] ? Number(m[2]) : null, rounds: m[3] ? Number(m[3]) : null }
    : { role: null, round: null, rounds: null }
}
// `Build · 01-add-a-due-date` groups one slice's three personas together; `Design · architect`
// does the same for a document node, which matters because architect and ux share a phase and
// would otherwise interleave, out of order, in one box.
const groupFor = (node, unit) => (unit ? `${node.phase} · ${unit}` : node.phase)

const VH = `${DIR}/VERIFY-WITH-HUMAN.md`
const SEED = `${DIR}/feature.md`
const MOCKUP = `${DIR}/mockup.html`
const DESIGN = `${DIR}/design.md`
const ISSUES = `${DIR}/issues`
const REPORT = `${DIR}/runs/${RUN_ID}.md`
// [E-07] Where a concurrently-built slice gets its own working tree. [SD-04] Deliberately OUTSIDE
// the repository, as a sibling of it. Two earlier locations were wrong for two different reasons:
// under `${DIR}` the report node would sweep a worktree into the paperwork commit, and under
// `.sdlc2/worktrees/` — anywhere inside the repo — a worktree is invisible to git (gitignored) but
// still perfectly visible to the project's own TEST RUNNER. Measured during development: vitest collected
// three sibling worktrees' suites from the main checkout and rendered every component against a
// second copy of React — 16 files, 98 failures, all `Invalid hook call`. Gitignoring them was only
// half the decision; a checkout of this repo is one project, not N+1. A path outside the repo
// removes the whole class instead of asking every project to configure its runner around us.
//
// Relative, not absolute: the engine is sandboxed (no filesystem, no `os.tmpdir`), and `../` is
// the one escape that is portable across the platforms install.sh and install.ps1 both target.
// `${RUN_ID}` makes each run's trees unique, so a worktree stranded by an aborted run can never
// collide with this one — `git worktree add` fails loudly on an existing path.
const WORKTREES = `../.sdlc2-worktrees/${FEATURE}-${RUN_ID}`

const ROUNDS = 5 // max build attempts per slice — its extra attempts only cost on failure
// [E-01] The DOCUMENT nodes get 2. Measured on run 1: all three burned all 5 rounds and went to an
// arbiter anyway, so 5 was not a cap, it was the actual price of every doc node. `build` keeps 5
// because its oracle is executable — a slice that passes first attempt never pays for the rest.
const DOC_ROUNDS = 2
const BUDGET_FLOOR = 60000 // stop taking new nodes/slices below this many remaining output tokens

// [R-CFG-02] The engine refuses to run without an executable oracle, exactly as the mode file
// does. Two gates, because the engine can also be invoked directly. Called from the graph walk so
// the declarations above stay side-effect free and independently evaluable.
function assertArgs() {
  const problems = []
  if (!A.feature) problems.push('`feature` (the slug) is missing')
  if (!A.runId) problems.push('`runId` is missing — the main thread must stamp it; the script has no clock')
  if (!CONFIG.commands || !String(CONFIG.commands.test || '').trim()) {
    problems.push('`config.commands.test` is empty — without it the tester has no oracle and the build gate is theatre [R-CFG-02]')
  }
  if (problems.length) {
    throw new Error(`sdlc2 cannot run:\n  - ${problems.join('\n  - ')}`)
  }
}

// ────────────────────────────────────────────────────────── schemas ────
// The schema IS the enforcement layer. Anything the engine will discard or score as zero must be
// `required` here, or a schema-obedient agent can silently lose its own findings.
const DEFECT = {
  type: 'object',
  required: ['criterion', 'severity', 'evidence', 'fix'],
  properties: {
    criterion: { type: 'string' }, // a rubric criterion id
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    location: { type: 'string' }, // file:line or an artifact anchor
    evidence: { type: 'string' }, // QUOTED from the artifact — no evidence, no defect
    fix: { type: 'string' },
  },
}

const CRITERIA = {
  type: 'array',
  minItems: 1, // an empty array scores zero just as surely as a missing one
  items: {
    type: 'object',
    required: ['id', 'score'],
    properties: { id: { type: 'string' }, score: { type: 'number' }, why: { type: 'string' } },
  },
}

// `criteria` is REQUIRED: the engine derives the weighted total from it, so an omitted array is
// scored 0 and would burn every round on work that was clean.
const VERDICT = {
  type: 'object',
  required: ['defects', 'criteria'],
  properties: {
    lens: { type: 'string' },
    criteria: CRITERIA,
    defects: { type: 'array', items: DEFECT },
    hard: { type: 'boolean' }, // the work cannot be judged at all — stop burning rounds
    notes: { type: 'string' },
  },
}

// Binary checkers (the tester) govern directly and must state `pass` explicitly.
const VERDICT_BINARY = {
  type: 'object',
  required: ['pass', 'defects', 'criteria'],
  properties: {
    lens: { type: 'string' },
    pass: { type: 'boolean' },
    criteria: CRITERIA,
    defects: { type: 'array', items: DEFECT },
    hard: { type: 'boolean' },
    notes: { type: 'string' },
  },
}

// One queued slice. Shared by the po maker's manifest and the fallback resolver, so the two can
// never drift into describing the same thing differently. [E-13]
const SLICE_ITEM = {
  // [R-BUILD-04b] `blockedBy` is REQUIRED. It used to be optional, which made a manifest carrying
  // no edges at all perfectly legal — and then every slice lands at level 0, every branch is cut
  // from the default branch, and the stacking invariant evaporates without a word. An empty array
  // is a real answer ("nothing blocks this"); an absent field is a graph nobody stated.
  type: 'object',
  required: ['id', 'path', 'title', 'blockedBy'],
  properties: {
    id: { type: 'string' }, // NN-slug
    path: { type: 'string' }, // issues/NN-slug.md
    title: { type: 'string' },
    dir: { type: 'string' }, // primary directory it touches — picks the nested config
    // [E-12] Whether this slice needs the UX node's output. A backend slice does not, and used to
    // wait for it anyway because `build` joined on BOTH design nodes.
    ui: { type: 'boolean' },
    blockedBy: { type: 'array', items: { type: 'string' } },
  },
}

const MAKER_PROPS = {
  ok: { type: 'boolean' },
  artifacts: {
    type: 'array',
    items: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, kind: { type: 'string' } },
    },
  },
  changelog: { type: 'string' }, // ≤20 lines: what changed and why. NEVER the artifact body.
  addressed: { type: 'array', items: { type: 'string' } },
  disputed: {
    type: 'array',
    items: {
      type: 'object',
      properties: { criterion: { type: 'string' }, why: { type: 'string' } },
    },
  },
  hasUiStories: { type: 'boolean' }, // po only — gates the ux node
  // [E-13] po only — the slice manifest. The build node used to spend a serial agent round-trip
  // re-reading the issue files the po had just written; the po already knows what it wrote.
  // The resolver spawn stays as a fallback for when this is absent or unusable.
  slices: { type: 'array', items: SLICE_ITEM },
  notes: { type: 'string' },
}

const MAKER = { type: 'object', required: ['ok', 'artifacts'], properties: MAKER_PROPS }

// The po maker MUST state hasUiStories: the executor gates the ux node on it, and an omitted
// flag would silently skip UX on a feature full of screens.
// [R-BUILD-04b] `slices` is REQUIRED. Omitting it was legal, and the engine then fell back to an
// agent re-deriving the queue from the issue files with no checker over it — so the fallback was
// the normal path. The po WROTE those files; its manifest is the first-hand source.
const MAKER_PO = { type: 'object', required: ['ok', 'artifacts', 'hasUiStories', 'slices'], properties: MAKER_PROPS }

function makerSchema(node) { return node.id === 'po' ? MAKER_PO : MAKER }
function verdictSchema(checker) { return checker.binary ? VERDICT_BINARY : VERDICT }

const ARBITER = {
  type: 'object',
  required: ['finalized', 'records'],
  properties: {
    finalized: { type: 'boolean' },
    records: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'decision', 'rationale'],
        properties: {
          id: { type: 'string' }, // VH-NN, assigned by the arbiter after reading the file
          severity: { type: 'string' },
          issue: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          decision: { type: 'string' },
          rationale: { type: 'string' },
          riskIfWrong: { type: 'string' },
          changesMyMind: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const SLICES = {
  type: 'object',
  required: ['slices'],
  properties: {
    slices: { type: 'array', items: SLICE_ITEM },
    notes: { type: 'string' },
  },
}

// [E2-08] The worktree release used to return prose nobody read. It is a verdict like any other.
const RELEASE = {
  type: 'object',
  required: ['released'],
  properties: {
    released: { type: 'boolean' }, // git worktree list shows the main checkout ALONE
    remaining: { type: 'array', items: { type: 'string' } },
    branches: { type: 'boolean' }, // every slice branch still present
    // [SD-12] The release prompt has always told the agent to `rmdir` the emptied container, and
    // there was no field to say whether it did — an instruction nobody could observe. Run 5's
    // report asserted "the container directory was empty and removed" anyway; the directory is
    // still there. The report node's own first line reads "use exactly this data — invent
    // nothing", so a prompt-level prohibition was in force and did not hold. The lesson the fix
    // encodes: a report can only be trusted on claims a FIELD backs, so make the claim a field.
    container: { type: 'boolean' }, // the emptied container directory was removed
    notes: { type: 'string' },
  },
}

const BUILD = {
  type: 'object',
  required: ['committed'],
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    branch: { type: 'string' },
    changelog: { type: 'string' },
    // [E2-13] Where a developer says "this acceptance criterion cannot be met on this branch".
    // In run 3 one edited the issue file instead, narrowing the scenario it was about to be judged
    // against. It did so well — options weighed, debt named, a human paid it — but the tester reads
    // those criteria FROM that file, so an honest narrowing and a quiet deletion produce the same
    // green from the same inputs. The contract is now proposed against, never rewritten in place.
    amendments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'why', 'owed'],
        properties: {
          criterion: { type: 'string' }, // the scenario or AC that cannot be executed here
          why: { type: 'string' }, // what about THIS branch makes it impossible
          owed: { type: 'string' }, // what must be asserted later, and where it must land
        },
      },
    },
    notes: { type: 'string' },
  },
}

// [SD-11 / R-BUILD-07] A slice's id becomes its git branch name, and only ONE of the two paths
// that produce ids was ever told what an id looks like. The resolver spawn below is told "the
// NN-slug from the filename"; the po's own manifest — the fast path [E-13] added to skip that
// round-trip — is filtered for truthiness and nothing more. `SLICE_ITEM.id` carries the comment
// `// NN-slug`, and a comment is not a constraint. Run 5 went down the fast path with issue files
// named `01-bring-back-the-last-removed-name.md` and ids of `01`, so it shipped three branches
// called `slice/undo-a-removal/01`, `02` and `03` — against a contract that both SPEC.md and the
// mode file state as `slice/<feature>/<NN>-<slug>`. The branch names are what a human reads at the
// one step sdlc2 deliberately leaves to a person.
//
// The filename is the documented source of truth and `path` is already required, so the id is
// recovered from there. Two things make this safe rather than clever:
//
//   `blockedBy` HOLDS IDS TOO. Renaming ids without rewriting the references would leave every
//   dependency edge pointing at a name that no longer exists; `levelOf` would flatten the graph to
//   one level and slices that must stack would build in parallel off the base instead. That is
//   run 1's stacking defect, reintroduced by a cosmetic fix — so the rename map is applied to
//   `blockedBy` in the same pass, and the probe asserts the LEVELS, not just the names.
//
//   IT IS ALL OR NOTHING. If the rewrite would collide two slices onto one id, nothing is renamed
//   at all. A half-applied rename is worse than an ugly branch name in every case.
const CANONICAL_ID = /^\d+-[a-z0-9][a-z0-9-]*$/
function canonicalSliceIds(slices, note) {
  const basename = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '')
  const rename = Object.create(null)
  for (const sl of slices) {
    if (CANONICAL_ID.test(sl.id)) continue
    const from = basename(sl.path)
    if (from && from !== sl.id && CANONICAL_ID.test(from)) rename[sl.id] = from
  }
  if (!Object.keys(rename).length) return slices
  const seen = Object.create(null)
  for (const sl of slices) {
    const id = rename[sl.id] || sl.id
    if (seen[id]) {
      if (note) note(`slice ids left alone: recovering them from the issue filenames would collide two slices on "${id}". [SD-11]`)
      return slices
    }
    seen[id] = true
  }
  const out = slices.map((sl) =>
    Object.assign({}, sl, {
      id: rename[sl.id] || sl.id,
      // Unknown references are left verbatim — the level pass already ignores an id it does not
      // know, and silently inventing an edge here would be worse than leaving a dangling one.
      blockedBy: (sl.blockedBy || []).map((b) => rename[b] || b),
    })
  )
  if (note) note(`slice ids recovered from the issue filenames so each branch says what it is: ${Object.keys(rename).map((k) => `${k} → ${rename[k]}`).join(', ')} [SD-11]`)
  return out
}

// ────────────────────────────────────────────────────────── rubrics ────
// SOURCE OF TRUTH: SPEC.md §13 Rubrics. These literals must match it criterion-for-criterion,
// weight-for-weight, threshold-for-threshold — drift is a conformance failure. [R-RUB-01]
const RUBRICS = {
  po: {
    // [E-03] 0.80, not 0.85. MIN across checkers + a refutation mandate + anchors written as
    // absolutes put 0.85 inside judge noise: run 1's po scored 0.84 and paid an arbiter for 0.01,
    // while the only unaided pass in the whole run happened at the 0.80 bar.
    threshold: 0.8,
    criteria: [
      { id: 'PO-AC', weight: 0.3, text: 'Every story carries Gherkin Given/When/Then that is concrete and testable, covering the happy path AND edge / error / empty / permission cases. One scenario maps to exactly one acceptance test.', anchors: '0.0 = prose criteria or vague terms ("fast", "user-friendly"); 0.5 = Gherkin for happy paths only; 1.0 = every story, every path, each step observable.' },
      { id: 'PO-INVEST', weight: 0.25, text: 'Stories are INVEST-compliant VERTICAL slices cut from a story map, walking-skeleton first. No horizontal or technical stories.', anchors: '0.0 = a flat list of technical tasks ("create the table"); 0.5 = vertical but no visible backbone or skeleton-first ordering; 1.0 = a mapped journey, thinnest end-to-end slice marked and ordered first.' },
      { id: 'PO-GRILL', weight: 0.15, text: 'Every decision, constraint and exclusion in the seed feature.md appears in a story, an acceptance criterion, or an explicit Out-of-scope line. Nothing silently dropped.', anchors: '0.0 = seed decisions missing with no trace; 0.5 = most carried, some silently gone; 1.0 = full traceability, exclusions stated.' },
      { id: 'PO-LANG', weight: 0.15, text: 'Terms match the seed\'s ubiquitous language and any existing domain docs. No invented synonyms for existing terms.', anchors: '0.0 = new vocabulary for existing concepts; 0.5 = mostly consistent, occasional drift; 1.0 = exact, and new terms are defined.' },
      { id: 'PO-MOCK', weight: 0.15, text: 'mockup.html shows a screen for every story\'s happy path, every control named in an acceptance criterion is present, and no screen exists that no story asks for.', anchors: '0.0 = missing or unrelated to the stories; 0.5 = partial coverage or orphan screens; 1.0 = bijective with the stories, self-contained HTML.' },
    ],
  },
  arch: {
    threshold: 0.8, // [E-03] — same reasoning as po
    criteria: [
      { id: 'AR-BOUND', weight: 0.28, text: 'Aggregate and context boundaries are correct: every invariant is owned in exactly one place, and no operation spans two aggregates transactionally.', anchors: '0.0 = invariants scattered or a cross-aggregate transaction; 0.5 = boundaries named but an invariant\'s owner is ambiguous; 1.0 = each invariant has one owner, stated.' },
      { id: 'AR-SEAM', weight: 0.22, text: 'The outer acceptance-test seam each slice will be driven through is named and reachable, and ports/adapters are explicit.', anchors: '0.0 = no seam named; 0.5 = a seam for the feature but not per slice; 1.0 = per slice, matching the project\'s declared seam.' },
      { id: 'AR-ADR', weight: 0.2, text: 'Each significant decision is an ADR with options considered, the decision, its consequences, and why the alternatives were rejected.', anchors: '0.0 = decisions asserted with no alternatives; 0.5 = ADRs without rejected options or consequences; 1.0 = complete.' },
      { id: 'AR-FIT', weight: 0.12, text: 'Consistent with the existing codebase and its conventions; any new pattern or dependency is justified rather than incidental.', anchors: '0.0 = a new stack/style with no rationale; 0.5 = consistent but unexamined; 1.0 = consistent, deviations argued.' },
      // [SD-07] The engine cannot read the disk, so the only place this can be caught is a checker
      // that can. Run 2's architect declared slice 04 blocked by 02 in design.md while the issue
      // said "Not blocked by 02"; `baseFor()` reads issues/, so the engine ignored it and the
      // diamond survived by luck. Had it been honoured, the run's whole point would have collapsed.
      { id: 'AR-QUEUE', weight: 0.1, text: 'design.md and the ADRs assert NO slice dependency that issues/ does not already declare. Open every issue file, read its `Blocked by:` line, and compare. A disagreement with the queue is raised as a defect against the product-owner node and a human-verify record naming the issue to amend — never as an edge declared here.', anchors: '0.0 = design.md declares a `Blocked by:` edge absent from issues/, or contradicts one that is there; 0.5 = no contradiction, but the design restates the graph so the two can drift; 1.0 = issues/ is the only place the queue is stated, and any disagreement is filed against the po node instead.' },
      { id: 'AR-SLICE', weight: 0.08, text: 'Each queued slice is implementable end-to-end against that seam in one sitting.', anchors: '0.0 = slices that cannot compile alone; 0.5 = plausible but unexamined; 1.0 = each slice traced to the seam it drives.' },
    ],
  },
  ux: {
    threshold: 0.8,
    criteria: [
      { id: 'UX-STATE', weight: 0.3, text: 'Every screen has empty / loading / error / partial / success (plus over-limit where it applies) designed, each with a way out.', anchors: '0.0 = happy path only; 0.5 = some states, no recovery paths; 1.0 = full matrix, each with recovery.' },
      { id: 'UX-FLOW', weight: 0.25, text: 'Happy path and recovery flows are complete; no dead ends; every screen is reachable.', anchors: '0.0 = dead ends or unreachable screens; 0.5 = happy path complete, recovery thin; 1.0 = both complete.' },
      { id: 'UX-A11Y', weight: 0.2, text: 'Structural WCAG AA: labels, heading order, keyboard path, visible focus, contrast tokens, never colour alone.', anchors: '0.0 = unlabelled controls / colour-only signalling; 0.5 = labels present, focus or keyboard path unaddressed; 1.0 = all five addressed in the markup.' },
      { id: 'UX-IA', weight: 0.15, text: '"Where am I / where can I go" holds on every screen; routes are real and deep-linkable.', anchors: '0.0 = no navigation model; 0.5 = nav present but inconsistent; 1.0 = consistent, with real routes.' },
      { id: 'UX-MOCK', weight: 0.1, text: 'Extends the product-owner\'s mockup.html in place without contradicting any acceptance criterion; no orphan screens.', anchors: '0.0 = a new file or contradicts an AC; 0.5 = extends it but drifts from a criterion; 1.0 = same file, consistent, states labelled with the story they serve.' },
    ],
  },
  build: {
    threshold: 0.8, // applies to code-reviewer only; the tester is binary and never averaged
    criteria: [
      { id: 'CR-CLEAN', weight: 0.3, text: 'Clean Code: intention-revealing names, small functions, one level of abstraction per function, no flag arguments, comments explain why not what.', anchors: '0.0 = long multi-purpose functions, cryptic names; 0.5 = readable with notable violations; 1.0 = no high-severity violation found.' },
      { id: 'CR-DDD', weight: 0.25, text: 'Domain model integrity: no anemic entities, no domain logic in adapters/controllers, the ubiquitous language appears in the code.', anchors: '0.0 = logic in the controller, getters/setters only; 0.5 = mostly modelled, leakage at one seam; 1.0 = behaviour lives with the data it protects.' },
      { id: 'CR-IDIOM', weight: 0.2, text: 'Idiomatic for this stack and consistent with the surrounding code; not fighting the framework.', anchors: '0.0 = fights the framework or ignores local conventions; 0.5 = idiomatic with lapses; 1.0 = indistinguishable in style from the best existing code.' },
      { id: 'CR-TEST', weight: 0.15, text: 'Tests assert behaviour rather than implementation, and the acceptance test maps to its Gherkin scenario.', anchors: '0.0 = tests assert internals or are absent; 0.5 = behavioural but no traceable acceptance test; 1.0 = one scenario, one acceptance test, behavioural units beneath.' },
      { id: 'CR-DUP', weight: 0.1, text: 'No duplication, dead code, or commented-out code introduced.', anchors: '0.0 = copy-pasted blocks or commented-out code; 0.5 = minor repetition; 1.0 = none.' },
    ],
  },
}

// ──────────────────────────────────────────────────────────── nodes ────
// The graph is DATA. Adding a node is a row here plus a row in SPEC.md — never a change to the
// executor below, which resolves ready nodes from `next` and dispatches on `kind`. Every role
// declares its own model and effort; there is no inherited default.
const NODES = {
  po: {
    id: 'po',
    kind: 'loop',
    phase: 'Product',
    mandate:
      'Turn the grilled seed into the product contract: epics, INVEST user stories cut from a story map (walking skeleton first), Gherkin acceptance criteria per story, an out-of-scope list, a self-contained HTML mockup of every story\'s happy path, and one queue issue per vertical slice.',
    maker: { agent: 'sdlc2-product-owner', model: 'sonnet', effort: 'high' },
    checkers: [
      { agent: 'sdlc2-product-owner-critic', model: 'opus', effort: 'xhigh', lens: 'requirements quality — INVEST, testability, coverage, language', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-product-owner', model: 'opus', effort: 'high' },
    rubric: 'po',
    rounds: DOC_ROUNDS,
    inputs: [SEED, VH],
    outputs: [
      { path: SEED, kind: 'feature', note: 'EXTEND the seed in place — preserve its sections, append epics/stories/AC/out-of-scope' },
      // [E-11] `whenUi` — required only when this feature has UI stories. A backend-only feature
      // used to be forced to generate a full mockup that `ux` (gated off) then never read and no
      // slice ever opened: a large artifact with no consumer.
      { path: MOCKUP, kind: 'mockup', whenUi: true, note: 'ONE self-contained file: inline CSS, no CDN, no network, one screen per story happy path. SKIP THIS ENTIRELY if the feature has no UI stories — set hasUiStories false and do not create the file' },
      { path: `${ISSUES}/NN-slug.md`, kind: 'issues', note: 'one per vertical slice; `## Acceptance criteria` is Gherkin COPIED VERBATIM from feature.md, plus `Blocked by:` and a `Dir:` line naming the directory it mainly touches. ALSO return the same list in the `slices` field of your structured result — id, path, title, dir, blockedBy, and `ui` true when the slice changes something a person sees on screen. The build node reads it directly rather than re-deriving what you already know' },
    ],
    when: null,
    next: ['architect', 'ux'],
  },

  architect: {
    id: 'architect',
    kind: 'loop',
    phase: 'Design',
    mandate:
      'Design the domain model and the boundaries this feature needs, name the outer acceptance-test seam for EACH slice, and record the decisions as ADRs. Do not touch feature.md, mockup.html, or any issue\'s acceptance criteria — disagreement with the product framing is a human-verify record, not an edit. [SD-07] THE DEPENDENCY QUEUE IS NOT YOURS TO DECLARE: the `Blocked by:` lines in issues/ are the single source of truth, they are what the build node actually reads, and design.md MUST NOT assert a dependency edge that issues/ does not already carry — not even one you are right about. If a slice needs a blocker its issue does not declare, that is a DEFECT to raise against the product-owner node, in `disputed` and as a human-verify record naming the issue file to amend. Declaring the edge downstream instead produces two artifacts of the same run asserting different graphs, with only one of them executable.',
    maker: { agent: 'sdlc2-architect', model: 'opus', effort: 'high' },
    checkers: [
      { agent: 'sdlc2-architect-critic', model: 'opus', effort: 'xhigh', lens: 'boundaries, invariants, seam reachability, ADR completeness, and fidelity to the queue declared in issues/', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-architect', model: 'opus', effort: 'high' },
    rubric: 'arch',
    rounds: DOC_ROUNDS,
    inputs: [SEED, ISSUES, VH],
    outputs: [
      { path: DESIGN, kind: 'design', note: 'domain model · boundaries · ports · THE SEAM PER SLICE. Do NOT restate or amend the slice dependency graph here — issues/ owns it [SD-07]' },
      { path: 'docs/adr/NNNN-<slug>.md', kind: 'adr', note: 'one per significant decision; options, decision, consequences, why the alternatives lost' },
    ],
    when: null,
    next: ['build'],
  },

  ux: {
    id: 'ux',
    kind: 'loop',
    phase: 'Design',
    mandate:
      'Turn the stories into the experience structure: user flows, information architecture, and the full state matrix. EXTEND the product-owner\'s mockup.html in place — same file, its screens preserved — adding a labelled variant for every state and the navigation model. Structure, not visual polish.',
    maker: { agent: 'sdlc2-ux-design', model: 'sonnet', effort: 'high' },
    checkers: [
      { agent: 'sdlc2-ux-auditor', model: 'opus', effort: 'xhigh', lens: 'SPEC MODE — static review of the mockup and the stories; no running app, no browser', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-ux-design', model: 'opus', effort: 'high' },
    rubric: 'ux',
    rounds: DOC_ROUNDS,
    inputs: [SEED, MOCKUP, VH],
    outputs: [
      { path: MOCKUP, kind: 'mockup', note: 'the SAME file — never a new one; add state variants + navigation, label each with the story/AC it serves' },
    ],
    when: (state) => state.po && state.po.hasUiStories === true,
    // [E-12] `ux` no longer feeds `build`. A backend slice consumes nothing from the state matrix
    // and used to wait for it anyway, because `build` joined on BOTH design nodes and the executor
    // held a barrier across the wave. The join is per SLICE now — `runSlice` waits on `ux` only
    // for a slice the resolver marked `ui: true`. `report` still waits for ux, so nothing is
    // reported before every node has settled.
    next: ['report'],
  },

  build: {
    id: 'build',
    kind: 'fanout',
    phase: 'Build',
    mandate:
      'Build ONE vertical slice outside-in: one Gherkin scenario becomes one failing acceptance test at the declared seam, kept red while inner red-green-refactor cycles drive it green.',
    maker: { agent: 'sdlc2-developer', model: 'opus', effort: 'xhigh' },
    checkers: [
      // [E-09] `medium`, not `xhigh`: this checker's authority is a green suite, not deliberation.
      // Effort cut, model kept — a tester false-green is the one unrecoverable failure here.
      { agent: 'sdlc2-tester', model: 'opus', effort: 'medium', lens: 'executable ground truth — the suite and the acceptance criteria', binary: true, arbitrable: false },
      { agent: 'sdlc2-code-reviewer', model: 'opus', effort: 'high', lens: 'Clean Code · DDD · idiom · test quality', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-developer', model: 'opus', effort: 'high' },
    rubric: 'build',
    rounds: ROUNDS,
    inputs: [SEED, DESIGN, MOCKUP, VH],
    outputs: [],
    when: null,
    fanout: 'slices',
    next: ['report'],
  },

  // Terminal node. It runs in EVERY outcome — including an aborted graph — because a run nobody
  // can read is indistinguishable from a run that never happened.
  report: {
    id: 'report',
    kind: 'report',
    phase: 'Report',
    mandate:
      'Write the run report: what each node decided, what shipped, and what a human still has to confirm.',
    maker: { agent: null, model: 'sonnet', effort: 'medium' },
    checkers: [],
    arbiter: null,
    rubric: null,
    rounds: 0,
    inputs: [VH],
    outputs: [{ path: REPORT, kind: 'report', note: 'node table · slice table · human-verify index · summary; then commits the paperwork to sdlc2/<feature>' }],
    when: null,
    next: [],
  },
}

// ───────────────────────────────────────────────────────── helpers ────
function rubricTable(name) {
  const r = RUBRICS[name]
  const rows = r.criteria
    .map((c) => `- ${c.id} (weight ${c.weight}) — ${c.text}\n    anchors: ${c.anchors}`)
    .join('\n')
  return `${rows}\n\nPASS BAR: weighted total ≥ ${r.threshold}, and no unresolved critical/high defect.`
}

function weightedTotal(name, verdict) {
  const r = RUBRICS[name]
  if (!verdict || !Array.isArray(verdict.criteria)) return 0
  let total = 0
  for (const c of r.criteria) {
    const got = verdict.criteria.find((x) => x && x.id === c.id)
    const s = got && typeof got.score === 'number' ? Math.max(0, Math.min(1, got.score)) : 0
    total += s * c.weight
  }
  return Math.round(total * 100) / 100
}

// [E-02/E-05] The per-criterion scores the verdict is actually computed from. The loop used to
// throw these away between rounds, which cost twice: the maker was told "do not regress what
// already passed" without being told WHAT passed, and the next round's checker re-scored from
// cold, re-rolling judge variance against unchanged text. Both now receive them from round 2 on.
// [R-REP-08] The MARGIN behind a score. `scoreBrief` above assembles exactly this data and hands
// it to the NEXT round — so a node that passes on its first round computes a full per-criterion
// breakdown, with each checker's stated reason, and then returns and discards it. Run 5 passed
// every node on round 1 and every slice on attempt 1, so it threw away all six breakdowns and left
// six aggregate numbers behind.
//
// That loses the only thing that answers whether the checkers are still adversarial. A total of
// 0.87 is produced equally by a panel scoring everything near 0.87 and by a panel scoring almost
// everything 1.0 with one criterion at 0.4 — a mild reviewer and a reviewer biting hard on one
// specific thing, which are opposite findings. The aggregate cannot tell them apart and the
// per-criterion scores can.
//
// MIN across the scoring checkers, matching how the total itself is computed: an adversarial panel
// is only as green as its harshest lens, so the margin must be read through the same lens.
function criterionLows(rubricName, verdicts, cap) {
  const r = RUBRICS[rubricName]
  if (!r) return []
  const out = []
  for (const c of r.criteria) {
    let worst = null
    let why = ''
    for (const v of verdicts) {
      if (!v || !Array.isArray(v.criteria)) continue
      const got = v.criteria.find((x) => x && x.id === c.id)
      if (!got || typeof got.score !== 'number') continue
      const sc = Math.max(0, Math.min(1, got.score))
      if (worst === null || sc < worst) {
        worst = sc
        why = got.why ? String(got.why).replace(/\s+/g, ' ').slice(0, 200) : ''
      }
    }
    // A criterion no checker scored is already counted as zero by `weightedTotal`; say so here too
    // rather than omitting it, because an absent row reads as "fine" and it is the opposite.
    if (worst === null) out.push({ id: c.id, score: 0, weight: c.weight, why: 'no checker scored this criterion — counted as zero' })
    else if (worst < 1) out.push({ id: c.id, score: worst, weight: c.weight, why: why })
  }
  // Gaps sort ahead of low marks — an unjudged criterion is worse news than a scored 0.5. The cap
  // is a guard, not a filter: only criteria BELOW 1.0 are in this list and no rubric has more than
  // six, so in practice nothing is ever trimmed. It was 4, which let four gaps hide a real low
  // score entirely — the opposite of what this record is for.
  out.sort((a, b) => a.score - b.score)
  return out.slice(0, cap || 6)
}

function scoreBrief(verdicts) {
  const rows = []
  for (const v of verdicts) {
    if (!v || !Array.isArray(v.criteria)) continue
    for (const c of v.criteria) {
      if (!c || !c.id) continue
      const sc = typeof c.score === 'number' ? c.score : '?'
      const why = c.why ? ` — ${String(c.why).replace(/\s+/g, ' ').slice(0, 240)}` : ''
      rows.push(`  ${c.id}: ${sc}${why}`)
    }
  }
  return rows.length ? rows.join('\n') : ''
}

// A defect without quoted evidence is discarded — it is an assertion, not a finding. The schema
// requires evidence, so this is the second gate, and it says out loud what it dropped.
function cleanDefects(verdict, label) {
  if (!verdict || !Array.isArray(verdict.defects)) return []
  const kept = verdict.defects.filter((d) => d && d.evidence && String(d.evidence).trim().length > 0)
  const lost = verdict.defects.length - kept.length
  // Says out loud what it dropped, but stays callable in isolation — it is otherwise pure.
  if (lost > 0 && typeof log === 'function') {
    log(`${label || 'checker'}: discarded ${lost} defect(s) with no quoted evidence [R-LOOP-06]`)
  }
  return kept
}

// Deduped by (criterion, location) — but `location` is optional, so two distinct findings under
// one criterion fall back to their evidence rather than collapsing into one. [R-LOOP-05]
function defectKey(d) {
  const where = d.location && String(d.location).trim().length ? String(d.location) : String(d.evidence || '').slice(0, 80)
  return `${d.criterion}|${where}`
}

function dedupe(defects) {
  const seen = Object.create(null)
  const out = []
  for (const d of defects) {
    const k = defectKey(d)
    if (seen[k]) continue
    seen[k] = true
    out.push(d)
  }
  return out
}

// [R-LOOP-01] What vetoes a pass regardless of score. At `build` the veto stays critical+high:
// the tester's authority is executable ground truth. At the DOCUMENT nodes it is `critical` only
// [E-10] — a `high` already drags its criterion's score, so vetoing on it as well double-counts
// the ONE judgement in this system that has no anchors. Scores are anchored 0.0/0.5/1.0 per
// criterion; severity is not, so the veto was firing on the least-calibrated signal a checker
// emits. Default (no second argument) is the strict form, so every existing caller is unchanged.
function blockingOpen(defects, docNode) {
  return defects.filter((d) => d.severity === 'critical' || (!docNode && d.severity === 'high'))
}

// [SD-05] Every spawn in this engine goes through here. `agent()` answers with `null` when the
// subagent dies on a terminal API error after the harness's own retries, and can throw outright;
// run 2 lost a node's clean pass to one dropped connection — `[ux:make (2/2)] failed: API Error:
// Connection lost mid-response` reached the loop as an empty result, was scored as the critical
// defect "maker agent returned nothing", consumed the round budget, and soft-passed the node at
// 0.79 against a 0.80 bar with two VH records for a human to read. One round from passing on
// content, and the round that would have done it was spent on the network.
//
// So: an agent that never ANSWERED has not made a mistake worth a defect record. Retry it once,
// free, before anything upstream charges it a round. An agent that answers badly is untouched by
// this — that is content, it is what the checkers are for, and it still costs a round.
const SPAWN_RETRIES = 1
async function spawn(prompt, opts) {
  const label = (opts && opts.label) || 'spawn'
  for (let tryN = 0; tryN <= SPAWN_RETRIES; tryN++) {
    let out = null
    try {
      out = await agent(prompt, opts) // the ONLY bare agent() call in the engine — everything else goes through spawn
    } catch (e) {
      out = null
      if (tryN >= SPAWN_RETRIES) log(`${label}: spawn threw (${(e && e.message) || e}) — giving up after ${tryN + 1} attempt(s).`)
    }
    if (out) return out
    if (tryN < SPAWN_RETRIES) log(`${label}: the spawn never answered — retrying once. This is transport, not content, so the round is NOT charged.`)
  }
  return null
}

function engineDefect(location, evidence, fix, severity) {
  return {
    criterion: 'engine',
    severity: severity || 'critical',
    location: location,
    evidence: evidence,
    fix: fix || 're-run and return the declared structured object',
  }
}

// A HARNESS defect — an agent that failed to answer — blocks the round exactly like any other
// critical defect, but it is nobody's work to repair. It is kept in the record and kept OUT of
// the repair brief, so no maker is ever asked to fix a checker.
function harnessDefect(location, evidence, fix) {
  return Object.assign(engineDefect(location, evidence, fix), { harness: true })
}

function actionable(defects) { return (defects || []).filter((d) => !d.harness) }
function harnessOnly(defects) { return (defects || []).filter((d) => d.harness) }

// The engine cannot read the disk, but it CAN check that the maker claims to have written what
// the node declares, and that the changelog stayed a changelog. [R-CTX-06]
function auditMaker(node, maker) {
  if (!maker || maker.ok === false) {
    return [engineDefect(node.id, (maker && maker.notes) || 'maker agent returned nothing', 'produce the required artifacts at the declared paths')]
  }
  const out = []
  const claimed = (maker.artifacts || []).map((a) => String((a && a.path) || ''))
  for (const o of node.outputs) {
    if (/NN|<|>/.test(o.path)) continue // templated path (one per slice / per decision) — unresolvable here
    // [E-11] A UI-only artifact is not owed when the maker itself declared there are no UI stories.
    if (o.whenUi && maker.hasUiStories === false) continue
    if (!claimed.some((p) => p === o.path || p.indexOf(o.path) >= 0)) {
      out.push(engineDefect(o.path, `maker returned artifacts ${JSON.stringify(claimed)} — ${o.path} is not among them`, `write ${o.path} and return its path in \`artifacts\``))
    }
  }
  // [E2-06] The one contradiction the engine CAN see without reading the disk. `hasUiStories`
  // gates the whole `ux` node, and it was called unenforceable for two releases — but since [E-13]
  // the po also returns a slice manifest with a `ui` flag per slice, so both halves arrive in the
  // same object. A maker that queues a UI slice while declaring the feature has no screens has
  // contradicted itself, which is `critical` by this engine's own severity anchor.
  if (maker.hasUiStories === false && Array.isArray(maker.slices)) {
    const uiSlices = maker.slices.filter((x) => x && x.ui === true).map((x) => x.id)
    if (uiSlices.length) {
      out.push(engineDefect(
        node.id,
        `hasUiStories is false, but the slice manifest marks ${uiSlices.length} slice(s) as ui:true — ${uiSlices.join(', ')}`,
        'set hasUiStories true if any slice renders a screen, or mark those slices ui:false if they do not — the two must agree [E2-06]'
      ))
    }
  }
  const lines = String(maker.changelog || '').split('\n').length
  if (lines > 20) {
    out.push(engineDefect(node.id, `changelog is ${lines} lines long`, 'return at most 20 lines of changelog and never an artifact body [R-CTX-06]', 'high'))
  }
  return out
}

// Nested CLAUDE.md wins for slices under its directory: longest matching prefix, matched on path
// SEGMENTS so `frontend` never claims `frontend-legacy/`.
function normalizeDir(p) {
  return String(p || '').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function configFor(dir) {
  const d = normalizeDir(dir)
  if (!d) return CONFIG
  let best = null
  let bestLen = -1
  for (const prefix of Object.keys(CONFIG_BY_DIR)) {
    const p = normalizeDir(prefix)
    if (!p) continue
    if ((d === p || d.indexOf(`${p}/`) === 0) && p.length > bestLen) {
      best = CONFIG_BY_DIR[prefix]
      bestLen = p.length
    }
  }
  if (!best) return CONFIG
  const cmds = Object.assign({}, CONFIG.commands || {}, best.commands || {})
  const seam = Object.assign({}, CONFIG.seam || {}, best.seam || {})
  // [E2-02] A nested block may declare its own stack — a `frontend/` directory in a repo whose
  // root is a JVM service is exactly the case per-directory config exists for.
  return { commands: cmds, seam: seam, stack: best.stack || CONFIG.stack || '' }
}

// Doc nodes reason about the whole repo, so they are shown the per-directory overrides too — a
// slice under `frontend/` does not run the backend's test command. [R-CFG-04]
function overrides() {
  const keys = Object.keys(CONFIG_BY_DIR)
  if (!keys.length) return ''
  const rows = keys
    .map((k) => {
      const c = configFor(k)
      return `    ${k} → test: ${c.commands.test || '(root)'} · seam: ${c.seam.backend || c.seam.frontend || '(root)'}`
    })
    .join('\n')
  return `  per-directory overrides (a slice whose Dir: falls under one of these uses its own):\n${rows}\n`
}

function conventions(cfg, withOverrides) {
  const c = cfg.commands || {}
  const s = cfg.seam || {}
  // [E2-02] The stack the project actually uses, declared by the project. The personas used to
  // carry one in their own identity — "Java 21 + Spring Boot backend and React 19 + TypeScript
  // frontend" — which made every judgement about idiom, test seam and framework fit assume a
  // stack sdlc2 has no business assuming. Commands were already the project's to declare; this
  // makes the language the same kind of fact.
  const stack = String(cfg.stack || CONFIG.stack || '').trim()
  return (
    `PROJECT CONVENTIONS (from the project's CLAUDE.md sdlc2 block — authoritative, do not guess):\n` +
    `  stack        : ${stack || '(not declared — infer it from the code you read, and never assume one)'}\n` +
    `  test command : ${c.test || '(none — STOP, there is no oracle)'}\n` +
    (c.build ? `  build        : ${c.build}\n` : '') +
    (c.run ? `  run          : ${c.run}\n` : '') +
    (c.e2e ? `  e2e          : ${c.e2e}\n` : '') +
    `  backend seam : ${s.backend || '(none declared)'}\n` +
    `  frontend seam: ${s.frontend || '(none declared)'}\n` +
    (withOverrides ? overrides() : '')
  )
}

// Paths are listed once, in order, however many node fields name the same file.
function pathList(paths) {
  const seen = Object.create(null)
  const out = []
  for (const p of paths) {
    if (!p || seen[p]) continue
    seen[p] = true
    out.push(p)
  }
  return out.map((p) => `  - ${p}`).join('\n')
}

// ───────────────────────────────────────────────── prompt builders ────
// PURE functions of (node, round, paths, defects). They never receive a prior round's
// transcript, a prior maker's output body, or another checker's verdict — artifacts travel on
// disk. Mandate first, rubric + schema last: the two highest-attention positions.
function makerPrompt(node, round, defects, extra) {
  const outs = node.outputs
    .map((o) => `  - ${o.path}\n      ${o.note}`)
    .join('\n')
  const real = actionable(defects)
  const stalled = harnessOnly(defects)
  const repair = real.length
    ? `\nROUND ${round} of ${node.rounds} — an independent adversarial checker REFUTED the previous round.\n` +
      `Fix EVERY defect below and do not regress what already passed. If you believe a defect is\n` +
      `wrong, still address the underlying concern and record it in \`disputed\` with your reason.\n` +
      `${JSON.stringify(real)}\n`
    : stalled.length
    ? `\nROUND ${round} of ${node.rounds} — the previous round could not be SCORED: ` +
      `${stalled.map((d) => d.evidence).join('; ')}.\n` +
      `That is a harness failure, not a fault found in your work. Re-check your artifacts against\n` +
      `the rubric below and fix anything you find — but do not rewrite work that is already right.\n`
    : round > 1
    ? // [E-02] A round can fail on SCORE alone — the checker cited nothing the engine could use,
      // or every defect it did cite was discarded for missing evidence. That used to fall through
      // to the "first attempt" branch and tell a round-3 maker it had never seen this work.
      `\nROUND ${round} of ${node.rounds} — the previous round scored BELOW THE BAR but cited no\n` +
      `usable defect. Nothing here is a first draft: read the per-criterion scores below and raise\n` +
      `the weakest criteria specifically.\n`
    : `\nROUND ${round} of ${node.rounds} — first attempt.\n`

  return (
    `You are the \`${node.maker.agent}\` persona working on the feature "${TITLE}" (slug: ${FEATURE}).\n\n` +
    `MANDATE — ${node.mandate}\n` +
    repair +
    // [E2-15] The seed arrives already grilled: its capability, scope, exclusions, decisions,
    // ubiquitous language and open questions were settled with a human before the graph started.
    // Measured on run 3, the document phase cost 42 minutes — 30% of the wall clock — much of it
    // re-deriving those decisions and then being scored on whether the re-derivation matched.
    `\nTHE SEED IS SETTLED WORK, NOT A PROMPT. Where ${SEED} already decides something — scope, an\n` +
    `exclusion, a term, a constraint — CARRY IT FORWARD verbatim rather than re-deriving it or\n` +
    `improving on it. Re-opening a settled decision is not thoroughness here; it is the single\n` +
    `most expensive thing you can do, and the rubric scores you on traceability to the seed, not\n` +
    `on independent agreement with it. Spend your rounds on what the seed leaves OPEN.\n` +
    `\nREAD THESE PATHS (they exist on disk; nothing is pasted for you):\n` +
    pathList(node.inputs.concat([VH])) +
    `\n  (${VH} — if it exists, these are decisions already taken under caveat. Honour them; do not relitigate.)\n` +
    `\n${conventions(CONFIG, true)}` +
    // [E-02] The previous round's per-criterion scores. `extra` was always a wired-but-unused
    // hook; the loop now fills it, so the maker can see which criterion cost it the round.
    (extra ? `\nHOW THE LAST ROUND SCORED YOU (criterion: score — why):\n${extra}\n` : '') +
    `\nWRITE YOUR OUTPUT TO DISK:\n${outs}\n` +
    `\nReturn every path you wrote in \`artifacts\` — the engine checks them against the list above —\n` +
    `plus a changelog of at most 20 lines. Never paste an artifact body back to me.\n` +
    `\nRUBRIC — you will be scored on exactly this, by an adversarial checker with fresh context:\n` +
    `${rubricTable(node.rubric)}\n` +
    `\nReturn the structured MAKER object.`
  )
}

function checkerPrompt(node, checker, round, prior) {
  return (
    `You are the \`${checker.agent}\` persona acting as an INDEPENDENT ADVERSARIAL CHECKER.\n\n` +
    `MANDATE — REFUTE this work. You did not write it and you are not here to be agreeable.\n` +
    // [E-03] "Default to FAIL when uncertain" belongs to a BINARY checker, whose ground truth is
    // executable. For a rubric scorer it silently biases every criterion it did not fully examine
    // toward 0.5, which is how genuinely good work lands under the bar round after round.
    (checker.binary
      ? `Default to FAIL when uncertain. Your lens: ${checker.lens}.\n`
      : `Score what you can evidence, and do not penalise the maker for what you did not check.\n` +
        `A clean pass with zero defects is a legitimate verdict — say so when you find one.\n` +
        `Your lens: ${checker.lens}.\n`) +
    `You are READ-ONLY: never edit an artifact. You have not seen any other checker's verdict and\n` +
    `must not speculate about one.\n` +
    // [E2-15] The checker's counterpart to the maker's instruction above.
    `The seed at ${SEED} is SETTLED work agreed with a human before this run. Score whether the\n` +
    `artifact CARRIES its decisions faithfully — a decision dropped, contradicted or silently\n` +
    `re-opened is a defect. Disagreeing with a settled decision is not: if you think one is wrong,\n` +
    `that is a human-verify note, never a score deduction.\n` +
    `\nROUND ${round}. The maker was asked to: ${node.mandate}\n` +
    // [E-05] From round 2 the checker sees how the PREVIOUS round scored. Without this a fresh,
    // memoryless judge re-scores all criteria cold every round, so a criterion that was clean can
    // drop against text that never changed — manufacturing the oscillation the loop is blamed for.
    // Mutual blindness WITHIN a round is untouched: this is last round's verdict, not a peer's.
    (prior
      ? `\nHOW THE PREVIOUS ROUND SCORED (last round's verdict, not another checker's):\n${prior}\n` +
        `Verify each claimed fix with FRESH evidence. You may raise a score freely. Do NOT lower\n` +
        `one without quoting the regression that justifies it.\n`
      : '') +
    `\nREAD THESE PATHS:\n` +
    pathList(node.inputs) +
    '\n' +
    pathList(node.outputs.map((o) => o.path)).replace(/$/gm, '   (artifact under review)') +
    `\n\n${conventions(CONFIG, true)}` +
    `\nEVERY defect MUST carry: criterion (a rubric id below), severity, location (file:line or a\n` +
    `precise anchor), evidence (QUOTED from the artifact — not paraphrased), and a concrete fix.\n` +
    // [E-10] Severity was the one judgement in this system with no anchors, and it drives a veto.
    `SEVERITY, anchored — use these definitions, not your own feel for the word:\n` +
    `  critical = the artifact cannot be built against at all, or it contradicts itself.\n` +
    `  high     = building against this as written would produce the WRONG software.\n` +
    `  medium   = a real gap that a competent implementer would close correctly anyway.\n` +
    `  low      = wording, ordering, or taste.\n` +
    `Wording and taste are never high. Inflating severity does not make a point stronger here —\n` +
    `the score already carries your judgement; severity only decides what BLOCKS.\n` +
    `A defect without quoted evidence is discarded by the engine, so it is wasted work.\n` +
    `Set \`hard\` only if the work cannot be judged at all (a required input is missing entirely) —\n` +
    `it ENDS the loop immediately rather than burning the remaining rounds.\n` +
    `\nRUBRIC — score EACH criterion 0..1 using its anchors, and return a score for EVERY id below:\n` +
    `a missing id is scored ZERO by the engine. Do NOT compute a total; the engine computes the\n` +
    `weighted total from your per-criterion scores:\n` +
    `${rubricTable(node.rubric)}\n` +
    `\nReturn the structured VERDICT object.`
  )
}

function arbiterPrompt(node, defects, round) {
  return (
    `You are the \`${node.arbiter.agent}\` persona, now in DECIDE MODE.\n\n` +
    `MANDATE — ${node.rounds} rounds have not satisfied the checker, and the graph does not stall.\n` +
    `Make the best decision available for EACH unresolved defect, finalize the artifact on disk,\n` +
    `and document what you decided so a human can confirm or overrule it later.\n` +
    `\nUnresolved after ${round} rounds:\n${JSON.stringify(defects)}\n` +
    `\nREAD:\n` +
    pathList(node.inputs.concat(node.outputs.map((o) => o.path))) +
    // [E-08] Ids are NAMESPACED per node. They used to be a single VH-NN sequence discovered by
    // reading the file, which is the only reason arbitration had to be serialized — and that
    // serialization made the architect's arbiter idle until ux finished. Its own prefix means an
    // arbiter can number its rows without looking at what anyone else is writing.
    `\n  (${VH} — you own the id prefix \`VH-${node.id}-\` and nothing else. Read the file, find\n` +
    `   the highest id THAT ALREADY CARRIES YOUR PREFIX, and continue from there. Another node's\n` +
    `   arbiter may be appending under its own prefix at this very moment: append only, never\n` +
    `   renumber, reorder or rewrite an existing row, and never touch a row that is not yours.)\n` +
    `\n${conventions(CONFIG, true)}` +
    `\nDO TWO THINGS:\n` +
    `1. Finalize the artifacts at the paths above — your best version, given the defects you could\n` +
    `   not resolve. This is what every downstream node will build on.\n` +
    `2. APPEND to ${VH} (create it if absent, with the index table header). Append-only: never\n` +
    `   rewrite or delete an existing row. For each decision add one index row\n` +
    `   \`| VH-${node.id}-NN | ${node.id} | <round> | <score> | <severity> | <one-line decision> | open |\`\n` +
    `   and, beneath, a record with: Issue · Options considered · Decision · Rationale ·\n` +
    `   Risk if wrong · What would change my mind · the unresolved defects verbatim.\n` +
    `\nBe honest: if the right answer is "this needs a human product decision", say that IS the\n` +
    `decision, pick the option that keeps the slice shippable and reversible, and name the risk.\n` +
    `\nReturn the structured ARBITER object with the ids you assigned.`
  )
}

// ─────────────────────────────────────────────────── the loop engine ────
// One implementation, every loop node. maker → checkers in parallel → MIN of the weighted totals,
// with any unresolved critical/high vetoing regardless of score → repeat.
//
// It does NOT arbitrate. Rounds exhausted returns `needs-arbitration` and the executor makes the
// single arbiter call SERIALLY, because concurrent nodes would otherwise read-then-append the one
// VERIFY-WITH-HUMAN.md at the same moment: same next id, lost write. [R-VH-02/03]
async function runLoop(node) {
  const label = node.id
  const bar = RUBRICS[node.rubric].threshold
  const scorers = node.checkers.filter((c) => !c.binary).length
  let defects = []
  let maker = null
  let lastGoodMaker = null
  let prevScores = '' // [E-02/E-05] last round's per-criterion scores; '' on round 1
  let score = 0
  let round = 0
  // [E2-03] A maker whose OUTPUT was rejected — `ok: false`, or a declared artifact it never wrote
  // — has produced nothing a checker could score, so the node learns nothing from the round and
  // used to pay half its budget for it. Run 3's `architect` had round 1 rejected this way and
  // passed on its only remaining scored attempt. Same principle as [SD-05]: what was never judged
  // is not a judgement. One free re-make per node, then it costs a round like anything else —
  // otherwise a maker that always answers badly would never terminate.
  let freeRemakes = 1
  // Per-round scores, so a node that burns its whole round budget can be read afterwards. A score that
  // climbs is convergence that ran out of budget; one that flatlines or oscillates is thrash, and
  // the two want opposite fixes. Only the FINAL score used to survive into the report, which is
  // exactly the number that cannot tell them apart. [SPEC §12 risk 5]
  const history = []

  while (round < node.rounds) {
    round++
    let binaryFailed = false
    let hard = false

    maker = await spawn(makerPrompt(node, round, defects, prevScores), {
      agentType: at(node.maker.agent),
      model: node.maker.model,
      effort: node.maker.effort,
      schema: makerSchema(node),
      label: labelFor(roleOf(node.maker.agent), round, node.rounds),
      phase: groupFor(node, node.id),
    })

    // [SD-05] A maker that never ANSWERED is a transport failure, not a content one. `spawn` has
    // already retried it for free; reaching here means the retry failed too. It still costs the
    // round — otherwise the loop cannot terminate — but it is recorded as `errored`, never
    // `rejected`, so the score history stays readable, and the defect is a HARNESS defect so the
    // next round's maker is never handed "you returned nothing" as work to repair.
    if (!maker) {
      defects = [harnessDefect(node.id, 'the maker spawn never answered — a transport failure, already retried once', 're-run the node')]
      history.push({ round: round, score: null, defects: 1, open: 1, note: 'maker spawn errored', errored: true })
      log(`${label} round ${round}/${node.rounds}: the maker spawn never answered — recorded as errored, not as a defect in its work.`)
      continue
    }

    // [R-LOOP-08] A maker that DID answer and answered badly — `ok: false`, or missing a declared
    // artifact — consumes a round and earns a synthetic critical defect. It never retries for free.
    const makerFaults = auditMaker(node, maker)
    if (makerFaults.length) {
      defects = makerFaults
      // [E2-03] The first rejection of the run is free: nothing was scored, so nothing was learned.
      if (freeRemakes > 0) {
        freeRemakes--
        round--
        history.push({ round: round + 1, score: null, defects: makerFaults.length, open: makerFaults.length, note: 'maker output rejected — free re-make, round not charged', free: true })
        log(`${label}: maker output rejected — ${makerFaults.map((d) => d.evidence).join('; ')}. Re-making once free; the round is NOT charged.`)
        continue
      }
      history.push({ round: round, score: null, defects: makerFaults.length, open: makerFaults.length, note: 'maker output rejected' })
      log(`${label} round ${round}/${node.rounds}: maker output rejected — ${makerFaults.map((d) => d.evidence).join('; ')}`)
      continue
    }
    lastGoodMaker = maker
    if (Array.isArray(maker.disputed) && maker.disputed.length) {
      log(`${label} round ${round}: maker disputed ${maker.disputed.length} defect(s) — carried to the report.`)
    }

    // Order is preserved, so verdicts[i] belongs to checkers[i]. A checker that returns NOTHING is
    // therefore visible as a missing slot, never as an absent opinion: silence is a critical
    // defect and, for the binary checker, a failure. [R-LOOP-03]
    const verdicts = await parallel(
      node.checkers.map((c) => () =>
        spawn(checkerPrompt(node, c, round, prevScores), {
          agentType: at(c.agent),
          model: c.model,
          effort: c.effort,
          schema: verdictSchema(c),
          label: labelFor(roleOf(c.agent), round, node.rounds),
          phase: groupFor(node, node.id),
        })
      )
    )

    const found = []
    const scored = []
    for (let i = 0; i < node.checkers.length; i++) {
      const c = node.checkers[i]
      const v = verdicts[i]
      if (!v) {
        found.push(harnessDefect(c.agent, `the ${c.agent} checker returned no verdict — its opinion is unknown, which is not the same as approval`, 're-run the checker'))
        if (c.binary) binaryFailed = true
        continue
      }
      for (const d of cleanDefects(v, `${label}:${c.agent}`)) found.push(d)
      if (v.hard === true) hard = true
      if (c.binary) {
        if (v.pass !== true) binaryFailed = true
      } else {
        const ids = RUBRICS[node.rubric].criteria.map((x) => x.id)
        const matched = (v.criteria || []).filter((x) => x && ids.indexOf(x.id) >= 0)
        if (!matched.length) {
          log(`${label}: ${c.agent} scored no recognised criterion — every id counts as zero. Expected: ${ids.join(', ')}`)
        }
        scored.push(weightedTotal(node.rubric, v))
      }
    }

    // Weakest link: an adversarial panel is only as green as its harshest lens — and a lens that
    // failed to report is not green, it is missing.
    score = scorers === 0 ? 1 : scored.length === scorers ? Math.min.apply(null, scored) : 0
    defects = dedupe(found)
    prevScores = scoreBrief(verdicts) // carried into the next round's maker AND checker
    const open = blockingOpen(defects, true) // [E-10] doc nodes veto on `critical` only
    // [R-REP-07] A round whose SCORE cleared the bar and was stopped by an open defect anyway is a
    // VETO ROUND — the one case where severity decides a node's fate by itself. Severity is the
    // least-anchored signal a checker emits (scores are anchored per criterion, severity is not),
    // which is why [E-10] already narrowed what it may veto on. SPEC §12 has called the veto's
    // real-world weight "still unmeasured" since v0.1.2 and four runs added no data — not because
    // it never bound, but because nothing wrote it down. A reader sees a score and a round count,
    // and those cannot tell a veto round from a round that simply scored badly. The datum costs
    // one boolean; whether the veto earns its rubber-stamping risk cannot be judged until the
    // count exists.
    const veto = !binaryFailed && score >= bar && open.length > 0
    // [R-REP-08] The margin and the criteria that cost it, recorded on the round rather than fed
    // forward and forgotten. A first-round pass is the case where this is the ONLY record.
    const low = criterionLows(node.rubric, verdicts)
    history.push({
      round: round,
      score: score,
      margin: Math.round((score - bar) * 100) / 100,
      defects: defects.length,
      open: open.length,
      binaryFailed: binaryFailed,
      veto: veto,
      low: low,
    })

    log(
      `${label} round ${round}/${node.rounds}: score ${score} (bar ${bar}), ` +
        `${defects.length} defect(s), ${open.length} critical/high` +
        (binaryFailed ? ', BINARY CHECKER RED' : '') +
        (veto ? ' — VETO ROUND: the score cleared the bar, an open defect stopped it anyway [R-REP-07]' : '')
    )

    if (hard) {
      return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: lastGoodMaker, history: history, reason: 'a checker could not judge the work at all' }
    }
    if (!binaryFailed && score >= bar && open.length === 0) {
      return { node: node.id, verdict: 'pass', score: score, rounds: round, defects: [], maker: lastGoodMaker, history: history, disputed: (lastGoodMaker && lastGoodMaker.disputed) || [] }
    }
    if (binaryFailed && round === node.rounds) {
      // The executable oracle is not arbitrable: no arbiter may sign off over a red suite.
      return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: lastGoodMaker, history: history, reason: 'binary checker still failing' }
    }

    // [E2-03] The plateau exit lived here and was DELETED. It required three rounds of history to
    // detect a flat run, and E-01 cut the document nodes to two in the same change that added it,
    // so it could never fire: `runLoop` is reached only by `po`, `architect` and `ux`, all at
    // DOC_ROUNDS. It was dead from the day it shipped, and two documents claimed a saving it never
    // delivered. What replaced its intent is the free re-make above: the budget is now two SCORED
    // rounds, which is what makes two rounds enough.
  }

  // Nothing to arbitrate over: no round ever produced the declared artifacts, so a "best
  // available decision" would be a decision about a file that does not exist.
  if (!lastGoodMaker) {
    return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: null, history: history, reason: 'the maker never produced the declared artifacts' }
  }

  return {
    node: node.id,
    verdict: 'needs-arbitration',
    score: score,
    rounds: round,
    defects: defects,
    maker: lastGoodMaker,
    history: history,
    disputed: lastGoodMaker.disputed || [],
  }
}

// [R-LOOP-07] Exactly one arbiter call per node, and its verdict is soft-pass — never pass.
async function arbitrate(node, result) {
  const decision = await spawn(arbiterPrompt(node, result.defects, result.rounds), {
    agentType: at(node.arbiter.agent),
    model: node.arbiter.model,
    effort: node.arbiter.effort,
    schema: ARBITER,
    label: labelFor('arbiter'),
    phase: groupFor(node, node.id),
  })
  if (!decision) {
    log(`${node.id}: the arbiter itself returned nothing — recorded as a hard fail rather than a silent pass.`)
    return Object.assign({}, result, { verdict: 'hard-fail', reason: 'arbiter returned nothing' })
  }
  const records = decision.records || []
  log(`${node.id}: soft-pass at ${result.score} after ${result.rounds} rounds — ${records.length} human-verify record(s).`)
  return Object.assign({}, result, {
    verdict: 'soft-pass',
    arbitrated: true,
    vh: records.map((r) => r.id).filter(Boolean),
  })
}

// ─────────────────────────────────────────────────────── build node ────
// Slices are scheduled by DEPENDENCY LEVEL. Independent slices may build concurrently, each in its
// own git worktree, but only where a fresh tree can actually be tested — which needs a declared
// `commands.install`, because a new worktree has no installed dependencies. Without it the engine
// builds one slice at a time in the session's own checkout, and says so rather than degrading
// quietly. Either way `[R-BUILD-07]` holds PER SLICE: developer, tester and reviewer all inspect
// exactly one tree, and it is the same one.
// Which branch a slice is cut from. A slice with `Blocked by:` needs its blocker's CODE, not just
// its issue file: cut it from BASE and the acceptance test runs against a tree where the blocker
// never happened. Slices arrive in dependency order, so a blocker has already shipped (or this
// slice was skipped). Picking the LAST blocker in that order matters — blockers are themselves
// stacked, so the last one's branch already contains the earlier ones.
function baseFor(slice, branchOf, order) {
  const shippedBlockers = (slice.blockedBy || []).filter((b) => branchOf[b])
  if (!shippedBlockers.length) return BASE
  shippedBlockers.sort((a, b) => order[a] - order[b])
  return branchOf[shippedBlockers[shippedBlockers.length - 1]]
}

function developerPrompt(slice, cfg, defects, attempt, rounds, base, wt, prevScores) {
  const install = String((cfg.commands || {}).install || '').trim()
  const real = actionable(defects)
  const stalled = harnessOnly(defects)
  const repair = real.length
    ? `\nRepair attempt ${attempt} of ${rounds}. The independent checkers refuted the previous attempt.\n` +
      `Fix EVERY defect; do not regress what passed:\n${JSON.stringify(real)}\n`
    : stalled.length
    ? `\nAttempt ${attempt} of ${rounds}. The previous attempt could not be VERIFIED: ` +
      `${stalled.map((d) => d.evidence).join('; ')}.\n` +
      `That is a harness failure, not a defect found in your code. Your commit stands; re-check it\n` +
      `against the acceptance criteria and the full test command, and fix only what is wrong.\n`
    : `\nAttempt ${attempt} of ${rounds} — first build of this slice.\n`
  return (
    `You are the \`sdlc2-developer\` persona building slice ${slice.id} of feature "${TITLE}".\n\n` +
    `MANDATE — build this ONE vertical slice OUTSIDE-IN. Read and follow sdlc2's own discipline at\n` +
    `${ROOT}/skills/outside-in-tdd/SKILL.md (use that file, not any similarly named skill installed\n` +
    `globally). One Gherkin scenario from the issue becomes ONE failing acceptance test at the\n` +
    `declared seam; keep it red while inner red-green-refactor cycles drive it green.\n` +
    repair +
    `\nREAD:\n  - ${slice.path}   (the issue — its \`## Acceptance criteria\` Gherkin IS the contract)\n` +
    // [E2-13] The contract is read-only to the party being judged.
    `      THAT FILE IS READ-ONLY TO YOU. Never edit it, never narrow a scenario, never delete a\n` +
    `      step — the tester scores you against it, so editing it moves your own bar. If a\n` +
    `      criterion genuinely CANNOT be executed on this branch (it drives a control another\n` +
    `      slice introduces, say), do not shrink it and do not ship it as an unexecuted todo:\n` +
    `      report it in \`amendments\` with the criterion, why this branch cannot run it, and what\n` +
    `      is owed and where it must land. That is a real outcome the engine records; a quiet\n` +
    `      rewrite is indistinguishable from deleting the assertion that would not go green.\n` +
    `  - ${SEED}\n  - ${DESIGN}   (the architecture, and the seam named for THIS slice)\n` +
    `  - ${MOCKUP}   (frontend work: match its structure, states and controls — not its CSS)\n` +
    `  - ${VH}   (if present — decisions already taken under caveat)\n` +
    `\n${conventions(cfg)}` +
    // [E2-07] Which criterion actually cost the last attempt. Without it a developer on attempt 4
    // sees the surviving defects and never learns which rubric line it is losing on.
    (prevScores ? `\nHOW THE LAST ATTEMPT SCORED YOU (criterion: score — why):\n${prevScores}\n` : '') +
    `\nYOU OWN GIT FOR THIS SLICE — the isolation invariant is non-negotiable, and the tester\n` +
    `asserts it with real git commands before it looks at anything else:\n` +
    (wt
      ? `1. This slice is being built CONCURRENTLY with others, so it gets its OWN working tree.\n` +
        `   Create it and its branch in one step, from the main checkout:\n` +
        `     \`git worktree add ${wt} -b slice/${FEATURE}/${slice.id} ${base}\`\n` +
        `   (if that path already exists from an earlier attempt, reuse it — do not delete it).\n` +
        `   EVERY git and build command from here runs against that tree: use \`git -C ${wt} …\`\n` +
        `   and run the test command with ${wt} as the working directory. Do NOT \`git checkout\`\n` +
        `   in the main tree — another slice's developer is working there right now.\n` +
        (install
          ? `1b. Install dependencies in the new tree FIRST — a fresh worktree has no build output\n` +
            `   or package directory, so the suite cannot run until you do:  \`${install}\`\n`
          : '') +
        `   The check is \`git -C ${wt} merge-base --is-ancestor ${base} HEAD\` succeeding while no\n` +
        `   OTHER 'slice/${FEATURE}/*' branch is an ancestor of HEAD, and\n` +
        `   \`git -C ${wt} branch --show-current\` equal to the slice branch before EVERY commit.\n`
      : `1. Create branch 'slice/${FEATURE}/${slice.id}' off '${base}' and switch to it (if it already\n` +
        `   exists, switch to it). Cut it from '${base}' EXACTLY — not from whatever branch you happen\n` +
        `   to be standing on, and not from the slice you built last. Run\n` +
        `   \`git checkout ${base} && git checkout -b slice/${FEATURE}/${slice.id}\` from a clean tree;\n` +
        `   the check is \`git merge-base --is-ancestor ${base} HEAD\` succeeding while no OTHER\n` +
        `   'slice/${FEATURE}/*' branch is an ancestor of HEAD.\n` +
        `   NEVER commit while HEAD is '${base}' or detached at its tip: assert\n` +
        `   \`git branch --show-current\` equals the slice branch before EVERY commit.\n`) +
    `2. '${BASE}' must not move. Do not merge, rebase onto it, or push anything.\n` +
    `3. Commit only when the acceptance test and the full test command are green.\n` +
    `4. LEAVE HEAD ON THE SLICE BRANCH when you finish — two read-only checkers inspect this same\n` +
    `   working tree next and neither may switch branches.\n` +
    `5. Touch only what this slice needs. Leave the tree clean — no stray files, no debug output.\n` +
    `\nReturn the structured BUILD object: committed, sha, branch, and a short changelog.`
  )
}

// [E2-13] The tester's contract is the issue as WRITTEN. A criterion it cannot execute is a
// finding, never a criterion to quietly drop.
function testerPrompt(slice, cfg, base, mustContain, mustNotContain, wt) {
  // [E-07] When the slice was built in its own worktree, every git command and the test command
  // itself must target THAT tree. `[R-BUILD-07]` is unchanged in substance: the developer, the
  // tester and the reviewer still inspect exactly one tree — it is simply this slice's tree
  // rather than the session's, which is what lets sibling slices run at the same time.
  const g = wt ? `git -C ${wt}` : 'git'
  return (
    `You are the \`sdlc2-tester\` persona. You did not build this slice and you verify it cold.\n\n` +
    `MANDATE — CONFIRM OR REFUTE slice ${slice.id} against its acceptance criteria using EXECUTABLE\n` +
    `ground truth. You are the only oracle in this graph with real evidence; a red suite is not\n` +
    `negotiable and cannot be waived by anyone. Default to FAIL on any unverified criterion.\n` +
    `\nREAD:\n  - ${slice.path}   (map EVERY Gherkin scenario to an observable check)\n  - ${SEED}\n` +
    `\n${conventions(cfg)}` +
    `\nMETHOD:\n` +
    (wt
      ? `0. This slice was built in its OWN working tree at ${wt}. Run every git command as\n` +
        `   \`${g} …\`, and run the test command with ${wt} as the working directory. Never touch\n` +
        `   the session's main checkout: other slices are being built there and beside you.\n`
      : '') +
    `1. HEAD is ALREADY on 'slice/${FEATURE}/${slice.id}'. Assert it with\n` +
    `   \`${g} branch --show-current\` and STOP if it is anything else — do not switch, stash, or\n` +
    `   otherwise move the working tree: a code reviewer is reading the same tree right now.\n` +
    `1a. ASSERT THE GRAPH ITSELF, BEFORE THE BRANCH. The engine was told this slice is blocked by:\n` +
    `   ${(slice.blockedBy || []).length ? (slice.blockedBy || []).join(', ') : 'NOTHING'}\n` +
    `   Open ${slice.path} and read its \`## Blocked by\` section. If the file names a different\n` +
    `   set — one blocker more, one fewer, or a different one — that is a CRITICAL defect named\n` +
    `   \`slice-graph-mismatch\`. Quote both lists verbatim.\n` +
    `   This check exists because everything below it is derived from the list above, so without\n` +
    `   reading the file you would only be confirming that the branch matches a graph that may\n` +
    `   itself be wrong. The issue files are the single source of truth for the queue. Report the\n` +
    `   mismatch and keep going; never edit the issue file, and never re-cut the branch.\n` +
    `1b. ASSERT THE BRANCH TOPOLOGY before you judge any behaviour. This slice was to be cut from\n` +
    `   '${base}'. These commands are read-only; run them and quote their real exit status:\n` +
    `     - \`${g} merge-base --is-ancestor ${base} HEAD\` MUST exit 0.\n` +
    (mustContain.length
      ? `     - each of these MUST also be an ancestor of HEAD (\`${g} merge-base --is-ancestor <b> HEAD\`\n` +
        `       exits 0), because this slice is blocked by them:\n${pathList(mustContain)}\n`
      : '') +
    (mustNotContain.length
      ? `     - each of these MUST NOT be an ancestor of HEAD (the same command exits NON-zero) —\n` +
        `       they are other slices this one does not depend on:\n${pathList(mustNotContain)}\n`
      : '') +
    `   Any failure here is a CRITICAL defect named \`slice-branch-base\`: the branch carries code\n` +
    `   this slice does not own, so neither your green suite nor the reviewer's diff means what it\n` +
    `   appears to mean. Report it and keep going — still run the suite, so the developer gets the\n` +
    `   whole picture in one round.\n` +
    `2. Run the test command above. Report failures with real output, never paraphrased.\n` +
    `3. Map every acceptance criterion to a check that actually ran. An unverified criterion is a\n` +
    `   defect, not a pass.\n` +
    `4. Probe the edges the developer did not: boundaries, error paths, empty and duplicate input.\n` +
    `5. If the slice changed existing behaviour, a regression net around the blast radius must\n` +
    `   exist and be green. A silently edited existing test is a critical defect.\n` +
    `\nSet \`pass\` true ONLY if the suite is green AND every acceptance criterion is verified.\n` +
    `You are read-only: never fix anything, never edit a test to make it pass.\n` +
    `Every defect needs quoted evidence (real command output or a real assertion).\n` +
    `Score every rubric criterion as well — the engine scores a missing id as zero.\n` +
    `\nReturn the structured VERDICT object with \`pass\` set.`
  )
}

function reviewerPrompt(slice, cfg, base, wt, alsoContains, prior) {
  const g = wt ? `git -C ${wt}` : 'git' // [E-07] — as the tester; same tree, read-only
  return (
    `You are the \`sdlc2-code-reviewer\` persona reviewing the code of slice ${slice.id}.\n\n` +
    `MANDATE — REFUTE the quality of this code. You judge craft, not whether it works (the tester\n` +
    `owns that). Every finding cites file:line and a NAMED principle.\n` +
    // [E2-04] "Default to FAIL when unsure" used to sit here. It belongs to a BINARY checker whose
    // ground truth is executable; this one SCORES, and for a scorer it silently drags every
    // criterion it did not fully examine downward. E-03 removed it from `checkerPrompt` and from
    // all four scoring personas and missed this hand-written prompt, which then contradicted
    // `agents/sdlc2-code-reviewer.md` for two releases.
    `Score what you can evidence, and do not penalise the developer for what you did not check.\n` +
    `A clean pass with zero defects is a legitimate verdict — say so when you find one.\n` +
    `You are READ-ONLY and you have not seen the tester's verdict.\n` +
    `\nREAD: the diff of branch 'slice/${FEATURE}/${slice.id}' against '${base}'\n` +
    `  (\`${g} diff ${base}...slice/${FEATURE}/${slice.id}\`), plus ${slice.path} and ${DESIGN}.\n` +
    (base === BASE
      ? ''
      : `This slice is stacked on '${base}' because it is blocked by it. Diff against '${base}',\n` +
        `NOT against '${BASE}': the blocker's code is context you have already reviewed, and\n` +
        `re-reporting it as this slice's work wastes the round.\n`) +
    // [E2-16] `baseFor` cuts a slice from ONE blocker, so a slice that declares several has the
    // others merged into its own branch by the developer — and they are inside `base...branch`.
    // Run 3's slice 07 declared five blockers, was cut from one, and was scored 0.94 on a diff
    // holding three other slices' code. The engine already computes this list for the tester; it
    // simply never told the reviewer.
    ((alsoContains && alsoContains.length)
      ? `This slice declares more than one blocker. It was cut from '${base}', and the developer\n` +
        `merged the following in, so their commits are inside the diff above and are NOT this\n` +
        `slice's work — each was reviewed on its own branch already:\n` +
        pathList(alsoContains) +
        `\nExclude everything reachable from those branches. \`${g} log ${base}..HEAD --no-merges\`\n` +
        `minus their commits is this slice's actual contribution.\n`
      : '') +
    `Read-only on git too: \`${g} diff\` / \`${g} show\` / \`${g} log\` only. Never checkout, switch,\n` +
    `stash or reset — the tester is running the suite in this same working tree right now.\n` +
    `\n${conventions(cfg)}` +
    // [E2-07] The previous attempt's per-criterion scores. E-05 gave document checkers this and
    // the build loop never got it, even though it runs up to 5 attempts where a doc node runs 2.
    ((prior)
      ? `\nHOW THE PREVIOUS ATTEMPT SCORED (the last verdict on this slice, not another checker's):\n${prior}\n` +
        `Verify each claimed fix with FRESH evidence. You may raise a score freely. Do NOT lower one\n` +
        `without quoting the regression that justifies it.\n`
      : '') +
    `\nScore ONLY what this slice changed — pre-existing debt elsewhere is out of scope and\n` +
    `reporting it wastes a round.\n` +
    `\nRUBRIC — score each 0..1 using its anchors; a missing id is scored zero. Do not compute a\n` +
    `total:\n${rubricTable('build')}\n` +
    `\nReturn the structured VERDICT object.`
  )
}

function buildArbiterPrompt(slice, defects, rounds) {
  return (
    `You are the \`sdlc2-developer\` persona in DECIDE MODE for slice ${slice.id}.\n\n` +
    `MANDATE — the test suite is GREEN and the acceptance criteria are verified, but the code\n` +
    `reviewer's findings survived ${rounds} rounds. Decide, per finding, whether the slice ships\n` +
    `with that debt recorded, or whether the debt is too large to ship and a human must take it.\n` +
    `\nUnresolved code-review findings:\n${JSON.stringify(defects)}\n` +
    `\nYOU ARE DECIDING, NOT BUILDING. Do NOT edit code and do NOT commit. [E-04]\n` +
    `The sha that ships is the one the tester actually verified; if you commit on top of it, the\n` +
    `slice would ship a commit no oracle ever saw, and 'the arbiter re-ran the tests' is exactly\n` +
    `the kind of instruction-without-assertion this graph does not count as evidence.\n` +
    `\n1. APPEND one record per ACCEPTED finding to ${VH}. [E-08] You own the id prefix\n` +
    `   \`VH-build-${slice.id}-\` and nothing else — other slices are being arbitrated beside you,\n` +
    `   so number within YOUR prefix, append only, and never renumber or rewrite another row.\n` +
    `   Each accepted item MUST name the file:line and the violated principle, plus Decision,\n` +
    `   Rationale, Risk if wrong, and What would change my mind.\n` +
    `2. Set \`finalized\`: true if this slice should SHIP with the debt you recorded; false if the\n` +
    `   surviving findings are too serious to accept, in which case the slice is escalated to a\n` +
    `   human with its branch intact and nothing is recorded as shipped.\n` +
    `\nReturn the structured ARBITER object.`
  )
}

function escalationPrompt(slice, reason, attempts, defects) {
  const why = {
    'no-commit': `the developer never reached a green commit in ${attempts} attempt(s), so there is nothing to test and no branch to review`,
    'tester-red': `the tester never went green in ${attempts} attempt(s)`,
    'tester-silent': `the tester never returned a verdict in ${attempts} attempt(s) — the slice is UNVERIFIED, which is not the same as failing`,
    unjudgeable: `a checker reported it could not judge the slice at all after ${attempts} attempt(s)`,
  }[reason] || `it failed after ${attempts} attempt(s) for reason \`${reason}\``
  return (
    `Escalate sdlc2 slice ${slice.id} (${slice.path}). Append a dated \`## Status\` note to that\n` +
    `issue file recording: needs a human, reason \`${reason}\` — ${why} — and these unresolved\n` +
    `defects: ${JSON.stringify(defects)}. Say plainly which of "no commit was ever made" or "the\n` +
    `suite stayed red" applies, so nobody hunts for a failing test that does not exist.\n` +
    `Leave the branch 'slice/${FEATURE}/${slice.id}' unmerged and modify no other file.`
  )
}

async function buildSlices(node) {
  const testerRole = node.checkers.filter((c) => c.binary)[0]
  const reviewRole = node.checkers.filter((c) => !c.binary)[0]
  const bar = RUBRICS[node.rubric].threshold
  const rounds = node.rounds

  // [E-13] The product owner already knows what it queued — it wrote the issue files. Re-deriving
  // that with a separate agent put a serial round-trip on the critical path to learn nothing new.
  // The resolver spawn stays as the fallback for a po that omitted the manifest.
  const manifest =
    results.po && results.po.maker && Array.isArray(results.po.maker.slices)
      // [R-BUILD-04b] `blockedBy` is checked here too, not just in the schema: an entry without it
      // is a slice whose place in the graph nobody stated, and taking it would silently level the
      // whole queue at 0.
      ? results.po.maker.slices.filter((x) => x && x.id && x.path && x.title && Array.isArray(x.blockedBy))
      : []
  const plan = manifest.length ? { slices: manifest } : await spawn(
    `Enumerate the queued slices for feature "${FEATURE}".\n\n` +
      `Read every file in ${ISSUES}/ (they were written by the product-owner node). For each, return:\n` +
      `  id        — the NN-slug from the filename\n` +
      `  path      — the file path\n` +
      `  title     — its title line\n` +
      `  dir       — the value of its \`Dir:\` line if present (the directory it mainly touches), else ""\n` +
      `  ui        — true if this slice renders or changes a USER INTERFACE (its acceptance\n` +
      `              criteria describe what a person sees or does on a screen); false if it is\n` +
      `              backend, domain or infrastructure only. Be accurate: a slice marked false\n` +
      `              starts without waiting for the UX design, so a wrong answer builds a screen\n` +
      `              against no design at all.\n` +
      `  blockedBy — the ids on its \`Blocked by:\` line, else []\n` +
      `Return them in dependency order: a slice must appear after everything it is blocked by.\n` +
      `Do not invent slices and do not modify any file.`,
    // [E-09] `medium`: this single unchecked call determines the entire branch topology, a larger
    // blast radius than any checker in the graph, and it was the cheapest tier in the engine.
    { schema: SLICES, model: 'sonnet', effort: 'medium', label: labelFor('resolve-slices'), phase: groupFor(node) }
  )
  if (manifest.length) log(`${manifest.length} slice(s) taken from the product owner's own manifest — no resolver round-trip.`)
  // [SD-11] Applied to BOTH paths. The resolver is *told* the id is the NN-slug from the filename,
  // but an instruction is not a guarantee — which is the whole reason the fast path drifted.
  const slices = canonicalSliceIds((plan && plan.slices) || [], log)
  if (!slices.length) {
    log('No slices found — the product-owner node produced no issues.')
    return { node: node.id, verdict: 'hard-fail', score: null, rounds: 0, reason: 'no slices queued', slices: { shipped: [], escalated: [], skipped: [], rows: [], lanes: null } }
  }
  // [E-07] Dependency LEVELS. Iterated to a fixpoint rather than assumed from arrival order: the
  // manifest above is whatever the po returned, and a slice listed before its blocker would
  // otherwise be levelled 0 and built against a tree where the blocker never happened. The pass
  // cap also means a cycle degrades to "everything at some level" instead of looping forever.
  const levelOf = Object.create(null)
  for (const sl of slices) levelOf[sl.id] = 0
  for (let pass = 0; pass < slices.length; pass++) {
    let moved = false
    for (const sl of slices) {
      let lv = 0
      for (const b of sl.blockedBy || []) {
        if (levelOf[b] !== undefined) lv = Math.max(lv, levelOf[b] + 1)
      }
      if (lv !== levelOf[sl.id]) {
        levelOf[sl.id] = lv
        moved = true
      }
    }
    if (!moved) break
  }
  // Stable sort into dependency order, so `order` (which decides which blocker a stacked slice is
  // cut from) and the build sequence agree with the levels.
  slices.sort((a, b) => levelOf[a.id] - levelOf[b.id])
  log(`${slices.length} slice(s) queued off ${BASE} in ${Math.max.apply(null, slices.map((x) => levelOf[x.id])) + 1} dependency wave(s), stacking any slice on the blocker it declares.`)
  // [E2-12] What an already-settled step said about this plan, BEFORE forty agents act on it. In
  // run 3 the architect correctly refuted issue 06's queue, filed it against the `po` node exactly
  // as [SD-07] requires — and the build then executed the refuted queue anyway, because the graph
  // runs forward and nothing reads a dispute. This does not make the graph go backwards. It puts
  // the finding in front of the person watching, at the one moment acting on it is still free.
  upstreamDisputes().forEach(log)
  // [E2-11] The slice table. Every column below is already in memory at this point.
  sliceTableLines(slices, levelOf).forEach(log)

  const shipped = []
  const escalated = []
  const amendments = [] // [E2-13] acceptance criteria a slice could not execute, and what is owed
  // [E-13] Escalation notes were awaited one at a time inside the slice loop, putting a serial
  // agent round-trip on the critical path for every failure. They are pure side-effect writes to
  // separate issue files, so they are collected here and flushed concurrently once building ends.
  const escalations = []
  const worktrees = [] // [E-07] paths to release once every slice is done
  const skipped = []
  const rows = []
  const done = Object.create(null) // id → shipped?
  const known = Object.create(null)
  const branchOf = Object.create(null) // id → the branch a shipped slice actually landed on
  const order = Object.create(null) // id → its position in dependency order
  slices.forEach((s, i) => {
    known[s.id] = true
    order[s.id] = i
  })

  // [E-07] One slice, start to finish. `wt` is '' when it is built in the session's own checkout
  // (the sequential path, unchanged) or a worktree path when it is running beside its siblings.
  // It never throws: a crash here must escalate one slice, not abort the whole build node.
  async function runSlice(slice, wt) {
    const blockers = slice.blockedBy || []
    const failedBlockers = blockers.filter((b) => done[b] === false)
    const unknownBlockers = blockers.filter((b) => !known[b])
    const budgetSpent = budget.total && budget.remaining() < BUDGET_FLOOR

    let skipReason = null
    if (failedBlockers.length) skipReason = `blocker-failed (${failedBlockers.join(', ')})`
    else if (unknownBlockers.length) skipReason = `blocker-unknown (${unknownBlockers.join(', ')} — no such slice)`
    else if (budgetSpent) skipReason = 'budget'
    if (skipReason) {
      log(`Skipping ${slice.id} — ${skipReason}.`)
      skipped.push({ id: slice.id, reason: skipReason })
      rows.push({ id: slice.id, attempts: 0, verdict: 'skipped', reason: skipReason })
      done[slice.id] = false
      return
    }

    // [E-12] A slice that renders a UI needs the ux node's state matrix and mockup; a backend
    // slice needs neither and used to wait for it anyway, because `build` joined on BOTH design
    // nodes. The join is per slice now: backend work starts as soon as the architecture lands.
    if (slice.ui === true) {
      const uxResult = await whenSettled('ux')
      // [E2-06] A GATED ux is the case this join exists for, and it was the one case it let
      // through: `blocksSuccessors` returns false for a gated node — correct in general, since a
      // feature with no screens must not block its build — so a slice explicitly marked ui:true
      // used to build with no state matrix and no mockup, silently. The po's own two answers
      // disagree; that is not a reason to guess, and it is certainly not a reason to say nothing.
      if (uxResult && uxResult.gated === true) {
        log(`Skipping ${slice.id} — it is marked ui:true, but the po set hasUiStories false so the ux node never ran. The two disagree; building a screen against no design is not the way to resolve that. [E2-06]`)
        skipped.push({ id: slice.id, reason: 'ux-gated-off-but-slice-is-ui' })
        rows.push({ id: slice.id, attempts: 0, verdict: 'skipped', reason: 'ux-gated-off-but-slice-is-ui' })
        done[slice.id] = false
        return
      }
      if (blocksSuccessors(uxResult)) {
        log(`Skipping ${slice.id} — it is a UI slice and the ux node did not pass.`)
        skipped.push({ id: slice.id, reason: 'ux-not-passed' })
        rows.push({ id: slice.id, attempts: 0, verdict: 'skipped', reason: 'ux-not-passed' })
        done[slice.id] = false
        return
      }
    }
    if (wt) worktrees.push(wt)

    const cfg = configFor(slice.dir)
    // The tester enforces this with real git commands; the developer's word is not evidence.
    const base = baseFor(slice, branchOf, order)
    const mustContain = (slice.blockedBy || []).map((b) => branchOf[b]).filter((b) => b && b !== base)
    const mustNotContain = Object.keys(branchOf)
      .filter((id) => (slice.blockedBy || []).indexOf(id) < 0)
      .map((id) => branchOf[id])
      .filter((b) => b && b !== base && mustContain.indexOf(b) < 0)
    if (base !== BASE) log(`${slice.id}: stacked on ${base} (blocked by ${(slice.blockedBy || []).join(', ')}).`)
    let defects = []
    let lastGood = null // the last build that actually COMMITTED — never the last agent return
    let attempt = 0
    let testerPass = false
    let reviewScore = 0
    // What the MOST RECENT attempt actually ended in. The escalation note quotes this, so a slice
    // that never compiled is never reported as a failing test suite.
    let outcome = 'no-commit'
    let prevScores = '' // [E2-07] last attempt's per-criterion review scores; '' on attempt 1
    // [R-REP-07] How many of this slice's attempts were VETO attempts — tester green, review score
    // at or above the bar, and an open critical/high stopped it anyway. `outcome` already calls
    // that case `craft-debt`, but `craft-debt` also covers a review that simply scored below the
    // bar, so the two are indistinguishable in the report. Counting them apart is what lets a run
    // answer whether the severity veto ever binds on its own.
    let vetoed = 0
    let reviewLow = [] // [R-REP-08] the criteria that cost the last attempt its margin
    let reviewMargin = null

    while (attempt < rounds) {
      attempt++
      const build = await spawn(developerPrompt(slice, cfg, defects, attempt, rounds, base, wt, prevScores), {
        agentType: at(node.maker.agent),
        model: node.maker.model,
        effort: node.maker.effort,
        schema: BUILD,
        label: labelFor(roleOf(node.maker.agent), attempt, rounds),
        phase: groupFor(node, slice.id),
      })
      // [E2-05] Two different events used to share this branch: a developer that never ANSWERED
      // (transport — `spawn` already retried it free and failed) and a developer that answered and
      // said it could not commit (content). Both produced an ordinary defect, so the next attempt
      // opened with "the independent checkers refuted the previous attempt" over a dropped
      // connection. That is the exact failure [SD-05] ended in `runLoop`, one layer down.
      if (!build) {
        testerPass = false
        outcome = 'developer-silent'
        defects = [harnessDefect(slice.id, 'the developer spawn never answered — a transport failure, already retried once', 're-run the slice')]
        log(`${slice.id}: the developer spawn never answered (attempt ${attempt}/${rounds}) — recorded as errored, not as a defect in its work. [E2-05]`)
        continue
      }
      if (build.committed !== true) {
        testerPass = false // nothing was tested this round; do not carry a stale green
        outcome = 'no-commit'
        defects = [engineDefect(slice.id, build.notes || 'developer did not reach a green commit', 'reach green and commit on the slice branch')]
        log(`${slice.id}: no commit (attempt ${attempt}/${rounds}).`)
        continue
      }
      lastGood = build
      // [E2-13] An amendment is a decision about the product contract. It survives into the row and
      // the report; it is never just a note in a changelog nobody re-reads.
      if (Array.isArray(build.amendments) && build.amendments.length) {
        for (const a of build.amendments) {
          log(`⚠ ${slice.id}: the developer says an acceptance criterion cannot be met on this branch — "${String(a.criterion || '').slice(0, 120)}". Owed: ${String(a.owed || 'not stated').slice(0, 160)} [E2-13]`)
        }
        amendments.push({ slice: slice.id, items: build.amendments })
      }

      const verdicts = await parallel([
        () => spawn(testerPrompt(slice, cfg, base, mustContain, mustNotContain, wt), {
          agentType: at(testerRole.agent), model: testerRole.model, effort: testerRole.effort,
          schema: verdictSchema(testerRole), label: labelFor(roleOf(testerRole.agent), attempt, rounds), phase: groupFor(node, slice.id),
        }),
        () => spawn(reviewerPrompt(slice, cfg, base, wt, mustContain, prevScores), {
          agentType: at(reviewRole.agent), model: reviewRole.model, effort: reviewRole.effort,
          schema: verdictSchema(reviewRole), label: labelFor(roleOf(reviewRole.agent), attempt, rounds), phase: groupFor(node, slice.id),
        }),
      ])
      const tv = verdicts[0]
      const rv = verdicts[1]

      // [R-LOOP-08] Silence from a checker is a critical defect, not an absent opinion.
      const missing = []
      if (!tv) missing.push(harnessDefect(testerRole.agent, 'the tester returned no verdict — the slice is UNVERIFIED, which is not the same as green', 're-run the tester'))
      if (!rv) missing.push(harnessDefect(reviewRole.agent, 'the code reviewer returned no verdict', 're-run the reviewer'))

      const testerDefects = cleanDefects(tv, `test:${slice.id}`)
      testerPass = !!(tv && tv.pass === true)
      // An oracle that passes the slice AND files a critical defect against it has contradicted
      // itself. Resolve the contradiction the safe way: red.
      if (testerPass && blockingOpen(testerDefects).length) {
        testerPass = false
        log(`${slice.id}: tester returned pass:true alongside ${blockingOpen(testerDefects).length} critical/high defect(s) — treating as RED.`)
      }
      reviewScore = rv ? weightedTotal(node.rubric, rv) : 0
      prevScores = scoreBrief([rv]) // [E2-07] carried into the next attempt's developer AND reviewer
      const all = dedupe(testerDefects.concat(cleanDefects(rv, `review:${slice.id}`)).concat(missing))
      const open = blockingOpen(all)
      const veto = testerPass && reviewScore >= bar && open.length > 0 // [R-REP-07]
      if (veto) vetoed++
      // [R-REP-08] Same reasoning one layer down: a slice that ships on attempt 1 is the case where
      // the reviewer's per-criterion verdict is computed once and never seen by anyone.
      reviewLow = criterionLows(node.rubric, [rv])
      reviewMargin = Math.round((reviewScore - bar) * 100) / 100

      log(
        `${slice.id} attempt ${attempt}/${rounds}: tester ${testerPass ? 'GREEN' : 'RED'}, ` +
          `code-review ${reviewScore} (bar ${bar}), ${open.length} critical/high` +
          (missing.length ? `, ${missing.length} checker(s) silent` : '') +
          (veto ? ' — VETO ATTEMPT: green suite, review at bar, an open defect stopped it anyway [R-REP-07]' : '')
      )

      if (testerPass && reviewScore >= bar && open.length === 0) {
        shipped.push({ id: slice.id, branch: build.branch, sha: build.sha })
        rows.push({ id: slice.id, attempts: attempt, verdict: 'pass', sha: build.sha, branch: build.branch, review: reviewScore, base: base, vetoed: vetoed, reviewLow: reviewLow, reviewMargin: reviewMargin })
        done[slice.id] = true
        // The CANONICAL name, not the developer's reported one: the tester asserted HEAD is on
        // exactly this branch, so it is the only branch name in this loop backed by evidence.
        branchOf[slice.id] = `slice/${FEATURE}/${slice.id}`
        log(`✓ ${slice.id} shipped on ${build.branch} @ ${build.sha || '?'}`)
        break
      }
      defects = all
      outcome = !tv ? 'tester-silent' : testerPass ? 'craft-debt' : 'tester-red'
      if ((tv && tv.hard === true) || (rv && rv.hard === true)) {
        outcome = 'unjudgeable'
        log(`${slice.id}: a checker reported it cannot judge this slice — ending the attempts early.`)
        break
      }
    }

    if (done[slice.id] === true) return

    // Escalate on the REAL reason — whatever the LAST attempt ended in. `lastGood` is the only
    // proof a commit exists, and testerPass is only meaningful when it does.
    if (outcome !== 'craft-debt' || !lastGood || !testerPass) {
      // The second and third disjuncts should be unreachable — if they fire, the loop's
      // bookkeeping disagrees with itself and that is worth saying out loud, not papering over.
      const reason = outcome === 'craft-debt' ? 'inconsistent-state' : outcome
      escalated.push({ id: slice.id, defects: defects, reason: reason })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: reason, defects: defects, branch: lastGood ? lastGood.branch : null, vetoed: vetoed })
      done[slice.id] = false
      escalations.push({ slice: slice, reason: reason, attempt: attempt, defects: defects })
      log(`✗ ${slice.id} escalated after ${attempt} attempt(s) — ${reason}.`)
      return
    }

    // Tests green, craft findings survived → arbiter may accept the debt and keep the commit.
    const decision = await spawn(buildArbiterPrompt(slice, defects, rounds), {
      agentType: at(node.arbiter.agent), model: node.arbiter.model, effort: node.arbiter.effort,
      schema: ARBITER, label: labelFor('arbiter'), phase: groupFor(node, slice.id),
    })
    if (!decision) {
      escalated.push({ id: slice.id, defects: defects, reason: 'arbiter-silent' })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: 'arbiter-silent', defects: defects, branch: lastGood.branch, vetoed: vetoed })
      done[slice.id] = false
      log(`✗ ${slice.id}: the arbiter returned nothing — not recording a soft-pass nobody decided.`)
      return
    }
    // [E-04] The arbiter may refuse the debt. It never commits, so `lastGood.sha` is still the
    // exact commit the tester verified — the shipped sha and the verified sha are one commit.
    if (decision.finalized === false) {
      escalated.push({ id: slice.id, defects: defects, reason: 'arbiter-rejected' })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: 'arbiter-rejected', defects: defects, branch: lastGood.branch, vetoed: vetoed })
      done[slice.id] = false
      escalations.push({ slice: slice, reason: 'arbiter-rejected', attempt: attempt, defects: defects })
      log(`✗ ${slice.id}: the arbiter judged the surviving findings too serious to accept — escalated.`)
      return
    }
    const vh = (decision.records || []).map((r) => r.id).filter(Boolean)
    shipped.push({ id: slice.id, branch: lastGood.branch, sha: lastGood.sha, softPass: true, vh: vh })
    rows.push({ id: slice.id, attempts: attempt, verdict: 'soft-pass', sha: lastGood.sha, branch: lastGood.branch, review: reviewScore, vh: vh, base: base, vetoed: vetoed, reviewLow: reviewLow, reviewMargin: reviewMargin })
    done[slice.id] = true
    branchOf[slice.id] = `slice/${FEATURE}/${slice.id}`
    log(`~ ${slice.id} shipped with accepted debt on ${lastGood.branch} (${vh.length} VH record(s)).`)
  }

  // ─────────────────────────────────────────────── the slice scheduler ────
  // [E-07] Slices used to run in a flat line: slice 4 waited on three slices it had no
  // relationship to. They are scheduled by DEPENDENCY LEVEL instead — everything with no
  // unshipped blocker forms level 0 and can run together, level 1 starts as its blockers land.
  //
  // Concurrency is opt-in, because a fresh worktree is a fresh tree: if the test command cannot
  // run in it, a slice fails for a reason that has nothing to do with its code.
  //
  // [R-BUILD-04c] The gate used to ask "is `commands.install` declared?", which is a proxy for the
  // real question and wrong for a whole ecosystem. Maven and Gradle resolve from a shared `~/.m2`
  // or Gradle cache, so a JVM project genuinely needs no install step — and was serialised for
  // having nothing to install, silently losing `E2-14` and the worktree isolation of `SD-04` on
  // every run. The question is whether a fresh worktree is testable. Only the project knows, so
  // the project answers: an install command implies yes, and a deliberately declared `lanes: N > 1`
  // says yes outright. The engine cannot find out for itself — it spawns agents, it does not run
  // commands — so a probe would mean a full test-suite run in the pre-checks on every run forever.
  // The pre-checks ask the human to try one worktree by hand instead, once per project.
  const install = String((CONFIG.commands || {}).install || '').trim()
  // [E2-10] The cap was the bare literal 4, derived from nothing. It is now the project's to set —
  // `lanes:` in the sdlc2 config block — with 4 as the default. Zero or nonsense falls back rather
  // than disabling the build.
  const declaredLanes = Math.floor(Number(CONFIG.lanes))
  const MAX_LANES = declaredLanes > 0 ? declaredLanes : 4
  const byConsent = !install && declaredLanes > 1
  const LANES = install ? MAX_LANES : byConsent ? declaredLanes : 1

  // Bucket the slices by the levels computed above. A slice whose blocker is unknown lands at
  // level 0, which is safe: the `blockedBy` guard inside runSlice still refuses to build it and
  // records `blocker-unknown` instead.
  const levels = []
  for (const sl of slices) {
    const lv = levelOf[sl.id]
    levels[lv] = levels[lv] || []
    levels[lv].push(sl)
  }

  const widest = levels.reduce((m, g) => Math.max(m, (g || []).length), 0)
  // [SD-08 / R-REP-05] What follows was only ever `log()`ed, which reaches the watching human and
  // nothing else: the report — the artifact that outlives the run — never learned whether slices
  // built concurrently or in a line. Record it as data so the report node can state it either way.
  const lanes = { lanes: LANES, install: install || null, opened: install ? 'install' : byConsent ? 'declared-lanes' : null, widest: widest, concurrent: false, batches: [] }
  // [R-BUILD-04c] Every path says which one it took. The consent path in particular is a claim the
  // PROJECT made and the engine cannot check — so a run that acted on it has to be readable as
  // having acted on it, or a slice failing on missing dependencies looks like a slice with a bug.
  if (byConsent) {
    log(`Building up to ${LANES} slices at once because the project declares \`lanes: ${declaredLanes}\` and no \`commands.install\`. That is the project asserting a fresh worktree is testable as checked out — nothing here verifies it. If slices start failing on missing dependencies, that assertion is what to doubt first. [R-BUILD-04c]`)
  } else if (LANES === 1 && widest > 1) {
    log(`${widest} slice(s) are independent and could build concurrently, but the project declares neither \`commands.install\` nor \`lanes: N > 1\`; a fresh worktree may have no dependencies to test against. Building sequentially. Declare either one to open lanes. [R-BUILD-04c]`)
  }

  // [E2-14] Slices are scheduled against THEIR OWN blockers, not against a level. The level loop
  // that used to live here awaited every slice in a level before starting the next, so a slice
  // waited on the slowest unrelated sibling rather than on anything it depends on. Measured in run
  // 3: slice 05 is blocked by 03 and nothing else; 03 landed at 14:46 and 05 started at 15:20, the
  // minute an unrelated slice 06 finished. 34 of 141 minutes — 24% of the run — bought nothing,
  // and the waste grows with the width of the graph because a barrier waits on the maximum.
  //
  // `levelOf` is kept: it is how the report describes the shape, and it is what `order` sorted by.
  // It is no longer what the scheduler waits on.
  const pending = slices.slice()
  const running = Object.create(null) // id → promise
  let started = 0
  // Ready = every declared blocker has SETTLED, either way. A failed or unknown blocker still
  // counts as settled: runSlice's own guard turns it into a `skipped` row, which is a decision, and
  // a decision is not something to wait for.
  const ready = (sl) => (sl.blockedBy || []).every((b) => !known[b] || b in done)
  const runningCount = () => Object.keys(running).length

  while (pending.length || runningCount()) {
    let launched = false
    for (let i = 0; i < pending.length && runningCount() < LANES; ) {
      const sl = pending[i]
      if (!ready(sl)) { i++; continue }
      pending.splice(i, 1)
      // A slice gets its own worktree only when it may actually share the clock with another. The
      // sequential path stays the session's own checkout, exactly as before. [R-BUILD-07]
      const wt = LANES > 1 ? `${WORKTREES}/${sl.id}` : ''
      const withOthers = runningCount() > 0
      if (withOthers) lanes.concurrent = true
      lanes.batches.push({ level: levelOf[sl.id], ids: [sl.id], concurrent: withOthers })
      log(`▸ starting ${sl.id}${withOthers ? ` alongside ${Object.keys(running).join(', ')}` : ''}${wt ? ' in its own worktree' : ''}.`)
      started++
      launched = true
      const pr = runSlice(sl, wt).then(
        () => { delete running[sl.id] },
        (e) => { delete running[sl.id]; log(`${sl.id}: threw — ${(e && e.message) || e}`) }
      )
      running[sl.id] = pr
    }
    if (!runningCount()) {
      if (!pending.length) break
      // Nothing running and nothing ready: every remaining slice is waiting on a blocker that will
      // never settle — a dependency cycle the level fixpoint could not break. Release them to
      // runSlice, which records each as `blocker-unknown` or `blocker-failed` rather than hanging.
      if (!launched) {
        log(`${pending.length} slice(s) can never become ready — their blockers never settle. Recording them rather than waiting forever.`)
        for (const sl of pending.splice(0)) await runSlice(sl, '')
        break
      }
      continue
    }
    await Promise.race(Object.keys(running).map((k) => running[k]))
  }

  // [E-07] Release the worktrees. [SD-04] They live OUTSIDE the repo now, so a stranded one no
  // longer dirties the tree or pollutes the test runner — but it still holds a branch checked out,
  // and the main tree cannot check that branch out while it does. Removing a worktree does not
  // touch its branch: the slice branches are the deliverable and they survive.
  //
  // [E2-08] Two things used to go wrong here and neither could be seen. The agent's answer was
  // discarded, so a half-done cleanup reported as success; and this call sits after the build loop,
  // so a throw anywhere above skipped it entirely and stranded every tree created so far. It is now
  // reached from a finally-equivalent path, and what it says is read.
  const releaseReport = await releaseWorktrees()
  if (releaseReport) lanes.release = releaseReport

  async function releaseWorktrees() {
    if (!worktrees.length) return null
    log(`Releasing ${worktrees.length} slice worktree(s).`)
    const answer = await spawn(
      `Release the sdlc2 slice worktrees for feature "${FEATURE}". For EACH path below run\n` +
        `\`git worktree remove --force <path>\`, then run \`git worktree prune\` once:\n` +
        pathList(worktrees) +
        `\n\nThese paths are OUTSIDE this repository, one directory up — that is deliberate, not a\n` +
        `mistake to correct. After the removals, delete the now-empty container \`${WORKTREES}\`\n` +
        `if and only if it is empty (\`rmdir\` it — never \`rm -rf\`, and never its parent).\n` +
        `\nThen confirm with \`git worktree list\` that only the main checkout remains, and with\n` +
        `\`git branch --list 'slice/${FEATURE}/*'\` that every slice branch is STILL THERE — the\n` +
        `branches are the deliverable; only their working trees are disposable.\n` +
        `Do NOT delete any branch, do not touch '${BASE}', and do not commit anything. If a removal\n` +
        `fails, say which path and why, and stop rather than forcing anything else.\n` +
        `\nReturn the structured RELEASE object: \`released\` true only if \`git worktree list\` now\n` +
        `shows the main checkout ALONE, \`remaining\` listing any path still there, \`branches\`\n` +
        `true only if every slice branch is still present, and [SD-12] \`container\` true only if you\n` +
        `actually removed \`${WORKTREES}\` — false if it is still there for ANY reason, including a\n` +
        `non-empty directory you correctly declined to delete. Do not report a step you did not take.`,
      { model: 'sonnet', effort: 'low', schema: RELEASE, label: labelFor('release-worktrees'), phase: groupFor(node) }
    )
    // [E2-08] Read the answer. A release that failed, half-finished, or never replied is a
    // human-verify item, not a silent success — a stranded worktree holds a branch checked out and
    // the main tree cannot check that branch out while it does.
    if (!answer) {
      log(`⚠ the worktree release never answered. ${worktrees.length} tree(s) may still exist outside the repo — check \`git worktree list\` before the next run. [E2-08]`)
      return { asked: worktrees.length, released: false, verified: false, note: 'the release agent returned nothing' }
    }
    if (answer.released !== true || (answer.remaining || []).length) {
      log(`⚠ the worktree release did not finish: ${(answer.remaining || []).join(', ') || answer.notes || 'reason not stated'}. [E2-08]`)
    } else {
      log(`Worktrees released and verified — only the main checkout remains.`)
    }
    if (answer.branches === false) {
      log(`⚠ the release reports a MISSING slice branch. The branches are the deliverable; the trees were the disposable part. [E2-08]`)
    }
    return { asked: worktrees.length, released: answer.released === true, verified: true, remaining: answer.remaining || [], branches: answer.branches !== false, container: answer.container === true, note: answer.notes || null }
  }

  // [E-13] Flush the escalation notes concurrently. Each writes a `## Status` note to its own
  // issue file, so they cannot collide; a failure here loses a note, never a branch, so the run
  // still reports. They are off the critical path entirely now.
  if (escalations.length) {
    log(`Writing ${escalations.length} escalation note(s).`)
    await parallel(escalations.map((e) => () =>
      spawn(escalationPrompt(e.slice, e.reason, e.attempt, e.defects), {
        model: 'sonnet', effort: 'low', label: labelFor('escalate'), phase: groupFor(node, e.slice.id),
      })
    ))
  }

  const verdict = shipped.length === 0 ? 'hard-fail' : escalated.length || skipped.length ? 'partial' : shipped.some((s) => s.softPass) ? 'soft-pass' : 'pass'
  return {
    node: node.id,
    verdict: verdict,
    score: null,
    rounds: 0,
    slices: { shipped: shipped, escalated: escalated, skipped: skipped, rows: rows, lanes: lanes, amendments: amendments, merge: mergePlan(shipped.map((x) => x.id), slices, levelOf) },
  }
}

// [E2-12] Every dispute an already-settled node raised against another node's artifact. `disputed`
// is where a maker is told to record a defect it believes belongs upstream; until now nothing ever
// read it during the run.
function upstreamDisputes() {
  const out = []
  for (const id of Object.keys(results)) {
    const r = results[id]
    for (const d of (r && r.disputed) || []) {
      out.push(`    ${id} disputes ${d.criterion || 'the plan'} — ${String(d.why || '').replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  }
  if (!out.length) return []
  return [`⚠ ${out.length} unresolved dispute(s) raised by an EARLIER step about this plan. The graph cannot act on them; you can, and it is free right now: [E2-12]`].concat(out)
}

// [E2-11] The slice table, printed once the slices are known and before the first one is built.
// Plain headings on purpose: "Waits for" is readable, `blockedBy` needs you to know the system.
// [R-REP-09] What a human actually has to merge, which is NOT one branch per slice.
//
// A stacked slice's branch contains its blockers': `baseFor` cuts it from the last of them and the
// tester proves every other blocker is an ancestor, so merging a LEAF merges its whole chain. Six
// slices in a chain two wide are two merges, not six — and until now the report never said so,
// leaving the reader to work out the ordering from the `Waits for` column by hand, or to merge six
// branches one at a time and hit "already up to date" four times.
//
// Leaves are computed over the SHIPPED subgraph only: a slice whose blocker escalated was skipped,
// so every shipped slice's blockers shipped too.
function mergePlan(shippedIds, slices, levelOf) {
  const by = Object.create(null)
  for (const sl of slices) by[sl.id] = sl
  const has = new Set(shippedIds)
  const blockersOf = (id) => ((by[id] && by[id].blockedBy) || []).filter((b) => has.has(b))

  const covered = new Set()
  for (const id of shippedIds) for (const b of blockersOf(id)) covered.add(b)

  // Transitive, so the report can say what each merge actually brings with it.
  const reach = (id, seen) => {
    for (const b of blockersOf(id)) {
      if (seen.has(b)) continue
      seen.add(b)
      reach(b, seen)
    }
    return seen
  }
  const order = (a, b) => (levelOf[a] || 0) - (levelOf[b] || 0) || (a < b ? -1 : a > b ? 1 : 0)
  const leaves = shippedIds.filter((id) => !covered.has(id)).sort(order)
  return {
    leaves: leaves,
    carries: leaves.map((id) => ({ id: id, brings: [...reach(id, new Set())].sort(order) })),
    shipped: shippedIds.slice().sort(order),
  }
}

function sliceTableLines(slices, levelOf) {
  const rows = slices.map((sl) => ({
    slice: sl.id,
    title: String(sl.title || '').slice(0, 44),
    screens: sl.ui === true ? 'yes' : 'no',
    waits: (sl.blockedBy || []).join(', ') || '—',
    wave: String(levelOf[sl.id] + 1),
    test: (configFor(sl.dir).commands || {}).test || '(none)',
  }))
  const cols = ['slice', 'title', 'screens', 'waits', 'wave', 'test']
  const head = { slice: 'Slice', title: 'Title', screens: 'Screens', waits: 'Waits for', wave: 'Wave', test: 'Test command' }
  const width = {}
  for (const c of cols) width[c] = rows.reduce((m, r) => Math.max(m, String(r[c]).length), head[c].length)
  const line = (r) => '  ' + cols.map((c) => String(r[c]).padEnd(width[c])).join('  ')
  return [`${rows.length} slices to build:`, line(head)].concat(rows.map(line))
}

// [E2-11] The plan, printed before the first agent is spawned. A run used to tell you what it was
// doing only while it did it: you learned what work existed by watching it happen. Everything here
// is already declared in NODES, and the call count is arithmetic on the same fields — nothing is
// typed by hand, so editing the graph cannot leave a stale number behind.
function planLines() {
  const ids = Object.keys(NODES).filter((id) => NODES[id].kind !== 'report')
  const rows = ids.map((id) => {
    const nd = NODES[id]
    const checkers = nd.checkers.map((c) => c.agent.replace('sdlc2-', '')).join(', ') || '—'
    const rounds = nd.kind === 'fanout' ? `${nd.rounds} per slice` : String(nd.rounds)
    return {
      step: nd.phase,
      writer: (nd.maker && nd.maker.agent || '—').replace('sdlc2-', ''),
      checkers: checkers,
      rounds: rounds,
      calls: nd.rounds * (1 + nd.checkers.length) + (nd.arbiter ? 1 : 0),
      fanout: nd.kind === 'fanout',
    }
  })
  const w = (a, i) => a.reduce((m, r) => Math.max(m, String(r[i]).length), i.length)
  const cols = ['step', 'writer', 'checkers', 'rounds']
  const width = {}
  for (const c of cols) width[c] = w(rows, c)
  const line = (r) => '  ' + cols.map((c) => String(r[c]).padEnd(width[c])).join('  ')
  const out = [`THE PLAN — ${rows.length} steps, then the report:`]
  out.push(line({ step: 'Step', writer: 'Written by', checkers: 'Checked by', rounds: 'Max rounds' }))
  for (const r of rows) out.push(line(r))
  const upfront = rows.filter((r) => !r.fanout).reduce((t, r) => t + r.calls, 0)
  const perSlice = rows.filter((r) => r.fanout).reduce((t, r) => t + r.calls, 0)
  out.push(`  Worst case: ${upfront} agent calls before building starts, then up to ${perSlice} per slice.`)
  out.push(`  ${NODES.ux.id} runs only if the product owner reports the feature has screens.`)
  return out
}

// ────────────────────────────────────────────────────── report node ────
async function writeReport(node) {
  const nodeRows = Object.keys(NODES)
    .filter((id) => NODES[id].kind !== 'report')
    .map((id) => {
      const r = results[id] || { verdict: 'not-run', score: null, rounds: 0 }
      const row = {
        node: id,
        verdict: r.verdict,
        score: r.score,
        rounds: r.rounds,
        arbitrated: !!r.arbitrated,
        vh: r.vh || [],
        history: r.history || [],
        reason: r.reason || null,
      }
      // [R-REP-06] A fan-out node has no score and no rounds of its OWN, because it runs its
      // maker/checker loop once per unit rather than once. Handing the report `score: null,
      // rounds: 0` renders as `—` and `0`, which reads as a node nobody measured — the exact
      // opposite of the truth, which is that it was measured n times. So carry the per-unit
      // spread out with the row: the cell then says what the node did, and the reader is pointed
      // at the table that holds the detail instead of inferring a gap.
      if (NODES[id].kind === 'fanout' && r.slices) {
        const unitRows = r.slices.rows || []
        const reviews = unitRows.map((u) => u.review).filter((v) => typeof v === 'number')
        const tries = unitRows.map((u) => u.attempts).filter((v) => typeof v === 'number' && v > 0)
        row.fanout = {
          over: NODES[id].fanout,
          units: {
            total: unitRows.length,
            shipped: r.slices.shipped.length,
            escalated: r.slices.escalated.length,
            skipped: r.slices.skipped.length,
          },
          review: reviews.length ? { min: Math.min(...reviews), max: Math.max(...reviews), n: reviews.length } : null,
          attempts: tries.length ? { worst: Math.max(...tries), cap: NODES[id].rounds, retried: tries.filter((t) => t > 1).length } : null,
        }
      }
      return row
    })
  const build = results.build && results.build.slices ? results.build.slices : { shipped: [], escalated: [], skipped: [], rows: [], lanes: null, amendments: [] }
  const softPassed = nodeRows
    .filter((r) => r.verdict === 'soft-pass')
    .map((r) => r.node)
    .concat(build.shipped.filter((s) => s.softPass).map((s) => `build:${s.id}`))
  const disputed = []
  for (const id of Object.keys(results)) {
    for (const d of results[id].disputed || []) disputed.push({ node: id, criterion: d.criterion, why: d.why })
  }
  // [R-REP-07] The veto tally. Computed here rather than left for the report agent to derive,
  // because a number nobody can recompute from the report is a number the run did not measure —
  // and this one is the answer to a question SPEC §12 has carried unanswered since v0.1.2. Zero is
  // a real answer and must survive to the page: four runs of silence were read as "no data" when
  // they may simply have been four runs of zero, and the two call for opposite decisions about
  // whether the severity veto is worth keeping.
  const vetoes = {
    loop: nodeRows.reduce((t, r) => t + (r.history || []).filter((h) => h.veto === true).length, 0),
    loopScoredRounds: nodeRows.reduce((t, r) => t + (r.history || []).filter((h) => typeof h.score === 'number').length, 0),
    build: (build.rows || []).reduce((t, r) => t + (r.vetoed || 0), 0),
    buildAttempts: (build.rows || []).reduce((t, r) => t + (r.attempts || 0), 0),
    where: nodeRows
      .filter((r) => (r.history || []).some((h) => h.veto === true))
      .map((r) => r.node)
      .concat((build.rows || []).filter((r) => (r.vetoed || 0) > 0).map((r) => `build:${r.id}`)),
  }

  await spawn(
    `Write the sdlc2 run report to ${REPORT} (create the directory if needed). It is the only file\n` +
      `you AUTHOR — you also commit files other nodes already wrote, per the last section, but you\n` +
      `edit none of them. Use exactly this data — invent nothing:\n\n` +
      `Feature: ${FEATURE} — "${TITLE}"\nRun: ${RUN_ID}\nBase branch: ${BASE}\n` +
      `Engine: sdlc2 ${VERSION_RAN}\nEngine path: ${ROOT}\n` +
      `Node results: ${JSON.stringify(nodeRows)}\n` +
      `Slices: ${JSON.stringify(build.rows)}\n` +
      `Lanes: ${JSON.stringify(build.lanes)}\n` +
      `Merge plan: ${JSON.stringify(build.merge || null)}\n` +
      `Amendments: ${JSON.stringify(build.amendments || [])}\n` +
      `Soft-passed: ${JSON.stringify(softPassed)}\n` +
      `Vetoes: ${JSON.stringify(vetoes)}\n` +
      `Maker disputes (checker findings the maker addressed but disagreed with): ${JSON.stringify(disputed)}\n\n` +
      `Structure: (0) a header carrying Feature, Run, Base branch, AND \`Engine: sdlc2 <version>\`\n` +
      `with its path — [SD-03] state the engine verbatim as given, even when it reads \`unknown\`.\n` +
      `A session pins its plugin root at start, so a report that does not name the engine it ran\n` +
      `cannot be trusted to be about the engine you think you updated. Never omit it, never\n` +
      `substitute a version you believe is installed;\n` +
      `(1) a node table — node · verdict · score · rounds · arbitrated · VH ids · reason.\n` +
      `[R-REP-06] A node carrying a \`fanout\` object ran its loop once PER unit and never once, so\n` +
      `it has no score and no rounds of its own. Do NOT print \`—\` and \`0\` in those two cells: a\n` +
      `reader takes that for a node nobody measured, when it was measured \`units.total\` times.\n` +
      `Fill Score from \`review\` — \`0.94–0.99 across 4 slices\`, or the bare score when \`review.n\`\n` +
      `is 1, or \`no slice scored\` when it is null — and Rounds from \`attempts\` as the worst any\n` +
      `one unit needed against the cap, \`1 of 5 max, per slice\`, adding \`· N retried\` when\n` +
      `\`attempts.retried\` is not zero. Then one line under the table saying the per-unit detail is\n` +
      `the slice table in section 2, so nobody reads the summary cell as the whole story.\n` +
      `Then a per-round score line for every node that used MORE THAN HALF its rounds, taken\n` +
      `from that node's \`history\` (e.g. \`po: 0.71 → 0.74 → 0.74 → 0.80 → 0.84\`, with the defect\n` +
      `count in brackets). Say which way it went — climbing means convergence that ran out of\n` +
      `rounds, flat or oscillating means the loop is thrashing. Do not diagnose further.\n` +
      `[SD-05] A round carrying \`errored: true\` is NOT a maker that collapsed — it is a spawn that\n` +
      `never answered, already retried once, i.e. infrastructure. Write it as \`errored\`, never as\n` +
      `\`rejected\`, and do not count it against the maker's work or read a trend through it;\n` +
      `[R-REP-08] Then, for EVERY node with a score, a **Margin** line — never omitted, and never\n` +
      `replaced by the score alone. Give \`margin\` (the score minus its bar) and then name the\n` +
      `criteria in \`low\` from that node's LAST scored round, worst first, as \`ID score — reason\`.\n` +
      `A node that passed on round 1 has exactly one scored round and this is the only place its\n` +
      `per-criterion detail exists at all. Do NOT summarise \`low\` as "minor points": a total of\n` +
      `0.87 is produced equally by a panel marking everything near 0.87 and by one marking almost\n` +
      `everything 1.0 with a single criterion at 0.4, and those two say opposite things about how\n` +
      `hard the checkers are pushing. The reader is looking for exactly that difference. A criterion\n` +
      `whose reason says no checker scored it is a GAP, not a low mark — say so in those words.\n` +
      `Do the same for each slice from its \`reviewMargin\` and \`reviewLow\`, in the slice table's\n` +
      `reason column or one line beneath it;\n` +
      `[R-REP-07] Then ONE line from \`Vetoes\`, headed **Veto rounds**, and NEVER omitted — print it\n` +
      `even when every number is zero, because zero is the finding here and an absent line reads as\n` +
      `an unmeasured one. A veto round is a round that scored AT OR ABOVE its bar and was stopped by\n` +
      `an open defect anyway, so it is the only evidence of severity — the one judgement in this\n` +
      `system with no anchors — deciding an outcome by itself. Write \`loop\` of \`loopScoredRounds\`\n` +
      `scored rounds and \`build\` of \`buildAttempts\` slice attempts, then name \`where\` if it is not\n` +
      `empty. State the count and stop: do NOT recommend keeping, widening or dropping the veto —\n` +
      `one run is not a sample, and that call is the reader's;\n` +
      `(2) a slice table — slice · attempts · verdict · branch@sha · cut from (the \`base\` field) ·\n` +
      `review score · reason. A \`base\` that is another slice's branch means the slice was stacked\n` +
      `on the blocker it declared; say so rather than leaving the reader to infer it;\n` +
      `(2b) [R-REP-05] how the slices were BUILT, from \`Lanes\` — one short paragraph, never omitted.\n` +
      `If \`concurrent\` is true, say which ids ran together (each \`batches\` entry with more than one\n` +
      `id is one such group) and that each had its own worktree outside the repo. If it is false,\n` +
      `say they were built one at a time, and give the reason: \`install\` being null means the\n` +
      `project declares no \`commands.install\`, so a fresh worktree would have no dependencies to\n` +
      `test against — name it as the one-line config change that would unlock lanes. A \`widest\` of\n` +
      `1 means nothing was independent enough to run beside anything else, which is not a config\n` +
      `problem. A reader who was not watching the run has no other way to learn any of this;\n` +
      `(2c) [R-REP-09] WHAT TO MERGE, from \`Merge plan\` — its own short section, never omitted\n` +
      `when anything shipped. Lead with the count: \`leaves\` is what a human actually has to merge,\n` +
      `and it is usually FEWER than the slices that shipped. A stacked slice's branch already\n` +
      `contains its blockers', so merging a leaf merges its whole chain — list each leaf's branch\n` +
      `and, from \`carries\`, name what it brings with it. Say plainly that merging only the leaves\n` +
      `is enough, and that the other branches are there for review rather than for merging. Where\n` +
      `\`leaves\` has more than one entry they are independent tips and may be merged in any order.\n` +
      `Do not print a merge order for slices that did not ship.\n` +
      `(3) a human-verify index: read ${VH} if it exists and list every OPEN row (id · node ·\n` +
      `severity · one-line decision);\n` +
      `(4) the maker disputes, if any — they are unresolved disagreements, not noise;\n` +
      // [E2-13] A criterion a slice could not execute is a decision about the product contract, and
      // the debt it leaves is owed to a human. It never belongs only in a changelog.
      `(4b) [E2-13] ACCEPTANCE CRITERIA THAT COULD NOT BE MET, from \`Amendments\` — its own section\n` +
      `whenever the array is non-empty, never folded into the slice table. For each: the slice, the\n` +
      `criterion, why that branch could not run it, and WHAT IS OWED and where it must land. These\n` +
      `slices passed their tester against a contract the tester could not fully execute, so a green\n` +
      `row here means less than a green row elsewhere — say that plainly. If the array is empty,\n` +
      `state that every acceptance criterion was executed as written;\n` +
      `(4c) [E2-08] whether the slice worktrees were released, from \`Lanes.release\`. \`released\`\n` +
      `false, or a non-empty \`remaining\`, means trees still exist outside the repo holding branches\n` +
      `checked out — say which, because the next run's clean-tree gate will meet them. Omit this\n` +
      `line only when no worktree was ever created.\n` +
      `[SD-12] State the container directory from \`container\` and from NOTHING ELSE: true means it\n` +
      `was removed, false means it is still on disk. Never write that it was removed on any other\n` +
      `basis — not from the release agent's prose, not because the prompt asked for it, not because\n` +
      `it follows from the trees being gone. Run 5's report claimed that removal, no field said it,\n` +
      `and the directory is still there. Every sentence in this report must trace to a field above;\n` +
      `where no field covers something, write nothing rather than the likely answer;\n` +
      `(5) a 2–3 sentence summary, then the next human action.\n\n` +
      `A node verdict of \`hard-fail\`, \`escalated\`, \`skipped\` or \`not-run\` MUST be stated as such\n` +
      `and never softened. If anything soft-passed, say so in the FIRST line of the summary — a run\n` +
      `with a soft-pass is never described as clean. Close by stating that sdlc2 has not merged\n` +
      `anything and that reviewing and merging the slice/ branches is the human's job.\n\n` +
      `THEN COMMIT THE PAPERWORK. [R-REP-03] The graph's artifacts are untracked files right now;\n` +
      `left that way they block the next run's clean-tree gate and the human-verify record is one\n` +
      `\`git clean\` from gone. Put them on their own branch — '${BASE}' must not move, and no\n` +
      `'slice/' branch may be touched:\n` +
      `1. \`git checkout -b sdlc2/${FEATURE} ${BASE}\`. If that branch already exists from an earlier\n` +
      `   run, \`git checkout sdlc2/${FEATURE}\` and commit ON TOP — never \`-B\` and never reset it,\n` +
      `   which would discard the earlier run's record. Untracked files follow you across the\n` +
      `   checkout, which is why this works.\n` +
      `2. \`git add ${DIR} docs/adr\` — omit \`docs/adr\` if it does not exist. Add NOTHING else: the\n` +
      `   slice code belongs to the slice branches and must not be duplicated here.\n` +
      `3. Commit as \`docs(${FEATURE}): sdlc2 run ${RUN_ID} — artifacts and human-verify record\`.\n` +
      `4. Leave HEAD on 'sdlc2/${FEATURE}'.\n` +
      `If any git step fails — the checkout is refused because these paths are tracked on the\n` +
      `current branch, or the tree has changes that are not yours — do NOT stash, reset, force or\n` +
      `\`git clean\` anything. Append a short \`## Paperwork not committed\` section to the report\n` +
      `saying exactly which command failed and its real output, and stop. A lost artifact is worse\n` +
      `than an uncommitted one.`,
    { model: node.maker.model, effort: node.maker.effort, label: labelFor('report'), phase: groupFor(node) }
  )
  return { node: node.id, verdict: 'pass', score: null, rounds: 0, report: REPORT, paperwork: `sdlc2/${FEATURE}` }
}

// ──────────────────────────────────────────────────────── the executor ────
// GENERIC. Predecessors come from `next`; a node runs when all of them have resolved; ready nodes
// run together in one parallel() barrier (that is what makes architect ∥ ux concurrent, and build
// their join). Dispatch is on `kind`. Adding a node to NODES needs no change here. [R-GRAPH-06]
//
// Every node body runs inside parallel(), which converts a throw into a null result. So a node
// that dies becomes a hard-fail row instead of taking the run down with it, and the report node
// — which runs whatever happened — always gets written. [R-GRAPH-04]
const state = {}
const results = {}

const RUNNERS = {
  loop: runLoop,
  fanout: buildSlices,
  report: writeReport,
}

// A node that never passed blocks its successors. A node whose GATE said "not for this feature"
// does not — `ux` being skipped because there are no UI stories must not take `build` with it.
function blocksSuccessors(result) {
  if (!result) return true
  if (result.gated === true) return false
  return result.verdict === 'hard-fail' || result.verdict === 'skipped' || result.verdict === 'not-run'
}

function predecessorsOf() {
  const preds = {}
  for (const id of Object.keys(NODES)) preds[id] = []
  for (const id of Object.keys(NODES)) {
    for (const nxt of NODES[id].next || []) {
      if (preds[nxt]) preds[nxt].push(id)
      else log(`graph: node '${id}' points at '${nxt}', which is not a node — edge ignored.`)
    }
  }
  return preds
}

// [E-08/E-12] Nodes settle independently, and anything can wait on a settled node without the
// executor holding a barrier. That is what lets a backend slice start while `ux` is still running.
const waiters = Object.create(null)
function settle(id, r) {
  results[id] = r
  state[id] = (r && r.maker) || {}
  const list = waiters[id] || []
  waiters[id] = []
  for (const fn of list) fn(r)
}
function whenSettled(id) {
  if (id in results) return Promise.resolve(results[id])
  if (!NODES[id]) return Promise.resolve(null) // no such node — never block on it
  return new Promise((resolve) => {
    waiters[id] = waiters[id] || []
    waiters[id].push(resolve)
  })
}

// [E-08] Arbitration runs INSIDE the node. It used to be deferred behind the wave barrier and then
// serialized, so the architect's arbiter idled until ux finished and the two most expensive calls
// in the run executed back to back. The only reason for that serialization was VH id allocation by
// reading the file; ids are namespaced per node now, so two arbiters cannot collide. [R-VH-02]
//
// It never throws: a node that dies becomes a hard-fail row rather than taking the run with it,
// which is what `parallel()` used to do for us and now has to be explicit. [R-GRAPH-04]
async function runNode(node) {
  let r = null
  try {
    r = await RUNNERS[node.kind](node)
  } catch (e) {
    log(`${node.id}: threw — ${(e && e.message) || e}`)
    r = null
  }
  if (!r) {
    log(`${node.id}: crashed. Recorded as a hard fail; the graph continues so the run is still reported.`)
    return { node: node.id, verdict: 'hard-fail', score: null, rounds: 0, defects: [], reason: 'the node crashed — no result returned' }
  }
  if (r.verdict === 'needs-arbitration') r = await arbitrate(node, r)
  return r
}

async function walk() {
  // [SD-03] First line of every run: which engine, from where. This one line would have caught
  // the stale pin on run 1 instead of two runs later.
  log(`sdlc2 ${VERSION_RAN} — engine at ${ROOT} — run ${RUN_ID} on "${TITLE}" (base ${BASE}).`)
  planLines().forEach(log) // [E2-11]
  const preds = predecessorsOf()
  const ids = Object.keys(NODES)
  const running = Object.create(null)
  let guard = 0

  // Start EVERY node whose predecessors have settled — no wave barrier. A node that is skipped
  // settles immediately, which can make its own successors ready, so this repeats until nothing
  // more can start.
  const startReady = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const id of ids) {
        if (id in results || id in running) continue
        if (!preds[id].every((pp) => pp in results)) continue
        const node = NODES[id]
        const terminal = node.kind === 'report' // reporting survives every outcome
        const upstreamDead = preds[id].filter((pp) => blocksSuccessors(results[pp]))

        if (!terminal && upstreamDead.length) {
          log(`${id} skipped — upstream ${upstreamDead.join(', ')} did not pass.`)
          settle(id, { node: id, verdict: 'skipped', score: null, rounds: 0, reason: `upstream ${upstreamDead.join(', ')} did not pass` })
          changed = true
          continue
        }
        if (!terminal && node.when && !node.when(state)) {
          log(`${id} skipped — its gate condition is not met (${id === 'ux' ? 'the product framing declared no UI stories' : `see NODES.${id}.when`}).`)
          settle(id, { node: id, verdict: 'skipped', score: null, rounds: 0, gated: true, reason: 'gate condition not met' })
          changed = true
          continue
        }
        if (!terminal && budget.total && budget.remaining() < BUDGET_FLOOR) {
          log(`${id} skipped — budget nearly spent.`)
          settle(id, { node: id, verdict: 'skipped', score: null, rounds: 0, reason: 'budget nearly spent' })
          changed = true
          continue
        }

        phase(node.phase)
        log(`▸ ${id}`)
        running[id] = runNode(node).then(
          (r) => ({ id: id, r: r }),
          () => ({ id: id, r: null })
        )
        changed = true
      }
    }
  }

  while (Object.keys(results).length < ids.length && guard++ <= ids.length * 4) {
    startReady()
    const inflight = Object.keys(running)
    if (!inflight.length) break
    const finished = await Promise.race(inflight.map((k) => running[k]))
    delete running[finished.id]
    settle(finished.id, finished.r || { node: finished.id, verdict: 'hard-fail', score: null, rounds: 0, defects: [], reason: 'the node crashed — no result returned' })
  }

  for (const id of ids) {
    if (!(id in results)) settle(id, { node: id, verdict: 'not-run', score: null, rounds: 0, reason: 'never became ready — check the graph edges' })
  }
}

// ───────────────────────────────────────────────────────── graph walk ────
// Everything above is declaration; everything below is the run. `verify.mjs` cuts here so it can
// evaluate the entire engine — executor included — without spawning a single agent.
assertArgs()
phase(NODES.po.phase)
log(`sdlc2 · feature "${TITLE}" (${FEATURE}) · run ${RUN_ID} · base ${BASE}`)
await walk()

const built = results.build && results.build.slices ? results.build.slices : { shipped: [], escalated: [], skipped: [], rows: [] }
const nodeVerdicts = Object.keys(NODES)
  .filter((id) => NODES[id].kind !== 'report')
  .map((id) => ({ node: id, verdict: results[id].verdict, score: results[id].score, rounds: results[id].rounds, arbitrated: !!results[id].arbitrated, vh: results[id].vh || [], reason: results[id].reason || null }))
const softPassed = nodeVerdicts
  .filter((r) => r.verdict === 'soft-pass')
  .map((r) => r.node)
  .concat(built.shipped.filter((s) => s.softPass).map((s) => `build:${s.id}`))
const failedNodes = nodeVerdicts.filter((r) => r.verdict === 'hard-fail' || r.verdict === 'skipped' || r.verdict === 'not-run')

return {
  runId: RUN_ID,
  feature: FEATURE,
  halted: failedNodes.some((r) => r.node === 'po') ? 'po-did-not-pass' : false,
  nodes: nodeVerdicts,
  shipped: built.shipped,
  escalated: built.escalated,
  skipped: built.skipped,
  softPassed: softPassed,
  report: REPORT,
  verifyWithHuman: VH,
  summary:
    `${built.shipped.length} slice(s) shipped, ${built.escalated.length} escalated, ` +
    `${built.skipped.length} skipped` +
    (failedNodes.length ? ` · NODES NOT PASSED: ${failedNodes.map((r) => `${r.node} (${r.verdict})`).join(', ')}` : '') +
    (softPassed.length ? ` · SOFT-PASSED: ${softPassed.join(', ')}` : failedNodes.length ? '' : ' · all nodes passed clean'),
}
