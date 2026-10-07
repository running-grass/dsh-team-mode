/**
 * Unit tests for the Lead write boundary.
 *
 * The plugin reaches Cordis only through `ctx`, so a minimal fake covers every
 * branch without a DSH checkout. `test/integration.test.mjs` drives the real
 * composition.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name } from '../lead-boundary.js'

/** One Agent identity. The plugin only compares objects by identity. */
function makeAgent(id) {
  return { id, guards: [] }
}

/** A ctx whose Agent ctx records guards instead of registering them. */
function makeCtx({ agents = [], presetId, memberships = {} } = {}) {
  const listeners = new Map()
  const disposers = []
  for (const agent of agents) {
    agent.ctx = {
      tools: {
        guard: (guard) => {
          agent.guards.push(guard)
          return () => { agent.guards = agent.guards.filter(g => g !== guard) }
        },
      },
    }
  }
  return {
    agents: { list: () => agents },
    agentTeams: {
      tryMembership: (agent) => memberships[agent.id],
    },
    get: (serviceName) => (serviceName === 'agentPresets'
      ? { composedPreset: () => presetId }
      : undefined),
    on: (eventName, listener) => {
      listeners.set(eventName, [...listeners.get(eventName) ?? [], listener])
      return () => {}
    },
    effect: (body) => {
      const disposer = body()
      disposers.push(disposer)
      return () => {}
    },
    emit: (eventName, payload) => {
      for (const listener of listeners.get(eventName) ?? []) listener(payload)
    },
  }
}

/** The denial the boundary returns for one tool name, if any. */
function denialFor(agent, toolName) {
  for (const guard of agent.guards) {
    const reason = guard({ name: toolName })
    if (reason !== undefined) return reason
  }
  return undefined
}

const lead = (id) => ({ root: {}, id: 'team', role: 'lead', name: id })
const teammate = (id) => ({ root: {}, id: 'team', role: 'teammate', name: id })

test('exports the Cordis function-plugin declarations', () => {
  assert.equal(name, 'team-lead-boundary')
  assert.deepEqual(inject, ['agents', 'agentPresets', 'tools', 'agentTeams'])
})

test('denies file mutation to a Lead running the team preset', () => {
  const agent = makeAgent('lead-1')
  const ctx = makeCtx({ agents: [agent], presetId: 'team', memberships: { 'lead-1': lead('lead-1') } })
  apply(ctx)

  assert.equal(agent.guards.length, 1)
  assert.match(denialFor(agent, 'write'), /Dispatch a worker/)
  assert.match(denialFor(agent, 'edit'), /Dispatch a worker/)
  assert.match(denialFor(agent, 'notebook_edit'), /Dispatch a worker/)
})

test('leaves reads and the acceptance shell open to the Lead', () => {
  const agent = makeAgent('lead-1')
  const ctx = makeCtx({ agents: [agent], presetId: 'team', memberships: { 'lead-1': lead('lead-1') } })
  apply(ctx)

  for (const toolName of ['read', 'glob', 'grep', 'bash', 'workflow', 'send_message']) {
    assert.equal(denialFor(agent, toolName), undefined, `${toolName} must stay usable`)
  }
})

test('does not install for a teammate in the team preset', () => {
  const agent = makeAgent('worker-1')
  const ctx = makeCtx({
    agents: [agent],
    presetId: 'team',
    memberships: { 'worker-1': teammate('worker-1') },
  })
  apply(ctx)

  assert.equal(agent.guards.length, 0)
})

test('does not install for a Lead of another preset', () => {
  const agent = makeAgent('lead-2')
  const ctx = makeCtx({
    agents: [agent],
    presetId: 'standard',
    memberships: { 'lead-2': lead('lead-2') },
  })
  apply(ctx)

  assert.equal(agent.guards.length, 0, 'a standard-mode Lead must keep its write tools')
})

test('does not install when the Agent is not a Team member', () => {
  const agent = makeAgent('outsider')
  const ctx = makeCtx({ agents: [agent], presetId: 'team', memberships: {} })
  apply(ctx)

  assert.equal(agent.guards.length, 0)
})

test('installs on agent/created for a Lead that appears later', () => {
  const ctx = makeCtx({ agents: [], presetId: 'team', memberships: {} })
  apply(ctx)

  const late = makeAgent('lead-late')
  late.ctx = {
    tools: {
      guard: (guard) => {
        late.guards.push(guard)
        return () => {}
      },
    },
  }
  ctx.agentTeams.tryMembership = () => lead('lead-late')
  ctx.emit('agent/created', { agent: late })

  assert.equal(late.guards.length, 1)
  assert.match(denialFor(late, 'write'), /Dispatch a worker/)
})

test('installs once per Agent', () => {
  const agent = makeAgent('lead-1')
  const ctx = makeCtx({ agents: [agent], presetId: 'team', memberships: { 'lead-1': lead('lead-1') } })
  apply(ctx)
  ctx.emit('agent/created', { agent })
  ctx.emit('agent/created', { agent })

  assert.equal(agent.guards.length, 1)
})

test('skips installation when the preset registry is absent', () => {
  const agent = makeAgent('lead-3')
  const ctx = makeCtx({ agents: [agent], memberships: { 'lead-3': lead('lead-3') } })
  ctx.get = () => undefined
  apply(ctx)

  assert.equal(agent.guards.length, 0)
})

test('releases the guard when the Agent is disposed', () => {
  const agent = makeAgent('lead-1')
  const ctx = makeCtx({ agents: [agent], presetId: 'team', memberships: { 'lead-1': lead('lead-1') } })
  apply(ctx)
  assert.equal(agent.guards.length, 1)

  ctx.emit('agent/disposed', { agent })
  // The fake's disposer filters the guard out of the recorded list.
  assert.equal(agent.guards.length, 0)
})
