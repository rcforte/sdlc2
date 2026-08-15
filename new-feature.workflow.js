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

const ROUNDS = 5 // max maker rounds before the arbiter — same at every node

// ────────────────────────────────────────────────────────── schemas ────
const DEFECT = {
  type: 'object',
  required: ['criterion', 'severity', 'fix'],
  properties: {
    criterion: { type: 'string' }, // a rubric criterion id
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    location: { type: 'string' }, // file:line or an artifact anchor
    evidence: { type: 'string' }, // QUOTED from the artifact — no evidence, no defect
    fix: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: ['defects'],
  properties: {
    lens: { type: 'string' },
    pass: { type: 'boolean' }, // binary checkers (tester) only — governs directly
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'score'],
        properties: { id: { type: 'string' }, score: { type: 'number' }, why: { type: 'string' } },
      },
    },
    defects: { type: 'array', items: DEFECT },
    hard: { type: 'boolean' }, // a §hard condition was met — stop burning rounds
    notes: { type: 'string' },
  },
}

const MAKER = {
  type: 'object',
  required: ['ok'],
  properties: {
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
  },
}

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
// SOURCE OF TRUTH: SPEC.md §Rubrics. These literals must match it criterion-for-criterion,
// weight-for-weight, threshold-for-threshold — drift is a conformance failure.
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
// executor below. Every role declares its own model and effort; there is no inherited default.
const NODES = {
  po: {
    id: 'po',
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
      { path: `${DIR}/feature.md`, kind: 'feature', note: 'EXTEND the seed in place — preserve its sections, append epics/stories/AC/out-of-scope' },
      { path: `${DIR}/mockup.html`, kind: 'mockup', note: 'ONE self-contained file: inline CSS, no CDN, no network, one screen per story happy path' },
      { path: `${DIR}/issues/NN-slug.md`, kind: 'issues', note: 'one per vertical slice; `## Acceptance criteria` is Gherkin COPIED VERBATIM from feature.md, plus `Blocked by:` and a `Dir:` line naming the directory it mainly touches' },
    ],
    when: null,
    next: ['architect', 'ux'],
  },

  architect: {
    id: 'architect',
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
    inputs: [SEED, `${DIR}/feature.md`, ISSUES, VH],
    outputs: [
      { path: `${DIR}/design.md`, kind: 'design', note: 'domain model · boundaries · ports · THE SEAM PER SLICE' },
      { path: 'docs/adr/NNNN-<slug>.md', kind: 'adr', note: 'one per significant decision; options, decision, consequences, why the alternatives lost' },
    ],
    when: null,
    next: ['build'],
  },

  ux: {
    id: 'ux',
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
    inputs: [`${DIR}/feature.md`, MOCKUP, VH],
    outputs: [
      { path: `${DIR}/mockup.html`, kind: 'mockup', note: 'the SAME file — never a new one; add state variants + navigation, label each with the story/AC it serves' },
    ],
    when: (state) => state.po && state.po.hasUiStories === true,
    next: ['build'],
  },

  build: {
    id: 'build',
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
    inputs: [`${DIR}/feature.md`, DESIGN, MOCKUP, VH],
    outputs: [],
    when: null,
    fanout: 'slices',
    next: ['report'],
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

// A defect without quoted evidence is discarded — it is an assertion, not a finding.
function cleanDefects(verdict) {
  if (!verdict || !Array.isArray(verdict.defects)) return []
  return verdict.defects.filter((d) => d && d.evidence && String(d.evidence).trim().length > 0)
}

function dedupe(defects) {
  const seen = {}
  const out = []
  for (const d of defects) {
    const k = `${d.criterion}|${d.location || ''}`
    if (seen[k]) continue
    seen[k] = true
    out.push(d)
  }
  return out
}

function blockingOpen(defects) {
  return defects.filter((d) => d.severity === 'critical' || d.severity === 'high')
}

// Nested CLAUDE.md wins for slices under its directory: longest matching prefix.
function configFor(dir) {
  if (!dir) return CONFIG
  let best = null
  let bestLen = -1
  for (const prefix of Object.keys(CONFIG_BY_DIR)) {
    if (dir.indexOf(prefix) === 0 && prefix.length > bestLen) {
      best = CONFIG_BY_DIR[prefix]
      bestLen = prefix.length
    }
  }
  if (!best) return CONFIG
  const cmds = Object.assign({}, CONFIG.commands || {}, best.commands || {})
  const seam = Object.assign({}, CONFIG.seam || {}, best.seam || {})
  return { commands: cmds, seam: seam }
}

function conventions(cfg) {
  const c = cfg.commands || {}
  const s = cfg.seam || {}
  return (
    `PROJECT CONVENTIONS (from the project's CLAUDE.md sdlc2 block — authoritative, do not guess):\n` +
    `  test command : ${c.test || '(none — STOP, there is no oracle)'}\n` +
    (c.build ? `  build        : ${c.build}\n` : '') +
    (c.run ? `  run          : ${c.run}\n` : '') +
    (c.e2e ? `  e2e          : ${c.e2e}\n` : '') +
    `  backend seam : ${s.backend || '(none declared)'}\n` +
    `  frontend seam: ${s.frontend || '(none declared)'}\n`
  )
}

// ───────────────────────────────────────────────── prompt builders ────
// PURE functions of (node, round, paths, defects). They never receive a prior round's
// transcript, a prior maker's output body, or another checker's verdict — artifacts travel on
// disk. Mandate first, rubric + schema last: the two highest-attention positions.
function makerPrompt(node, round, defects, extra) {
  const outs = node.outputs
    .map((o) => `  - ${o.path}\n      ${o.note}`)
    .join('\n')
  const repair = defects && defects.length
    ? `\nROUND ${round} of ${node.rounds} — an independent adversarial checker REFUTED the previous round.\n` +
      `Fix EVERY defect below and do not regress what already passed. If you believe a defect is\n` +
      `wrong, still address the underlying concern and record it in \`disputed\` with your reason.\n` +
      `${JSON.stringify(defects, null, 2)}\n`
    : `\nROUND ${round} of ${node.rounds} — first attempt.\n`

  return (
    `You are the \`${node.maker.agent}\` persona working on the feature "${TITLE}" (slug: ${FEATURE}).\n\n` +
    `MANDATE — ${node.mandate}\n` +
    repair +
    `\nREAD THESE PATHS (they exist on disk; nothing is pasted for you):\n` +
    node.inputs.map((p) => `  - ${p}`).join('\n') +
    `\n  - ${VH} — if it exists, these are decisions already taken under caveat. Honour them; do not relitigate.\n` +
    `\n${conventions(CONFIG)}` +
    (extra ? `\n${extra}\n` : '') +
    `\nWRITE YOUR OUTPUT TO DISK:\n${outs}\n` +
    `\nReturn PATHS and a changelog of at most 20 lines — never paste an artifact body back to me.\n` +
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
    node.inputs.map((p) => `  - ${p}`).join('\n') +
    '\n' +
    node.outputs.map((o) => `  - ${o.path}   (the artifact under review)`).join('\n') +
    `\n\n${conventions(CONFIG)}` +
    `\nEVERY defect MUST carry: criterion (a rubric id below), severity, location (file:line or a\n` +
    `precise anchor), evidence (QUOTED from the artifact — not paraphrased), and a concrete fix.\n` +
    `A defect without quoted evidence is discarded by the engine, so it is wasted work.\n` +
    `Set \`hard\` only if the work cannot be judged at all (a required input is missing entirely).\n` +
    `\nRUBRIC — score EACH criterion 0..1 using its anchors. Do NOT compute a total; the engine\n` +
    `computes the weighted total from your per-criterion scores:\n` +
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
    node.inputs.map((p) => `  - ${p}`).join('\n') +
    '\n' +
    node.outputs.map((o) => `  - ${o.path}`).join('\n') +
    `\n  - ${VH} — read it FIRST to find the highest existing VH-NN id; your new ids continue that sequence.\n` +
    `\n${conventions(CONFIG)}` +
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
// One implementation, every node. maker → checkers in parallel → MIN of the weighted totals,
// with any unresolved critical/high vetoing regardless of score → repeat → arbiter.
async function runLoop(node, opts) {
  const o = opts || {}
  const label = o.label || node.id
  let defects = []
  let maker = null
  let score = 0
  let round = 0
  let binaryFailed = false

  while (round < node.rounds) {
    round++
    maker = await agent(makerPrompt(node, round, defects, o.extra), {
      agentType: at(node.maker.agent),
      model: node.maker.model,
      effort: node.maker.effort,
      schema: MAKER,
      label: `${label}:make (${round}/${node.rounds})`,
      phase: node.phase,
    })
    if (!maker || maker.ok === false) {
      defects = [
        {
          criterion: 'engine',
          severity: 'critical',
          location: node.id,
          evidence: (maker && maker.notes) || 'maker agent returned nothing',
          fix: 'produce the required artifacts at the declared paths',
        },
      ]
      log(`${label}: maker produced nothing (round ${round}/${node.rounds}).`)
      continue
    }

    const verdicts = await parallel(
      node.checkers.map((c) => () =>
        agent(checkerPrompt(node, c, round), {
          agentType: at(c.agent),
          model: c.model,
          effort: c.effort,
          schema: VERDICT,
          label: `${label}:${c.agent.replace('sdlc2-', '')} (${round}/${node.rounds})`,
          phase: node.phase,
        }).then((v) => ({ checker: c, verdict: v }))
      )
    )

    const found = []
    const scored = []
    let hard = false
    binaryFailed = false
    for (const r of verdicts.filter(Boolean)) {
      const v = r.verdict
      if (!v) {
        found.push({ criterion: 'engine', severity: 'critical', location: r.checker.agent, evidence: 'checker returned nothing', fix: 're-run' })
        continue
      }
      const ds = cleanDefects(v)
      for (const d of ds) found.push(d)
      if (v.hard === true && r.checker.arbitrable === false) hard = true
      if (r.checker.binary) {
        if (v.pass !== true) binaryFailed = true
      } else {
        scored.push(weightedTotal(node.rubric, v))
      }
    }

    // Weakest link: an adversarial panel is only as green as its harshest lens.
    score = scored.length ? Math.min.apply(null, scored) : 1
    defects = dedupe(found)
    const open = blockingOpen(defects)
    const bar = RUBRICS[node.rubric].threshold

    log(
      `${label} round ${round}/${node.rounds}: score ${score} (bar ${bar}), ` +
        `${defects.length} defect(s), ${open.length} critical/high` +
        (binaryFailed ? ', TESTER RED' : '')
    )

    if (hard) {
      return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: maker, reason: 'hard condition' }
    }
    if (!binaryFailed && score >= bar && open.length === 0) {
      return { node: node.id, verdict: 'pass', score: score, rounds: round, defects: [], maker: maker }
    }
  }

  // Rounds exhausted. A non-arbitrable checker still failing is a hard fail — the executable
  // oracle is not negotiable, and no arbiter may commit over a red test suite.
  if (binaryFailed) {
    return { node: node.id, verdict: 'hard-fail', score: score, rounds: round, defects: defects, maker: maker, reason: 'binary checker still failing' }
  }

  const decision = await agent(arbiterPrompt(node, defects, round), {
    agentType: at(node.arbiter.agent),
    model: node.arbiter.model,
    effort: node.arbiter.effort,
    schema: ARBITER,
    label: `${label}:arbiter`,
    phase: node.phase,
  })
  const records = (decision && decision.records) || []
  log(`${label}: soft-pass at ${score} after ${round} rounds — ${records.length} human-verify record(s).`)
  return {
    node: node.id,
    verdict: 'soft-pass',
    score: score,
    rounds: round,
    defects: defects,
    maker: maker,
    arbitrated: true,
    vh: records.map((r) => r.id).filter(Boolean),
  }
}

// ─────────────────────────────────────────────────────── build node ────
// Sequential by design: one slice at a time, one branch each, no worktrees. Nothing runs
// concurrently, so no isolation machinery is needed — and the entire class of parallel-tree
// bugs cannot occur. Parallelism is a later decision, made with real timing data.
function developerPrompt(slice, cfg, defects, attempt) {
  const repair = defects && defects.length
    ? `\nRepair attempt ${attempt}. The independent checkers refuted the previous attempt.\n` +
      `Fix EVERY defect; do not regress what passed:\n${JSON.stringify(defects, null, 2)}\n`
    : `\nAttempt ${attempt} — first build of this slice.\n`
  return (
    `You are the \`sdlc2-developer\` persona building slice ${slice.id} of feature "${TITLE}".\n\n` +
    `MANDATE — build this ONE vertical slice OUTSIDE-IN. Read and follow sdlc2's own discipline at\n` +
    `${ROOT}/skills/outside-in-tdd/SKILL.md (use that file, not any similarly named skill installed\n` +
    `globally). One Gherkin scenario from the issue becomes ONE failing acceptance test at the\n` +
    `declared seam; keep it red while inner red-green-refactor cycles drive it green.\n` +
    repair +
    `\nREAD:\n  - ${slice.path}   (the issue — its \`## Acceptance criteria\` Gherkin IS the contract)\n` +
    `  - ${DIR}/feature.md\n  - ${DESIGN}   (the architecture, and the seam named for THIS slice)\n` +
    `  - ${MOCKUP}   (frontend work: match its structure, states and controls — not its CSS)\n` +
    `  - ${VH}   (if present — decisions already taken under caveat)\n` +
    `\n${conventions(cfg)}` +
    `\nYOU OWN GIT FOR THIS SLICE — the isolation invariant is non-negotiable:\n` +
    `1. Create branch 'slice/${FEATURE}/${slice.id}' off '${BASE}' and switch to it (if it already\n` +
    `   exists, switch to it). NEVER commit while HEAD is '${BASE}' or detached at its tip: assert\n` +
    `   \`git branch --show-current\` equals the slice branch before EVERY commit.\n` +
    `2. '${BASE}' must not move. Do not merge, rebase onto it, or push anything.\n` +
    `3. Commit only when the acceptance test and the full test command are green.\n` +
    `4. Touch only what this slice needs. Leave the tree clean — no stray files, no debug output.\n` +
    `\nReturn the structured BUILD object: committed, sha, branch, and a short changelog.`
  )
}

function testerPrompt(slice, cfg) {
  return (
    `You are the \`sdlc2-tester\` persona. You did not build this slice and you verify it cold.\n\n` +
    `MANDATE — CONFIRM OR REFUTE slice ${slice.id} against its acceptance criteria using EXECUTABLE\n` +
    `ground truth. You are the only oracle in this graph with real evidence; a red suite is not\n` +
    `negotiable and cannot be waived by anyone. Default to FAIL on any unverified criterion.\n` +
    `\nREAD:\n  - ${slice.path}   (map EVERY Gherkin scenario to an observable check)\n  - ${DIR}/feature.md\n` +
    `\n${conventions(cfg)}` +
    `\nMETHOD:\n` +
    `1. Run the test command above from the slice branch 'slice/${FEATURE}/${slice.id}'. Report\n` +
    `   failures with real output, never paraphrased.\n` +
    `2. Map every acceptance criterion to a check that actually ran. An unverified criterion is a\n` +
    `   defect, not a pass.\n` +
    `3. Probe the edges the developer did not: boundaries, error paths, empty and duplicate input.\n` +
    `4. If the slice changed existing behaviour, a regression net around the blast radius must\n` +
    `   exist and be green. A silently edited existing test is a critical defect.\n` +
    `\nSet \`pass\` true ONLY if the suite is green AND every acceptance criterion is verified.\n` +
    `You are read-only: never fix anything, never edit a test to make it pass.\n` +
    `Every defect needs quoted evidence (real command output or a real assertion).\n` +
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
    `\n${conventions(cfg)}` +
    `\nScore ONLY what this slice changed — pre-existing debt elsewhere is out of scope and\n` +
    `reporting it wastes a round.\n` +
    `\nRUBRIC — score each 0..1 using its anchors; do not compute a total:\n${rubricTable('build')}\n` +
    `\nReturn the structured VERDICT object.`
  )
}

function buildArbiterPrompt(slice, defects) {
  return (
    `You are the \`sdlc2-developer\` persona in DECIDE MODE for slice ${slice.id}.\n\n` +
    `MANDATE — the test suite is GREEN and the acceptance criteria are verified, but the code\n` +
    `reviewer's findings survived ${ROUNDS} rounds. Decide, per finding, whether to fix it now or\n` +
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

async function buildSlices() {
  phase('Build')
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
    { schema: SLICES, model: 'sonnet', effort: 'low', label: 'slices:resolve', phase: 'Build' }
  )
  const slices = (plan && plan.slices) || []
  if (!slices.length) {
    log('No slices found — the product-owner node produced no issues.')
    return { shipped: [], escalated: [], skipped: [], rows: [] }
  }
  log(`${slices.length} slice(s) queued; building sequentially on branches off ${BASE}.`)

  const shipped = []
  const escalated = []
  const skipped = []
  const rows = []
  const done = {} // id → shipped?

  for (const slice of slices) {
    const blockers = slice.blockedBy || []
    const blocked = blockers.filter((b) => done[b] === false || done[b] === undefined && blockers.length && !(b in done))
    if (blockers.some((b) => done[b] === false)) {
      log(`Skipping ${slice.id} — blocker did not ship.`)
      skipped.push({ id: slice.id, reason: 'blocker-failed' })
      rows.push({ id: slice.id, attempts: 0, verdict: 'skipped', reason: 'blocker-failed' })
      done[slice.id] = false
      continue
    }
    if (budget.total && budget.remaining() < 60000) {
      log(`Budget nearly spent — skipping ${slice.id} and everything after it.`)
      skipped.push({ id: slice.id, reason: 'budget' })
      rows.push({ id: slice.id, attempts: 0, verdict: 'skipped', reason: 'budget' })
      done[slice.id] = false
      continue
    }

    const cfg = configFor(slice.dir)
    let defects = []
    let build = null
    let attempt = 0
    let testerPass = false
    let reviewScore = 0

    while (attempt < ROUNDS) {
      attempt++
      build = await agent(developerPrompt(slice, cfg, defects, attempt), {
        agentType: at('sdlc2-developer'),
        model: 'opus',
        effort: 'xhigh',
        schema: BUILD,
        label: `build:${slice.id} (${attempt}/${ROUNDS})`,
        phase: 'Build',
      })
      if (!build || build.committed !== true) {
        defects = [
          {
            criterion: 'build',
            severity: 'critical',
            location: slice.id,
            evidence: (build && build.notes) || 'developer did not reach a green commit',
            fix: 'reach green and commit on the slice branch',
          },
        ]
        log(`${slice.id}: no commit (attempt ${attempt}/${ROUNDS}).`)
        continue
      }

      const verdicts = await parallel([
        () => agent(testerPrompt(slice, cfg), {
          agentType: at('sdlc2-tester'), model: 'opus', effort: 'xhigh', schema: VERDICT,
          label: `test:${slice.id} (${attempt}/${ROUNDS})`, phase: 'Build',
        }),
        () => agent(reviewerPrompt(slice, cfg), {
          agentType: at('sdlc2-code-reviewer'), model: 'opus', effort: 'xhigh', schema: VERDICT,
          label: `review:${slice.id} (${attempt}/${ROUNDS})`, phase: 'Build',
        }),
      ])
      const tv = verdicts[0]
      const rv = verdicts[1]
      testerPass = !!(tv && tv.pass === true)
      reviewScore = weightedTotal('build', rv)
      const all = dedupe(cleanDefects(tv).concat(cleanDefects(rv)))
      const open = blockingOpen(all)

      log(
        `${slice.id} attempt ${attempt}/${ROUNDS}: tester ${testerPass ? 'GREEN' : 'RED'}, ` +
          `code-review ${reviewScore} (bar ${RUBRICS.build.threshold}), ${open.length} critical/high`
      )

      if (testerPass && reviewScore >= RUBRICS.build.threshold && open.length === 0) {
        shipped.push({ id: slice.id, branch: build.branch, sha: build.sha })
        rows.push({ id: slice.id, attempts: attempt, verdict: 'pass', sha: build.sha, branch: build.branch, review: reviewScore })
        done[slice.id] = true
        log(`✓ ${slice.id} shipped on ${build.branch} @ ${build.sha || '?'}`)
        break
      }
      defects = all
    }

    if (done[slice.id] === true) continue

    if (!testerPass) {
      // The executable oracle is not arbitrable: no commit stands on a red suite.
      escalated.push({ id: slice.id, defects: defects, reason: 'tester-red' })
      rows.push({ id: slice.id, attempts: attempt, verdict: 'escalated', reason: 'tester-red', defects: defects })
      done[slice.id] = false
      await agent(
        `Escalate sdlc2 slice ${slice.id} (${slice.path}). Append a dated \`## Status\` note to that\n` +
          `issue file recording: needs a human, ${attempt} attempts, the tester never went green, and\n` +
          `these unresolved defects: ${JSON.stringify(defects)}. Leave the branch\n` +
          `'slice/${FEATURE}/${slice.id}' unmerged and modify no other file.`,
        { model: 'sonnet', effort: 'low', label: `escalate:${slice.id}`, phase: 'Build' }
      )
      log(`✗ ${slice.id} escalated after ${attempt} attempt(s) — tester never green, nothing committed for it.`)
      continue
    }

    // Tests green, craft findings survived → arbiter may accept the debt and keep the commit.
    const decision = await agent(buildArbiterPrompt(slice, defects), {
      agentType: at('sdlc2-developer'), model: 'opus', effort: 'max', schema: ARBITER,
      label: `arbiter:${slice.id}`, phase: 'Build',
    })
    const vh = ((decision && decision.records) || []).map((r) => r.id).filter(Boolean)
    shipped.push({ id: slice.id, branch: build.branch, sha: build.sha, softPass: true, vh: vh })
    rows.push({ id: slice.id, attempts: attempt, verdict: 'soft-pass', sha: build.sha, branch: build.branch, review: reviewScore, vh: vh })
    done[slice.id] = true
    log(`~ ${slice.id} shipped with accepted debt on ${build.branch} (${vh.length} VH record(s)).`)
  }

  return { shipped, escalated, skipped, rows }
}

// ───────────────────────────────────────────────────── graph walk ────
// Generic: resolve ready nodes, run them, follow the exit edges. Adding a node to NODES needs
// no change here.
const state = {}
const results = {}

phase('Product')
log(`sdlc2 · feature "${TITLE}" (${FEATURE}) · run ${RUN_ID} · base ${BASE}`)

results.po = await runLoop(NODES.po)
state.po = { hasUiStories: !!(results.po.maker && results.po.maker.hasUiStories) }
if (results.po.verdict === 'hard-fail') {
  log('po hard-failed — nothing downstream can be correct. Stopping.')
  return {
    runId: RUN_ID, feature: FEATURE, halted: 'po-hard-fail',
    nodes: results, summary: 'product framing hard-failed; see the defects and the seed',
  }
}

phase('Design')
const designNodes = [NODES.architect]
if (NODES.ux.when(state)) designNodes.push(NODES.ux)
else log('ux node skipped — the product framing declared no UI stories.')

const designed = await parallel(designNodes.map((n) => () => runLoop(n)))
for (const r of designed.filter(Boolean)) results[r.node] = r
if (!NODES.ux.when(state)) results.ux = { node: 'ux', verdict: 'skipped', score: null, rounds: 0 }

const designHardFail = designed.filter(Boolean).filter((r) => r.verdict === 'hard-fail')
let built = { shipped: [], escalated: [], skipped: [], rows: [] }
if (designHardFail.length) {
  log(`${designHardFail.map((r) => r.node).join(', ')} hard-failed — skipping the build node.`)
} else {
  built = await buildSlices()
}

phase('Report')
const nodeRows = ['po', 'architect', 'ux'].map((k) => {
  const r = results[k] || { node: k, verdict: 'not-run', score: null, rounds: 0 }
  return { node: k, verdict: r.verdict, score: r.score, rounds: r.rounds, arbitrated: !!r.arbitrated, vh: r.vh || [] }
})
const softPassed = nodeRows.filter((r) => r.verdict === 'soft-pass').map((r) => r.node)
  .concat(built.shipped.filter((s) => s.softPass).map((s) => `build:${s.id}`))

await agent(
  `Write the sdlc2 run report to ${DIR}/runs/${RUN_ID}.md (create the directory if needed; this is\n` +
    `the ONLY file you write). Use exactly this data — invent nothing:\n\n` +
    `Feature: ${FEATURE} — "${TITLE}"\nRun: ${RUN_ID}\nBase branch: ${BASE}\n` +
    `Node results: ${JSON.stringify(nodeRows)}\n` +
    `Slices: ${JSON.stringify(built.rows)}\n` +
    `Soft-passed: ${JSON.stringify(softPassed)}\n\n` +
    `Structure: (1) a node table — node · verdict · score · rounds · arbitrated · VH ids;\n` +
    `(2) a slice table — slice · attempts · verdict · branch@sha · review score · reason;\n` +
    `(3) a human-verify index: read ${VH} if it exists and list every OPEN row (id · node ·\n` +
    `severity · one-line decision);\n` +
    `(4) a 2–3 sentence summary, then the next human action.\n\n` +
    `If anything soft-passed, say so in the FIRST line of the summary — a run with a soft-pass is\n` +
    `never described as clean. Close by stating that sdlc2 has not merged anything and that\n` +
    `reviewing and merging the slice/ branches is the human's job.`,
  { model: 'sonnet', effort: 'low', label: 'report', phase: 'Report' }
)

return {
  runId: RUN_ID,
  feature: FEATURE,
  halted: false,
  nodes: nodeRows,
  shipped: built.shipped,
  escalated: built.escalated,
  skipped: built.skipped,
  softPassed: softPassed,
  report: `${DIR}/runs/${RUN_ID}.md`,
  verifyWithHuman: VH,
  summary:
    `${built.shipped.length} slice(s) shipped, ${built.escalated.length} escalated, ` +
    `${built.skipped.length} skipped` +
    (softPassed.length ? ` · SOFT-PASSED: ${softPassed.join(', ')}` : ' · all nodes passed clean'),
}
