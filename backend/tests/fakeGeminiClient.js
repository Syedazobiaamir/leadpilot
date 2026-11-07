// A fake Gemini client for tests (same shape as createGeminiClient's result). No network.
// Tell it what to answer with answerWith(...), or how to fail with failWith(...).
// It records every prompt, so tests can check what the AI was (and was NOT) sent.
import { AiError } from '../services/ai/geminiClient.js'

export function createFakeGeminiClient({ model = 'gemini-fake-001' } = {}) {
  const calls = []
  let next = () => ({ classification: 'Hot', score: 88, reason: 'Active leak that needs urgent repair.', injectionSuspected: false })
  let delayMs = 0

  return {
    model,
    calls,

    /** Answer every call with this object (or a function of the call). */
    answerWith(answer) {
      next = typeof answer === 'function' ? answer : () => answer
    },
    /** Fail every call with an AiError of this kind. */
    failWith(kind, { temporary = false } = {}) {
      next = () => {
        throw new AiError(kind, `Simulated ${kind}`, { temporary })
      }
    },
    /** Make each call take this long (to test "already running"). */
    slowDown(ms) {
      delayMs = ms
    },

    /** Models the fake key "can use". */
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-fake-001'],
    async listModels() {
      return this.models
    },

    async generateJson(request) {
      calls.push(request)
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return { data: next(request), model }
    },
  }
}
