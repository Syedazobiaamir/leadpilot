// Stage 9: makes COPIES of the n8n workflows that call a different backend address.
//
// The workflow files in automation/workflows/ call the LOCAL backend (http://localhost:3001), so
// local development keeps working. For the live site, n8n must call the Vercel address instead.
// This script writes copies with the address replaced; you import those copies into n8n.
//
//   node automation/scripts/point-workflows.mjs https://leadpilot-lac-psi.vercel.app <output folder>
//
// It only changes the backend address. Keys stay in n8n's credential, never in these files.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOCAL_BACKEND = 'http://localhost:3001'
const WORKFLOWS_DIR = fileURLToPath(new URL('../workflows/', import.meta.url))

/** Checks the new address: a full http(s) URL with no path, e.g. https://example.vercel.app */
export function checkBaseUrl(text) {
  let url
  try {
    url = new URL(String(text ?? '').trim())
  } catch {
    throw new Error('Give the backend address as a full URL, e.g. https://leadpilot-lac-psi.vercel.app')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The address must start with https:// (or http:// for local tests)')
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Give only the site address, without a path (no /api at the end)')
  return url.origin // no trailing "/"
}

/** Returns the workflow text with every LOCAL_BACKEND address replaced. Throws if there was none. */
export function pointWorkflow(text, baseUrl) {
  const count = text.split(LOCAL_BACKEND).length - 1
  if (count === 0) throw new Error(`No ${LOCAL_BACKEND} address found: is this already a converted copy?`)
  return { text: text.replaceAll(LOCAL_BACKEND, baseUrl), count }
}

// Command-line use (not when imported by a test)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const baseUrl = checkBaseUrl(process.argv[2])
  const outDir = process.argv[3]
  if (!outDir) throw new Error('Give an output folder as the second argument')
  mkdirSync(outDir, { recursive: true })
  for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.json'))) {
    const { text, count } = pointWorkflow(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'), baseUrl)
    writeFileSync(join(outDir, file), text)
    console.log(`${file}: ${count} address(es) → ${baseUrl}`)
  }
}
