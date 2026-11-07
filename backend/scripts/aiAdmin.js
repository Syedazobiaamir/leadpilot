// Diagnostics for the Gemini AI connection (npm run ai:check).
// Takes a client and a print function, so tests can run it against a fake.
// Uses exactly 2 requests: one model list, one tiny classification of a FICTIONAL inquiry.
import { AiError } from '../services/ai/geminiClient.js'
import {
  QUALIFICATION_SETTINGS,
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTIONS,
  buildQualificationPrompt,
  qualificationResultSchema,
} from '../services/ai/qualificationPrompt.js'
import {
  FOLLOW_UP_SCHEMA,
  FOLLOW_UP_SETTINGS,
  buildFollowUpPrompt,
  firstNameOf,
  followUpDraftSchema,
  followUpInstructions,
} from '../services/ai/followUpPrompt.js'

export const AI_FIX_HINTS = {
  auth: 'Copy the key again from Google AI Studio (aistudio.google.com → API keys) into GEMINI_API_KEY in backend/.env. No spaces.',
  api_disabled: 'Enable the "Generative Language API" for the key\'s Google Cloud project, or create the key in AI Studio, which enables it for you.',
  permission: 'This key may be restricted. In Google Cloud → Credentials, check the key\'s API restrictions include the Generative Language API.',
  model_not_found: 'Set GEMINI_MODEL in backend/.env to one of the models listed above (a "flash" model is recommended), or leave it empty.',
  rate_limited: 'Per-minute limit reached. Wait a minute and try again.',
  quota_exhausted: 'The free DAILY quota for this model is used up (it resets about 24h after it started counting). Wait, or set GEMINI_MODEL to another model (each model has its own quota), or enable billing (rotate the leaked key first!).',
  unavailable: 'Check your internet connection. If it works, Gemini may be overloaded. Try again in a few minutes.',
  timeout: 'Gemini did not answer in time. Check your connection and try again.',
  blocked: 'Gemini refused this request for safety reasons. Try again; if it repeats, report it.',
  invalid_output: 'The model answered in an unexpected format. Try again; if it repeats, try another flash model in GEMINI_MODEL.',
  bad_request: 'Gemini rejected the request format. This is a bug in our code: please report it.',
  unknown: 'Unexpected error. Try again.',
}

// A FICTIONAL inquiry with an obvious answer, used only to prove the full path works.
export const CHECK_INQUIRY = {
  serviceType: 'Plumbing',
  timeline: 'ASAP',
  message: 'Our water heater burst an hour ago and water is spreading across the basement floor. We need someone today.',
}

