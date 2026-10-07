/**
 * Tests for the bundle patch: the `team` preset must expose the Team
 * delegation surface, keep the workflow fan-out channel, and drop every
 * anonymous subagent control.
 *
 * The patch is the maintained source, so these assertions are what keeps a
 * hand edit from silently changing the mode's contract.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))

/** The `insert` rows the patch declares. */
const inserted = patch.find(entry => entry?.insert !== undefined).insert

/** Flatten a preset's plugin rows, nested groups included. */
function flatten(plugins) {
  return plugins.flatMap(row => (row.group ? (row.config ?? []) : [row]))
}

const presetRow = inserted.find(row => row.id === 'preset-team')
const plugins = presetRow.config.plugins
const active = flatten(plugins).filter(row => row.disabled !== true)
const activeIds = active.map(row => row.id)

test('patch inserts the boundary plugin and the preset', () => {
  assert.deepEqual(inserted.map(row => row.id).sort(), ['preset-team', 'team-lead-boundary'])
  assert.equal(inserted.find(row => row.id === 'team-lead-boundary').name, 'dsh-team-mode')
  assert.equal(presetRow.name, '@deepseek-ai/dsh-agent-preset')
})

test('preset identity is stable', () => {
  assert.equal(presetRow.config.id, 'team')
  assert.equal(presetRow.config.order, 5)
  assert.ok(presetRow.config.name, 'the mode needs a display name for the picker')
})

test('no anonymous subagent control stays active', () => {
  const anonymous = activeIds.filter(id => String(id).startsWith('tool-subagent'))
  assert.deepEqual(anonymous, [], 'team mode must not expose the anonymous subagent tools')
})

test('the shipped disabled provider rows stay disabled', () => {
  const subagentRows = flatten(plugins).filter(row => String(row.id).startsWith('tool-subagent'))
  assert.ok(subagentRows.length > 0, 'the derived list carries the shipped disabled rows')
  for (const row of subagentRows) {
    assert.equal(row.disabled, true, `${row.id} must stay disabled`)
  }
})

test('Team tools replace the anonymous controls', () => {
  assert.ok(activeIds.includes('tool-agent-team'))
})

test('the workflow fan-out channel is retained', () => {
  assert.ok(activeIds.includes('tool-workflow'))
  assert.ok(activeIds.includes('workflow-ptc'))
})

test('the mode keeps an ordinary coding toolset', () => {
  for (const id of ['tool-fs', 'tool-fs-search', 'tool-bash', 'tool-skill']) {
    assert.ok(activeIds.includes(id), `${id} must be present`)
  }
})

test('the persona states both dispatch channels', () => {
  const persona = plugins.find(row => row.id === 'persona')
  const prefix = persona.config.prefix
  assert.match(prefix, /workflow/, 'the lead must be told to dispatch through workflow')
  assert.match(prefix, /spawn_teammate/, 'the resident-teammate channel must be named')
  assert.match(prefix, /Lead/, 'the persona must establish the Lead role')
})
