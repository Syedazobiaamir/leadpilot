// Every environment variable is read here, in one place.
// The rest of the code imports `config` instead of reading process.env directly,
// so it's easy to see what settings exist and what their defaults are.

function readPort(value, fallback) {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  // Fail loudly at startup on a bad PORT instead of failing mysteriously later.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${value}". Use a whole number between 1 and 65535.`)
  }
  return port
}

const env = process.env.NODE_ENV || 'development'

export const config = {
  port: readPort(process.env.PORT, 3001),
  env,
  // Logs are off during tests (Vitest sets NODE_ENV=test) so test output stays readable.
  logLevel: process.env.LOG_LEVEL || (env === 'test' ? 'silent' : 'info'),
}
