#!/usr/bin/env node
// verify.mjs — structural conformance check for the sdlc2 plugin.
//
//   node verify.mjs
//
// Proves what can be proven WITHOUT executing the graph: manifests parse, the engine's node table
// and rubrics are well-formed, the pure helpers behave, the prompt builders take no forbidden
// input, and the bundle references no other harness. It cannot prove the graph produces good
// software — only a real `/sdlc2 new-feature` run can. Exits non-zero on any failure.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const R = (p) => readFileSync(join(ROOT, p), 'utf8')

let fails = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const no = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fails++ }
const check = (cond, m) => (cond ? ok(m) : no(m))
const group = (t) => console.log(`\n${t}`)

// ── 1. packaging ──────────────────────────────────────────────────────────
group('packaging')
let plugin, market
try { plugin = JSON.parse(R('.claude-plugin/plugin.json')); ok('plugin.json parses') } catch (e) { no(`plugin.json parses (${e.message})`) }
try { market = JSON.parse(R('.claude-plugin/marketplace.json')); ok('marketplace.json parses') } catch (e) { no(`marketplace.json parses (${e.message})`) }
check(plugin && plugin.name === 'sdlc2', 'plugin is named sdlc2')
check(market && market.plugins && market.plugins.length === 1 && market.plugins[0].name === 'sdlc2', 'marketplace lists exactly this plugin')
check(existsSync(join(ROOT, 'commands/sdlc2.md')), 'router command commands/sdlc2.md exists  [R-PKG-02]')
for (const m of ['modes/new-feature.md', 'modes/status.md']) check(existsSync(join(ROOT, m)), `${m} exists`)

