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

// Same hole, one level down. The walk above covers agents/ only — which is how
// skills/grill-with-docs/SKILL.md ("Run a `/grilling` session, using the `/domain-modeling`
// skill") stayed green through 205 checks while sending three personas to the HOST's skills on
// their FIRST step, and skills/outside-in-tdd/SKILL.md kept pointing the developer at `/tdd` and
// `/improve-codebase-architecture`. A slash-prefixed name in a skill body resolves against
// whatever the host installed; a bundled skill must be named by its plugin-root path.  [R-IND-02]
const skillDocs = []
for (const s of BUNDLED) {
  for (const f of readdirSync(join(ROOT, `skills/${s}`)).filter((n) => n.endsWith('.md'))) skillDocs.push([s, `skills/${s}/${f}`])
}
check(skillDocs.length >= BUNDLED.length, `every bundled skill ships at least one .md (${skillDocs.length} across ${BUNDLED.length} skills)`)
const slashRefs = []
const skillStray = []
const skillUnrooted = []
for (const [own, rel] of skillDocs) {
  const body = R(rel)
  // Preceded by start-of-line, whitespace, backtick or "(" — so `skills/outside-in-tdd/SKILL.md`
  // and `${CLAUDE_PLUGIN_ROOT}/skills/...` are paths, not command invocations.
  for (const m of body.match(/(?:^|[\s`(])\/[a-z][a-z0-9-]*/gm) || []) slashRefs.push(`${rel}: ${m.trim()}`)
  for (const t of body.match(/`[^`\n]+`/g) || []) {
    const name = t.slice(1, -1)
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) continue
    if (TECHNICAL_TERMS.has(name) || name === own) continue
    skillStray.push(`${rel}:${name}`)
  }
  for (const s of BUNDLED) {
    if (s === own) continue // a skill may name itself in its own frontmatter
    const re = new RegExp(`(?<!/)\\b${s}\\b`, 'g')
    for (const line of body.split('\n')) {
      if (re.test(line) && !line.includes('${CLAUDE_PLUGIN_ROOT}/skills/') && !/sdlc2's own|not any similarly named|own copy/i.test(line)) {
        skillUnrooted.push(`${rel}: ${line.trim().slice(0, 60)}`)
      }
    }
  }
}
check(slashRefs.length === 0, `no bundled skill invokes a slash command — those resolve against the host${slashRefs.length ? ' — ' + slashRefs.join(', ') : ''}  [R-IND-02]`)
check(skillStray.length === 0, `no bundled skill names a skill sdlc2 does not bundle${skillStray.length ? ' — ' + skillStray.join(', ') : ''}  [R-IND-02]`)
check(skillUnrooted.length === 0, `bundled skills cite each other by \${CLAUDE_PLUGIN_ROOT} path${skillUnrooted.length ? ' — ' + skillUnrooted.join(' | ') : ''}  [R-IND-02]`)

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

// ── 3c. setup documentation ───────────────────────────────────────────────
// A project cannot adopt sdlc2 without knowing what to put in its CLAUDE.md. These checks keep
// that document from drifting away from the fields the engine actually renders.
group('setup docs')
check(existsSync(join(ROOT, 'SETUP.md')), 'SETUP.md exists')
if (existsSync(join(ROOT, 'SETUP.md'))) {
  const setup = R('SETUP.md')
  check(readme.includes('SETUP.md'), 'README points at SETUP.md')
  check(setup.includes('<!-- sdlc2:config -->') && setup.includes('<!-- /sdlc2:config -->'), 'SETUP.md shows the real config delimiters  [R-CFG-01]')
  check(/commands\.test[^\n]*\bMANDATORY\b|\| `commands\.test` \| \*\*Yes\*\*/.test(setup), 'SETUP.md marks commands.test mandatory  [R-CFG-02]')
  // Every field the prompts render must be documented, and nothing invented.
  const engineSrc = R('new-feature.workflow.js') // `src` is not read until the engine section below
  const rendered = ['test', 'build', 'run', 'e2e'].filter((k) => new RegExp(`c\\.${k}\\b`).test(engineSrc))
  for (const k of rendered) check(setup.includes(`commands.${k}`), `SETUP.md documents commands.${k}, which conventions() renders`)
  for (const k of ['backend', 'frontend']) check(setup.includes(`seam.${k}`), `SETUP.md documents seam.${k}`)
  check(/cannot create|does not create/i.test(setup), 'SETUP.md states that sdlc2 cannot create a project')
  check(/Known limitations/.test(setup), 'SETUP.md carries a known-limitations section')
}

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
  'baseFor', 'developerPrompt', 'testerPrompt', 'reviewerPrompt', 'spawn', 'SPAWN_RETRIES',
  'predecessorsOf', 'blocksSuccessors', 'results', 'state', 'assertArgs', 'settle',
  'planLines', 'sliceTableLines', 'upstreamDisputes',
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
    // [E-01] Document nodes get 2 rounds, `build` keeps 5. Asserted per KIND rather than as one
    // number, so a doc node silently returning to 5 — or build being cut to 2 — is a failure.
    const want = n.kind === 'fanout' ? 5 : 2
    check(n.rounds === want, `node ${id}: ${want} rounds  [E-01]`)
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
  // [E-12] `build` no longer joins on BOTH design nodes. A backend slice consumes nothing from
  // the UX output and used to wait for it regardless. The join moved INTO the build node, per
  // slice — so what must hold here is: build waits for architect, ux is still reached, and
  // `report` waits for everything so nothing is reported before every node has settled.
  check(preds.build.join() === 'architect', 'build waits for architect alone — the ux join is per slice  [R-GRAPH-02]')
  check(preds.report.sort().join() === 'build,ux', 'report still waits for BOTH build and ux  [R-GRAPH-02]')
  check(/slice\.ui === true/.test(src) && /whenSettled\('ux'\)/.test(src), 'a UI slice waits for the ux node before it is built  [R-GRAPH-02]')
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
  check(M.makerPrompt.length <= 4 && M.checkerPrompt.length <= 4, 'prompt builders take only (node, round, defects, scores)-shaped input  [R-CTX-05]')
  const paths = M.makerPrompt(M.NODES.architect, 1, []).match(/^  - \S+$/gm) || []
  check(new Set(paths).size === paths.length, 'makerPrompt: each path is listed once  [R-CTX-02]')
  const harnessBrief = M.makerPrompt(M.NODES.po, 2, [{ criterion: 'engine', severity: 'critical', location: 'sdlc2-product-owner-critic', evidence: 'the critic returned no verdict', fix: 're-run the checker', harness: true }])
  check(!/Fix EVERY defect/.test(harnessBrief) && /harness failure/.test(harnessBrief), 'makerPrompt: a maker is never asked to repair a checker that failed to answer  [R-LOOP-08]')
  check(!/first attempt/.test(harnessBrief) && /ROUND 2/.test(harnessBrief), 'makerPrompt: and the round still counts — a harness failure is not a fresh start  [R-LOOP-08]')
  const cp = M.checkerPrompt(M.NODES.po, M.NODES.po.checkers[0], 2)
  // [E-03] The refutation mandate stays everywhere; the default-to-FAIL tie-break is now the
  // BINARY checker's alone. A global find/replace that disarmed the tester would fail here.
  const tp = M.checkerPrompt(M.NODES.build, M.NODES.build.checkers.filter((c) => c.binary)[0], 1)
  check(/REFUTE/.test(cp), 'checkerPrompt: adversarial mandate  [R-LOOP-03]')
  check(!/Default to FAIL/i.test(cp), 'checkerPrompt: a SCORING checker no longer defaults to FAIL  [E-03]')
  check(/do not penalise the maker for what you did not check/i.test(cp), 'checkerPrompt: scoring checker is told not to guess downward  [E-03]')
  check(/Default to FAIL/i.test(tp), 'checkerPrompt: the BINARY checker still fails closed  [E-03]')
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
// [E-07] These two checks used to assert a flat `for` over slices. That invariant is GONE by
// design; they are rewritten, not deleted, because they are the only executable guard on how the
// build node schedules work. What must now hold: one callable unit per slice, dependency-LEVEL
// scheduling, concurrency only where a fresh tree can actually be tested, and a private worktree
// for anything running beside a sibling.
check(/async function runSlice\(slice, wt\)/.test(src), 'one slice is built by one callable unit  [R-BUILD-04]')
check(/levelOf\[sl\.id\] = lv/.test(src), 'slices are scheduled by dependency LEVEL, not in a flat line  [R-BUILD-04]')
check(/const LANES = install \? MAX_LANES : 1/.test(src), 'lanes open only when the project declares an install command  [R-BUILD-04]')
check(/const declaredLanes = Math\.floor\(Number\(CONFIG\.lanes\)\)/.test(src), 'and how many lanes is the project\'s to declare, not a literal  [E2-10]')
check(/await Promise\.race\(Object\.keys\(running\)/.test(src), 'the scheduler waits on the FIRST slice to land, not on a whole level  [E2-14]')
check(!/for \(let lv = 0; lv < levels\.length; lv\+\+\)/.test(src), 'and no level barrier survives  [E2-14]')
check(/const ready = \(sl\) => \(sl\.blockedBy \|\| \[\]\)\.every/.test(src), 'readiness is a slice\'s own blockers  [E2-14]')
check(src.includes('git worktree add ${wt}'), 'a concurrently-built slice gets its OWN worktree  [R-BUILD-07]')
check(src.includes('git worktree remove --force'), 'and the worktrees are released when building ends  [R-BUILD-07]')
check(!/WORKTREES = `\$\{DIR\}/.test(src), 'worktrees live OUTSIDE the feature dir the report node commits  [R-REP-03]')
// [SD-04] Outside the feature dir was not enough: anywhere INSIDE the repo is invisible to git but
// visible to the project's test runner, which then renders against a second copy of its framework.
check(/const WORKTREES = `\.\.\//.test(src), 'worktrees live OUTSIDE THE REPOSITORY, not merely outside .sdlc2/  [R-BUILD-07a]')
check(!/const WORKTREES = `\.sdlc2\/worktrees/.test(src), 'and specifically not back under .sdlc2/worktrees/, which run 2 measured as broken  [R-BUILD-07a]')
check(/WORKTREES = `[^`]*\$\{RUN_ID\}/.test(src), 'each run gets its own worktree container, so a stranded tree cannot collide  [R-BUILD-07a]')
// `rm -rf` DOES appear in the source — inside the prohibition. Assert the prohibition, not its
// absence, or this check passes the moment someone deletes the warning that makes it safe.
check(/rmdir/.test(src), 'the release step removes the empty container with rmdir  [R-BUILD-07a]')
check(/never \\`rm -rf\\`/.test(src), 'and says never rm -rf, in the instruction itself  [R-BUILD-07a]')
check(/agentPrefix/.test(src) && /function at\(/.test(src), 'agent types are resolved through a host-configurable prefix')
// [SD-03 / R-REP-04] The engine must know, and say, which engine it is.
check(/const VERSION_RAN = A\.version \|\| 'unknown'/.test(src), 'the engine carries the version it was told it is, defaulting to unknown  [R-REP-04]')
check(/log\(`sdlc2 \$\{VERSION_RAN\}/.test(src), 'and names it on the FIRST line of the run  [R-REP-04]')
check(/Engine: sdlc2 \$\{VERSION_RAN\}/.test(src), 'and in the report header  [R-REP-04]')
check(/Engine path: \$\{ROOT\}/.test(src), 'with the plugin root it actually ran from  [R-REP-04]')
// [SD-08 / R-REP-05] The scheduler knew whether lanes fired and told only the live log. The report
// is the artifact that outlives the run, so it has to carry it too — asserted at every hop, because
// a break anywhere in the chain leaves the report silent in exactly the way run 3's was.
check(/const lanes = \{ lanes: LANES, install: install \|\| null, widest: widest/.test(src), 'the scheduler records how it scheduled  [R-REP-05]')
check(/lanes\.batches\.push\(\{ level: levelOf\[sl\.id\], ids: \[sl\.id\], concurrent: withOthers \}\)/.test(src), 'every slice start is recorded with whether it shared the clock  [R-REP-05 / E2-14]')
check(/rows: rows, lanes: lanes, amendments: amendments \}/.test(src), 'the build node carries the lane record out with its rows  [R-REP-05]')
check(/Amendments: \$\{JSON\.stringify\(build\.amendments/.test(src), 'and the report prompt is handed the amendments  [E2-13]')
check(/ACCEPTANCE CRITERIA THAT COULD NOT BE MET/.test(src), 'which it must state in its own section  [E2-13]')
check(/Lanes\.release/.test(src), 'and whether the worktrees were actually released  [E2-08]')
check(/amendments: \{/.test(src), 'and a developer proposes a contract amendment rather than editing the issue  [E2-13]')
check(/THAT FILE IS READ-ONLY TO YOU/.test(src), 'the developer is told the acceptance criteria are read-only to it  [E2-13]')
check(/`Lanes: \$\{JSON\.stringify\(build\.lanes\)\}/.test(src), 'and the report prompt is handed it  [R-REP-05]')
check(/\(2b\) \[R-REP-05\] how the slices were BUILT/.test(src), 'which is told to state it, in its own numbered section  [R-REP-05]')
check(/never omitted/.test(src) && /commands\.install/.test(src), 'either way — including naming the config change that would open the lanes  [R-REP-05]')
// `git merge-base` is read-only plumbing — it is how the tester PROVES a branch was cut where the
// engine said, which is the opposite of merging. Exclude it by name rather than loosening the grep.
check(!/\bmerge\b[^\n]*\$\{BASE\}|git merge(?!-base)/.test(src), 'the engine never merges  [R-BUILD-06]')
check(/git merge-base --is-ancestor/.test(src), 'the tester proves the slice branch base with real git plumbing  [R-BUILD-04]')

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
  check(r.verdict === 'needs-arbitration' && r.rounds === 2, 'the loop itself never arbitrates — it hands the decision up  [R-VH-02]')
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
  // [E2-05] A developer that returns NOTHING is a transport failure, not a developer who tried and
  // could not commit. They used to share one reason and one defect record; the next attempt was then
  // told "the checkers refuted your previous attempt" over a dropped connection.
  check(r.slices.escalated.length === 1 && r.slices.escalated[0].reason === 'developer-silent', `a silent developer escalates as developer-silent, not tester-red (got '${r.slices.escalated[0] && r.slices.escalated[0].reason}')  [R-BUILD-02 / E2-05]`)
  check((r.slices.escalated[0].defects || []).every((d) => d.harness === true), 'and its defect is a HARNESS defect, so no developer is asked to repair a dropped connection  [E2-05]')
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
  check(r.verdict === 'hard-fail' && r.rounds === 2, `a maker that never produced its artifacts hard-fails (got '${r.verdict}')`)
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

// P10b — [SD-03 / R-REP-04 / R-PKG-06] the run says which engine produced it, and the mode file
// refuses to start from a superseded one. Two runs of this plugin measured an engine nobody was
// developing any more, and nothing anywhere said so.
await probe('SD-03 engine identity', async () => {
  let reportPrompt = ''
  const logs = []
  const stub = (extraArgs) => engine({
    parallel: parallelReal,
    log: (m) => logs.push(m),
    args: Object.assign({}, ARGS, extraArgs),
    agent: async (p, o) => {
      const L = o.label || ''
      if (L === 'report') { reportPrompt = p; return {} }
      if (isMake(o) && L.startsWith('po')) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: false }
      if (L.startsWith('po:')) return scoreAll(E.RUBRICS.po, 1)
      return {}
    },
  })
  let E = stub({ version: '9.9.9', pluginRoot: '/cache/sdlc2/9.9.9' })
  await E.walk()
  check(/Engine: sdlc2 9\.9\.9/.test(reportPrompt), 'the report is given the engine version that ran  [R-REP-04]')
  check(/Engine path: \/cache\/sdlc2\/9\.9\.9/.test(reportPrompt), 'and the plugin root it ran from  [R-REP-04]')
  check(logs.some((m) => /^sdlc2 9\.9\.9 — engine at \/cache\/sdlc2\/9\.9\.9/.test(m)), 'and the run says so on its first line  [R-REP-04]')

  // An unstamped run must say `unknown` — a guessed version is worse than an absent one, because
  // it is the guess a reader would have made anyway.
  reportPrompt = ''; logs.length = 0
  E = stub({ version: undefined })
  await E.walk()
  check(/Engine: sdlc2 unknown/.test(reportPrompt), 'an unstamped run reports `unknown` rather than guessing  [R-REP-04]')
})

// P10c — [R-PKG-06] the mode file's pre-check 0, read as text: it is main-thread instructions, so
// the only executable thing about it is that it says the right words in the right order.
await probe('R-PKG-06 stale-pin pre-check', async () => {
  const mode = R('modes/new-feature.md')
  const pre0 = mode.slice(mode.indexOf('0. **Which engine'), mode.indexOf('1. **Git.**'))
  check(pre0.length > 200, 'pre-check 0 exists and precedes the git check  [R-PKG-06]')
  check(/VERSION/.test(pre0) && /CLAUDE_PLUGIN_ROOT/.test(pre0), 'it reads VERSION beside the resolved plugin root  [R-PKG-06]')
  check(/sort -V/.test(pre0), 'it compares sibling version dirs by version order, not lexically  [R-PKG-06]')
  check(/STALE/.test(pre0) && /\*\*stop\*\*/i.test(pre0), 'and STOPS on a superseded root rather than warning and continuing  [R-PKG-06]')
  check(/local or dev install|non-version directory/i.test(pre0), 'a dev checkout is tolerated, not treated as stale  [R-PKG-06]')
  check(!/\.claude\/plugins/.test(pre0), 'and it reaches for no harness internals to do it  [R-PKG-03]')
  check(/"version":/.test(mode), 'the resolved version is passed to the engine in args  [R-PKG-06]')
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

// P14 — a blocked slice is cut from its BLOCKER's branch, an independent one from the default
// branch, and the tester is handed the assertions that prove it. This is the defect run 1
// produced: the developer stacked four independent slices and the reviewer scored three earlier
// slices' code as if it were this slice's work. [R-BUILD-04 / R-BUILD-04a]
await probe('slice branch bases', async () => {
  const said = []
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      said.push({ label: L, prompt: p })
      if (L.startsWith('slices:resolve')) return { slices: [
        { id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] },
        { id: '02-b', path: 'issues/02-b.md', title: 'B', dir: '', blockedBy: ['01-a'] },
        { id: '03-c', path: 'issues/03-c.md', title: 'C', dir: '', blockedBy: [] },
      ] }
      if (L.startsWith('build:')) return { committed: true, sha: 'cafe', branch: `slice/demo/${L.slice(6).split(' ')[0]}`, changelog: 'x' }
      if (L.startsWith('test:')) return { pass: true, defects: [] }
      if (L.startsWith('review:')) return scoreAll(E.RUBRICS.build, 1)
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  const of = (pre, id) => (said.find((s) => s.label.startsWith(`${pre}:${id}`)) || {}).prompt || ''

  check(r.slices.shipped.length === 3, `all three slices ship in this probe (got ${r.slices.shipped.length})`)
  check(/off 'main'/.test(of('build', '01-a')), 'an independent slice is cut from the default branch  [R-BUILD-04]')
  check(/off 'slice\/demo\/01-a'/.test(of('build', '02-b')), 'a blocked slice is cut from its BLOCKER, not from the default branch  [R-BUILD-04]')
  check(/off 'main'/.test(of('build', '03-c')), 'a later INDEPENDENT slice goes back to the default branch — it does not inherit the stack  [R-BUILD-04]')
  check(/git diff slice\/demo\/01-a\.\.\./.test(of('review', '02-b')), "the reviewer diffs a stacked slice against its blocker, so the blocker's code is not replayed as this slice's work  [R-BUILD-04]")
  check(/git diff main\.\.\./.test(of('review', '03-c')), 'and an independent slice is still diffed against the default branch  [R-BUILD-04]')
  check(/merge-base --is-ancestor main HEAD/.test(of('test', '01-a')), 'the tester is told to PROVE the base with real git plumbing  [R-BUILD-04a]')
  // [E-07] Level scheduling changed the ORDER: 01-a and 03-c are both independent (level 0), so
  // 03-c now ships before 02-b, which is blocked by 01-a (level 1). The must-not-contain list is
  // built from what has actually shipped, so the assertions move with the order — but every pair
  // is still covered exactly once, which is what the invariant needs.
  const t3 = of('test', '03-c')
  check(/MUST NOT be an ancestor/.test(t3) && /slice\/demo\/01-a/.test(t3),
    'an independent slice must not carry its independent sibling  [R-BUILD-04a]')
  const t2 = of('test', '02-b')
  check(/MUST NOT be an ancestor/.test(t2) && /slice\/demo\/03-c/.test(t2),
    'and a blocked slice must not carry the independent slice that shipped beside it  [R-BUILD-04a]')
  check(!/MUST NOT be an ancestor[\s\S]*slice\/demo\/01-a/.test(t2), "a blocker is never in its dependent's must-not-contain list  [R-BUILD-04a]")
  const row = r.slices.rows.find((x) => x.id === '02-b')
  check(row && row.base === 'slice/demo/01-a', 'the report row records what each slice was cut from  [R-REP-02]')
})


// ── P15..P19 — the v0.1.3 enhancements, each driven through the path it changed ────────────────
// Every fix in sdlc2-enhance-1.md was an UNEXECUTED fix when it was written. These probes are the
// difference between "the code says it does this" and "it does this", which is the only
// distinction this project has ever found a real defect with.

// P15 — [E-02] the repair brief. A round that fails on SCORE alone used to fall through to the
// "first attempt" branch and tell a round-3 maker it had never seen the work.
await probe('E-02 repair brief carries the scores', async () => {
  const M2 = engine()
  const withScores = M2.makerPrompt(M2.NODES.po, 3, [], '  PO-AC: 0.5 — happy path only')
  check(!/first attempt/.test(withScores), 'a later round is never told it is the first attempt  [E-02]')
  check(/scored BELOW THE BAR but cited no/.test(withScores), 'a score-only failure gets its own brief, not silence  [E-02]')
  check(/PO-AC: 0\.5/.test(withScores), "and the maker is shown which criterion cost it the round  [E-02]")
  const first = M2.makerPrompt(M2.NODES.po, 1, [], '')
  check(/first attempt/.test(first), 'but a genuine round 1 still says first attempt  [E-02]')

  // and the loop actually threads them: a checker that scores low with no defects must still
  // produce a round-2 prompt carrying round-1's numbers.
  const seen = []
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (isMake(o)) { seen.push(p); return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true } }
      if (isArb(o)) return { finalized: true, records: [] }
      return { pass: false, criteria: E.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 0.5, why: `thin ${c.id}` })), defects: [] }
    },
  })
  await E.runLoop(E.NODES.po)
  check(seen.length === 2, `the loop ran both rounds (got ${seen.length})`)
  check(/HOW THE LAST ROUND SCORED YOU/.test(seen[1] || ''), "round 2's maker receives round 1's per-criterion scores  [E-02]")
  check(/thin PO-AC/.test(seen[1] || ''), 'including the checker’s reason  [E-02]')
  check(!/HOW THE LAST ROUND SCORED YOU/.test(seen[0] || ''), 'and round 1 receives none — there is nothing to carry  [E-02]')
})

// P16 — [E-05] the checker gets last round's verdict from round 2, and only from round 2.
await probe('E-05 checker memory across rounds', async () => {
  const M2 = engine()
  const r1 = M2.checkerPrompt(M2.NODES.po, M2.NODES.po.checkers[0], 1, '')
  const r2 = M2.checkerPrompt(M2.NODES.po, M2.NODES.po.checkers[0], 2, '  PO-AC: 0.5 — thin')
  check(!/HOW THE PREVIOUS ROUND SCORED/.test(r1), 'round 1 has no previous round to anchor to  [E-05]')
  check(/HOW THE PREVIOUS ROUND SCORED/.test(r2) && /PO-AC: 0\.5/.test(r2), 'round 2 sees how round 1 scored  [E-05]')
  check(/Do NOT lower\n?.*without quoting the regression|without quoting the regression/s.test(r2), 'and may not silently lower a score  [E-05]')
  check(/not seen any other checker/i.test(r2), 'while staying blind to its PEERS — only its own past verdict  [R-LOOP-03]')
})

// P17 — [E-10] severity anchors exist, and the doc-node veto is `critical`-only while build keeps
// critical+high. Without the second assertion, narrowing the veto is indistinguishable from
// deleting it.
await probe('E-10 severity anchoring and veto scope', async () => {
  const M2 = engine()
  const cp = M2.checkerPrompt(M2.NODES.po, M2.NODES.po.checkers[0], 1, '')
  check(/SEVERITY, anchored/.test(cp), 'checkerPrompt defines the severity levels  [E-10]')
  check(/Wording and taste are never high/.test(cp), 'and says plainly what is NOT high  [E-10]')
  const hi = [{ criterion: 'PO-AC', severity: 'high', evidence: 'e', fix: 'f' }]
  const crit = [{ criterion: 'PO-AC', severity: 'critical', evidence: 'e', fix: 'f' }]
  check(M2.blockingOpen(hi).length === 1, 'default scope still blocks on high — build is unchanged  [R-LOOP-01]')
  check(M2.blockingOpen(hi, true).length === 0, 'a doc node does not veto on high  [E-10]')
  check(M2.blockingOpen(crit, true).length === 1, 'but a doc node DOES still veto on critical  [E-10]')

  // end to end: a checker at bar with one `high` now PASSES a doc node, in one round.
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      if (isMake(o)) return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/feature.md' }, { path: '.sdlc2/features/demo/mockup.html' }], hasUiStories: true }
      if (isArb(o)) return { finalized: true, records: [] }
      return { pass: true, criteria: E.RUBRICS.po.criteria.map((c) => ({ id: c.id, score: 1 })), defects: [{ criterion: 'PO-AC', severity: 'high', location: 'x', evidence: 'quoted', fix: 'f' }] }
    },
  })
  const r = await E.runLoop(E.NODES.po)
  check(r.verdict === 'pass' && r.rounds === 1, `a clean score with one high defect passes in round 1 (got '${r.verdict}' in ${r.rounds})  [E-10]`)
})

// P22 — [E2-06] The po cannot declare "no UI stories" while queueing UI slices, and a slice
// marked ui:true never builds against a ux node that was gated off.
await probe('E2-06 hasUiStories is enforced', async () => {
  const M = engine({ agent: async () => ({}) })
  const node = M.NODES.po
  const contradiction = M.auditMaker(node, {
    ok: true,
    artifacts: [{ path: '.sdlc2/features/demo/feature.md' }],
    hasUiStories: false,
    slices: [{ id: '01-a', path: 'x', title: 'A', ui: true }, { id: '02-b', path: 'y', title: 'B', ui: false }],
  })
  check(contradiction.length === 1, `a po that queues a ui slice while declaring no screens is a defect (got ${contradiction.length})  [E2-06]`)
  check(contradiction[0].severity === 'critical', 'and it is critical — the maker contradicted itself  [E2-06]')
  const consistent = M.auditMaker(node, {
    ok: true,
    artifacts: [{ path: '.sdlc2/features/demo/feature.md' }],
    hasUiStories: false,
    slices: [{ id: '01-a', path: 'x', title: 'A', ui: false }],
  })
  check(consistent.length === 0, 'a genuinely backend-only feature is untouched, and owes no mockup  [E-11]')

  // A ui slice must not build when ux was gated off — it used to sail through, because
  // blocksSuccessors deliberately returns false for a gated node.
  const E = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [], ui: true }] }
      if (L.startsWith('build:')) return { committed: true, sha: 'a1', branch: 'slice/demo/01-a' }
      if (L.startsWith('test:')) return { pass: true, criteria: [], defects: [] }
      if (L.startsWith('review:')) return { criteria: E.RUBRICS.build.criteria.map((c) => ({ id: c.id, score: 1 })), defects: [] }
      return {}
    },
  })
  E.settle('ux', { node: 'ux', verdict: 'skipped', gated: true, reason: 'gate condition not met' })
  const r = await E.buildSlices(E.NODES.build)
  check(r.slices.skipped.length === 1 && r.slices.skipped[0].reason === 'ux-gated-off-but-slice-is-ui',
    `a ui slice is not built against a ux node that never ran (got '${r.slices.skipped[0] && r.slices.skipped[0].reason}')  [E2-06]`)
  check(r.slices.shipped.length === 0, 'and nothing shipped from it  [E2-06]')
})

// P23 — [E2-16] a slice cut from one of several blockers tells its reviewer which commits are
// not its work; [E2-07] and the build loop now carries scores across attempts.
await probe('E2-16 / E2-07 build-loop prompts', async () => {
  const M = engine({ agent: async () => ({}) })
  const sl = { id: '07-g', path: 'issues/07-g.md', title: 'G', dir: '', blockedBy: ['02-b', '05-e'] }
  const withOthers = M.reviewerPrompt(sl, { commands: { test: 't' }, seam: {} }, 'slice/demo/05-e', '', ['slice/demo/02-b'], 'CR-CLEAN: 0.4 — naming')
  check(/slice\/demo\/02-b/.test(withOthers), 'the reviewer is told which merged-in branches are not this slice  [E2-16]')
  check(/NOT this\n?\s*slice's work/.test(withOthers), 'and why they are in its diff  [E2-16]')
  check(/HOW THE PREVIOUS ATTEMPT SCORED/.test(withOthers), 'and how the last attempt scored it  [E2-07]')
  check(!/Default to FAIL/.test(withOthers), 'a SCORING reviewer is never told to default to FAIL  [E2-04]')
  const alone = M.reviewerPrompt(sl, { commands: { test: 't' }, seam: {} }, 'main', '', [], '')
  check(!/merged the following in/.test(alone), 'a single-blocker slice gets no such paragraph  [E2-16]')
  check(!/HOW THE PREVIOUS ATTEMPT SCORED/.test(alone), 'and attempt 1 is not told about a previous attempt  [E2-07]')
  const dev = M.developerPrompt(sl, { commands: { test: 't' }, seam: {} }, [], 2, 5, 'main', '', 'CR-DUP: 0.3 — copy-paste')
  check(/HOW THE LAST ATTEMPT SCORED YOU/.test(dev), 'the developer learns which criterion cost it the attempt  [E2-07]')
  check(/THAT FILE IS READ-ONLY TO YOU/.test(dev), 'and that the acceptance criteria are not its to edit  [E2-13]')
})

// P24 — [E2-02] the project declares its stack, and every persona prompt carries it.
await probe('E2-02 the stack is the project\'s to declare', async () => {
  const M = engine({
    agent: async () => ({}),
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { stack: 'Rust 1.79, axum, cargo test', commands: { test: 'cargo test' }, seam: {} }, configByDir: {} },
  })
  const mk = M.makerPrompt(M.NODES.architect, 1, [], '')
  check(/Rust 1\.79, axum, cargo test/.test(mk), 'the declared stack reaches the maker  [E2-02]')
  const ck = M.checkerPrompt(M.NODES.architect, M.NODES.architect.checkers[0], 1, '')
  check(/Rust 1\.79, axum, cargo test/.test(ck), 'and the checker, which scores idiom against it  [E2-02]')
  check(/THE SEED IS SETTLED WORK/.test(mk), 'the maker is told to carry the grilled seed forward, not re-derive it  [E2-15]')
  check(/SETTLED work agreed with a human/.test(ck), 'and the checker scores fidelity to it, not agreement with it  [E2-15]')
  const bare = engine({ agent: async () => ({}), args: { feature: 'd', runId: 'r', config: { commands: { test: 't' }, seam: {} }, configByDir: {} } })
  check(/never assume one/.test(bare.makerPrompt(bare.NODES.architect, 1, [], '')), 'and an undeclared stack is stated as undeclared, never guessed  [E2-02]')
})

// P25 — [E2-11 / E2-12] The run states its plan before spending anything, and surfaces what an
// earlier step already refuted about that plan.
await probe('E2-11 / E2-12 the plan is stated first', async () => {
  const M = engine({ agent: async () => ({}) })
  const plan = M.planLines().join('\n')
  check(/THE PLAN/.test(plan), 'the run prints a plan before the first agent  [E2-11]')
  for (const id of ['po', 'architect', 'ux', 'build']) {
    check(plan.includes(M.NODES[id].phase), `the plan names the ${id} step by its phase  [E2-11]`)
  }
  check(/product-owner-critic/.test(plan), 'and who checks each step  [E2-11]')
  check(/Worst case: \d+ agent calls before building starts, then up to \d+ per slice/.test(plan),
    'the call count is computed from NODES, so editing the graph cannot leave it stale  [E2-11]')

  const table = M.sliceTableLines(
    [{ id: '01-a', title: 'Hold a list', dir: '', ui: true, blockedBy: [] },
     { id: '02-b', title: 'Remove one', dir: '', ui: false, blockedBy: ['01-a'] }],
    { '01-a': 0, '02-b': 1 }
  ).join('\n')
  check(/Waits for/.test(table) && !/blockedBy/.test(table), 'the slice table uses plain headings, not field names  [E2-11]')
  check(/Screens/.test(table) && /Wave/.test(table) && /Test command/.test(table), 'and states screens, wave and test command per slice  [E2-11]')
  check(/02-b\s+Remove one\s+no\s+01-a/.test(table), 'a blocked slice shows what it waits for  [E2-11]')

  // [E2-12] a dispute raised by a settled node reaches the human before the build acts on it
  check(M.upstreamDisputes().length === 0, 'no disputes, no noise  [E2-12]')
  M.results.architect = { node: 'architect', verdict: 'pass', disputed: [{ criterion: 'AR-QUEUE', why: 'issue 06 drives a control issue 03 introduces' }] }
  const d = M.upstreamDisputes().join('\n')
  check(/unresolved dispute/.test(d), 'a dispute from an earlier step is surfaced  [E2-12]')
  check(/issue 06 drives a control issue 03 introduces/.test(d), 'with what it actually said  [E2-12]')
  check(/architect disputes AR-QUEUE/.test(d), 'and which step raised it  [E2-12]')
  delete M.results.architect
})

// P26 — [E2-08] the worktree release is verified, not assumed.
await probe('E2-08 the release is read', async () => {
  let asked = null
  const E = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test', install: 'npm ci' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [
        { id: '01-a', path: 'i/01.md', title: 'A', dir: '', blockedBy: [] },
        { id: '02-b', path: 'i/02.md', title: 'B', dir: '', blockedBy: [] },
      ] }
      if (L === 'worktrees:release') { asked = { prompt: p, schema: o.schema }; return { released: false, remaining: ['../.sdlc2-worktrees/demo-r/02-b'], branches: true } }
      if (L.startsWith('build:')) return { committed: true, sha: 'a1', branch: 'slice/demo/x' }
      if (L.startsWith('test:')) return { pass: true, criteria: [], defects: [] }
      if (L.startsWith('review:')) return { criteria: E.RUBRICS.build.criteria.map((c) => ({ id: c.id, score: 1 })), defects: [] }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(!!asked, 'the worktrees are released  [E-07]')
  check(!!(asked && asked.schema), 'and the release answers with a structured verdict, not prose  [E2-08]')
  const rel = r.slices.lanes.release
  check(!!rel, 'whose answer the engine keeps  [E2-08]')
  check(rel && rel.released === false, 'a release that did not finish is recorded as unfinished  [E2-08]')
  check(!!(rel && (rel.remaining || []).length), 'naming what is still there  [E2-08]')
})

// P21 — [E2-14] A slice starts when ITS OWN blockers land, not when its whole level does.
// Behavioural, not a grep: 03-slow parks until 02-b is observed starting. Under the old level
// barrier 02-b could not start until 03-slow finished, so the gate would never open and the
// fallback timer would fire with `bStarted` still false.
await probe('E2-14 per-slice readiness', async () => {
  let bStarted = false
  let bStartedBeforeSlowFinished = false
  let openGate = null
  const gate = new Promise((r) => { openGate = r })
  const fallback = new Promise((r) => setTimeout(r, 1500))

  const E = engine({
    parallel: parallelReal,
    args: {
      feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main',
      config: { commands: { test: 'npm test', install: 'npm ci' }, seam: {} }, configByDir: {},
    },
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) {
        return { slices: [
          { id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [] },
          { id: '03-slow', path: 'issues/03-slow.md', title: 'Slow', dir: '', blockedBy: [] },
          { id: '02-b', path: 'issues/02-b.md', title: 'B', dir: '', blockedBy: ['01-a'] },
        ] }
      }
      if (L.startsWith('build:02-b')) { bStarted = true; openGate() }
      if (L.startsWith('build:03-slow')) {
        await Promise.race([gate, fallback])
        bStartedBeforeSlowFinished = bStarted
      }
      if (L.startsWith('build:')) return { committed: true, sha: 'a1b2c3', branch: 'slice/demo/x' }
      if (L.startsWith('test:')) return { pass: true, criteria: [], defects: [] }
      if (L.startsWith('review:')) return { criteria: E.RUBRICS.build.criteria.map((c) => ({ id: c.id, score: 1 })), defects: [] }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(bStarted === true, 'the blocked slice did start  [E2-14]')
  check(bStartedBeforeSlowFinished === true, 'and it started while an unrelated sibling was still building — no level barrier  [E2-14]')
  check(r.slices.shipped.length === 3, `all three slices still ship (${r.slices.shipped.length})  [E2-14]`)
})

// P18 — [E2-03] The plateau exit is GONE, and a rejected maker output gets one free re-make.
// The old probe here asserted the plateau exit by giving a document node 9 rounds — which is the
// only reason it passed. In production `runLoop` is reached only by po/architect/ux, all at
// DOC_ROUNDS = 2, so three rounds of history could never accumulate and the branch was dead.
// What replaces it: the round budget now means two SCORED rounds.
await probe('E2-03 free re-make, no plateau exit', async () => {
  // (a) A node that never converges spends exactly its declared rounds and then arbitrates.
  let makes = 0
  const E = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      if (isMake(o)) { makes++; return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/design.md' }], hasUiStories: true } }
      if (isArb(o)) return { finalized: true, records: [] }
      return { pass: false, criteria: E.RUBRICS.arch.criteria.map((c) => ({ id: c.id, score: 0.5 })), defects: [{ criterion: 'AR-BOUND', severity: 'critical', location: 'x', evidence: 'q', fix: 'f' }] }
    },
  })
  const r = await E.runLoop(E.NODES.architect)
  check(r.verdict === 'needs-arbitration', `a flat node hands off rather than passing (got '${r.verdict}')  [R-LOOP-07]`)
  check(r.rounds === 2 && makes === 2, `and spends exactly DOC_ROUNDS, no plateau short-circuit (rounds=${r.rounds}, makers=${makes})  [E2-03]`)
  check(r.history.length === 2, 'the score history records every round it did spend  [R-LOOP-09]')
  check(!/if \(history\.length >= 3\)/.test(src), 'no plateau-exit branch survives in the engine  [E2-03]')

  // (b) The FIRST rejected maker output is free; the round is not charged.
  let m2 = 0
  const E2 = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      if (isMake(o)) {
        m2++
        // Round 1's answer names no artifact at all → auditMaker rejects it. Everything after is good.
        if (m2 === 1) return { ok: true, artifacts: [], hasUiStories: true }
        return { ok: true, artifacts: [{ path: '.sdlc2/features/demo/design.md' }], hasUiStories: true }
      }
      if (isArb(o)) return { finalized: true, records: [] }
      return { pass: true, criteria: E2.RUBRICS.arch.criteria.map((c) => ({ id: c.id, score: 1 })), defects: [] }
    },
  })
  const r2 = await E2.runLoop(E2.NODES.architect)
  check(r2.verdict === 'pass', `a node whose first output was rejected can still pass (got '${r2.verdict}')  [E2-03]`)
  check(r2.rounds === 1, `and the rejected attempt did not cost a round (rounds=${r2.rounds}, makers=${m2})  [E2-03]`)
  check(m2 === 2, `the maker really was re-spawned (${m2} maker calls)  [E2-03]`)
  check((r2.history[0] || {}).free === true, 'the free re-make is recorded in the history, not hidden  [R-LOOP-09]')

  // (c) The free re-make is bounded: a maker that ALWAYS answers badly still terminates.
  let m3 = 0
  const E3 = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      if (isMake(o)) { m3++; return { ok: true, artifacts: [], hasUiStories: true } }
      if (isArb(o)) return { finalized: true, records: [] }
      return { pass: true, criteria: [], defects: [] }
    },
  })
  const r3 = await E3.runLoop(E3.NODES.architect)
  check(r3.verdict === 'hard-fail', `a maker that never produces artifacts still hard-fails (got '${r3.verdict}')  [E2-03]`)
  check(m3 === 3, `bounded at DOC_ROUNDS + 1 free re-make, not infinite (${m3} maker calls)  [E2-03]`)
})

// P18b — [SD-05 / R-LOOP-11] a spawn that never answered is transport, not content. It retries
// once for free; a maker that ANSWERS badly is untouched and still costs its round.
await probe('SD-05 transport retry', async () => {
  // (a) one free retry, and the recovered answer is the one that is used.
  let calls = 0
  const E1 = engine({ agent: async () => { calls++; return calls === 1 ? null : { ok: true, recovered: true } } })
  const got = await E1.spawn('p', { label: 'ux:make' })
  check(calls === 2, `a spawn that returns null is retried (called ${calls}x)  [R-LOOP-11]`)
  check(got && got.recovered === true, 'and the retry\'s answer is what the caller receives  [R-LOOP-11]')

  // (b) a throw is transport too — the engine must not die on it.
  let thrown = 0
  const E2 = engine({ agent: async () => { thrown++; if (thrown === 1) throw new Error('API Error: Connection lost mid-response'); return { ok: true } } })
  const rec = await E2.spawn('p', { label: 'ux:make' })
  check(rec && rec.ok === true, 'a spawn that THROWS is retried too, not propagated  [R-LOOP-11]')

  // (c) the retry is bounded — a permanently dead spawn returns null rather than looping.
  let dead = 0
  const E3 = engine({ agent: async () => { dead++; return null } })
  const none = await E3.spawn('p', { label: 'ux:make' })
  check(none === null, 'a permanently dead spawn gives up and returns null  [R-LOOP-11]')
  check(dead === E3.SPAWN_RETRIES + 1, `and is bounded at ${E3.SPAWN_RETRIES + 1} attempt(s), not infinite (made ${dead})  [R-LOOP-11]`)

  // (d) a maker that never answers is `errored`, not `rejected`, and its defect is a HARNESS
  //     defect — so the next round's maker is never asked to repair a non-answer.
  const said = []
  const E4 = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      said.push({ label: L, prompt: p })
      if (L.startsWith('po:make')) return null
      return {}
    },
  })
  const r = await E4.runLoop(E4.NODES.po)
  const errored = (r.history || []).filter((h) => h.errored === true)
  check(errored.length > 0, 'an unanswered maker is recorded as errored  [R-LOOP-11]')
  check(errored.every((h) => h.note === 'maker spawn errored'), 'and never as "maker output rejected"  [R-LOOP-11]')
  check(!(r.history || []).some((h) => h.note === 'maker output rejected'), 'the two are not conflated  [R-LOOP-11]')
  const makes = said.filter((x) => x.label.startsWith('po:make'))
  check(makes.length === E4.NODES.po.rounds * (E4.SPAWN_RETRIES + 1), `each round retried once before being charged (${makes.length} spawns for ${E4.NODES.po.rounds} rounds)  [R-LOOP-11]`)
  const second = (makes[2] || {}).prompt || ''
  check(!/Fix EVERY defect/.test(second), 'and the next maker is not asked to repair its own non-answer  [R-LOOP-08]')
  check(/harness failure/.test(second), 'it is told the round could not be scored  [R-LOOP-08]')
})

// P18c — [SD-07 / R-ARCH-03] issues/ owns the dependency queue. The architect may disagree with
// it; it may not declare a different one downstream, where only one of the two graphs is read.
await probe('SD-07 queue single source of truth', async () => {
  const m = M.NODES.architect.mandate
  check(/issues\//.test(m) && /single source of truth/i.test(m), 'the architect mandate names issues/ as the queue\'s single source of truth  [R-ARCH-03]')
  check(/MUST NOT assert a dependency edge/i.test(m) || /MUST NOT.*dependency edge/i.test(m), 'and forbids design.md asserting an edge issues/ does not carry  [R-ARCH-03]')
  check(/product-owner node|po node/i.test(m), 'and routes the disagreement to the product-owner node instead  [R-ARCH-03]')
  check(/not even one you are right about/i.test(m), 'including one the architect is right about — being correct is not the exception  [R-ARCH-03]')

  const q = M.RUBRICS.arch.criteria.find((c) => c.id === 'AR-QUEUE')
  check(!!q, 'the arch rubric carries a criterion that scores it  [R-ARCH-03]')
  check(!!q && /Blocked by:/.test(q.text), 'and tells the critic to actually read the Blocked by: lines  [R-ARCH-03]')
  check(!!q && /0\.0 = design\.md declares a `Blocked by:` edge absent from issues\//.test(q.anchors), 'with a 0.0 anchor that is the exact run-2 failure  [R-ARCH-03]')

  const design = M.NODES.architect.outputs.find((o) => o.path.endsWith('design.md'))
  check(!!design && /issues\/ owns it/.test(design.note), 'design.md\'s own output note says issues/ owns the queue  [R-ARCH-03]')
  check(/issues\//.test(M.NODES.architect.checkers[0].lens), 'and the critic\'s lens points at it  [R-ARCH-03]')

  // The engine must still read ONLY issues/ — the whole defect was an artifact nobody reads.
  const branchOf = { '01-a': 'slice/demo/01-a', '02-b': 'slice/demo/02-b' }
  const order = { '01-a': 0, '02-b': 1, '03-c': 2 }
  check(M.baseFor({ id: '03-c', blockedBy: ['01-a'] }, branchOf, order) === 'slice/demo/01-a', 'baseFor still reads the issue\'s blockedBy, nothing else  [R-ARCH-03]')
})

// P19 — [E-04] the build arbiter never commits, and a slice ships the sha the TESTER verified.
// Also [E-07]: with an install command declared, independent slices build in parallel worktrees.
await probe('E-04 arbiter cannot commit · E-07 lanes', async () => {
  const said = []
  const E = engine({
    parallel: parallelReal,
    args: { feature: 'demo', title: 'Demo', runId: 'r', defaultBranch: 'main', config: { commands: { test: 'npm test', install: 'npm ci' }, seam: {} }, configByDir: {} },
    agent: async (p, o) => {
      const L = o.label || ''
      said.push({ label: L, prompt: p })
      if (L.startsWith('slices:resolve')) return { slices: [
        { id: '01-a', path: 'issues/01-a.md', title: 'A', dir: '', blockedBy: [], ui: false },
        { id: '02-b', path: 'issues/02-b.md', title: 'B', dir: '', blockedBy: [], ui: false },
      ] }
      if (L.startsWith('build:')) return { committed: true, sha: 'verified-sha', branch: `slice/demo/${L.slice(6).split(' ')[0]}`, changelog: 'x' }
      if (L.startsWith('test:')) return { pass: true, defects: [] }
      if (L.startsWith('review:')) return { criteria: E.RUBRICS.build.criteria.map((c) => ({ id: c.id, score: 0.2 })), defects: [] }
      if (L.startsWith('arbiter:')) return { finalized: true, records: [{ id: 'VH-build-01-a-01', decision: 'd', rationale: 'r' }] }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  const arb = (said.find((x) => x.label.startsWith('arbiter:')) || {}).prompt || ''
  check(/Do NOT edit code and do NOT commit/.test(arb), 'the build arbiter is forbidden from committing  [E-04]')
  check(!/commit any fix/.test(arb), 'and is not invited to "commit any fix" any more  [E-04]')
  check(/finalized/.test(arb) && /escalated to a\n?\s*human/.test(arb), 'it may refuse the debt instead  [E-04]')
  check(r.slices.shipped.every((x) => x.sha === 'verified-sha'), 'a shipped slice carries the sha the tester verified  [E-04]')

  const dev = (said.find((x) => x.label.startsWith('build:01-a')) || {}).prompt || ''
  check(/git worktree add/.test(dev), 'with lanes open, a slice builds in its own worktree  [E-07]')
  check(/npm ci/.test(dev), 'and installs dependencies there before testing  [E-07]')
  const tst = (said.find((x) => x.label.startsWith('test:01-a')) || {}).prompt || ''
  check(/git -C \.\.\/\.sdlc2-worktrees\/demo-r\/01-a/.test(tst), 'and the tester judges THAT tree, not the session checkout  [R-BUILD-07]')
  check(/\.\.\//.test(tst), 'and that tree is OUTSIDE the repo, so the project test runner cannot collect it  [SD-04]')
  check(said.some((x) => x.label === 'worktrees:release'), 'the worktrees are released when building ends  [E-07]')
})

// P20 — [E-04 mirror] an arbiter that REFUSES the debt escalates instead of shipping.
await probe('E-04 arbiter refusal', async () => {
  const E = engine({
    parallel: parallelReal,
    agent: async (p, o) => {
      const L = o.label || ''
      if (L.startsWith('slices:resolve')) return { slices: [{ id: '01-a', path: 'p', title: 'A', dir: '', blockedBy: [], ui: false }] }
      if (L.startsWith('build:')) return { committed: true, sha: 'cafe', branch: 'slice/demo/01-a', changelog: 'x' }
      if (L.startsWith('test:')) return { pass: true, defects: [] }
      if (L.startsWith('review:')) return { criteria: E.RUBRICS.build.criteria.map((c) => ({ id: c.id, score: 0.2 })), defects: [] }
      if (L.startsWith('arbiter:')) return { finalized: false, records: [] }
      return {}
    },
  })
  const r = await E.buildSlices(E.NODES.build)
  check(r.slices.shipped.length === 0, 'nothing ships when the arbiter refuses the debt  [E-04]')
  check((r.slices.escalated[0] || {}).reason === 'arbiter-rejected', `and the slice is escalated with the real reason (got '${(r.slices.escalated[0] || {}).reason}')  [E-04]`)
})

console.log('')
if (fails) { console.log(`\x1b[31mFAILED\x1b[0m — ${fails} check(s)\n`); process.exit(1) }
console.log('\x1b[32mAll checks passed.\x1b[0m Structure AND the failure paths — but still not proof the graph\nproduces good software. Run 1 passed every check here and STILL stacked four branches it was\ntold to keep separate; only running it again finds the next one of those.\n')
