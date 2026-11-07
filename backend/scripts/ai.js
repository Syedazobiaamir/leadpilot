// Command-line entry for the Gemini AI helpers. Reads settings from backend/.env.
//
//   npm run ai:check   check the key, the model and one test classification (2 requests)
//   npm run ai:eval    run the evaluation set (evals/qualification-cases.json), about one request
//                      per case, and save the results to evals/last-run.json
//
// The API key is never printed.
import { readFileSync, writeFileSync } from 'node:fs'
import { readAiConfig } from '../config.js'
import { createGeminiClient } from '../services/ai/geminiClient.js'
import { checkAi, runEval } from './aiAdmin.js'

const command = process.argv[2]
const evalFile = new URL('../evals/qualification-cases.json', import.meta.url)
const resultFile = new URL('../evals/last-run.json', import.meta.url)

async function main() {
  if (!['check', 'eval'].includes(command)) {
    console.error('Usage: node scripts/ai.js check | eval')
    return false
  }
  let ai
  try {
    ai = readAiConfig()
  } catch (err) {
    console.error(`\n${err.message}\n`)
    return false
  }
  if (!ai) {
    console.error('\nGEMINI_API_KEY is empty in backend/.env, so AI qualification is disabled.')
    console.error('Get a key at https://aistudio.google.com (API keys), then paste it after GEMINI_API_KEY= in backend/.env.\n')
    return false
  }
  // A longer deadline than the app's (6s): a first request can be slower.
  const client = createGeminiClient({ ...ai, timeoutMs: 20_000 })

  if (command === 'check') return checkAi({ client, model: ai.model })

  const { cases } = JSON.parse(readFileSync(evalFile, 'utf8'))
  console.log(`Evaluating ${cases.length} FICTIONAL inquiries with ${ai.model} (one at a time, about ${Math.ceil((cases.length * 6) / 60)} min)...\n`)
  const { results, summary } = await runEval({ client, cases })
  writeFileSync(resultFile, JSON.stringify({ model: ai.model, ranAt: new Date().toISOString(), summary, results }, null, 2) + '\n')
  console.log('\nSaved to evals/last-run.json')
  // Exit code 1 if any case was wrong or failed, so this can act as a quality gate later.
  return summary.correct === summary.total
}

// Set the exit code and let Node finish by itself (process.exit() can crash Node on Windows
// while network connections are closing).
main().then((ok) => {
  process.exitCode = ok ? 0 : 1
})
