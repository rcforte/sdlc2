#!/usr/bin/env node
// verify.mjs — conformance check for the sdlc2 plugin.
//
//   node verify.mjs
//
// Two halves:
//   STRUCTURE — manifests parse, the node table and rubrics are well-formed, prompts take no
//               forbidden input, the bundle depends on nothing outside itself.
//   BEHAVIOUR — the engine's declarations (everything above the `graph walk` marker, executor
//               included) are evaluated with stubbed agent/parallel/log/budget, and the loop,
//               the build node and the graph walk are driven through their FAILURE paths. This
//               is where a dead checker, a vanished developer and a crashed node are proven not
//               to produce a green run.
//
// It still cannot prove the graph produces good software — only a real `/sdlc2 new-feature` run
// can. Exits non-zero on any failure.

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
check(plugin && plugin.version === R('VERSION').trim(), `plugin.json version matches VERSION (${R('VERSION').trim()})`)

// ── 2. independence ───────────────────────────────────────────────────────
group('independence  [R-IND-01..04]')
const shipped = []
;(function walkDir(d) {
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = d ? `${d}/${e.name}` : e.name
    if (e.isDirectory()) walkDir(p)
    // .sh/.ps1 are scanned too: they ship inside the bundle, and a shipped file the
    // independence grep cannot see is exactly how the v0.1.0 review's H12/H13 survived.
    else if (/\.(md|js|mjs|json|sh|ps1)$/.test(e.name)) shipped.push(p)
  }
})('')
const SELF = /verify\.mjs|SPEC\.md|REVIEW-[\d.]+\.md/
// /sdlc-OWNED paths only. `CONTEXT-MAP.md` at a repo ROOT is the domain-modeling skill's own
// DDD convention and is not coupling — the /sdlc artifact is docs/agents/CONTEXT-MAP.md.
const foreign = [/~\/\.claude\/skills\/sdlc\b/, /\.scratch\//, /docs\/agents\//, /\/sdlc\s+(run|feature|setup|onboard|hunt|integrate)\b/]
const hits = []
for (const f of shipped) {
  if (SELF.test(f)) continue // these files name the patterns in order to forbid them
  const body = R(f)
  for (const rx of foreign) if (rx.test(body)) hits.push(`${f} :: ${rx}`)
}
check(hits.length === 0, `no reference to another harness${hits.length ? ' — ' + hits.join(', ') : ''}`)
const hardcoded = shipped.filter((f) => /~\/\.claude\//.test(R(f)) && !SELF.test(f))
check(hardcoded.length === 0, `no hardcoded ~/.claude path${hardcoded.length ? ' — ' + hardcoded.join(', ') : ''}  [R-PKG-03]`)
check(/\$\{CLAUDE_PLUGIN_ROOT\}/.test(R('commands/sdlc2.md')), 'router resolves plugin files via ${CLAUDE_PLUGIN_ROOT}')
// A persona that grants an MCP tool depends on whatever plugin/server provides it. sdlc2 runs on
// core tools only, so uninstalling anything else cannot break it.  [R-IND-04]
const mcpDeps = shipped.filter((f) => !SELF.test(f) && /mcp__/.test(R(f)))
check(mcpDeps.length === 0, `no cross-plugin MCP tool dependency${mcpDeps.length ? ' — ' + mcpDeps.join(', ') : ''}  [R-IND-04]`)

// ── 3. personas ───────────────────────────────────────────────────────────
group('personas  [R-IND-02]')
const agentFiles = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md'))
check(agentFiles.length === 9, `9 personas bundled (found ${agentFiles.length})`)
const names = new Set()
const CORE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'])
let badFm = 0
let noTools = []
let badTools = []
for (const f of agentFiles) {
  const body = R(`agents/${f}`)
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const nm = m && m[1].match(/^name:\s*(\S+)/m)
  if (!m || !nm || !nm[1].startsWith('sdlc2-')) { badFm++; continue }
  names.add(nm[1])
  const tl = m[1].match(/^tools:\s*(.+)$/m)
  if (!tl) { noTools.push(f); continue }
  for (const t of tl[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!CORE_TOOLS.has(t)) badTools.push(`${f}:${t}`)
  }
}
check(badFm === 0, 'every persona has frontmatter with an sdlc2-* name')
check(names.size === agentFiles.length, 'persona names are unique')
check(noTools.length === 0, `every persona pins its tools${noTools.length ? ' — missing in ' + noTools.join(', ') : ''}  [R-IND-02]`)
check(badTools.length === 0, `every granted tool is a core tool${badTools.length ? ' — ' + badTools.join(', ') : ''}  [R-IND-04]`)
for (const f of agentFiles) {
  const tl = R(`agents/${f}`).match(/^tools:\s*(.+)$/m)
  if (tl && /browser|playwright/i.test(tl[1])) no(`${f} grants a browser tool`)
}
check(!/tools:.*browser/i.test(R('agents/sdlc2-ux-auditor.md')), 'ux-auditor ships without browser tools (spec mode)  [R-UX-03]')
check(!/tools:.*browser/i.test(R('agents/sdlc2-ux-design.md')), 'ux-design ships without browser tools (spec mode)  [R-UX-03]')
const BUNDLED = readdirSync(join(ROOT, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
for (const s of ['grill-with-docs', 'grilling', 'domain-modeling', 'outside-in-tdd'])
  check(existsSync(join(ROOT, `skills/${s}/SKILL.md`)), `bundled skill ${s}`)
// A persona that says "reach for `some-skill`" resolves it against the HOST's installed skills.
// Only sdlc2's own skills may be named, and only by their plugin-root path.  [R-IND-02]
const TECHNICAL_TERMS = new Set(['aria-label', 'unverified-regression'])
const strayNames = []
const unrooted = []
for (const f of agentFiles) {
  const body = R(`agents/${f}`)
  for (const t of body.match(/`[^`\n]+`/g) || []) {
    const name = t.slice(1, -1)
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) continue
    if (TECHNICAL_TERMS.has(name)) continue
    strayNames.push(`${f}:${name}`)
  }
  for (const s of BUNDLED) {
    const re = new RegExp(`(?<!/)\\b${s}\\b`, 'g')
    for (const m of body.split('\n')) {
      if (re.test(m) && !m.includes('${CLAUDE_PLUGIN_ROOT}/skills/') && !/sdlc2's own|not any similarly named|own copy/i.test(m)) {
        unrooted.push(`${f}: ${m.trim().slice(0, 60)}`)
      }
    }
  }
}
check(strayNames.length === 0, `no persona names a skill sdlc2 does not bundle${strayNames.length ? ' — ' + strayNames.join(', ') : ''}  [R-IND-02]`)
check(unrooted.length === 0, `bundled skills are referenced by \${CLAUDE_PLUGIN_ROOT} path${unrooted.length ? ' — ' + unrooted.join(' | ') : ''}  [R-IND-02]`)

// ── 3b. installers ────────────────────────────────────────────────────────
group('installers  [R-PKG-05]')
const INSTALLERS = ['install.sh', 'install.ps1']
const installers = {}
for (const f of INSTALLERS) {
  const present = existsSync(join(ROOT, f))
  check(present, `${f} exists`)
  if (present) installers[f] = R(f)
}
const readme = R('README.md')
for (const [f, body] of Object.entries(installers)) {
  // Installation goes through the documented CLI and nothing else. Anything that clones,
  // writes under $HOME, or edits a project's CLAUDE.md is doing the host's job for it.
  check(/claude plugin (marketplace add|install)/.test(body), `${f}: installs through the documented \`claude plugin\` CLI  [R-PKG-05]`)
  check(!/(^|[;&|(`\s])git\s+(clone|pull|fetch|checkout|init|remote)\b/m.test(body), `${f}: never runs git — Claude Code fetches the plugin  [R-PKG-05]`)
  check(!/~\/\.claude|\$HOME\/\.claude|USERPROFILE|\$env:HOME/.test(body), `${f}: writes no path under the user's home  [R-PKG-05]`)
  check(!/(>>?|Set-Content|Add-Content|Out-File|tee)\s*[^\n]*CLAUDE\.md/i.test(body), `${f}: never writes a project's CLAUDE.md  [R-CFG-03]`)
  // Piped into a shell, the script IS stdin — a prompt would read the rest of itself.
  check(!/\bread\s+-[rp]|\bRead-Host\b|\bselect\b\s+\w+\s+in\b/.test(body), `${f}: never prompts — the documented delivery pipes it into a shell  [R-PKG-05]`)
  check(body.includes(market ? market.name : 'sdlc2-marketplace'), `${f}: names the marketplace declared in marketplace.json  [R-PKG-01]`)
  check(readme.includes(f), `${f}: documented in README.md`)
  // `claude plugin update` rejects the bare name (`Plugin "sdlc2" not found`) while
  // `details` accepts it. One qualified id everywhere; this is the regression guard.
  check(/PLUGIN_ID|PluginId/.test(body), `${f}: uses one qualified plugin@marketplace id  [R-PKG-05]`)
  check(!/plugin (update|install|details)\s+"?\$\{?(PLUGIN|Plugin)\}?"?(\s|$)/m.test(body), `${f}: never passes the bare plugin name to the CLI  [R-PKG-05]`)
}
// The asserted counts ARE the shipped counts, so a tenth persona fails here rather than
// shipping an installer that green-lights a half-registered plugin.
for (const [f, body] of Object.entries(installers)) {
  const a = body.match(/Expect_?Agents\s*=\s*(\d+)/i)
  const s = body.match(/Expect_?Skills\s*=\s*(\d+)/i)
  // `claude plugin details` counts slash COMMANDS under Skills — claude-md-management
  // ships 1 skill + 1 command and reports Skills (2) — so the expected total is the
  // bundled skills plus the /sdlc2 router.
  const commandCount = readdirSync(join(ROOT, 'commands')).filter((n) => n.endsWith('.md')).length
  check(a && Number(a[1]) === agentFiles.length, `${f}: asserts ${agentFiles.length} agents, the number this repo ships  [R-PKG-05]`)
  check(s && Number(s[1]) === BUNDLED.length + commandCount, `${f}: asserts ${BUNDLED.length + commandCount} skills — ${BUNDLED.length} bundled plus ${commandCount} command, which the CLI counts under Skills  [R-PKG-05]`)
}
// There is no Commands category in the inventory, so an installer that asserted one
// would fail on a correct install. This exact mistake was caught by running the script.
for (const [f, body] of Object.entries(installers)) {
  check(!/Expect_?Commands/i.test(body), `${f}: asserts no Commands count — the CLI inventory has no such category`)
}
check(/raw\.githubusercontent\.com\/rcforte\/sdlc2\/[^/\s]+\/install\.sh/.test(readme), 'README one-liner points at this repo\'s install.sh')
check(/raw\.githubusercontent\.com\/rcforte\/sdlc2\/[^/\s]+\/install\.ps1/.test(readme), 'README one-liner points at this repo\'s install.ps1')

// ── 4. the engine, structurally ───────────────────────────────────────────
group('engine — structure')
const src = R('new-feature.workflow.js')
// Everything up to the graph walk is declaration: constants, schemas, helpers, prompts, the loop,
// the build node AND the executor. Nothing below it but the run itself.
const MARK = ' graph walk ────'
const cut = src.indexOf(MARK) >= 0 ? src.lastIndexOf('//', src.indexOf(MARK)) : -1
check(cut > 0, 'graph-walk marker present (declarations are separable from execution)')
// Parse the WHOLE script — the half below the marker never runs in this file, so a syntax error
// there would otherwise only surface on a real run.
try {
  new Function('args', 'agent', 'parallel', 'log', 'phase', 'budget',
    `return (async () => {\n${src.replace('export const meta', 'const meta')}\n})()`)
  ok('the whole workflow script parses, execution half included')
} catch (e) { no(`the whole workflow script parses (${e.message})`) }
const head = src.slice(0, cut).replace('export const meta', 'const meta')
const EXPORTS = [
  'meta', 'RUBRICS', 'NODES', 'DEFECT', 'VERDICT', 'VERDICT_BINARY', 'MAKER', 'MAKER_PO',
  'weightedTotal', 'configFor', 'normalizeDir', 'cleanDefects', 'dedupe', 'defectKey',
  'blockingOpen', 'auditMaker', 'makerPrompt', 'checkerPrompt', 'arbiterPrompt',
  'escalationPrompt', 'rubricTable', 'conventions', 'runLoop', 'arbitrate', 'buildSlices', 'walk',
  'predecessorsOf', 'blocksSuccessors', 'results', 'state', 'assertArgs',
]
const ARGS = {
  feature: 'demo', title: 'Demo', runId: 'nf-test', defaultBranch: 'main',
  config: { commands: { test: 'npm test' }, seam: { backend: 'REST' } },
  configByDir: { 'frontend/': { commands: { test: 'npm run test:fe' } } },
}
// Fresh engine instance per probe: module-level `results`/`state` must not leak between them.
function engine(stubs) {
  const s = stubs || {}
  return new Function(
    'args', 'agent', 'parallel', 'log', 'phase', 'budget',
    `${head}\n return { ${EXPORTS.join(', ')} };`
  )(
    s.args || ARGS,
    s.agent || (async () => ({})),
    s.parallel || (async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))),
    s.log || (() => {}),
    s.phase || (() => {}),
    s.budget || { total: null, spent: () => 0, remaining: () => Infinity }
  )
}
let M
try { M = engine(); ok('engine declarations evaluate cleanly') } catch (e) { no(`engine declarations evaluate cleanly (${e.message})`) }

if (M) {
  // rubrics
  for (const [k, r] of Object.entries(M.RUBRICS)) {
    const sum = Math.round(r.criteria.reduce((a, c) => a + c.weight, 0) * 100) / 100
    check(sum === 1, `rubric ${k}: weights sum to 1.00 (got ${sum})  [R-RUB-01]`)
    check(r.criteria.every((c) => c.anchors && c.anchors.includes('1.0')), `rubric ${k}: every criterion has 0/0.5/1.0 anchors  [R-RUB-01]`)
    check(typeof r.threshold === 'number' && r.threshold > 0 && r.threshold <= 1, `rubric ${k}: threshold ${r.threshold}`)
  }

  // node table
  const need = ['id', 'kind', 'phase', 'mandate', 'maker', 'checkers', 'arbiter', 'rubric', 'rounds', 'inputs', 'outputs', 'when', 'next']
  const nodes = Object.entries(M.NODES)
  for (const [id, n] of nodes) {
    check(need.every((f) => f in n), `node ${id}: has every required field  [R-GRAPH-01]`)
    check(['loop', 'fanout', 'report'].includes(n.kind), `node ${id}: kind '${n.kind}' is one the executor dispatches`)
  }
  const judged = nodes.filter(([, n]) => n.kind === 'loop' || n.kind === 'fanout')
  for (const [id, n] of judged) {
    const roles = [n.maker, n.arbiter, ...n.checkers]
    check(roles.every((r) => r && r.agent && r.model && r.effort), `node ${id}: every role declares agent+model+effort  [R-MODEL-01]`)
    check(roles.every((r) => ['sonnet', 'opus', 'haiku'].includes(r.model)), `node ${id}: model aliases only, no dated ids  [R-MODEL-02]`)
    check(roles.every((r) => names.size === 0 || names.has(r.agent)), `node ${id}: every role names a bundled persona  [R-IND-02]`)
    check(n.arbiter.agent === n.maker.agent, `node ${id}: arbiter is the maker's persona  [R-LOOP-07]`)
    check(M.RUBRICS[n.rubric] !== undefined, `node ${id}: rubric '${n.rubric}' exists`)
    check(n.rounds === 5, `node ${id}: 5 rounds`)
  }
  check(M.NODES.build.checkers.some((c) => c.binary && c.arbitrable === false), 'build: the tester is binary and NOT arbitrable  [R-BUILD-01]')
  check(M.NODES.build.checkers.some((c) => c.arbitrable === true), 'build: the code reviewer IS arbitrable  [R-BUILD-03]')
  check(typeof M.NODES.ux.when === 'function' && M.NODES.ux.when({ po: { hasUiStories: false } }) === false, 'ux: gated by po.hasUiStories  [R-GRAPH-03]')
  check(M.NODES.ux.when({ po: { hasUiStories: true } }) === true, 'ux: runs when the po declares UI stories  [R-GRAPH-03]')

  // graph shape
  const edges = nodes.flatMap(([id, n]) => (n.next || []).map((t) => [id, t]))
  check(edges.every(([, t]) => t in M.NODES), `every 'next' names a real node  [R-GRAPH-01]`)
  const preds = M.predecessorsOf()
  check(preds.architect.join() === 'po' && preds.ux.join() === 'po', 'architect and ux both hang off po — one wave, run concurrently  [R-GRAPH-02]')
  check(preds.build.sort().join() === 'architect,ux', 'build is the join of architect and ux  [R-GRAPH-02]')
  check(nodes.filter(([, n]) => n.kind === 'report').length === 1, 'exactly one terminal report node')
  // no back-edges: `next` must always point at a node further from the root  [R-GRAPH-05]
  const depth = { po: 0, architect: 1, ux: 1, build: 2, report: 3 }
  check(edges.every(([f, t]) => depth[t] > depth[f]), 'no back-edges: every edge moves forward  [R-GRAPH-05]')
  check(M.blocksSuccessors({ verdict: 'skipped', gated: true }) === false, 'a gate-skipped node does not block its successors')
  check(M.blocksSuccessors({ verdict: 'hard-fail' }) === true, 'a hard-failed node blocks its successors  [R-GRAPH-04]')

  // schemas are the enforcement layer
  check(M.DEFECT.required.includes('evidence'), 'DEFECT requires evidence — the engine discards defects without it  [R-LOOP-06]')
  check(M.VERDICT.required.includes('criteria'), 'VERDICT requires criteria — a missing array scores 0  [R-LOOP-04]')
  check(M.VERDICT_BINARY.required.includes('pass'), 'the binary VERDICT requires an explicit pass  [R-LOOP-01]')
  check(M.MAKER.required.includes('artifacts'), 'MAKER requires the artifact paths it wrote  [R-CTX-06]')
  check(M.MAKER_PO.required.includes('hasUiStories'), 'the po MAKER must state hasUiStories — it gates the ux node  [R-PO-04]')

  // pure helpers
  const perfect = { criteria: M.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 1 })) }
  const zero = { criteria: M.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 0 })) }
  check(M.weightedTotal('po', perfect) === 1, 'weightedTotal: all-1 scores → 1.00')
  check(M.weightedTotal('po', zero) === 0, 'weightedTotal: all-0 scores → 0.00')
  check(M.weightedTotal('po', { criteria: [{ id: 'PO-AC', score: 1 }] }) === 0.3, 'weightedTotal: a missing criterion counts as 0, not as absent')
  check(M.weightedTotal('po', { criteria: [{ id: 'PO-AC', score: 99 }] }) === 0.3, 'weightedTotal: scores are clamped to 0..1')
  check(M.cleanDefects({ defects: [{ criterion: 'a', evidence: '' }, { criterion: 'b', evidence: 'x' }] }).length === 1, 'cleanDefects: drops a defect with no quoted evidence  [R-LOOP-06]')
  check(M.dedupe([{ criterion: 'a', location: 'f:1' }, { criterion: 'a', location: 'f:1' }, { criterion: 'a', location: 'f:2' }]).length === 2, 'dedupe: by (criterion, location)  [R-LOOP-05]')
  check(
    M.dedupe([{ criterion: 'PO-AC', evidence: 'story 1 has no Gherkin' }, { criterion: 'PO-AC', evidence: 'story 7 has no Gherkin' }]).length === 2,
    'dedupe: two evidence-distinct defects under one criterion both survive  [R-LOOP-05]'
  )
  check(M.blockingOpen([{ severity: 'high' }, { severity: 'low' }]).length === 1, 'blockingOpen: critical/high only')
  check(M.configFor('frontend/x').commands.test === 'npm run test:fe', 'configFor: nested dir config wins  [R-CFG-04]')
  check(M.configFor('src/main').commands.test === 'npm test', 'configFor: root config for everything else')
  check(M.configFor('frontend-legacy/x').commands.test === 'npm test', 'configFor: matches path segments, so `frontend` never claims `frontend-legacy/`  [R-CFG-04]')
  check(M.configFor('./frontend/x/').commands.test === 'npm run test:fe', 'configFor: normalizes ./ and trailing /')
  check(M.configFor('frontend/x').seam.backend === 'REST', 'configFor: merges seam from the root config')
  check(M.auditMaker(M.NODES.ux, { ok: true, artifacts: [] }).length === 1, 'auditMaker: a maker that declares no artifact for a declared output is a defect')
  check(M.auditMaker(M.NODES.ux, { ok: true, artifacts: [{ path: `.sdlc2/features/demo/mockup.html` }] }).length === 0, 'auditMaker: the declared output satisfies it')
  check(M.auditMaker(M.NODES.ux, { ok: true, artifacts: [{ path: `.sdlc2/features/demo/mockup.html` }], changelog: 'x\n'.repeat(30) }).length === 1, 'auditMaker: a changelog over 20 lines is a defect  [R-CTX-06]')
  check(M.auditMaker(M.NODES.po, null).length === 1, 'auditMaker: a null maker is a critical defect  [R-LOOP-08]')

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
  const paths = M.makerPrompt(M.NODES.architect, 1, []).match(/^  - \S+$/gm) || []
  check(new Set(paths).size === paths.length, 'makerPrompt: each path is listed once  [R-CTX-02]')
  const harnessBrief = M.makerPrompt(M.NODES.po, 2, [{ criterion: 'engine', severity: 'critical', location: 'sdlc2-product-owner-critic', evidence: 'the critic returned no verdict', fix: 're-run the checker', harness: true }])
  check(!/Fix EVERY defect/.test(harnessBrief) && /harness failure/.test(harnessBrief), 'makerPrompt: a maker is never asked to repair a checker that failed to answer  [R-LOOP-08]')
  check(!/first attempt/.test(harnessBrief) && /ROUND 2/.test(harnessBrief), 'makerPrompt: and the round still counts — a harness failure is not a fresh start  [R-LOOP-08]')
  const cp = M.checkerPrompt(M.NODES.po, M.NODES.po.checkers[0], 2)
  check(/REFUTE/.test(cp) && /Default to FAIL/i.test(cp), 'checkerPrompt: adversarial mandate, default-to-fail')
  check(/READ-ONLY/i.test(cp) && /not seen any other checker/i.test(cp), 'checkerPrompt: read-only and blind to other checkers  [R-LOOP-03]')
  check(/do not compute a total|Do NOT compute a total/i.test(cp), 'checkerPrompt: engine computes the total  [R-LOOP-04]')
  check(/missing id is scored ZERO|scored ZERO by the engine/i.test(cp), 'checkerPrompt: says an unscored criterion is a zero')
  check(!cp.includes('<!DOCTYPE') && !/```html/.test(cp), 'checkerPrompt: no artifact body inlined  [R-CTX-02]')
  const ep = M.escalationPrompt({ id: '01-a', path: 'issues/01-a.md' }, 'no-commit', 3, [])
  check(/never reached a green commit/.test(ep) && !/tester never went green/.test(ep), 'escalationPrompt: a slice that never committed is not reported as a red suite  [R-BUILD-02]')
  check(/tester never went green/.test(M.escalationPrompt({ id: '01-a', path: 'p' }, 'tester-red', 3, [])), 'escalationPrompt: a red suite is reported as one  [R-BUILD-02]')
  const dp = M.conventions({ commands: { test: 'x' }, seam: {} }, true)
  check(/per-directory overrides/.test(dp), 'conventions: doc nodes are shown the per-directory overrides  [R-CFG-04]')
}

// ── 5. sandbox rules the Workflow runtime enforces ────────────────────────
group('workflow sandbox rules')
check(!/Date\.now\(|Math\.random\(|new Date\(\)/.test(src), 'no Date.now / Math.random / new Date() — they throw in a workflow script')
check(!/require\(|from ['"]node:/.test(src), 'no filesystem or node imports')
check(/Math\.min\.apply/.test(src) && !/scored\.reduce/.test(src), 'step score is a MIN, never an average  [R-LOOP-02]')
check(/for \(const slice of slices\)/.test(src), 'build node iterates slices sequentially  [R-BUILD-04]')
check(!/parallel\(\s*slices/.test(src), 'build node never parallelizes slices  [R-BUILD-04]')
check(/agentPrefix/.test(src) && /function at\(/.test(src), 'agent types are resolved through a host-configurable prefix')
check(!/\bmerge\b[^\n]*\$\{BASE\}|git merge/.test(src), 'the engine never merges  [R-BUILD-06]')

// ── 6. the engine, behaviourally ──────────────────────────────────────────
// Every probe drives a REAL engine instance; only the agents are stubbed.
group('engine — behaviour under agent failure')

const parallelReal = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
const isMake = (o) => (o.label || '').includes(':make')
const isArb = (o) => (o.label || '').includes('arbiter')
const scoreAll = (rubric, s) => ({ criteria: rubric.criteria.map((c) => ({ id: c.id, score: s })), defects: [] })

async function probe(name, fn) {
  try { await fn() } catch (e) { no(`${name} — threw: ${e.message}`) }
}

// P1 — a checker that dies must never yield a pass. [C1 / R-LOOP-08]
await probe('dead checker', async () => {
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      if (isArb(o)) return { finalized: true, records: [{ id: 'VH-01', decision: 'd', rationale: 'r' }] }
      throw new Error('terminal agent error')
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict !== 'pass', `a dead checker never passes the node (got '${r.verdict}' at ${r.score})  [R-LOOP-08]`)
  check(r.score === 0, 'a node with no surviving scoring checker scores 0, not 1')
  check(r.defects.some((d) => d.criterion === 'engine'), 'a silent checker becomes a critical engine defect')
})

// P2 — a checker that scores everything clean passes on round 1. [H2]
await probe('clean verdict', async () => {
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      return scoreAll(E.RUBRICS.po, 1)
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict === 'pass' && r.rounds === 1, `clean work passes on round 1 (got '${r.verdict}' in ${r.rounds})`)
})

// P3 — `hard` ends the loop for ANY checker, not just a non-arbitrable one. [H1 / R-GRAPH-04]
await probe('hard verdict', async () => {
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      return { criteria: [], defects: [], hard: true }
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict === 'hard-fail' && r.rounds === 1, `hard:true ends the loop at once (got '${r.verdict}' in ${r.rounds} round(s))  [R-GRAPH-04]`)
})

// P4 — rounds exhausted hands off to the executor, which arbitrates SERIALLY. [R-LOOP-07]
await probe('arbitration', async () => {
  let arbiters = 0
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      if (isArb(o)) { arbiters++; return { finalized: true, records: [{ id: 'VH-01', decision: 'd', rationale: 'r' }] } }
      return scoreAll(E.RUBRICS.po, 0.5)
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict === 'needs-arbitration' && r.rounds === 5, 'the loop itself never arbitrates — it hands the decision up  [R-VH-02]')
  check(arbiters === 0, 'no arbiter ran inside the loop, so two concurrent nodes cannot race on VERIFY-WITH-HUMAN.md  [R-VH-02/03]')
  const decided = await E.arbitrate(E.NODES.po, r)
  check(arbiters === 1, 'the executor makes exactly one arbiter call  [R-LOOP-07]')
  check(decided.verdict === 'soft-pass' && decided.vh.join() === 'VH-01', 'and it is a soft-pass carrying its VH ids — never a pass  [R-LOOP-07]')
  const silent = await engine({ parallel: parallelReal, agent: async () => null }).arbitrate(E.NODES.po, r)
  check(silent.verdict === 'hard-fail', 'an arbiter that returns nothing is a hard fail, not a silent soft-pass')
})

// P5 — the developer vanishing after a green attempt must not crash the run. [C2]
await probe('developer vanishes', async () => {
  let built = 0
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] }] }
      if (L.startsWith('build:')) { built++; return built === 1 ? { committed: true, sha: 'abc123', branch: 'slice/demo/01-a' } : null }
      if (L.startsWith('test:')) return { pass: true, criteria: [], defects: [] }
      if (L.startsWith('review:')) return { criteria: [{ id: 'CR-CLEAN', score: 0.2 }], defects: [{ criterion: 'CR-CLEAN', severity: 'medium', location: 'F.java:3', evidence: 'q', fix: 'f' }] }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(!!r, 'buildSlices survives a developer that stops returning  [C2]')
  check(r.slices.escalated.length === 1 && r.slices.escalated[0].reason === 'no-commit', `it escalates as no-commit, not tester-red (got '${r.slices.escalated[0] && r.slices.escalated[0].reason}')  [R-BUILD-02]`)
  check(r.slices.shipped.length === 0, 'nothing is recorded as shipped without a commit to point at  [R-BUILD-01]')
})

// P6 — a slice that never commits is escalated as such. [H5]
await probe('never commits', async () => {
  let note = ''
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] }] }
      if (L.startsWith('build:')) return { committed: false, notes: 'compile error' }
      if (L.startsWith('escalate:')) { note = p; return {} }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(r.slices.escalated[0] && r.slices.escalated[0].reason === 'no-commit', 'a slice that never compiled escalates as no-commit  [R-BUILD-02]')
  check(/never reached a green commit/.test(note) && !/tester never went green/.test(note), 'the escalation note does not blame a tester that never ran')
})

// P7 — a red tester is never arbitrated away, however good the code looks. [R-BUILD-01]
await probe('tester red', async () => {
  let arbiters = 0
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] }] }
      if (L.startsWith('build:')) return { committed: true, sha: 'a1', branch: 'slice/demo/01-a' }
      if (L.startsWith('test:')) return { pass: false, criteria: [], defects: [{ criterion: 'CR-TEST', severity: 'critical', location: 'T.java:9', evidence: 'expected 2 got 1', fix: 'fix it' }] }
      if (L.startsWith('review:')) return scoreAll(E.RUBRICS.build, 1)
      if (L.startsWith('arbiter:')) { arbiters++; return { finalized: true, records: [] } }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(arbiters === 0, 'no arbiter is consulted on a red suite  [R-BUILD-01]')
  check(r.slices.shipped.length === 0 && r.slices.escalated[0].reason === 'tester-red', 'a red suite escalates and commits nothing  [R-BUILD-01]')
})

// P8 — a silent checker in the build node is a defect, and the developer is told. [H4]
await probe('silent build checker', async () => {
  const prompts = []
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] }] }
      if (L.startsWith('build:')) { prompts.push(/first build of this slice/.test(p) ? 'FIRST' : 'REPAIR'); return { committed: true, sha: 'a1', branch: 'b' } }
      if (L.startsWith('test:') || L.startsWith('review:')) throw new Error('checker died')
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(prompts.slice(1).every((x) => x === 'REPAIR'), `a silent checker still produces a repair brief (${prompts.join(',')})  [R-LOOP-08]`)
  check(r.slices.escalated.length === 1, 'the slice is escalated rather than shipped')
  check(r.slices.escalated[0].reason === 'tester-silent', `a tester that never answered escalates as unverified, not as failing (got '${r.slices.escalated[0].reason}')  [R-BUILD-02]`)
})

// P8b — a maker that never delivers is a hard-fail, not something to arbitrate over. [R-LOOP-08]
await probe('maker never delivers', async () => {
  let arbiters = 0
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isArb(o)) { arbiters++; return { finalized: true, records: [] } }
      if (isMake(o)) return { ok: false, artifacts: [], notes: 'could not write' }
      return scoreAll(E.RUBRICS.po, 1)
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict === 'hard-fail' && r.rounds === 5, `a maker that never produced its artifacts hard-fails (got '${r.verdict}')`)
  check(arbiters === 0, 'and nothing is arbitrated over an artifact that does not exist')
})

// P9 — an unknown blocker id skips the dependent instead of silently building it. [M6]
await probe('unknown blocker', async () => {
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '02-b', path: 'issues/02-b.md', title: 'B', dir: '', blockedBy: ['01-a'] }] }
      if (L.startsWith('build:')) return { committed: true, sha: 'x', branch: 'b' }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(r.slices.skipped.length === 1 && /blocker-unknown/.test(r.slices.skipped[0].reason), 'a slice blocked by a nonexistent id is skipped, not built  [R-GRAPH-04]')
})

group('engine — the graph walk')

// P10 — a node that CRASHES becomes a hard-fail row, and the report still runs. [C3 / H10]
await probe('node crash', async () => {
  let reported = false
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L === 'report') { reported = true; return {} }
      if (isMake(o) && L.startsWith('po')) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: false }
      if (L.startsWith('po:')) return scoreAll(E.RUBRICS.po, 1)
      if (L.startsWith('architect')) throw new Error('architect died')
      return {}
    },
  })
  await E.walk()
  check(E.results.architect.verdict === 'hard-fail', `a crashed node is a hard-fail row (got '${E.results.architect.verdict}')  [R-GRAPH-04]`)
  check(E.results.build.verdict === 'skipped', 'its dependents are skipped, not run against a missing design  [R-GRAPH-04]')
  check(reported === true, 'the report node runs anyway — a run nobody can read is not a finished run  [R-REP-01]')
})

// P11 — the ux gate skips ux WITHOUT taking build down with it. [R-GRAPH-03]
await probe('ux gate', async () => {
  const seen = []
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      seen.push(L)
      if (L.startsWith('slices:resolve')) return { slices: [] }
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }, { path: '.sdlc2/features/demo/design.md' }], hasUiStories: false }
      if (isArb(o)) return { finalized: true, records: [] }
      return scoreAll(L.startsWith('architect') ? E.RUBRICS.arch : E.RUBRICS.po, 1)
    },
  })
  await E.walk()
  check(E.results.ux.verdict === 'skipped' && E.results.ux.gated === true, 'ux is gated off when the po declares no UI stories  [R-GRAPH-03]')
  check(E.results.build.verdict !== 'skipped', 'a gated-off ux does not block the build')
  check(!seen.some((l) => l.startsWith('ux')), 'no ux agent was ever spawned')
})

// P12 — po not passing stops the graph but still reports. [R-GRAPH-04]
await probe('po hard-fail', async () => {
  let reported = false
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L === 'report') { reported = true; return {} }
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      return { criteria: [], defects: [], hard: true }
    },
  })
  await E.walk()
  check(E.results.po.verdict === 'hard-fail', 'po hard-fails')
  check(['architect', 'ux', 'build'].every((n) => E.results[n].verdict === 'skipped'), 'everything downstream of po is skipped  [R-GRAPH-04]')
  check(reported === true, 'and the run is still reported')
})

// P13 — the engine refuses to run without an executable oracle. [R-CFG-02]
await probe('no test command', async () => {
  const E = engine({ args: { feature: 'demo', runId: 'nf-test', config: { commands: {}, seam: {} } } })
  let threw = false
  try { E.assertArgs() } catch (e) { threw = /commands\.test/.test(e.message) }
  check(threw === true, 'the engine refuses to run with no commands.test, exactly as the mode file does  [R-CFG-02]')
  const good = engine()
  let ranClean = true
  try { good.assertArgs() } catch (e) { ranClean = false }
  check(ranClean, 'and runs when the oracle is declared')
})

console.log('')
if (fails) { console.log(`\x1b[31mFAILED\x1b[0m — ${fails} check(s)\n`); process.exit(1) }
console.log('\x1b[32mAll checks passed.\x1b[0m Structure AND the failure paths — but still not proof the graph\nproduces good software: the first real run is that acceptance test.\n')
