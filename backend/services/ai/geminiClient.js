// The ONLY file that talks to the Gemini API. Plain fetch, no SDK (Stage 4 decision 2A):
// there is one endpoint, and this way we fully control the timeout, the errors and
// what gets logged.
//
//   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
//   header x-goog-api-key: <key>   (in a HEADER, not the URL: URLs end up in logs and proxies)
//
// Every failure becomes an AiError with a "kind" and a "temporary" flag, like StorageError
// in Stage 3. See the api-integration skill.

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * An AI failure.
 * kind:      what went wrong (see describeGeminiError and the checks in generateJson)
 * temporary: true if trying again later may work (timeout, rate limit, Google overloaded,
 *            or an odd one-off answer). false for setup problems, which need a human.
 * httpStatus / apiStatus: what Gemini sent back (e.g. 429 / RESOURCE_EXHAUSTED), for the logs.
 * retryAfterSeconds: how long Gemini says to wait before trying again (from its RetryInfo), if known.
 * Never contains the API key.
 */
export class AiError extends Error {
  constructor(kind, message, { temporary = false, httpStatus = null, apiStatus = null, retryAfterSeconds = null } = {}) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    this.temporary = temporary
    this.httpStatus = httpStatus
    this.apiStatus = apiStatus
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** Finds a detail of one type (e.g. "QuotaFailure") in a Google error body. */
function errorDetail(body, type) {
  return (body?.error?.details ?? []).find((d) => String(d?.['@type'] ?? '').endsWith(`.${type}`))
}

/** "83574s" or "1.5s" → seconds (rounded up), or null. */
function parseDelaySeconds(value) {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value ?? ''))
  return match ? Math.ceil(Number(match[1])) : null
}

/** "83574" seconds → "about 23h", "45s" → "about 45s". */
function humanDelay(seconds) {
  if (seconds === null) return 'later'
  if (seconds >= 3600) return `in about ${Math.round(seconds / 3600)}h`
  if (seconds >= 60) return `in about ${Math.round(seconds / 60)} min`
  return `in about ${seconds}s`
}

/** Turns an HTTP error response from Gemini into an AiError. */
export function describeGeminiError(httpStatus, body) {
  const apiStatus = body?.error?.status ?? null // e.g. "INVALID_ARGUMENT", "RESOURCE_EXHAUSTED"
  const text = `${body?.error?.message ?? ''} ${JSON.stringify(body?.error?.details ?? '')}`
  const make = (kind, message, temporary = false) => new AiError(kind, message, { temporary, httpStatus, apiStatus })

  if (/API key not valid|API_KEY_INVALID|API key expired/i.test(text) || httpStatus === 401) {
    return make('auth', 'Gemini rejected the API key. Check GEMINI_API_KEY.')
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) {
    return make('api_disabled', 'The Gemini API (Generative Language API) is not enabled for this key\'s project.')
  }
  if (httpStatus === 403) {
    return make('permission', 'This API key is not allowed to use the Gemini API or this model.')
  }
  if (httpStatus === 404) {
    return make('model_not_found', 'The Gemini model was not found. Check GEMINI_MODEL ("npm run ai:check" lists valid models).')
  }
  if (httpStatus === 429) {
    // Two very different limits share HTTP 429. The QuotaFailure detail says which one:
    //   per DAY    → "quota_exhausted": retrying before the reset (hours away) is pointless
    //   per MINUTE → "rate_limited":    retrying after a short wait works
    const violation = errorDetail(body, 'QuotaFailure')?.violations?.[0]
    const retryAfterSeconds = parseDelaySeconds(errorDetail(body, 'RetryInfo')?.retryDelay)
    const extra = { temporary: true, httpStatus, apiStatus, retryAfterSeconds }
    if (/PerDay/i.test(violation?.quotaId ?? '')) {
      const limit = violation?.quotaValue ? ` (${violation.quotaValue} requests/day)` : ''
      return new AiError('quota_exhausted', `Gemini's daily quota is used up${limit}. It resets ${humanDelay(retryAfterSeconds)}.`, extra)
    }
    return new AiError('rate_limited', `Gemini rate limit reached. Try again ${humanDelay(retryAfterSeconds)}.`, extra)
  }
  if (httpStatus >= 500) {
    return make('unavailable', 'Gemini is temporarily unavailable or overloaded.', true)
  }
  if (httpStatus === 400) {
    // Our request was wrong (e.g. an unsupported schema). A bug on our side, not temporary.
    return make('bad_request', 'Gemini rejected the request format.')
  }
  return make('unknown', `Unexpected response from Gemini (HTTP ${httpStatus}).`)
}

