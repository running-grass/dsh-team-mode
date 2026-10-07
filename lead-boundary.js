/**
 * Lead write boundary for the `team` agent preset.
 *
 * Two conditions gate the boundary, and both are required:
 *
 *   - the Agent runs this mode's preset, read from the preset registry, so no
 *     other mode's Lead is affected;
 *   - the Team roster reports the Agent as the Lead.
 *
 * Both checks are per Agent because the preset is shared: the Lead and every
 * one-shot worker it starts join the same composition, so a tool removed from
 * the preset would be removed from the workers too.
 *
 * Enforcement is a guard. `tools.restrict()` cannot do this job: it appends to
 * the calling Agent's own layer, and the tool registry exempts a scope's own
 * layer from the restriction filter, so a restriction registered on the Agent
 * does not mask the tools the Agent inherits. A guard is name-agnostic, needs
 * no catalog lookup, and runs at execution, which is where the decision is
 * actually enforced.
 *
 * Shell tools stay allowed: the Lead owns the final acceptance run. A shell
 * can still write files, so this boundary is exact for the file-mutation tools
 * and advisory for the shell — the same split the Team policy states.
 *
 * @module dsh-team-mode/lead-boundary
 */

/** Cordis plugin name. */
export const name = 'team-lead-boundary'

/** Services required by the boundary plugin. */
export const inject = ['agents', 'agentPresets', 'tools', 'agentTeams']

/** The agent preset this boundary belongs to. */
const PRESET_ID = 'team'

/**
 * Tool names the Lead must not call: file mutation and terminal lifecycle
 * surfaces that belong to a dispatched worker.
 */
const DENIED = Object.freeze([
  'write',
  'edit',
  'notebook_edit',
  'terminal_open',
  'terminal_signal',
  'terminal_close',
])

/** The denial reason the Lead's model reads when it reaches for a denied tool. */
function denialReason(toolName) {
  return `"${toolName}" is not available to the Team Lead in this mode. Dispatch a worker instead: call the workflow tool and describe the role (builder, verifier, sweeper), the exact paths, and what to return.`
}

/** Cordis plugin body. */
export function apply(ctx) {
  /** One guard per Lead Agent, keyed by Agent identity. */
  const installed = new Map()

  /**
   * Install the boundary on one Agent that is both the Lead of its Team and
   * running this mode. The preset check keeps the boundary out of every other
   * mode: a session composed from `standard` is a Team root too, but its Lead
   * is expected to do the work.
   */
  const install = (agent) => {
    if (installed.has(agent)) return
    if (ctx.get('agentPresets')?.composedPreset(agent.ctx) !== PRESET_ID) return
    const membership = ctx.agentTeams.tryMembership(agent)
    if (membership === undefined || membership.role !== 'lead') return
    installed.set(agent, agent.ctx.tools.guard((exec) => {
      if (!DENIED.includes(exec.name)) return undefined
      return denialReason(exec.name)
    }))
  }

  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'team-lead-boundary.guards')
}