export async function checkAi({ client, model, print = console.log }) {
  const fail = (step, err) => {
    print(`FAIL  ${step}`)
    print(`      Reason: ${err.message}`)
    if (err instanceof AiError) print(`      Fix:    ${AI_FIX_HINTS[err.kind] ?? AI_FIX_HINTS.unknown}`)
    print('\nAI check failed. Fix the item above and run this again.')
    return false
  }

  print(`Model configured: ${model}\n`)

  // 1. Is the key accepted, and which models can it use?
  let models
  try {
    models = await client.listModels()
    print(`PASS  Gemini accepted the API key (${models.length} models available for generateContent)`)
  } catch (err) {
    return fail('Gemini did not accept the API key', err)
  }

  // 2. Is our model one of them?
  if (!models.includes(model)) {
    const flash = models.filter((m) => /flash/.test(m) && !/preview|exp|image|tts|audio|live/.test(m)).slice(0, 6)
    print(`FAIL  Model "${model}" is not available for this key`)
    print(`      Fix:    Set GEMINI_MODEL in backend/.env to one of: ${(flash.length ? flash : models.slice(0, 6)).join(', ')}`)
    print('\nAI check failed. Fix the item above and run this again.')
    return false
  }
  print(`PASS  Model "${model}" is available`)

  // 3. One real classification of a fictional inquiry, through the SAME prompt, schema and validation as the app.
  let answer
  try {
    const started = Date.now()
    const { data, model: version } = await client.generateJson({
      system: SYSTEM_INSTRUCTIONS,
      prompt: buildQualificationPrompt(CHECK_INQUIRY),
      schema: RESPONSE_SCHEMA,
      ...QUALIFICATION_SETTINGS,
    })
    const parsed = qualificationResultSchema.safeParse(data)
    if (!parsed.success) {
      throw new AiError('invalid_output', `The answer did not pass validation: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }
    answer = { ...parsed.data, version, ms: Date.now() - started }
  } catch (err) {
    return fail('Test classification of a fictional inquiry', err)
  }
  print(`PASS  Test classification: ${answer.classification} (score ${answer.score}) in ${answer.ms} ms by ${answer.version}`)
  print(`      Reason: "${answer.reason}"`)
  if (answer.classification !== 'Hot') {
    // Not a failure of the connection, but worth knowing: this test case is obviously urgent.
    print('WARN  Expected "Hot" for a burst water heater. The connection works, but check the AI quality with: npm run ai:eval')
  }

  print('\nAll checks passed. Gemini AI is ready.')
  return true
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A rough "is this Spanish?" check: a few very common Spanish words (enough to tell an
// English draft from a Spanish one; not a real language detector).
const SPANISH_WORDS = /\b(hola|gracias|estimad[oa]|saludos|nuestro|equipo|pronto|usted|su|para|atentamente)\b/gi

/**
 * Runs the follow-up evaluation (Stage 5): one AI draft per case, through the SAME prompt,
 * settings and guardrails as the app (followUpDraftSchema), plus extra checks:
 *   mentions the project, right language, and for injection cases: flagged by the AI.
 * Returns { results, summary }. Nothing is saved.
 */
export async function runFollowUpEval({ client, cases, contractorName, print = console.log, pauseMs = 4500, rateLimitWaitMs = 30_000, wait = sleep }) {
  const results = []
  let quotaGone = null
  for (const [index, c] of cases.entries()) {
    if (quotaGone) {
      results.push({ id: c.id, label: c.label, skipped: true, passed: false, problems: [] })
      print(`SKIP  ${c.id} ${c.label}`)
      continue
    }
    if (index > 0) await wait(pauseMs)

    let outcome
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const started = Date.now()
        const { data, model } = await client.generateJson({
          system: followUpInstructions(contractorName),
          prompt: buildFollowUpPrompt(c),
          schema: FOLLOW_UP_SCHEMA,
          ...FOLLOW_UP_SETTINGS,
        })
        outcome = { data, model, ms: Date.now() - started }
        break
      } catch (err) {
        if (err instanceof AiError && ['rate_limited', 'unavailable', 'timeout'].includes(err.kind) && attempt < 3) {
          const waitMs = err.retryAfterSeconds ? Math.min(err.retryAfterSeconds, 60) * 1000 : rateLimitWaitMs
          print(`      (${err.kind}, waiting ${waitMs / 1000}s before retrying ${c.id})`)
          await wait(waitMs)
          continue
        }
        if (err instanceof AiError && err.kind === 'quota_exhausted') quotaGone = err
        outcome = { error: err.kind ?? 'error', detail: err.message }
        break
      }
    }

    if (outcome.error) {
      results.push({ id: c.id, label: c.label, error: outcome.error, detail: outcome.detail, passed: false, problems: [] })
      print(`ERROR ${c.id} ${c.label.padEnd(46)} ${outcome.error}: ${outcome.detail}`)
      continue
    }

    // 1. The app's own guardrails
    const problems = []
    const parsed = followUpDraftSchema({ firstName: firstNameOf(c.name), contractorName }).safeParse(outcome.data)
    if (!parsed.success) problems.push(...parsed.error.issues.map((i) => i.message))
    const body = String(outcome.data?.body ?? '')
    const text = `${outcome.data?.subject ?? ''}\n${body}`.toLowerCase()
    // 2. About THIS project
    if (!c.mustMention.some((word) => text.includes(word.toLowerCase()))) problems.push(`does not mention the project (${c.mustMention.join('/')})`)
    // 3. Language
    const spanishHits = (body.match(SPANISH_WORDS) ?? []).length
    if (c.language === 'es' && spanishHits < 3) problems.push('not written in Spanish')
    if (!c.language && spanishHits >= 6) problems.push('written in Spanish for an English inquiry')

    const flagged = Boolean(outcome.data?.injectionSuspected)
    const passed = problems.length === 0
    results.push({ id: c.id, label: c.label, injection: Boolean(c.injection), passed, problems, flagged, model: outcome.model, ms: outcome.ms, subject: outcome.data?.subject, body })
    print(`${passed ? 'OK   ' : 'FAIL '} ${c.id} ${c.label.padEnd(46)} ${passed ? '' : problems.join('; ')}${c.injection ? (flagged ? ' [injection flagged]' : ' [injection NOT flagged]') : ''} (${outcome.ms} ms)`)
  }

  const answered = results.filter((r) => !r.error && !r.skipped)
  const injections = answered.filter((r) => r.injection)
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    errors: results.filter((r) => r.error).length,
    skipped: results.filter((r) => r.skipped).length,
    injectionCases: cases.filter((c) => c.injection).length,
    injectionsResisted: injections.filter((r) => r.passed).length,
    injectionsFlagged: injections.filter((r) => r.flagged).length,
    falseInjectionFlags: answered.filter((r) => !r.injection && r.flagged).length,
    avgMs: answered.length ? Math.round(answered.reduce((s, r) => s + r.ms, 0) / answered.length) : null,
  }
  print('')
  print(`Drafts passing every check: ${summary.passed}/${summary.total}`)
  print(`Prompt injection:           ${summary.injectionsResisted}/${summary.injectionCases} resisted, ${summary.injectionsFlagged}/${summary.injectionCases} flagged`)
  print(`False alarms:               ${summary.falseInjectionFlags}`)
  print(`Errors / skipped:           ${summary.errors} / ${summary.skipped}${quotaGone ? ` (${quotaGone.message})` : ''}`)
  print(`Average answer time:        ${summary.avgMs ?? 'n/a'} ms`)
  return { results, summary }
}

/**
 * Runs every evaluation case through the SAME prompt, schema and validation as the app,
 * one at a time (free-tier limits), and reports how many answers a careful human would accept.
 *   cases:   from evals/qualification-cases.json
 *   pauseMs: wait between requests (the free tier allows only a few requests per minute)
 *   wait:    the sleep function (tests pass an instant one)
 * Returns { results, summary }. Nothing is saved to the leads.
 */
export async function runEval({ client, cases, print = console.log, pauseMs = 4500, rateLimitWaitMs = 30_000, wait = sleep }) {
  const results = []
  let quotaGone = null // set when the DAILY quota runs out: the remaining cases are skipped, not failed
  for (const [index, testCase] of cases.entries()) {
    if (quotaGone) {
      results.push({ id: testCase.id, label: testCase.label, accept: testCase.accept, injection: Boolean(testCase.injection), skipped: true, correct: false })
      print(`SKIP  ${testCase.id} ${testCase.label}`)
      continue
    }
    if (index > 0) await wait(pauseMs)
    let outcome
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now()
      try {
        const { data, model } = await client.generateJson({
          system: SYSTEM_INSTRUCTIONS,
          prompt: buildQualificationPrompt(testCase),
          schema: RESPONSE_SCHEMA,
          ...QUALIFICATION_SETTINGS,
        })
        const parsed = qualificationResultSchema.safeParse(data)
        outcome = parsed.success
          ? { ...parsed.data, model, ms: Date.now() - started }
          : { error: 'invalid_output', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), ms: Date.now() - started }
        break
      } catch (err) {
        // Google being busy or slow says nothing about the AI's QUALITY, so wait and retry
        // (the eval measures answers, not Google's load at that minute). Other errors count as errors.
        if (err instanceof AiError && ['rate_limited', 'unavailable', 'timeout'].includes(err.kind) && attempt < 3) {
          // Use Gemini's own "retry after" when it gives one (capped at 60s), else our default.
          const waitMs = err.retryAfterSeconds ? Math.min(err.retryAfterSeconds, 60) * 1000 : rateLimitWaitMs
          print(`      (${err.kind}, waiting ${waitMs / 1000}s before retrying ${testCase.id})`)
          await wait(waitMs)
          continue
        }
        if (err instanceof AiError && err.kind === 'quota_exhausted') quotaGone = err
        outcome = { error: err.kind ?? 'error', detail: err.message, ms: Date.now() - started }
        break
      }
    }

    const correct = !outcome.error && testCase.accept.includes(outcome.classification)
    results.push({ id: testCase.id, label: testCase.label, accept: testCase.accept, injection: Boolean(testCase.injection), ...outcome, correct })

    const verdict = outcome.error ? 'ERROR' : correct ? 'OK   ' : 'WRONG'
    const got = outcome.error
      ? `${outcome.error}: ${outcome.detail}`
      : `${outcome.classification} ${outcome.score}${outcome.injectionSuspected ? ' [injection flagged]' : ''} (${outcome.ms} ms)`
    print(`${verdict} ${testCase.id} ${testCase.label.padEnd(48)} expected ${testCase.accept.join('/').padEnd(9)} got ${got}`)
    if (!outcome.error && !correct) print(`      AI reason: "${outcome.reason}"`)
  }

  const answered = results.filter((r) => !r.error && !r.skipped)
  const injections = results.filter((r) => r.injection)
  const normal = answered.filter((r) => !r.injection)
  const summary = {
    total: results.length,
    correct: results.filter((r) => r.correct).length,
    errors: results.filter((r) => r.error).length,
    skipped: results.filter((r) => r.skipped).length,
    injectionCases: injections.length,
    injectionsResisted: injections.filter((r) => r.correct).length,
    injectionsFlagged: injections.filter((r) => r.injectionSuspected).length,
    falseInjectionFlags: normal.filter((r) => r.injectionSuspected).length,
    avgMs: answered.length ? Math.round(answered.reduce((sum, r) => sum + r.ms, 0) / answered.length) : null,
  }
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a')
  print('')
  print(`Accuracy:            ${summary.correct}/${summary.total} (${pct(summary.correct, summary.total)}) answers a careful human would accept`)
  print(`Prompt injection:    ${summary.injectionsResisted}/${summary.injectionCases} resisted (class still correct), ${summary.injectionsFlagged}/${summary.injectionCases} flagged by the AI`)
  print(`False alarms:        ${summary.falseInjectionFlags} normal inquiries wrongly flagged as injection`)
  print(`Errors:              ${summary.errors}`)
  if (summary.skipped) print(`Skipped:             ${summary.skipped} (daily quota used up: ${quotaGone.message})`)
  print(`Average answer time: ${summary.avgMs ?? 'n/a'} ms`)
  return { results, summary }
}
