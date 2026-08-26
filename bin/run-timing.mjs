#!/usr/bin/env node
// run-timing — where a run's time actually went.
//
// The run report carries verdicts, scores, rounds and defects, and no timing at all, so a slow
// run and a retrying run read identically. The engine cannot fix this itself: the workflow
// sandbox makes `Date.now()` throw, the main thread sees one tool call rather than node
// boundaries, and `journal.jsonl` carries no timestamps. The per-agent transcripts do — so this
// reads them after the fact.
//
//   node bin/run-timing.mjs --feature guest-checkout      # find the run by what it built
//   node bin/run-timing.mjs --dir <workflow-transcript-dir>
//
// It reports what the timestamps support and nothing more. In particular it does NOT draw a
// critical path: it has no access to the graph's edges, so any chain it inferred from overlap
// would be a guess wearing the clothes of a measurement.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

// ─────────────────────────────────────────────────────────── arguments ────
const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const flag = (name) => argv.indexOf(`--${name}`) >= 0

if (flag('help') || (!arg('feature') && !arg('dir'))) {
  console.log(`run-timing — where a run's time actually went

  --feature <slug>   find the run by the feature it built (scans this machine's transcripts)
  --dir <path>       read one workflow transcript directory directly
  --out <path>       write the report here (default: .sdlc2/features/<slug>/runs/, if it exists)
  --no-write         print only
  --json             machine-readable output

A run resumed in a second session leaves two directories under the same workflow id; --feature
merges them and de-duplicates by agent id. --dir reads exactly what you point it at.`)
  process.exit(flag('help') ? 0 : 1)
}

// ───────────────────────────────────────────────────── finding the run ────
// Nothing records the mapping from a runId to its transcript directory today. Going forward
// `modes/new-feature.md` writes it into the run report; for every run made before that, the only
// way back is to look for a workflow whose prompts name the feature's own artifacts.
const PROJECTS = join(homedir(), '.claude', 'projects')

function dirsFor(feature) {
  const hits = []
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('wf_')) { hits.push(join(dir, e.name)); continue }
      walk(join(dir, e.name), depth + 1)
    }
  }
  walk(PROJECTS, 0)
  const needle = `.sdlc2/features/${feature}/`
  return hits.filter((d) => {
    const files = readdirSync(d).filter((f) => f.endsWith('.jsonl') && f.startsWith('agent-'))
    for (const f of files.slice(0, 3)) {
      try { if (readFileSync(join(d, f), 'utf8').slice(0, 20000).includes(needle)) return true } catch {}
    }
    return false
  })
}

// ────────────────────────────────────────────────────── reading agents ────
const SHORT = (t) => String(t || '').replace(/^sdlc2:/, '').replace(/^sdlc2-/, '')

// agentType -> the node it belongs to. The roleless helper spawns declare no agentType at all, so
// they are recognised from their prompt instead.
const NODE_OF = {
  'product-owner': 'po', 'product-owner-critic': 'po',
  architect: 'architect', 'architect-critic': 'architect',
  'ux-design': 'ux', 'ux-auditor': 'ux',
  developer: 'build', tester: 'build', 'code-reviewer': 'build',
}

function firstUserText(lines) {
  for (const d of lines) {
    if (d.type !== 'user') continue
    let c = d.message && d.message.content
    if (Array.isArray(c)) c = c.map((x) => (x && x.text) || '').join(' ')
    if (typeof c === 'string' && c.length) return c
  }
  return ''
}

