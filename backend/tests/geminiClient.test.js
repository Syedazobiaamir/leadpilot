// Tests the Gemini client with a FAKE fetch: no network, no API key, no cost.
import { describe, expect, it, vi } from 'vitest'
import { AiError, createGeminiClient, describeGeminiError, GEMINI_BASE_URL } from '../services/ai/geminiClient.js'
import { readAiConfig } from '../config.js'
import { createLogger } from '../utils/logger.js'

const FAKE_KEY = 'AIzaFAKE-test-key-0000000000000000000'
const schema = { type: 'OBJECT', properties: { classification: { type: 'STRING', enum: ['Hot', 'Warm', 'Cold'] } }, required: ['classification'] }

/** A Response like Gemini's. */
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

/** A successful generateContent body whose answer text is `text`. */
const answer = (text, extra = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', ...extra }],
  modelVersion: 'gemini-test-001',
})

function client(fetchImpl, options = {}) {
  return createGeminiClient({ apiKey: FAKE_KEY, model: 'gemini-test', timeoutMs: 1000, fetchImpl, ...options })
}

const ask = (c) => c.generateJson({ system: 'You classify leads.', prompt: 'Roof leaking!', schema })

describe('generateJson: the request', () => {
  it('POSTs to the model endpoint with the key in a HEADER (never in the URL)', async () => {
    const fetchImpl = vi.fn(async () => reply(answer('{"classification":"Hot"}')))
    await ask(client(fetchImpl))

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${GEMINI_BASE_URL}/models/gemini-test:generateContent`)
    expect(url).not.toContain(FAKE_KEY)
    expect(init.method).toBe('POST')
    expect(init.headers['x-goog-api-key']).toBe(FAKE_KEY)
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends instructions and content separately, and asks for JSON in the given shape', async () => {
    const fetchImpl = vi.fn(async () => reply(answer('{"classification":"Hot"}')))
    await client(fetchImpl).generateJson({ system: 'RULES', prompt: 'MESSAGE', schema, temperature: 0, maxOutputTokens: 200 })

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      systemInstruction: { parts: [{ text: 'RULES' }] },
      contents: [{ role: 'user', parts: [{ text: 'MESSAGE' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', responseSchema: schema },
    })
  })
})

describe('generateJson: thinking budget', () => {
  it('sends thinkingConfig only when a budget is given (0 = thinking off)', async () => {
    const fetchImpl = vi.fn(async () => reply(answer('{"classification":"Hot"}')))
    await client(fetchImpl).generateJson({ system: 's', prompt: 'p', schema, thinkingBudget: 0 })
    await client(fetchImpl).generateJson({ system: 's', prompt: 'p', schema })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).generationConfig.thinkingConfig).toBeUndefined()
  })
})

describe('generateJson: good answers', () => {
  it('returns the parsed JSON and the exact model version', async () => {
    const result = await ask(client(async () => reply(answer('{"classification":"Hot"}'))))
    expect(result).toEqual({ data: { classification: 'Hot' }, model: 'gemini-test-001' })
  })

  it('joins answer parts and skips "thought" parts', async () => {
    const body = answer('')
    body.candidates[0].content.parts = [{ text: 'thinking...', thought: true }, { text: '{"classification":' }, { text: '"Warm"}' }]
    const result = await ask(client(async () => reply(body)))
    expect(result.data).toEqual({ classification: 'Warm' })
  })

  it('falls back to the configured model name if Gemini does not say which version answered', async () => {
    const body = answer('{"classification":"Cold"}')
    delete body.modelVersion
    expect((await ask(client(async () => reply(body)))).model).toBe('gemini-test')
  })
})

describe('generateJson: bad answers are errors, never "success"', () => {
  it.each([
    ['answer text is not JSON', reply(answer('Sure! The lead is Hot.')), 'invalid_output', true],
    ['response body is not JSON', reply('<html>oops</html>'), 'invalid_output', true],
    ['no candidates', reply({ candidates: [] }), 'invalid_output', true],
    ['answer cut off', reply(answer('{"classif', { finishReason: 'MAX_TOKENS' })), 'invalid_output', true],
    ['input blocked', reply({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked', false],
    ['answer blocked', reply(answer('', { finishReason: 'SAFETY' })), 'blocked', false],
  ])('%s → %s (temporary: %s)', async (_label, response, kind, temporary) => {
    const error = await ask(client(async () => response)).catch((e) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind, temporary })
  })
})

describe('generateJson: HTTP errors', () => {
  const gemini = (code, status, message) => ({ error: { code, status, message } })

  it.each([
    ['invalid key', 400, gemini(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'), 'auth', false],
    ['API not enabled', 403, gemini(403, 'PERMISSION_DENIED', 'Generative Language API has not been used in project 123 before or it is disabled.'), 'api_disabled', false],
    ['no permission', 403, gemini(403, 'PERMISSION_DENIED', 'Permission denied.'), 'permission', false],
    ['unknown model', 404, gemini(404, 'NOT_FOUND', 'models/gemini-nope is not found'), 'model_not_found', false],
    ['rate limit / free quota', 429, gemini(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'), 'rate_limited', true],
    ['overloaded', 503, gemini(503, 'UNAVAILABLE', 'The model is overloaded.'), 'unavailable', true],
    ['server error', 500, gemini(500, 'INTERNAL', 'Internal error'), 'unavailable', true],
    ['bad request (our bug)', 400, gemini(400, 'INVALID_ARGUMENT', 'Invalid JSON payload received.'), 'bad_request', false],
  ])('%s → %s (temporary: %s)', async (_label, status, body, kind, temporary) => {
    const error = await ask(client(async () => reply(body, status))).catch((e) => e)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ kind, temporary, httpStatus: status, apiStatus: body.error.status })
  })

  it('no internet → unavailable (temporary)', async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    const error = await ask(client(fetchImpl)).catch((e) => e)
    expect(error).toMatchObject({ kind: 'unavailable', temporary: true })
    expect(error.message).toMatch(/ENOTFOUND/)
  })
})

describe('generateJson: deadline', () => {
  it('cancels a request that never answers and reports a temporary timeout', async () => {
    let receivedSignal
    const neverAnswers = (_url, init) =>
      new Promise((_, reject) => {
        receivedSignal = init.signal
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const started = Date.now()
    const error = await ask(client(neverAnswers, { timeoutMs: 50 })).catch((e) => e)

    expect(error).toMatchObject({ kind: 'timeout', temporary: true })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(receivedSignal.aborted).toBe(true) // the request was really cancelled
  })

  it('still gives up even if the request IGNORES the cancel signal', async () => {
    const ignoresCancel = () => new Promise(() => {}) // never settles, ignores the signal
    const error = await ask(client(ignoresCancel, { timeoutMs: 50 })).catch((e) => e)
    expect(error).toMatchObject({ kind: 'timeout', temporary: true })
  })

  it('also covers a slow response BODY (not only the headers)', async () => {
    const slowBody = async (_url, init) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    })
    const error = await ask(client(slowBody, { timeoutMs: 50 })).catch((e) => e)
    expect(error).toMatchObject({ kind: 'timeout' })
  })
})

describe('the API key never leaks', () => {
  it('is not in any error message or field, for any kind of failure', async () => {
    const responses = [
      () => reply({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' } }, 400),
      () => reply('not json'),
      () => {
        throw new TypeError('fetch failed')
      },
    ]
    for (const make of responses) {
      const error = await ask(client(async () => make())).catch((e) => e)
      expect(JSON.stringify({ ...error, message: error.message, stack: error.stack })).not.toContain(FAKE_KEY)
    }
  })

  it('is redacted by the logger if someone logs request headers', () => {
    const lines = []
    createLogger({ level: 'info', output: (l) => lines.push(l) }).info('debug', { headers: { 'x-goog-api-key': FAKE_KEY }, GEMINI_API_KEY: FAKE_KEY })
    expect(lines[0]).not.toContain(FAKE_KEY)
  })
})

describe('listModels', () => {
  it('returns only models that support generateContent, without the "models/" prefix', async () => {
    const fetchImpl = vi.fn(async () =>
      reply({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    )
    expect(await client(fetchImpl).listModels()).toEqual(['gemini-2.5-flash'])
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
  })

  it('reports a bad key clearly', async () => {
    const error = await client(async () => reply({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' } }, 400))
      .listModels()
      .catch((e) => e)
    expect(error.kind).toBe('auth')
  })
})

describe('readAiConfig', () => {
  it('no key → AI disabled (null), not an error', () => {
    expect(readAiConfig({})).toBeNull()
    expect(readAiConfig({ GEMINI_API_KEY: '   ' })).toBeNull()
  })

  it('reads the key (quotes removed) and uses the default model', () => {
    expect(readAiConfig({ GEMINI_API_KEY: `"${FAKE_KEY}"` })).toEqual({ apiKey: FAKE_KEY, model: 'gemini-2.5-flash' })
  })

  it('accepts a model override', () => {
    expect(readAiConfig({ GEMINI_API_KEY: FAKE_KEY, GEMINI_MODEL: 'gemini-2.5-flash-lite' }).model).toBe('gemini-2.5-flash-lite')
  })

  it('rejects a malformed key or model without printing the key', () => {
    const error = (() => {
      try {
        readAiConfig({ GEMINI_API_KEY: 'AIza secret with spaces', GEMINI_MODEL: 'Bad Model!' })
      } catch (e) {
        return e
      }
    })()
    expect(error.message).toMatch(/GEMINI_API_KEY does not look like an API key/)
    expect(error.message).toMatch(/GEMINI_MODEL "Bad Model!" is not a valid model name/)
    expect(error.message).not.toMatch(/secret with spaces/)
  })
})

describe('describeGeminiError: the two kinds of 429', () => {
  // A REAL 429 body received from Gemini on 2026-11-05 (free tier, daily limit reached).
  const dailyQuota429 = {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details. ...',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.Help', links: [] },
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '83574s' },
      ],
    },
  }

  it('daily limit → quota_exhausted, with the limit and a readable reset time', () => {
    const error = describeGeminiError(429, dailyQuota429)
    expect(error).toMatchObject({ kind: 'quota_exhausted', temporary: true, retryAfterSeconds: 83574, httpStatus: 429 })
    expect(error.message).toBe("Gemini's daily quota is used up (20 requests/day). It resets in about 23h.")
  })

  it('per-minute limit → rate_limited, with Gemini\'s retry delay', () => {
    const perMinute = structuredClone(dailyQuota429)
    perMinute.error.details[1].violations[0].quotaId = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'
    perMinute.error.details[2].retryDelay = '41.2s'
    const error = describeGeminiError(429, perMinute)
    expect(error).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 42 })
    expect(error.message).toMatch(/in about 42s/)
  })

  it('a 429 without details is treated as a per-minute limit', () => {
    expect(describeGeminiError(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } })).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: null })
  })
})

describe('describeGeminiError', () => {
  it('handles an empty body', () => {
    expect(describeGeminiError(502, null)).toMatchObject({ kind: 'unavailable', temporary: true })
  })
})
