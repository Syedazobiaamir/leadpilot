// Small helpers for setup scripts (Stage 8): edit backend/.env safely and read a secret without
// showing it. Used by auth.js (staff password) and keys.js (Google / Gemini key rotation).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export const ENV_FILE = new URL('../.env', import.meta.url)

export function readEnv() {
  return existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
}

export function writeEnv(text) {
  writeFileSync(ENV_FILE, text)
}

/** Sets NAME=value in the .env text: replaces the line if it exists, appends it otherwise. */
export function setEnvLine(text, name, value) {
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  if (pattern.test(text)) return text.replace(pattern, () => line) // a function: "$" in values stays literal
  return `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${line}\n`
}

/** Reads a line without showing it (each key shows "*"). Needs an interactive terminal. */
export function askHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY) {
      reject(new Error('This needs an interactive terminal (to hide what you type). Run it in PowerShell or the VS Code terminal.'))
      return
    }
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') { // Ctrl+C
          stdout.write('\n')
          process.exit(1)
        } else if (char === '\r' || char === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          resolve(value)
          return
        } else if (char === '\u007f' || char === '\b') { // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
        } else {
          value += char
          stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}
