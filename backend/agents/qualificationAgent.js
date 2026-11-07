// LEAD QUALIFICATION AGENT (Stage 5): the Stage 4 AI qualification, as an agent.
// Same behaviour as before; the difference is that it touches data ONLY through its tools:
//   readLead           read the lead
//   updateLeadAiFields write ONLY the AI fields (the tool itself refuses anything else)
//   writeActivity      audit events
// It cannot change contact details or the sales status, draft or send messages, or delete anything.
//
// Outcome:
//   success → returns { lead, classification, score, ... } and the lead is "qualified"
//   AI failure → the lead is marked "failed" (previous result kept), an audit event is written,
//                and the AiError is thrown, so runAgent records the run as failed with its kind.
import { AppError } from '../utils/AppError.js'
import { AiError } from '../services/ai/geminiClient.js'
import {
  QUALIFICATION_SETTINGS,
  RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTIONS,
  buildQualificationPrompt,
  qualificationResultSchema,
} from '../services/ai/qualificationPrompt.js'

/** ai: the Gemini client ({ model, generateJson }). now: clock. */
export function createQualificationAgent({ ai, now = () => new Date() }) {
  /** Asks the AI and returns a VALIDATED result, or throws an AiError. */
  async function askAi(lead, logger) {
    const { data, model } = await ai.generateJson({
      system: SYSTEM_INSTRUCTIONS,
      prompt: buildQualificationPrompt(lead), // service + timeline + message only
      schema: RESPONSE_SCHEMA,
      ...QUALIFICATION_SETTINGS,
    })
    const parsed = qualificationResultSchema.safeParse(data)
    if (!parsed.success) {
      // Log what was wrong (field names and rules only, never the customer's message).
      const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(answer)'}: ${i.message}`)
      logger.warn('ai answer rejected', { leadId: lead.id, model, problems })
      throw new AiError('invalid_output', `The AI answer did not pass validation (${problems.join('; ')}).`, { temporary: true })
    }
    return { ...parsed.data, model }
  }

  /** An audit write failing must never hide the real outcome. */
  async function audit(tools, logger, type, message, leadId) {
    try {
      await tools.call('writeActivity', type, message, leadId)
    } catch (err) {
      logger.warn('could not write activity event', { leadId, type, error: err.code ?? err.message })
    }
  }

  return {
    name: 'qualification',
    description: 'Classifies a lead as Hot, Warm or Cold with a score and a one-sentence reason, using Gemini. Writes only the AI fields.',
    tools: ['readLead', 'updateLeadAiFields', 'writeActivity'],

    async run({ input, tools, logger }) {
      const id = input.leadId
      const lead = await tools.call('readLead', id)
      if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${id}`)

      let result
      try {
        result = await askAi(lead, logger)
      } catch (err) {
        if (!(err instanceof AiError)) throw err // a bug: surfaces as a 500
        logger.error('ai qualification failed', {
          leadId: id, kind: err.kind, temporary: err.temporary, reason: err.message,
          httpStatus: err.httpStatus, apiStatus: err.apiStatus, retryAfterSeconds: err.retryAfterSeconds, model: ai.model,
        })
        await tools.call('updateLeadAiFields', id, { qualificationStatus: 'failed' }) // previous result is kept
        await audit(tools, logger, 'error', `AI qualification failed for ${id}: ${err.message} (${err.temporary ? 'temporary, can be retried' : 'needs attention'})`, id)
        throw err
      }

      const updated = await tools.call('updateLeadAiFields', id, {
        classification: result.classification,
        score: result.score,
        aiReason: result.reason,
        aiModel: result.model,
        qualificationStatus: 'qualified',
        qualifiedAt: now().toISOString(),
      })
      logger.info('lead qualified', { leadId: id, classification: result.classification, score: result.score, model: result.model, injectionSuspected: result.injectionSuspected })
      await audit(tools, logger, 'ai', `${id} classified as ${result.classification} (score ${result.score}) by ${result.model}`, id)
      if (result.injectionSuspected) {
        // Security audit trail: someone may have tried to manipulate the AI through the form.
        await audit(tools, logger, 'error', `Possible prompt injection in ${id}: the inquiry contained instructions to the AI. They were ignored.`, id)
      }

      return {
        lead: updated,
        classification: result.classification,
        score: result.score,
        injectionSuspected: result.injectionSuspected,
        // Goes to AgentRuns: no personal data, only the outcome.
        summary: `${result.classification} (score ${result.score})${result.injectionSuspected ? ', injection flagged' : ''}`,
      }
    },
  }
}
