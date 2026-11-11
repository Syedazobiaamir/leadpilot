// FOLLOW-UP AGENT (Stage 5): writes a personalized first follow-up email DRAFT for a lead.
//
// Tools: readLead, listFollowUps (read-only), saveFollowUpDraft (status "draft" only), writeActivity.
// It can NOT change the lead, approve or edit a draft, or send anything: sending is not a tool
// at all, and a person must approve each draft (CLAUDE.md §5: human approval for sensitive actions).
//
// Outcome:
//   success → a new draft is saved; returns { followUp, summary }
//   skipped → the lead already has an open draft (avoids piling up drafts and spending AI quota)
//   failure → AiError thrown (runAgent records the kind); no draft is saved
import { randomBytes } from 'node:crypto'
import { AppError } from '../utils/AppError.js'
import { AiError } from '../services/ai/geminiClient.js'
import {
  FOLLOW_UP_SCHEMA,
  FOLLOW_UP_SETTINGS,
  buildFollowUpPrompt,
  firstNameOf,
  followUpDraftSchema,
  followUpInstructions,
} from '../services/ai/followUpPrompt.js'

export function createFollowUpAgent({ ai, contractorName, now = () => new Date() }) {
  return {
    name: 'followup',
    description: 'Writes a personalized first follow-up email DRAFT for a lead. Cannot change the lead, approve, or send.',
    tools: ['readLead', 'listFollowUps', 'saveFollowUpDraft', 'writeActivity'],

    async run({ input, tools, logger }) {
      const id = input.leadId
      const lead = await tools.call('readLead', id)
      if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', `No lead found with ID ${id}`)

      // One open draft per lead is enough. A person can reject it and ask for a new one.
      const existing = await tools.call('listFollowUps', id)
      if (existing.some((f) => f.status === 'draft')) {
        return { status: 'skipped', summary: 'an open draft already exists' }
      }

      const firstName = firstNameOf(lead.name)
      const { data, model } = await ai.generateJson({
        system: followUpInstructions(contractorName),
        prompt: buildFollowUpPrompt(lead), // first name, service, timeline, class, message only
        schema: FOLLOW_UP_SCHEMA,
        ...FOLLOW_UP_SETTINGS,
      })

      // Never trust the draft: shape, length, greeting, signature, and no prices/promises/placeholders.
      const parsed = followUpDraftSchema({ firstName, contractorName }).safeParse(data)
      if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(answer)'}: ${i.message}`)
        logger.warn('ai follow-up rejected', { leadId: id, model, problems }) // rules only, never the text
        throw new AiError('invalid_output', `The AI draft did not pass the checks (${problems.join('; ')}).`, { temporary: true })
      }

      const followUp = await tools.call('saveFollowUpDraft', {
        id: `FU-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`,
        leadId: id,
        channel: 'email',
        subject: parsed.data.subject,
        body: parsed.data.body,
        status: 'draft',
        aiModel: model,
        createdAt: now().toISOString(),
        decidedAt: null,
        editedAt: null,
        sentAt: null, // Stage 6: set when n8n reports the message was sent
        sentVia: null,
        claimedAt: null, // Stage 7: set when n8n claims it for sending
        claimedBy: null,
      })

      try {
        await tools.call('writeActivity', 'ai', `Follow-up draft ${followUp.id} written for ${id} by ${model} (needs approval, not sent)`, id)
        if (parsed.data.injectionSuspected) {
          await tools.call('writeActivity', 'error', `Possible prompt injection in ${id} (follow-up): the inquiry contained instructions to the AI. They were ignored.`, id)
        }
      } catch (err) {
        logger.warn('could not write activity event', { leadId: id, error: err.code ?? err.message })
      }

      return {
        followUp,
        summary: `draft ${followUp.id}${parsed.data.injectionSuspected ? ', injection flagged' : ''}`,
      }
    },
  }
}