// ── 2. independence ───────────────────────────────────────────────────────
group('independence  [R-IND-01..04]')
const shipped = []
;(function walk(d) {
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = d ? `${d}/${e.name}` : e.name
    if (e.isDirectory()) walk(p)
    else if (/\.(md|js|mjs|json)$/.test(e.name)) shipped.push(p)
  }
})('')
// /sdlc-OWNED paths only. `CONTEXT-MAP.md` at a repo ROOT is the domain-modeling skill's own
// DDD convention and is not coupling — the /sdlc artifact is docs/agents/CONTEXT-MAP.md.
const foreign = [/~\/\.claude\/skills\/sdlc\b/, /\.scratch\//, /docs\/agents\//, /\/sdlc\s+(run|feature|setup|onboard|hunt|integrate)\b/]
const hits = []
for (const f of shipped) {
  if (f === 'verify.mjs') continue // it contains the patterns by definition
  const body = R(f)
  for (const rx of foreign) if (rx.test(body)) hits.push(`${f} :: ${rx}`)
}
check(hits.length === 0, `no reference to another harness${hits.length ? ' — ' + hits.join(', ') : ''}`)
const hardcoded = shipped.filter((f) => /~\/\.claude\//.test(R(f)) && !/verify\.mjs|SPEC\.md/.test(f))
check(hardcoded.length === 0, `no hardcoded ~/.claude path${hardcoded.length ? ' — ' + hardcoded.join(', ') : ''}  [R-PKG-03]`)
check(/\$\{CLAUDE_PLUGIN_ROOT\}/.test(R('commands/sdlc2.md')), 'router resolves plugin files via ${CLAUDE_PLUGIN_ROOT}')

// ── 3. personas ───────────────────────────────────────────────────────────
group('personas  [R-IND-02]')
const agentFiles = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md'))
check(agentFiles.length === 9, `9 personas bundled (found ${agentFiles.length})`)
const names = new Set()
let badFm = 0
for (const f of agentFiles) {
  const body = R(`agents/${f}`)
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const nm = m && m[1].match(/^name:\s*(\S+)/m)
  if (!m || !nm || !nm[1].startsWith('sdlc2-')) { badFm++; continue }
  names.add(nm[1])
}
check(badFm === 0, 'every persona has frontmatter with an sdlc2-* name')
check(names.size === agentFiles.length, 'persona names are unique')
check(!/tools:.*browser/i.test(R('agents/sdlc2-ux-auditor.md')), 'ux-auditor ships without browser tools (spec mode)  [R-UX-03]')
for (const s of ['grill-with-docs', 'grilling', 'domain-modeling', 'outside-in-tdd'])
  check(existsSync(join(ROOT, `skills/${s}/SKILL.md`)), `bundled skill ${s}`)

// ── 4. the engine, structurally ───────────────────────────────────────────
group('engine')
const src = R('new-feature.workflow.js')
// Evaluate everything up to the graph walk: declarations and functions only, no agent calls.
const cut = src.indexOf('// ───────────────────────────────────────────────────── graph walk ────')
check(cut > 0, 'graph-walk marker present (declarations are separable from execution)')
const head = src.slice(0, cut).replace('export const meta', 'const meta')
let M
try {
  M = new Function(
    'args',
    `${head}\n return { meta, RUBRICS, NODES, weightedTotal, configFor, cleanDefects, dedupe, blockingOpen, makerPrompt, checkerPrompt, arbiterPrompt, rubricTable };`
  )({ feature: 'demo', config: { commands: { test: 'X' }, seam: {} }, configByDir: { 'frontend/': { commands: { test: 'npm test' } } } })
  ok('engine declarations evaluate cleanly')
} catch (e) { no(`engine declarations evaluate cleanly (${e.message})`) }

if (M) {
  // rubrics
  for (const [k, r] of Object.entries(M.RUBRICS)) {
    const sum = Math.round(r.criteria.reduce((a, c) => a + c.weight, 0) * 100) / 100
    check(sum === 1, `rubric ${k}: weights sum to 1.00 (got ${sum})  [R-RUB]`)
    check(r.criteria.every((c) => c.anchors && c.anchors.includes('1.0')), `rubric ${k}: every criterion has 0/0.5/1.0 anchors`)
    check(typeof r.threshold === 'number' && r.threshold > 0 && r.threshold <= 1, `rubric ${k}: threshold ${r.threshold}`)
  }
  // node table
  const need = ['id', 'phase', 'mandate', 'maker', 'checkers', 'arbiter', 'rubric', 'rounds', 'inputs', 'outputs', 'when', 'next']
  for (const [id, n] of Object.entries(M.NODES)) {
    check(need.every((f) => f in n), `node ${id}: has every required field  [R-GRAPH-01]`)
    const roles = [n.maker, n.arbiter, ...n.checkers]
    check(roles.every((r) => r && r.model && r.effort), `node ${id}: every role declares model+effort  [R-MODEL-01]`)
    check(roles.every((r) => ['sonnet', 'opus', 'haiku'].includes(r.model)), `node ${id}: model aliases only, no dated ids  [R-MODEL-02]`)
    check(n.arbiter.agent === n.maker.agent, `node ${id}: arbiter is the maker's persona  [R-LOOP-07]`)
    check(M.RUBRICS[n.rubric] !== undefined, `node ${id}: rubric '${n.rubric}' exists`)
    check(n.rounds === 5, `node ${id}: 5 rounds`)
  }
  check(M.NODES.build.checkers.some((c) => c.binary && c.arbitrable === false), 'build: the tester is binary and NOT arbitrable  [R-BUILD-01]')
  check(M.NODES.build.checkers.some((c) => c.arbitrable === true), 'build: the code reviewer IS arbitrable  [R-BUILD-03]')
  check(typeof M.NODES.ux.when === 'function' && M.NODES.ux.when({ po: { hasUiStories: false } }) === false, 'ux: gated by po.hasUiStories  [R-GRAPH-03]')

  // pure helpers
  const perfect = { criteria: M.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 1 })) }
  const zero = { criteria: M.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 0 })) }
  check(M.weightedTotal('po', perfect) === 1, 'weightedTotal: all-1 scores → 1.00')
  check(M.weightedTotal('po', zero) === 0, 'weightedTotal: all-0 scores → 0.00')
  check(M.weightedTotal('po', { criteria: [{ id: 'PO-AC', score: 1 }] }) === 0.3, 'weightedTotal: a missing criterion counts as 0, not as absent')
  check(M.weightedTotal('po', { criteria: [{ id: 'PO-AC', score: 99 }] }) === 0.3, 'weightedTotal: scores are clamped to 0..1')
  check(M.cleanDefects({ defects: [{ criterion: 'a', evidence: '' }, { criterion: 'b', evidence: 'x' }] }).length === 1, 'cleanDefects: drops a defect with no quoted evidence  [R-LOOP-06]')
  check(M.dedupe([{ criterion: 'a', location: 'f:1' }, { criterion: 'a', location: 'f:1' }, { criterion: 'a', location: 'f:2' }]).length === 2, 'dedupe: by (criterion, location)  [R-LOOP-05]')
  check(M.blockingOpen([{ severity: 'high' }, { severity: 'low' }]).length === 1, 'blockingOpen: critical/high only')
  check(M.configFor('frontend/x').commands.test === 'npm test', 'configFor: nested dir config wins  [R-CFG-04]')
  check(M.configFor('src/main').commands.test === 'X', 'configFor: root config for everything else')
  check(M.configFor('frontend/x').seam !== undefined, 'configFor: merges seam from the root config')

  // prompt hygiene
  const p1 = M.makerPrompt(M.NODES.po, 1, [])
  const p3 = M.makerPrompt(M.NODES.po, 3, [{ criterion: 'PO-AC', severity: 'high', evidence: 'q', fix: 'f' }])
  check(p1.indexOf('MANDATE') < 300 && p1.indexOf('MANDATE') < p1.indexOf('READ THESE PATHS'), 'makerPrompt: mandate precedes the inputs  [R-CTX-04]')
  const tail = p1.slice(p1.lastIndexOf('RUBRIC'))
  check(tail.includes('Return the structured') && !tail.includes('READ THESE PATHS'), 'makerPrompt: nothing but the return instruction follows the rubric  [R-CTX-04]')
  check(p3.includes('ROUND 3'), 'makerPrompt: round number is passed through')
  check(!/transcript|previous round said|earlier you wrote/i.test(p3), 'makerPrompt: carries no prior-round transcript  [R-CTX-03]')
  check(M.makerPrompt(M.NODES.po, 1, []) === p1, 'makerPrompt: pure — same inputs, same output  [R-CTX-05]')
  check(M.makerPrompt.length <= 4 && M.checkerPrompt.length <= 3, 'prompt builders take only (node, round, defects)-shaped input  [R-CTX-05]')
  const cp = M.checkerPrompt(M.NODES.po, M.NODES.po.checkers[0], 2)
  check(/REFUTE/.test(cp) && /Default to FAIL/i.test(cp), 'checkerPrompt: adversarial mandate, default-to-fail')
  check(/READ-ONLY/i.test(cp) && /not seen any other checker/i.test(cp), 'checkerPrompt: read-only and blind to other checkers  [R-LOOP-03]')
  check(/do not compute a total|Do NOT compute a total/i.test(cp), 'checkerPrompt: engine computes the total  [R-LOOP-04]')
  check(!cp.includes('<!DOCTYPE') && !/```html/.test(cp), 'checkerPrompt: no artifact body inlined  [R-CTX-02]')
}

// sandbox rules the Workflow runtime enforces
group('workflow sandbox rules')
check(!/Date\.now\(|Math\.random\(|new Date\(\)/.test(src), 'no Date.now / Math.random / new Date() — they throw in a workflow script')
check(!/require\(|from ['"]node:/.test(src), 'no filesystem or node imports')
check(/Math\.min\.apply/.test(src) && !/scored\.reduce/.test(src), 'step score is a MIN, never an average  [R-LOOP-02]')
check(/for \(const slice of slices\)/.test(src), 'build node iterates slices sequentially  [R-BUILD-04]')
check(!/parallel\(\s*slices/.test(src), 'build node never parallelizes slices  [R-BUILD-04]')
check(/agentPrefix/.test(src) && /function at\(/.test(src), 'agent types are resolved through a host-configurable prefix')

console.log('')
if (fails) { console.log(`\x1b[31mFAILED\x1b[0m — ${fails} check(s)\n`); process.exit(1) }
console.log('\x1b[32mAll structural checks passed.\x1b[0m Note: this proves shape, not behaviour — the first real run is the acceptance test.\n')