function readAgent(dir, file) {
  const id = basename(file).slice('agent-'.length, -'.jsonl'.length)
  let meta = {}
  const mp = join(dir, `agent-${id}.meta.json`)
  if (existsSync(mp)) { try { meta = JSON.parse(readFileSync(mp, 'utf8')) } catch {} }

  const lines = []
  let lo = null, hi = null
  for (const raw of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (!raw) continue
    let d
    try { d = JSON.parse(raw) } catch { continue }
    lines.push(d)
    if (d.timestamp) {
      const t = Date.parse(d.timestamp)
      if (!Number.isNaN(t)) { if (lo === null || t < lo) lo = t; if (hi === null || t > hi) hi = t }
    }
  }
  if (lo === null) return null

  const p = firstUserText(lines)
  const raw = SHORT(meta.agentType)
  const type = raw === 'workflow-subagent' ? '' : raw
  let node = NODE_OF[type] || null
  let role = type || null

  // A maker and its arbiter are the same persona; only the prompt tells them apart.
  const arbiter = /now in DECIDE MODE/.test(p)
  if (arbiter) role = 'arbiter'

  // The helper spawns carry no agentType. Name them the way the labels item will name them.
  if (!type) {
    if (/Enumerate the queued slices/.test(p)) { node = 'build'; role = 'resolve-slices' }
    else if (/worktree/i.test(p) && /remove|release/i.test(p)) { node = 'build'; role = 'release-worktrees' }
    else if (/escalat/i.test(p)) { node = 'build'; role = 'escalate' }
    else if (/run report/i.test(p)) { node = 'report'; role = 'report' }
    else role = raw || 'helper'
  }

  // The unit of work, where there is one: the slice this call is about.
  let unit = null
  const m = p.match(/slice\/[^/\s`]+\/([0-9]+[-a-z0-9]*)/) || p.match(/issues\/([0-9]+-[a-z0-9-]+)\.md/)
  if (m) unit = m[1]

  // Which round or attempt this was, where the prompt says so.
  let round = null
  const r = p.match(/ROUND (\d+) of (\d+)/) || p.match(/ROUND (\d+)\./) || p.match(/Repair attempt (\d+) of (\d+)/)
  if (r) round = r[2] ? `${r[1]}/${r[2]}` : `${r[1]}`
  else if (/first build of this slice/.test(p)) round = '1'

  return { id, node, role, unit, round, model: meta.model || '', start: lo, end: hi, dur: hi - lo }
}

// ───────────────────────────────────────────────────────────── collect ────
const feature = arg('feature')
let dirs = arg('dir') ? [arg('dir')] : dirsFor(feature)
dirs = dirs.filter((d) => existsSync(d) && statSync(d).isDirectory())
if (!dirs.length) {
  console.error(feature
    ? `No workflow transcripts on this machine mention .sdlc2/features/${feature}/.\nTranscripts are per-machine and can be pruned; a run whose transcripts are gone cannot be timed.`
    : `Not a directory: ${arg('dir')}`)
  process.exit(1)
}

if (dirs.length > 1 && !flag('all')) {
  console.error(`${dirs.length} workflow directories mention this feature:\n`)
  for (const d of dirs) {
    const n = readdirSync(d).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).length
    console.error(`  ${d}\n    ${n} agent call(s)`)
  }
  console.error(`
Two directories can share a workflow id without being one run — resuming keeps the id, and so
does re-running the same script. Timing them as one invents a run that never happened.

Pick one with --dir, or pass --all if you really do mean to merge them.`)
  process.exit(1)
}

const byId = new Map()
for (const d of dirs) {
  for (const f of readdirSync(d)) {
    if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue
    const a = readAgent(d, f)
    if (a && !byId.has(a.id)) byId.set(a.id, a)
  }
}
const agents = [...byId.values()].sort((a, b) => a.start - b.start)
if (!agents.length) { console.error('No timestamped agent transcripts found.'); process.exit(1) }

// ───────────────────────────────────────────────────────────── measure ────
const T0 = agents[0].start
const TN = Math.max(...agents.map((a) => a.end))
const wall = TN - T0
const busy = agents.reduce((t, a) => t + a.dur, 0)

// The largest stretch in which NOTHING was running. Engine overhead lands here, and nothing
// measures it today.
let gap = { ms: 0, at: 0 }
{
  const iv = agents.map((a) => [a.start, a.end]).sort((x, y) => x[0] - y[0])
  let reach = iv[0][1]
  for (const [s, e] of iv.slice(1)) {
    if (s > reach && s - reach > gap.ms) gap = { ms: s - reach, at: reach }
    if (e > reach) reach = e
  }
}

const span = (list) => ({
  count: list.length,
  from: Math.min(...list.map((a) => a.start)) - T0,
  to: Math.max(...list.map((a) => a.end)) - T0,
  busy: list.reduce((t, a) => t + a.dur, 0),
})
const groupBy = (key) => {
  const g = new Map()
  for (const a of agents) {
    const k = a[key] || '—'
    if (!g.has(k)) g.set(k, [])
    g.get(k).push(a)
  }
  return [...g.entries()].map(([k, v]) => [k, span(v)]).sort((x, y) => x[1].from - y[1].from)
}

// ───────────────────────────────────────────────────────────── report ────
const min = (ms) => (ms / 60000).toFixed(1)
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

const out = []
out.push(`# Run timing${feature ? ` — ${feature}` : ''}`)
out.push('')
out.push(`**Workflow:** ${dirs.map((d) => basename(d)).join(', ')}`)
if (dirs.length > 1) out.push(`**Merged from ${dirs.length} session directories** — the run was resumed.`)
out.push(`**Agent calls:** ${agents.length}`)
out.push('')
out.push('## Totals')
out.push('')
out.push('| | |')
out.push('|---|---|')
out.push(`| wall-clock | **${min(wall)} min** |`)
out.push(`| summed agent time | ${min(busy)} min |`)
out.push(`| ratio | ${(busy / wall).toFixed(2)}× — how much overlap the graph actually achieved |`)
out.push(`| largest idle gap | ${min(gap.ms)} min, at t+${min(gap.at - T0)} |`)
out.push('')
out.push('No critical path is claimed: this reads timestamps, not the graph, so any chain it drew')
out.push('from overlap would be a guess.')
out.push('')
out.push('## By node')
out.push('')
out.push('| node | calls | first start | last end | span | agent time |')
out.push('|---|---|---|---|---|---|')
for (const [k, s] of groupBy('node')) {
  out.push(`| ${k} | ${s.count} | t+${min(s.from)} | t+${min(s.to)} | ${min(s.to - s.from)} min | ${min(s.busy)} min |`)
}
const units = groupBy('unit').filter(([k]) => k !== '—')
if (units.length) {
  out.push('')
  out.push('## By slice')
  out.push('')
  out.push('| slice | calls | first start | last end | span | agent time |')
  out.push('|---|---|---|---|---|---|')
  for (const [k, s] of units) {
    out.push(`| ${k} | ${s.count} | t+${min(s.from)} | t+${min(s.to)} | ${min(s.to - s.from)} min | ${min(s.busy)} min |`)
  }
}
out.push('')
out.push('## Every call, in the order it started')
out.push('')
out.push('```')
out.push(`${lpad('start', 7)} ${lpad('min', 6)}  ${pad('node', 10)}${pad('role', 22)}${pad('unit', 30)}${pad('round', 7)}model`)
for (const a of agents) {
  out.push(
    `${lpad('t+' + min(a.start - T0), 7)} ${lpad(min(a.dur), 6)}  ` +
    `${pad(a.node || '—', 10)}${pad(a.role || '—', 22)}${pad(a.unit || '—', 30)}${pad(a.round || '—', 7)}${a.model}`
  )
}
out.push('```')
const text = out.join('\n') + '\n'

if (flag('json')) {
  console.log(JSON.stringify({ feature, dirs, wall, busy, ratio: busy / wall, gap, agents }, null, 2))
} else {
  process.stdout.write(text)
}

if (!flag('no-write') && !flag('json')) {
  let dest = arg('out')
  if (!dest && feature) {
    const runs = join('.sdlc2', 'features', feature, 'runs')
    if (existsSync(runs)) dest = join(runs, `${basename(dirs[0])}-timing.md`)
  }
  if (dest) { writeFileSync(dest, text); console.error(`\nwritten to ${dest}`) }
}
