// dsh-i-have-adhd — ADHD-friendly output shaping for DeepSeek Harness.
//
// Registers one system-prompt section (the rewritten ruleset in ./rules.js)
// plus three zero-argument tools — adhd_on, adhd_off, adhd_status — so the
// reader or the model can flip the mode mid-conversation. The mode persists
// across restarts via a flag file under $DSH_HOME (default ~/.dsh).
//
// The original idea of shaping assistant output for ADHD readers comes from
// ayghri/i-have-adhd (MIT); this implementation and wording are original.
// See THIRD-PARTY-NOTICES.md.
//
// Loaded via the cordis.patch.yml row declared by package.json `dsh.bundle`.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { RULES } from './rules.js'

export const name = 'dsh-i-have-adhd'

// systemPrompt carries the ruleset into every model step; tools registers
// the on/off/status switches. Both are core, so they are hard dependencies.
export const inject = ['systemPrompt', 'tools']

const SECTION_NAME = 'dsh-i-have-adhd'
// Convention: -100 harness identity, 0 persona, 100–199 tool guidance.
// Output-style shaping belongs after the persona, before tool guidance.
const SECTION_ORDER = 50

function stateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-i-have-adhd')
}

function flagPath() {
  return join(stateDir(), 'always-on')
}

function readFlag() {
  try {
    return existsSync(flagPath())
  } catch {
    return false
  }
}

function writeFlag(on) {
  try {
    if (on) {
      mkdirSync(stateDir(), { recursive: true })
      // Content is human-readable so the file explains itself in an editor.
      const written = new Date().toISOString()
      writeFileSync(flagPath(), `enabled at ${written}\n`)
    } else {
      rmSync(flagPath(), { force: true })
    }
  } catch (error) {
    console.error(`[dsh-i-have-adhd] flag persistence failed: ${error?.message ?? error}`)
  }
}

export function apply(ctx) {
  let disposeSection = null
  let enabled = false
  let since = null

  function enable(persist) {
    if (disposeSection !== null) return
    try {
      disposeSection = ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: RULES,
      })
      enabled = true
      since = new Date().toISOString()
      if (persist) writeFlag(true)
      console.log('[dsh-i-have-adhd] output mode ON')
    } catch (error) {
      // A same-name section already registered (double mount in one process)
      // degrades loudly instead of breaking composition.
      console.error(`[dsh-i-have-adhd] section registration failed: ${error?.message ?? error}`)
    }
  }

  function disable(persist) {
    if (disposeSection !== null) {
      disposeSection()
      disposeSection = null
    }
    enabled = false
    since = null
    if (persist) writeFlag(false)
    console.log('[dsh-i-have-adhd] output mode OFF')
  }

  // Restore the persisted mode at boot.
  if (readFlag()) enable(false)

  function status() {
    return {
      enabled,
      since,
      persisted: readFlag(),
      section: SECTION_NAME,
    }
  }

  const renderJson = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

  function registerTool(tool) {
    try {
      ctx.tools.register(tool)
    } catch (error) {
      console.error(`[dsh-i-have-adhd] ${tool.name} registration skipped: ${error?.message ?? error}`)
    }
  }

  registerTool({
    name: 'adhd_on',
    description:
      'Turn ON ADHD-friendly output shaping for this DSH session and persist it across restarts. Call when the user asks for "adhd mode", "adhd mode on", or wants action-first, numbered-step replies without preamble or closers. Returns the mode status.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: renderJson },
    async execute() {
      enable(true)
      return { ok: true, ...status() }
    },
  })

  registerTool({
    name: 'adhd_off',
    description:
      'Turn OFF ADHD-friendly output shaping and clear the persisted flag. Call when the user says "adhd mode off", "normal mode", or wants the default reply style back.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: renderJson },
    async execute() {
      disable(true)
      return { ok: true, ...status() }
    },
  })

  registerTool({
    name: 'adhd_status',
    description:
      'Report whether ADHD-friendly output shaping is on, since when, and whether the flag file will restore it after a restart.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: renderJson },
    async execute() {
      return status()
    },
  })
}
