// Structured logger: every log line is one JSON object, for example
// {"level":"info","time":"...","msg":"request completed","requestId":"...","status":200}
// JSON logs can be searched and filtered by tools (Vercel logs, n8n monitoring),
// unlike free-text messages.
import { config } from '../config.js'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

// Field names that must never appear in logs with their real values.
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|private[-_]?key|automation[-_]?key|credential|authorization|cookie/i

/** Replaces the values of sensitive fields (at any depth) with "[REDACTED]". */
export function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))

  const clean = {}
  for (const [key, val] of Object.entries(value)) {
    clean[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(val, depth + 1)
  }
  return clean
}

/**
 * Creates a logger.
 * level:  the lowest level that gets written ('silent' writes nothing)
 * output: the function that receives each finished line (console.log by default; tests pass their own)
 */
export function createLogger({ level = 'info', output = console.log } = {}) {
  const minimum = LEVELS[level] ?? LEVELS.info

  function write(lvl, msg, fields = {}) {
    if (LEVELS[lvl] < minimum) return
    output(JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...redact(fields) }))
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  }
}

// The shared logger the app uses.
export const logger = createLogger({ level: config.logLevel })