/**
 * Creates the client.
 * apiKey, model: from config.ai
 * timeoutMs:     our own deadline for the WHOLE call (sending + waiting + reading the answer)
 * fetchImpl:     the fetch function. Tests pass a fake, so no test ever reaches the network.
 */
export function createGeminiClient({ apiKey, model, timeoutMs = 6_000, fetchImpl = fetch, baseUrl = GEMINI_BASE_URL }) {
  /**
   * Runs one HTTP request with our own deadline and returns { httpStatus, body }.
   * The deadline both CANCELS the request (AbortController) and, as a backup,
   * stops waiting (Promise.race), so we never hang even if the request ignores the cancel.
   * (Lesson from Stage 3: a library timeout can miss part of the call.)
   */
  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController()
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new AiError('timeout', 'Gemini did not respond in time.', { temporary: true }))
      }, timeoutMs)
    })

    const call = (async () => {
      let res
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: { 'x-goog-api-key': apiKey, ...(body && { 'Content-Type': 'application/json' }) },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
      } catch (err) {
        if (controller.signal.aborted) throw new AiError('timeout', 'Gemini did not respond in time.', { temporary: true })
        // fetch itself only fails when no answer arrives at all (no internet, DNS, proxy...).
        // The original error is NOT kept: it isn't needed and could carry request details.
        throw new AiError('unavailable', `Could not reach Gemini (${err?.cause?.code ?? err?.name ?? 'network error'}).`, { temporary: true })
      }
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        // not JSON: handled by the caller
      }
      return { httpStatus: res.status, ok: res.ok, body: json }
    })()

    try {
      return await Promise.race([call, deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    model,

    /**
     * Asks Gemini for a JSON answer in a fixed shape ("structured output").
     *   system:          the instructions (role, rules)
     *   prompt:          the user content (for us: the lead's message, treated as untrusted data)
     *   schema:          the shape the answer must have (Gemini's OpenAPI-style schema)
     *   temperature:     0 = always the most likely answer; low = consistent results
     *   maxOutputTokens: upper limit on the answer's length (for "thinking" models this INCLUDES the thinking)
     *   thinkingBudget:  optional. Tokens a thinking model may spend thinking; 0 turns thinking off.
     *                    Only send it to models that support it (otherwise Gemini answers 400).
     * Returns { data, model }: the parsed JSON and the exact model version that answered.
     * The CALLER must still validate `data` (e.g. with Zod): never trust AI output blindly.
     */
    async generateJson({ system, prompt, schema, temperature = 0.2, maxOutputTokens = 1024, thinkingBudget }) {
      const { httpStatus, ok, body } = await request(`/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: schema,
            ...(thinkingBudget !== undefined && { thinkingConfig: { thinkingBudget } }),
          },
        },
      })
      if (!ok) throw describeGeminiError(httpStatus, body)
      if (!body) throw new AiError('invalid_output', 'Gemini sent a response that is not JSON.', { temporary: true, httpStatus })

      // Gemini may refuse the INPUT for safety reasons...
      if (body.promptFeedback?.blockReason) {
        throw new AiError('blocked', `Gemini blocked the request (${body.promptFeedback.blockReason}).`, { httpStatus })
      }
      const candidate = body.candidates?.[0]
      if (!candidate) throw new AiError('invalid_output', 'Gemini returned no answer.', { temporary: true, httpStatus })
      // ...or stop the ANSWER early.
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
        throw new AiError('blocked', `Gemini stopped the answer (${candidate.finishReason}).`, { httpStatus })
      }
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new AiError('invalid_output', 'Gemini\'s answer was cut off (too long).', { temporary: true, httpStatus })
      }

      // The answer text, skipping any "thought" parts some models can include.
      const text = (candidate.content?.parts ?? [])
        .filter((part) => typeof part.text === 'string' && !part.thought)
        .map((part) => part.text)
        .join('')
      try {
        return { data: JSON.parse(text), model: body.modelVersion ?? model }
      } catch {
        throw new AiError('invalid_output', 'Gemini\'s answer was not valid JSON.', { temporary: true, httpStatus })
      }
    },

    /** Models this key can use for generateContent (for "npm run ai:check"). */
    async listModels() {
      const { httpStatus, ok, body } = await request('/models?pageSize=1000')
      if (!ok) throw describeGeminiError(httpStatus, body)
      return (body?.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, ''))
    },
  }
}
