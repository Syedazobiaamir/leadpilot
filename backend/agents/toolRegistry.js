// The TOOL REGISTRY: the only way an agent can touch data.
//
// An agent never imports the store. It gets a `tools` object from forAgent(agent), and every
// call goes through a check: "is this tool on this agent's list?" If not, the call is refused
// (PermissionError) and logged. This is how "agents have limited permissions" (CLAUDE.md §5)
// is enforced in code, not just promised in a comment.
//
// Dangerous capabilities (sending messages, deleting data, reading credentials, running code)
// are NOT tools at all, so no agent can ever be given them. The registry refuses to even
// register a tool whose name suggests one.

/** An agent tried to use a tool it is not allowed to use (or a tool tried something it may not do). */
export class PermissionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PermissionError'
    this.kind = 'permission_denied'
  }
}

// Tool names that must never exist in this registry.
const FORBIDDEN_NAME = /send|email|sms|delete|remove|drop|credential|secret|password|token|exec|eval|shell/i

/**
 * tools:  { toolName: { description, fn } }
 * logger: for permission-denied warnings
 */
export function createToolRegistry(tools, { logger }) {
  for (const name of Object.keys(tools)) {
    if (FORBIDDEN_NAME.test(name)) {
      throw new Error(`Refusing to register tool "${name}": agents may not send, delete, run code or touch credentials`)
    }
  }

  return {
    /** All tool names, for documentation and tests. */
    names: () => Object.keys(tools),

    /** Fails fast (e.g. at startup) if an agent asks for a tool that doesn't exist. */
    checkAgent(agent) {
      const unknown = agent.tools.filter((name) => !(name in tools))
      if (unknown.length > 0) throw new Error(`Agent "${agent.name}" lists unknown tool(s): ${unknown.join(', ')}`)
    },

    /**
     * The tools ONE agent may use. Every call is recorded in `trace` (for the AgentRuns record).
     * Usage inside an agent: await tools.call('readLead', leadId)
     */
    forAgent(agent, trace = []) {
      return {
        async call(name, ...args) {
          if (!agent.tools.includes(name)) {
            trace.push({ tool: name, allowed: false })
            logger.warn('agent permission denied', { agent: agent.name, tool: name })
            throw new PermissionError(`Agent "${agent.name}" is not allowed to use tool "${name}"`)
          }
          if (!(name in tools)) throw new Error(`Unknown tool "${name}"`)
          trace.push({ tool: name, allowed: true })
          return tools[name].fn(...args)
        },
      }
    },
  }
}
