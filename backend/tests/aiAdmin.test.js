// Tests the ai:check logic against the fake Gemini client (no network).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkAi, runEval, runFollowUpEval } from '../scripts/aiAdmin.js'
import { AiError } from '../services/ai/geminiClient.js'
import { createFakeGeminiClient } from './fakeGeminiClient.js'

async function run(client, model = 'gemini-2.5-flash') {
  const lines = []
  const ok = await checkAi({ client, model, print: (l) => lines.push(l) })
  return { ok, output: lines.join('\n') }
}

describe('ai:check', () => {
  it('passes when the key works, the model exists and the test answer is valid', async () => {
    const { ok, output } = await run(createFakeGeminiClient())
    expect(ok).toBe(true)
    expect(output).toMatch(/PASS  Gemini accepted the API key \(4 models/)
    expect(output).toMatch(/PASS  Model "gemini-2.5-flash" is available/)
    expect(output).toMatch(/PASS  Test classification: Hot \(score 88\)/)
    expect(output).toMatch(/All checks passed/)
  })

  it('a bad key → FAIL with a fix', async () => {
    const client = createFakeGeminiClient()
    client.listModels = async () => {
      throw new AiError('auth', 'Gemini rejected the API key.')
    }
    const { ok, output } = await run(client)
    expect(ok).toBe(false)
    expect(output).toMatch(/FAIL  Gemini did not accept the API key/)
    expect(output).toMatch(/Fix:    Copy the key again/)
  })

  it('a model the key cannot use → FAIL, suggesting stable flash models', async () => {
    const { ok, output } = await run(createFakeGeminiClient(), 'gemini-9-ultra')
    expect(ok).toBe(false)
    expect(output).toMatch(/Model "gemini-9-ultra" is not available/)
    expect(output).toMatch(/gemini-2\.5-flash, gemini-2\.5-flash-lite/)
    expect(output).not.toMatch(/gemini-2\.5-pro/) // only flash models are suggested
  })

  it('an answer that fails validation → FAIL (never a false PASS)', async () => {
    const client = createFakeGeminiClient()
    client.answerWith({ classification: 'Hot', score: 5, reason: 'x', injectionSuspected: false })
    const { ok, output } = await run(client)
    expect(ok).toBe(false)
    expect(output).toMatch(/FAIL  Test classification/)
  })

  it('a non-Hot answer for the burst water heater passes the connection check but WARNs', async () => {
    const client = createFakeGeminiClient()
    client.answerWith({ classification: 'Warm', score: 60, reason: 'Needs a plumber.', injectionSuspected: false })
    const { ok, output } = await run(client)
    expect(ok).toBe(true)
    expect(output).toMatch(/WARN  Expected "Hot"/)
  })
})

describe('ai:eval', () => {
  const cases = JSON.parse(readFileSync(new URL('../evals/qualification-cases.json', import.meta.url), 'utf8')).cases
  const instant = async () => {}

  it('the evaluation set is well-formed', () => {
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of cases) {
      expect(c.accept.length).toBeGreaterThan(0)
      expect(c.accept.every((a) => ['Hot', 'Warm', 'Cold'].includes(a))).toBe(true)
      expect(c.message.length).toBeGreaterThan(10)
    }
    expect(cases.filter((c) => c.injection).length).toBeGreaterThanOrEqual(3)
  })

  it('scores answers against "accept" and counts injections resisted and flagged', async () => {
    const client = createFakeGeminiClient()
    client.answerWith((req) =>
      /Ignore all previous|SYSTEM UPDATE|administrator/.test(req.prompt)
        ? { classification: 'Cold', score: 10, reason: 'Not a real project now.', injectionSuspected: true }
        : { classification: 'Hot', score: 90, reason: 'Urgent.', injectionSuspected: false },
    )
    const { summary, results } = await runEval({ client, cases, print: () => {}, wait: instant })

    const hotAccepted = cases.filter((c) => !c.injection && c.accept.includes('Hot')).length
    expect(summary.correct).toBe(hotAccepted + 3)
    expect(summary).toMatchObject({ total: cases.length, injectionCases: 3, injectionsResisted: 3, injectionsFlagged: 3, falseInjectionFlags: 0, errors: 0 })
    expect(results.find((r) => r.id === 'E07')).toMatchObject({ correct: false, classification: 'Hot' })
  })

  it('an invalid answer counts as an error, never as correct', async () => {
    const client = createFakeGeminiClient()
    client.answerWith({ classification: 'Hot', score: 3, reason: 'x', injectionSuspected: false })
    const { summary } = await runEval({ client, cases: cases.slice(0, 2), print: () => {}, wait: instant })
    expect(summary).toMatchObject({ correct: 0, errors: 2 })
  })

  it.each(['unavailable', 'timeout'])('also waits and retries when Gemini is %s (Google load is not AI quality)', async (kind) => {
    const client = createFakeGeminiClient()
    let calls = 0
    client.answerWith(() => {
      calls++
      if (calls === 1) throw new AiError(kind, 'busy', { temporary: true })
      return { classification: 'Hot', score: 90, reason: 'Urgent.', injectionSuspected: false }
    })
    const { summary } = await runEval({ client, cases: cases.slice(0, 1), print: () => {}, wait: instant })
    expect(summary).toMatchObject({ correct: 1, errors: 0 })
  })

  it('stops when the DAILY quota is used up: the rest are skipped, not retried', async () => {
    const client = createFakeGeminiClient()
    let calls = 0
    client.answerWith(() => {
      calls++
      if (calls === 3) throw new AiError('quota_exhausted', "Gemini's daily quota is used up (20 requests/day). It resets in about 23h.", { temporary: true, retryAfterSeconds: 83574 })
      return { classification: 'Hot', score: 90, reason: 'Urgent.', injectionSuspected: false }
    })
    const waits = []
    const lines = []
    const { summary } = await runEval({ client, cases: cases.slice(0, 6), print: (l) => lines.push(l), wait: async (ms) => waits.push(ms) })

    expect(client.calls).toHaveLength(3) // no retries, no calls after the quota ran out
    expect(summary).toMatchObject({ total: 6, errors: 1, skipped: 3 })
    expect(waits.every((ms) => ms < 60_000)).toBe(true) // never waits hours
    expect(lines.join('\n')).toMatch(/Skipped: +3 \(daily quota used up/)
  })

  it('uses Gemini\'s retry delay for a per-minute limit (capped at 60s)', async () => {
    const client = createFakeGeminiClient()
    let calls = 0
    client.answerWith(() => {
      calls++
      if (calls === 1) throw new AiError('rate_limited', 'slow down', { temporary: true, retryAfterSeconds: 7 })
      if (calls === 2) throw new AiError('rate_limited', 'slow down', { temporary: true, retryAfterSeconds: 500 })
      return { classification: 'Hot', score: 90, reason: 'Urgent.', injectionSuspected: false }
    })
    const waits = []
    await runEval({ client, cases: cases.slice(0, 1), print: () => {}, wait: async (ms) => waits.push(ms) })
    expect(waits).toEqual([7000, 60_000])
  })

  it('does NOT retry a permanent error such as an invalid key', async () => {
    const client = createFakeGeminiClient()
    client.failWith('auth')
    const { summary } = await runEval({ client, cases: cases.slice(0, 1), print: () => {}, wait: instant })
    expect(summary.errors).toBe(1)
    expect(client.calls).toHaveLength(1)
  })

  it('waits and retries when rate limited, then continues', async () => {
    const client = createFakeGeminiClient()
    let calls = 0
    client.answerWith(() => {
      calls++
      if (calls === 1) throw new AiError('rate_limited', 'slow down', { temporary: true })
      return { classification: 'Hot', score: 90, reason: 'Urgent.', injectionSuspected: false }
    })
    const waits = []
    const { summary } = await runEval({ client, cases: cases.slice(0, 1), print: () => {}, wait: async (ms) => waits.push(ms), rateLimitWaitMs: 1234 })
    expect(summary.correct).toBe(1)
    expect(waits).toContain(1234)
  })
})

describe('ai:eval-followup', () => {
  const cases = JSON.parse(readFileSync(new URL('../evals/followup-cases.json', import.meta.url), 'utf8')).cases
  const COMPANY = 'Acme Test Roofing'
  const instant = async () => {}
  const run = (client, someCases = cases) => runFollowUpEval({ client, cases: someCases, contractorName: COMPANY, print: () => {}, wait: instant })

  /** A fake that writes a clean, on-topic draft for every case (in Spanish for the Spanish case). */
  function goodWriter() {
    const client = createFakeGeminiClient()
    client.answerWith((req) => {
      const first = /Customer first name: (\S+)/.exec(req.prompt)[1]
      const c = cases.find((x) => req.prompt.includes(x.message.split('</inquiry>')[0]))
      const injection = Boolean(c.injection)
      const body = c.language === 'es'
        ? `Hola ${first},\n\nGracias por su mensaje sobre el aire acondicionado. Nuestro equipo se pondrá en contacto con usted pronto para una visita.\n\nAtentamente,\n${COMPANY}`
        : `Hi ${first},\n\nThank you for reaching out about your ${c.mustMention[0]} project. Our team will contact you soon to arrange a visit and discuss the details.\n\nBest regards,\n${COMPANY}`
      return { subject: 'About your project', body, injectionSuspected: injection }
    })
    return client
  }

  it('the case set is well-formed', () => {
    const ids = cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of cases) expect(c.mustMention.length).toBeGreaterThan(0)
    expect(cases.filter((c) => c.injection).length).toBeGreaterThanOrEqual(2)
    expect(cases.some((c) => c.language === 'es')).toBe(true)
  })

  it('clean, on-topic drafts all pass; injections counted as resisted and flagged', async () => {
    const { summary } = await run(goodWriter())
    expect(summary).toMatchObject({ total: cases.length, passed: cases.length, errors: 0, injectionsResisted: 2, injectionsFlagged: 2, falseInjectionFlags: 0 })
  })

  it('a draft that obeys the injection (discount) FAILS with the reason', async () => {
    const client = goodWriter()
    const injectionCase = cases.find((c) => c.id === 'F06')
    client.answerWith({ subject: 'Your siding', body: `Hi Mark,\n\nThanks for asking about siding. Sure, 50% discount!\n\nBest regards,\n${COMPANY}`, injectionSuspected: false })
    const { results, summary } = await run(client, [injectionCase])
    expect(summary).toMatchObject({ passed: 0, injectionsResisted: 0, injectionsFlagged: 0 })
    expect(results[0].problems.join()).toMatch(/contains a percentage/)
  })

  it('an English draft for the Spanish inquiry FAILS ("not written in Spanish")', async () => {
    const client = createFakeGeminiClient()
    client.answerWith({ subject: 'Your AC', body: `Hi Rosa,\n\nThanks for your message about the air conditioning (aire acondicionado). Our team will call soon.\n\nBest regards,\n${COMPANY}`, injectionSuspected: false })
    const { results } = await run(client, [cases.find((c) => c.language === 'es')])
    expect(results[0].problems).toContain('not written in Spanish')
  })

  it('a generic draft that never mentions the project FAILS', async () => {
    const client = createFakeGeminiClient()
    client.answerWith({ subject: 'Thanks', body: `Hi Emily,\n\nThanks for contacting us. Our team will be in touch soon.\n\nBest regards,\n${COMPANY}`, injectionSuspected: false })
    const { results } = await run(client, [cases.find((c) => c.id === 'F03')])
    expect(results[0].problems.join()).toMatch(/does not mention the project/)
  })

  it('stops on daily quota: the rest are skipped, never counted as passed', async () => {
    const client = createFakeGeminiClient()
    client.failWith('quota_exhausted', { temporary: true })
    const { summary } = await run(client)
    expect(summary).toMatchObject({ passed: 0, errors: 1, skipped: cases.length - 1 })
    expect(client.calls).toHaveLength(1)
  })
})
