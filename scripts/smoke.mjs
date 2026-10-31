#!/usr/bin/env node
// Smoke test: exercises dsh-i-have-adhd without the harness.
//
// 1. Originality gate — distinctive sentences from the upstream project
//    (ayghri/i-have-adhd, MIT) must NOT appear in our ruleset. The concept
//    list is fair game; the expression is not. This encodes the copyright
//    mitigation of THIRD-PARTY-NOTICES.md as a regression check.
// 2. Concept coverage — all ten ideas the ruleset promises are present.
// 3. Interpolation safety — no {{variable}} references (renderPrompt is
//    strict; an unknown reference would fail every assembly).
// 4. State machine — with a mocked Cordis context and a temp DSH_HOME:
//    off by default, adhd_on registers the section and writes the flag,
//    adhd_off disposes and clears it, and a pre-existing flag restores the
//    section at apply time.
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
function check(label, ok) {
  console.log((ok ? 'ok   ' : 'FAIL ') + label)
  if (!ok) failures++
}

const { RULES } = await import('../dsh/rules.js')
const plugin = await import('../dsh/index.js')

// --- 1. originality gate -------------------------------------------------
const upstreamFingerprints = [
  'Lead with the next action',
  'Number multi-step tasks',
  'End with one concrete next action',
  'Suppress tangents',
  'Restate state every turn',
  'Make completed work visible',
  'Matter-of-fact tone for errors',
  'Cap lists at 5 items',
  'Hope this helps',
  'Working memory is small',
  'Starting is the hardest step',
  'Dopamine is scarce',
  'A short path finished beats a complete path abandoned',
  'Start with the answer',
  'The reader has ADHD',
  'circle back',
  'get the ball rolling',
]
for (const phrase of upstreamFingerprints) {
  check(`ruleset avoids upstream phrase: "${phrase}"`, !RULES.includes(phrase))
}

// --- 2. concept coverage ---------------------------------------------------
const concepts = [
  ['action first', /first line is the action/i],
  ['numbered steps', /number (the|your) steps|numbered list/i],
  ['one next move', /one next move|next move/i],
  ['park tangents', /park side quests|one issue per reply/i],
  ['restate progress', /re-?say where we are|current progress/i],
  ['real time units', /minutes or hours|real units/i],
  ['visible wins', /surface what now works|concrete outcome/i],
  ['factual errors', /errors are facts|what broke.*the fix/is],
  ['list cap', /cap lists at five/i],
  ['no preamble', /no throat-?clearing|no preamble/i],
]
for (const [label, pattern] of concepts) {
  check(`ruleset covers concept: ${label}`, pattern.test(RULES))
}

// --- 3. interpolation safety ----------------------------------------------
check('ruleset has no {{variable}} references', !/\{\{[a-z][a-z0-9_]*\}\}/i.test(RULES))

// --- 4. state machine ------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), 'dsh-adhd-smoke-'))
process.env.DSH_HOME = home

function mockCtx() {
  const state = { sections: [], tools: new Map(), disposed: [] }
  return {
    state,
    systemPrompt: {
      section(spec) {
        state.sections.push(spec)
        return () => {
          state.disposed.push(spec.name)
          state.sections = state.sections.filter((s) => s !== spec)
        }
      },
    },
    tools: {
      register(tool) {
        state.tools.set(tool.name, tool)
      },
    },
  }
}

// 4a. off by default, all three tools registered
const ctx1 = mockCtx()
plugin.apply(ctx1)
check('mode is off by default (no flag, no section)', ctx1.state.sections.length === 0)
check('registers adhd_on / adhd_off / adhd_status',
  ['adhd_on', 'adhd_off', 'adhd_status'].every((n) => ctx1.state.tools.has(n)))

// dsh-tools register() validates output.schema against a fixed JSON Schema
// subset and throws on anything else; the mock above does not, so the subset
// is asserted here or a bad type ships as silently missing tools.
const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
check('tool output schemas use a dsh-tools-supported type',
  [...ctx1.state.tools.values()].every((tool) => SUPPORTED_SCHEMA_TYPES.has(tool.output?.schema?.type)))

// 4b. adhd_on registers the section and persists the flag
await ctx1.state.tools.get('adhd_on').execute()
check('adhd_on registers one section', ctx1.state.sections.length === 1)
const section = ctx1.state.sections[0]
check('section is named dsh-i-have-adhd at order 50',
  section.name === 'dsh-i-have-adhd' && section.order === 50)
check('section text is the ruleset', section.text === RULES)
check('flag file written', existsSync(join(home, 'dsh-i-have-adhd', 'always-on')))
const onResult = await ctx1.state.tools.get('adhd_status').execute()
check('status reports enabled', onResult.enabled === true && onResult.persisted === true)

// 4c. adhd_off disposes the section and clears the flag
await ctx1.state.tools.get('adhd_off').execute()
check('adhd_off disposes the section', ctx1.state.sections.length === 0 && ctx1.state.disposed.includes('dsh-i-have-adhd'))
check('flag file removed', !existsSync(join(home, 'dsh-i-have-adhd', 'always-on')))

// 4d. a pre-existing flag restores the mode at apply time
mkdirSync(join(home, 'dsh-i-have-adhd'), { recursive: true })
writeFileSync(join(home, 'dsh-i-have-adhd', 'always-on'), 'enabled at smoke\n')
const ctx2 = mockCtx()
plugin.apply(ctx2)
check('pre-existing flag restores the section at boot', ctx2.state.sections.length === 1)

rmSync(home, { recursive: true, force: true })

if (failures > 0) {
  console.error(failures + ' check(s) failed')
  process.exit(1)
}
console.log('all checks passed')
