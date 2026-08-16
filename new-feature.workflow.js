export const meta = {
  name: 'sdlc2-new-feature',
  description:
    'Run the sdlc2 feature graph: product framing → architecture ∥ UX → sequential outside-in TDD slices → report. Every node is a maker/checker loop scored against a rubric; 5 rounds then an arbiter decides and documents instead of stalling. A red tester verdict is never arbitrable.',
  phases: [
    { title: 'Product', detail: 'product-owner ⇄ product-owner-critic → feature.md · mockup.html · issues/' },
    { title: 'Design', detail: 'architect ⇄ architect-critic ∥ ux-design ⇄ ux-auditor (spec mode)' },
    { title: 'Build', detail: 'per slice, sequential: developer ⇄ tester + code-reviewer → commit on pass' },
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
const BASE = A.defaultBranch || 'main'
const CONFIG = A.config || { commands: {}, seam: {} }
const CONFIG_BY_DIR = A.configByDir || {}
// Plugin agents may be registered bare (`sdlc2-developer`) or namespaced by the host
// (`sdlc2:sdlc2-developer`). The mode file resolves which and passes the prefix, so the engine
// never guesses at a name it cannot verify.
const AGENT_PREFIX = A.agentPrefix || ''
function at(name) { return AGENT_PREFIX + name }

const VH = `${DIR}/VERIFY-WITH-HUMAN.md`
const SEED = `${DIR}/feature.md`
const MOCKUP = `${DIR}/mockup.html`
const DESIGN = `${DIR}/design.md`
const ISSUES = `${DIR}/issues`
const REPORT = `${DIR}/runs/${RUN_ID}.md`

const ROUNDS = 5 // max maker rounds before the arbiter — same at every node
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
  notes: { type: 'string' },
}

const MAKER = { type: 'object', required: ['ok', 'artifacts'], properties: MAKER_PROPS }

// The po maker MUST state hasUiStories: the executor gates the ux node on it, and an omitted
// flag would silently skip UX on a feature full of screens.
const MAKER_PO = { type: 'object', required: ['ok', 'artifacts', 'hasUiStories'], properties: MAKER_PROPS }

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
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'path', 'title'],
        properties: {
          id: { type: 'string' }, // NN-slug
          path: { type: 'string' }, // issues/NN-slug.md
          title: { type: 'string' },
          dir: { type: 'string' }, // primary directory it touches — picks the nested config
          blockedBy: { type: 'array', items: { type: 'string' } },
        },
      },
    },
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
    notes: { type: 'string' },
  },
}

// ────────────────────────────────────────────────────────── rubrics ────
// SOURCE OF TRUTH: SPEC.md §13 Rubrics. These literals must match it criterion-for-criterion,
// weight-for-weight, threshold-for-threshold — drift is a conformance failure. [R-RUB-01]
const RUBRICS = {
  po: {
    threshold: 0.85,
    criteria: [
      { id: 'PO-AC', weight: 0.3, text: 'Every story carries Gherkin Given/When/Then that is concrete and testable, covering the happy path AND edge / error / empty / permission cases. One scenario maps to exactly one acceptance test.', anchors: '0.0 = prose criteria or vague terms ("fast", "user-friendly"); 0.5 = Gherkin for happy paths only; 1.0 = every story, every path, each step observable.' },
      { id: 'PO-INVEST', weight: 0.25, text: 'Stories are INVEST-compliant VERTICAL slices cut from a story map, walking-skeleton first. No horizontal or technical stories.', anchors: '0.0 = a flat list of technical tasks ("create the table"); 0.5 = vertical but no visible backbone or skeleton-first ordering; 1.0 = a mapped journey, thinnest end-to-end slice marked and ordered first.' },
      { id: 'PO-GRILL', weight: 0.15, text: 'Every decision, constraint and exclusion in the seed feature.md appears in a story, an acceptance criterion, or an explicit Out-of-scope line. Nothing silently dropped.', anchors: '0.0 = seed decisions missing with no trace; 0.5 = most carried, some silently gone; 1.0 = full traceability, exclusions stated.' },
      { id: 'PO-LANG', weight: 0.15, text: 'Terms match the seed\'s ubiquitous language and any existing domain docs. No invented synonyms for existing terms.', anchors: '0.0 = new vocabulary for existing concepts; 0.5 = mostly consistent, occasional drift; 1.0 = exact, and new terms are defined.' },
      { id: 'PO-MOCK', weight: 0.15, text: 'mockup.html shows a screen for every story\'s happy path, every control named in an acceptance criterion is present, and no screen exists that no story asks for.', anchors: '0.0 = missing or unrelated to the stories; 0.5 = partial coverage or orphan screens; 1.0 = bijective with the stories, self-contained HTML.' },
    ],
  },
  arch: {
    threshold: 0.85,
    criteria: [
      { id: 'AR-BOUND', weight: 0.3, text: 'Aggregate and context boundaries are correct: every invariant is owned in exactly one place, and no operation spans two aggregates transactionally.', anchors: '0.0 = invariants scattered or a cross-aggregate transaction; 0.5 = boundaries named but an invariant\'s owner is ambiguous; 1.0 = each invariant has one owner, stated.' },
      { id: 'AR-SEAM', weight: 0.25, text: 'The outer acceptance-test seam each slice will be driven through is named and reachable, and ports/adapters are explicit.', anchors: '0.0 = no seam named; 0.5 = a seam for the feature but not per slice; 1.0 = per slice, matching the project\'s declared seam.' },
      { id: 'AR-ADR', weight: 0.2, text: 'Each significant decision is an ADR with options considered, the decision, its consequences, and why the alternatives were rejected.', anchors: '0.0 = decisions asserted with no alternatives; 0.5 = ADRs without rejected options or consequences; 1.0 = complete.' },
      { id: 'AR-FIT', weight: 0.15, text: 'Consistent with the existing codebase and its conventions; any new pattern or dependency is justified rather than incidental.', anchors: '0.0 = a new stack/style with no rationale; 0.5 = consistent but unexamined; 1.0 = consistent, deviations argued.' },
      { id: 'AR-SLICE', weight: 0.1, text: 'Each queued slice is implementable end-to-end against that seam in one sitting.', anchors: '0.0 = slices that cannot compile alone; 0.5 = plausible but unexamined; 1.0 = each slice traced to the seam it drives.' },
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
    arbiter: { agent: 'sdlc2-product-owner', model: 'opus', effort: 'max' },
    rubric: 'po',
    rounds: ROUNDS,
    inputs: [SEED, VH],
    outputs: [
      { path: SEED, kind: 'feature', note: 'EXTEND the seed in place — preserve its sections, append epics/stories/AC/out-of-scope' },
      { path: MOCKUP, kind: 'mockup', note: 'ONE self-contained file: inline CSS, no CDN, no network, one screen per story happy path' },
      { path: `${ISSUES}/NN-slug.md`, kind: 'issues', note: 'one per vertical slice; `## Acceptance criteria` is Gherkin COPIED VERBATIM from feature.md, plus `Blocked by:` and a `Dir:` line naming the directory it mainly touches' },
    ],
    when: null,
    next: ['architect', 'ux'],
  },

  architect: {
    id: 'architect',
    kind: 'loop',
    phase: 'Design',
    mandate:
      'Design the domain model and the boundaries this feature needs, name the outer acceptance-test seam for EACH slice, and record the decisions as ADRs. Do not touch feature.md, mockup.html, or any issue\'s acceptance criteria — disagreement with the product framing is a human-verify record, not an edit.',
    maker: { agent: 'sdlc2-architect', model: 'opus', effort: 'high' },
    checkers: [
      { agent: 'sdlc2-architect-critic', model: 'opus', effort: 'xhigh', lens: 'boundaries, invariants, seam reachability, ADR completeness', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-architect', model: 'opus', effort: 'max' },
    rubric: 'arch',
    rounds: ROUNDS,
    inputs: [SEED, ISSUES, VH],
    outputs: [
      { path: DESIGN, kind: 'design', note: 'domain model · boundaries · ports · THE SEAM PER SLICE' },
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
    arbiter: { agent: 'sdlc2-ux-design', model: 'opus', effort: 'max' },
    rubric: 'ux',
    rounds: ROUNDS,
    inputs: [SEED, MOCKUP, VH],
    outputs: [
      { path: MOCKUP, kind: 'mockup', note: 'the SAME file — never a new one; add state variants + navigation, label each with the story/AC it serves' },
    ],
    when: (state) => state.po && state.po.hasUiStories === true,
    next: ['build'],
  },

  build: {
    id: 'build',
    kind: 'fanout',
    phase: 'Build',
    mandate:
      'Build ONE vertical slice outside-in: one Gherkin scenario becomes one failing acceptance test at the declared seam, kept red while inner red-green-refactor cycles drive it green.',
    maker: { agent: 'sdlc2-developer', model: 'opus', effort: 'xhigh' },
    checkers: [
      { agent: 'sdlc2-tester', model: 'opus', effort: 'xhigh', lens: 'executable ground truth — the suite and the acceptance criteria', binary: true, arbitrable: false },
      { agent: 'sdlc2-code-reviewer', model: 'opus', effort: 'xhigh', lens: 'Clean Code · DDD · idiom · test quality', arbitrable: true },
    ],
    arbiter: { agent: 'sdlc2-developer', model: 'opus', effort: 'max' },
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
    maker: { agent: null, model: 'sonnet', effort: 'low' },
    checkers: [],
    arbiter: null,
    rubric: null,
    rounds: 0,
    inputs: [VH],
    outputs: [{ path: REPORT, kind: 'report', note: 'node table · slice table · human-verify index · summary' }],
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

function blockingOpen(defects) {
  return defects.filter((d) => d.severity === 'critical' || d.severity === 'high')
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
    if (!claimed.some((p) => p === o.path || p.indexOf(o.path) >= 0)) {
      out.push(engineDefect(o.path, `maker returned artifacts ${JSON.stringify(claimed)} — ${o.path} is not among them`, `write ${o.path} and return its path in \`artifacts\``))
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
  return { commands: cmds, seam: seam }
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
  return (
    `PROJECT CONVENTIONS (from the project's CLAUDE.md sdlc2 block — authoritative, do not guess):\n` +
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
      `${JSON.stringify(real, null, 2)}\n`
    : stalled.length
    ? `\nROUND ${round} of ${node.rounds} — the previous round could not be SCORED: ` +
      `${stalled.map((d) => d.evidence).join('; ')}.\n` +
      `That is a harness failure, not a fault found in your work. Re-check your artifacts against\n` +
      `the rubric below and fix anything you find — but do not rewrite work that is already right.\n`
    : `\nROUND ${round} of ${node.rounds} — first attempt.\n`

  return (
    `You are the \`${node.maker.agent}\` persona working on the feature "${TITLE}" (slug: ${FEATURE}).\n\n` +
    `MANDATE — ${node.mandate}\n` +
    repair +
    `\nREAD THESE PATHS (they exist on disk; nothing is pasted for you):\n` +
    pathList(node.inputs.concat([VH])) +
    `\n  (${VH} — if it exists, these are decisions already taken under caveat. Honour them; do not relitigate.)\n` +
    `\n${conventions(CONFIG, true)}` +
    (extra ? `\n${extra}\n` : '') +
    `\nWRITE YOUR OUTPUT TO DISK:\n${outs}\n` +
    `\nReturn every path you wrote in \`artifacts\` — the engine checks them against the list above —\n` +
    `plus a changelog of at most 20 lines. Never paste an artifact body back to me.\n` +
    `\nRUBRIC — you will be scored on exactly this, by an adversarial checker with fresh context:\n` +
    `${rubricTable(node.rubric)}\n` +
    `\nReturn the structured MAKER object.`
  )
}

function checkerPrompt(node, checker, round) {
  return (
    `You are the \`${checker.agent}\` persona acting as an INDEPENDENT ADVERSARIAL CHECKER.\n\n` +
    `MANDATE — REFUTE this work. You did not write it and you are not here to be agreeable.\n` +
    `Default to FAIL when uncertain. Your lens: ${checker.lens}.\n` +
    `You are READ-ONLY: never edit an artifact. You have not seen any other checker's verdict and\n` +
    `must not speculate about one.\n` +
    `\nROUND ${round}. The maker was asked to: ${node.mandate}\n` +
    `\nREAD THESE PATHS:\n` +
    pathList(node.inputs) +
    '\n' +
    pathList(node.outputs.map((o) => o.path)).replace(/$/gm, '   (artifact under review)') +
    `\n\n${conventions(CONFIG, true)}` +
    `\nEVERY defect MUST carry: criterion (a rubric id below), severity, location (file:line or a\n` +
    `precise anchor), evidence (QUOTED from the artifact — not paraphrased), and a concrete fix.\n` +
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
    `\nUnresolved after ${round} rounds:\n${JSON.stringify(defects, null, 2)}\n` +
    `\nREAD:\n` +
    pathList(node.inputs.concat(node.outputs.map((o) => o.path))) +
    `\n  (${VH} — read it FIRST to find the highest existing VH-NN id; your new ids continue that\n` +
    `   sequence. You are the only arbiter running right now, so the file will not move under you.)\n` +
    `\n${conventions(CONFIG, true)}` +
    `\nDO TWO THINGS:\n` +
    `1. Finalize the artifacts at the paths above — your best version, given the defects you could\n` +
    `   not resolve. This is what every downstream node will build on.\n` +
    `2. APPEND to ${VH} (create it if absent, with the index table header). Append-only: never\n` +
    `   rewrite or delete an existing row. For each decision add one index row\n` +
    `   \`| VH-NN | ${node.id} | <round> | <score> | <severity> | <one-line decision> | open |\`\n` +
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
  let score = 0
  let round = 0

  while (round < node.rounds) {
    round++
    let binaryFailed = false
    let hard = false

    maker = await agent(makerPrompt(node, round, defects, null), {
      agentType: at(node.maker.agent),
      model: node.maker.model,
      effort: node.maker.effort,
      schema: makerSchema(node),
      label: `${label}:make (${round}/${node.rounds})`,
      phase: node.phase,
    })

    // [R-LOOP-08] A null or incomplete maker consumes a round and earns a synthetic critical
    // defect. It never retries for free.
    const makerFaults = auditMaker(node, maker)
    if (makerFaults.length) {
      defects = makerFaults
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
        agent(checkerPrompt(node, c, round), {
          agentType: at(c.agent),
          model: c.model,
          effort: c.effort,
          schema: verdictSchema(c),
          label: `${label}:${c.agent.replace('sdlc2-', '')} (${round}/${node.rounds})`,
          phase: node.phase,
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
    const open = blockingOpen(defects)

    log(
      `${label} round ${round}/${node.rounds}: score ${score} (bar ${bar}), ` +
        `${defects.length} defect(s), ${open.length} critical/high` +
        (binaryFailed ? ', BINARY CHECKER RED' : '')
    )

    if (hard) {
      return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: lastGoodMaker, reason: 'a checker could not judge the work at all' }
    }
    if (!binaryFailed && score >= bar && open.length === 0) {
      return { node: node.id, verdict: 'pass', score: score, rounds: round, defects: [], maker: lastGoodMaker, disputed: (lastGoodMaker && lastGoodMaker.disputed) || [] }
    }
    if (binaryFailed && round === node.rounds) {
      // The executable oracle is not arbitrable: no arbiter may sign off over a red suite.
      return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: lastGoodMaker, reason: 'binary checker still failing' }
    }
  }

  // Nothing to arbitrate over: no round ever produced the declared artifacts, so a "best
  // available decision" would be a decision about a file that does not exist.
  if (!lastGoodMaker) {
    return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: null, reason: 'the maker never produced the declared artifacts' }
  }

  return {
    node: node.id,
    verdict: 'needs-arbitration',
    score: score,
    rounds: round,
    defects: defects,
    maker: lastGoodMaker,
    disputed: lastGoodMaker.disputed || [],
  }
}

// [R-LOOP-07] Exactly one arbiter call per node, and its verdict is soft-pass — never pass.
async function arbitrate(node, result) {
  const decision = await agent(arbiterPrompt(node, result.defects, result.rounds), {
    agentType: at(node.arbiter.agent),
    model: node.arbiter.model,
    effort: node.arbiter.effort,
    schema: ARBITER,
    label: `${node.id}:arbiter`,
    phase: node.phase,
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
// Sequential by design: one slice at a time, one branch each, no worktrees. Nothing runs
// concurrently, so no isolation machinery is needed — and the entire class of parallel-tree
// bugs cannot occur. Parallelism is a later decision, made with real timing data.
function developerPrompt(slice, cfg, defects, attempt, rounds) {
  const real = actionable(defects)
  const stalled = harnessOnly(defects)
  const repair = real.length
    ? `\nRepair attempt ${attempt} of ${rounds}. The independent checkers refuted the previous attempt.\n` +
      `Fix EVERY defect; do not regress what passed:\n${JSON.stringify(real, null, 2)}\n`
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
    `  - ${SEED}\n  - ${DESIGN}   (the architecture, and the seam named for THIS slice)\n` +
    `  - ${MOCKUP}   (frontend work: match its structure, states and controls — not its CSS)\n` +
    `  - ${VH}   (if present — decisions already taken under caveat)\n` +
    `\n${conventions(cfg)}` +
    `\nYOU OWN GIT FOR THIS SLICE — the isolation invariant is non-negotiable:\n` +
    `1. Create branch 'slice/${FEATURE}/${slice.id}' off '${BASE}' and switch to it (if it already\n` +
    `   exists, switch to it). NEVER commit while HEAD is '${BASE}' or detached at its tip: assert\n` +
    `   \`git branch --show-current\` equals the slice branch before EVERY commit.\n` +
    `2. '${BASE}' must not move. Do not merge, rebase onto it, or push anything.\n` +
    `3. Commit only when the acceptance test and the full test command are green.\n` +
    `4. LEAVE HEAD ON THE SLICE BRANCH when you finish — two read-only checkers inspect this same\n` +
    `   working tree next and neither may switch branches.\n` +
    `5. Touch only what this slice needs. Leave the tree clean — no stray files, no debug output.\n` +
    `\nReturn the structured BUILD object: committed, sha, branch, and a short changelog.`
  )
}

function testerPrompt(slice, cfg) {
  return (
    `You are the \`sdlc2-tester\` persona. You did not build this slice and you verify it cold.\n\n` +
    `MANDATE — CONFIRM OR REFUTE slice ${slice.id} against its acceptance criteria using EXECUTABLE\n` +
    `ground truth. You are the only oracle in this graph with real evidence; a red suite is not\n` +
    `negotiable and cannot be waived by anyone. Default to FAIL on any unverified criterion.\n` +
    `\nREAD:\n  - ${slice.path}   (map EVERY Gherkin scenario to an observable check)\n  - ${SEED}\n` +
    `\n${conventions(cfg)}` +
    `\nMETHOD:\n` +
    `1. HEAD is ALREADY on 'slice/${FEATURE}/${slice.id}'. Assert it with\n` +
    `   \`git branch --show-current\` and STOP if it is anything else — do not switch, stash, or\n` +
    `   otherwise move the working tree: a code reviewer is reading the same tree right now.\n` +
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

function reviewerPrompt(slice, cfg) {
  return (
    `You are the \`sdlc2-code-reviewer\` persona reviewing the code of slice ${slice.id}.\n\n` +
    `MANDATE — REFUTE the quality of this code. You judge craft, not whether it works (the tester\n` +
    `owns that). Every finding cites file:line and a NAMED principle. Default to FAIL when unsure.\n` +
    `You are READ-ONLY and you have not seen the tester's verdict.\n` +
    `\nREAD: the diff of branch 'slice/${FEATURE}/${slice.id}' against '${BASE}'\n` +
    `  (\`git diff ${BASE}...slice/${FEATURE}/${slice.id}\`), plus ${slice.path} and ${DESIGN}.\n` +
    `Read-only on git too: \`git diff\` / \`git show\` / \`git log\` only. Never checkout, switch,\n` +
    `stash or reset — the tester is running the suite in this same working tree right now.\n` +
    `\n${conventions(cfg)}` +
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
    `reviewer's findings survived ${rounds} rounds. Decide, per finding, whether to fix it now or\n` +
    `accept it as recorded debt, then document what you accepted.\n` +
    `\nUnresolved code-review findings:\n${JSON.stringify(defects, null, 2)}\n` +
    `\n1. Fix what is cheap and safe; commit any fix on 'slice/${FEATURE}/${slice.id}' and keep the\n` +
    `   suite green (re-run the test command; a red suite means you must revert the fix).\n` +
    `2. APPEND one record per ACCEPTED finding to ${VH} (append-only, continue the VH-NN sequence).\n` +
    `   Each accepted item MUST name the file:line and the violated principle, plus Decision,\n` +
    `   Rationale, Risk if wrong, and What would change my mind.\n` +
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

  const plan = await agent(
    `Enumerate the queued slices for feature "${FEATURE}".\n\n` +
      `Read every file in ${ISSUES}/ (they were written by the product-owner node). For each, return:\n` +
      `  id        — the NN-slug from the filename\n` +
      `  path      — the file path\n` +
      `  title     — its title line\n` +
      `  dir       — the value of its \`Dir:\` line if present (the directory it mainly touches), else ""\n` +
      `  blockedBy — the ids on its \`Blocked by:\` line, else []\n` +
      `Return them in dependency order: a slice must appear after everything it is blocked by.\n` +
      `Do not invent slices and do not modify any file.`,
    { schema: SLICES, model: 'sonnet', effort: 'low', label: 'slices:resolve', phase: node.phase }
  )
  const slices = (plan && plan.slices) || []
  if (!slices.length) {
    log('No slices found — the product-owner node produced no issues.')
    return { node: node.id, verdict: 'hard-fail', score: null, rounds: 0, reason: 'no slices queued', slices: { shipped: [], escalated: [], skipped: [], rows: [] } }
  }
  log(`${slices.length} slice(s) queued; building sequentially on branches off ${BASE}.`)

  const shipped = []
  const escalated = []
  const skipped = []
  const rows = []
  const done = Object.create(null) // id → shipped?
  const known = Object.create(null)
  for (const s of slices) known[s.id] = true

  for (const slice of slices) {
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
      continue
    }

    const cfg = configFor(slice.dir)
    let defects = []
    let lastGood = null // the last build that actually COMMITTED — never the last agent return
    let attempt = 0
    let testerPass = false
    let reviewScore = 0
    // What the MOST RECENT attempt actually ended in. The escalation note quotes this, so a slice
    // that never compiled is never reported as a failing test suite.
    let outcome = 'no-commit'

    while (attempt < rounds) {
      attempt++
      const build = await agent(developerPrompt(slice, cfg, defects, attempt, rounds), {
        agentType: at(node.maker.agent),
        model: node.maker.model,
        effort: node.maker.effort,
        schema: BUILD,
        label: `build:${slice.id} (${attempt}/${rounds})`,
        phase: node.phase,
      })
      if (!build || build.committed !== true) {
        testerPass = false // nothing was tested this round; do not carry a stale green
        outcome = 'no-commit'
        defects = [engineDefect(slice.id, (build && build.notes) || 'developer did not reach a green commit', 'reach green and commit on the slice branch')]
        log(`${slice.id}: no commit (attempt ${attempt}/${rounds}).`)
        continue
      }
      lastGood = build

      const verdicts = await parallel([
        () => agent(testerPrompt(slice, cfg), {
          agentType: at(testerRole.agent), model: testerRole.model, effort: testerRole.effort,
          schema: verdictSchema(testerRole), label: `test:${slice.id} (${attempt}/${rounds})`, phase: node.phase,
        }),
        () => agent(reviewerPrompt(slice, cfg), {
          agentType: at(reviewRole.agent), model: reviewRole.model, effort: reviewRole.effort,
          schema: verdictSchema(reviewRole), label: `review:${slice.id} (${attempt}/${rounds})`, phase: node.phase,
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
      const all = dedupe(testerDefects.concat(cleanDefects(rv, `review:${slice.id}`)).concat(missing))
      const open = blockingOpen(all)

      log(
        `${slice.id} attempt ${attempt}/${rounds}: tester ${testerPass ? 'GREEN' : 'RED'}, ` +
          `code-review ${reviewScore} (bar ${bar}), ${open.length} critical/high` +
          (missing.length ? `, ${missing.length} checker(s) silent` : '')
      )

      if (testerPass && reviewScore >= bar && open.length === 0) {
        shipped.push({ id: slice.id, branch: build.branch, sha: build.sha })
        rows.push({ id: slice.id, attempts: attempt, verdict: 'pass', sha: build.sha, branch: build.branch, review: reviewScore })
        done[slice.id] = true
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

    if (done[slice.id] === true) continue

    // Escalate on the REAL reason — whatever the LAST attempt ended in. `lastGood` is the only
    // proof a commit exists, and testerPass is only meaningful when it does.
    if (outcome !== 'craft-debt' || !lastGood || !testerPass) {
      // The second and third disjuncts should be unreachable — if they fire, the loop's
      // bookkeeping disagrees with itself and that is worth saying out loud, not papering over.
      const reason = outcome === 'craft-debt' ? 'inconsistent-state' : outcome
      escalated.push({ id: slice.id, defects: defects, reason: reason })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: reason, defects: defects, branch: lastGood ? lastGood.branch : null })
      done[slice.id] = false
      await agent(escalationPrompt(slice, reason, attempt, defects), {
        model: 'sonnet', effort: 'low', label: `escalate:${slice.id}`, phase: node.phase,
      })
      log(`✗ ${slice.id} escalated after ${attempt} attempt(s) — ${reason}.`)
      continue
    }

    // Tests green, craft findings survived → arbiter may accept the debt and keep the commit.
    const decision = await agent(buildArbiterPrompt(slice, defects, rounds), {
      agentType: at(node.arbiter.agent), model: node.arbiter.model, effort: node.arbiter.effort,
      schema: ARBITER, label: `arbiter:${slice.id}`, phase: node.phase,
    })
    if (!decision) {
      escalated.push({ id: slice.id, defects: defects, reason: 'arbiter-silent' })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: 'arbiter-silent', defects: defects, branch: lastGood.branch })
      done[slice.id] = false
      log(`✗ ${slice.id}: the arbiter returned nothing — not recording a soft-pass nobody decided.`)
      continue
    }
    const vh = (decision.records || []).map((r) => r.id).filter(Boolean)
    shipped.push({ id: slice.id, branch: lastGood.branch, sha: lastGood.sha, softPass: true, vh: vh })
    rows.push({ id: slice.id, attempts: attempt, verdict: 'soft-pass', sha: lastGood.sha, branch: lastGood.branch, review: reviewScore, vh: vh })
    done[slice.id] = true
    log(`~ ${slice.id} shipped with accepted debt on ${lastGood.branch} (${vh.length} VH record(s)).`)
  }

  const verdict = shipped.length === 0 ? 'hard-fail' : escalated.length || skipped.length ? 'partial' : shipped.some((s) => s.softPass) ? 'soft-pass' : 'pass'
  return {
    node: node.id,
    verdict: verdict,
    score: null,
    rounds: 0,
    slices: { shipped: shipped, escalated: escalated, skipped: skipped, rows: rows },
  }
}

// ────────────────────────────────────────────────────── report node ────
async function writeReport(node) {
  const nodeRows = Object.keys(NODES)
    .filter((id) => NODES[id].kind !== 'report')
    .map((id) => {
      const r = results[id] || { verdict: 'not-run', score: null, rounds: 0 }
      return {
        node: id,
        verdict: r.verdict,
        score: r.score,
        rounds: r.rounds,
        arbitrated: !!r.arbitrated,
        vh: r.vh || [],
        reason: r.reason || null,
      }
    })
  const build = results.build && results.build.slices ? results.build.slices : { shipped: [], escalated: [], skipped: [], rows: [] }
  const softPassed = nodeRows
    .filter((r) => r.verdict === 'soft-pass')
    .map((r) => r.node)
    .concat(build.shipped.filter((s) => s.softPass).map((s) => `build:${s.id}`))
  const disputed = []
  for (const id of Object.keys(results)) {
    for (const d of results[id].disputed || []) disputed.push({ node: id, criterion: d.criterion, why: d.why })
  }

  await agent(
    `Write the sdlc2 run report to ${REPORT} (create the directory if needed; this is the ONLY\n` +
      `file you write). Use exactly this data — invent nothing:\n\n` +
      `Feature: ${FEATURE} — "${TITLE}"\nRun: ${RUN_ID}\nBase branch: ${BASE}\n` +
      `Node results: ${JSON.stringify(nodeRows)}\n` +
      `Slices: ${JSON.stringify(build.rows)}\n` +
      `Soft-passed: ${JSON.stringify(softPassed)}\n` +
      `Maker disputes (checker findings the maker addressed but disagreed with): ${JSON.stringify(disputed)}\n\n` +
      `Structure: (1) a node table — node · verdict · score · rounds · arbitrated · VH ids · reason;\n` +
      `(2) a slice table — slice · attempts · verdict · branch@sha · review score · reason;\n` +
      `(3) a human-verify index: read ${VH} if it exists and list every OPEN row (id · node ·\n` +
      `severity · one-line decision);\n` +
      `(4) the maker disputes, if any — they are unresolved disagreements, not noise;\n` +
      `(5) a 2–3 sentence summary, then the next human action.\n\n` +
      `A node verdict of \`hard-fail\`, \`escalated\`, \`skipped\` or \`not-run\` MUST be stated as such\n` +
      `and never softened. If anything soft-passed, say so in the FIRST line of the summary — a run\n` +
      `with a soft-pass is never described as clean. Close by stating that sdlc2 has not merged\n` +
      `anything and that reviewing and merging the slice/ branches is the human's job.`,
    { model: node.maker.model, effort: node.maker.effort, label: 'report', phase: node.phase }
  )
  return { node: node.id, verdict: 'pass', score: null, rounds: 0, report: REPORT }
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

async function walk() {
  const preds = predecessorsOf()
  const ids = Object.keys(NODES)
  let guard = 0

  while (Object.keys(results).length < ids.length && guard++ <= ids.length + 1) {
    const ready = ids.filter((id) => !(id in results) && preds[id].every((p) => p in results))
    if (!ready.length) break

    const toRun = []
    for (const id of ready) {
      const node = NODES[id]
      const terminal = node.kind === 'report' // reporting survives every outcome
      const upstreamDead = preds[id].filter((p) => blocksSuccessors(results[p]))

      if (!terminal && upstreamDead.length) {
        results[id] = { node: id, verdict: 'skipped', score: null, rounds: 0, reason: `upstream ${upstreamDead.join(', ')} did not pass` }
        log(`${id} skipped — ${results[id].reason}.`)
        continue
      }
      if (!terminal && node.when && !node.when(state)) {
        results[id] = { node: id, verdict: 'skipped', score: null, rounds: 0, gated: true, reason: 'gate condition not met' }
        log(`${id} skipped — its gate condition is not met (${id === 'ux' ? 'the product framing declared no UI stories' : `see NODES.${id}.when`}).`)
        continue
      }
      if (!terminal && budget.total && budget.remaining() < BUDGET_FLOOR) {
        results[id] = { node: id, verdict: 'skipped', score: null, rounds: 0, reason: 'budget nearly spent' }
        log(`${id} skipped — budget nearly spent.`)
        continue
      }
      toRun.push(node)
    }
    if (!toRun.length) continue

    log(`▸ ${toRun.map((n) => n.id).join(' ∥ ')}`)
    const announced = []
    for (const n of toRun) {
      if (announced.indexOf(n.phase) >= 0) continue
      announced.push(n.phase)
      phase(n.phase)
    }
    const out = await parallel(toRun.map((n) => () => RUNNERS[n.kind](n)))

    // Arbitration is SERIAL on purpose: every arbiter read-then-appends the one
    // VERIFY-WITH-HUMAN.md, and two doing it at once means duplicate VH ids and a lost row.
    for (let i = 0; i < toRun.length; i++) {
      const n = toRun[i]
      let r = out[i]
      if (!r) {
        r = { node: n.id, verdict: 'hard-fail', score: null, rounds: 0, defects: [], reason: 'the node crashed — no result returned' }
        log(`${n.id}: crashed. Recorded as a hard fail; the graph continues so the run is still reported.`)
      }
      if (r.verdict === 'needs-arbitration') r = await arbitrate(n, r)
      results[n.id] = r
      state[n.id] = (r && r.maker) || {}
    }
  }

  for (const id of ids) {
    if (!(id in results)) results[id] = { node: id, verdict: 'not-run', score: null, rounds: 0, reason: 'never became ready — check the graph edges' }
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
