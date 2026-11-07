// The tools agents can be given. Each tool does ONE narrow thing and checks its own limits.
// Agents only get the tools listed in their definition (see toolRegistry.js).
//
// Deliberately MISSING (so no agent can ever do them): sending messages, deleting anything,
// changing a lead's contact details or sales status, reading settings or credentials.
// More tools are added in later steps (review flags, follow-up drafts).
import { PermissionError } from './toolRegistry.js'
import { REVIEW_FLAGS } from './validationAgent.js'

// The only lead fields the AI qualification flow may change.
export const AI_FIELDS = ['classification', 'score', 'aiReason', 'aiModel', 'qualificationStatus', 'qualifiedAt']

/** store: the lead store (leadStore.js, or a test store). now: clock. */
export function createTools({ store, now = () => new Date() }) {
  return {
    readLead: {
      description: 'Read one lead by ID (read-only).',
      fn: (id) => store.findLeadById(id),
    },

    updateLeadAiFields: {
      description: `Change ONLY these fields of a lead: ${AI_FIELDS.join(', ')}.`,
      fn: async (id, changes) => {
        // Enforced inside the tool too: an agent allowed to use this tool still can't use it
        // to change a phone number, the sales status, or anything else.
        const notAllowed = Object.keys(changes).filter((key) => !AI_FIELDS.includes(key))
        if (notAllowed.length > 0) {
          throw new PermissionError(`updateLeadAiFields may not change: ${notAllowed.join(', ')}`)
        }
        return store.updateLead(id, changes)
      },
    },

    setReviewFlags: {
      description: 'Set the Validation Agent flags of a lead (known flag codes only). Changes nothing else.',
      fn: async (id, flags) => {
        const unknown = flags.filter((code) => !(code in REVIEW_FLAGS))
        if (unknown.length > 0) throw new PermissionError(`setReviewFlags: unknown flag(s): ${unknown.join(', ')}`)
        // Stored as one comma-separated cell (Sheets-friendly); null when there are no flags.
        return store.updateLead(id, { reviewFlags: flags.length > 0 ? flags.join(',') : null })
      },
    },

    listFollowUps: {
      description: 'List the follow-up drafts of one lead (read-only).',
      fn: async (leadId) => (await store.listFollowUps()).filter((f) => f.leadId === leadId),
    },

    saveFollowUpDraft: {
      description: 'Save a NEW follow-up draft (status "draft" only). Agents can never approve, edit or send a draft.',
      fn: async (draft) => {
        // Only a person may approve or reject (followUpService), so an agent can only create drafts.
        if (draft.status !== 'draft') throw new PermissionError('saveFollowUpDraft may only save drafts (status "draft")')
        if (draft.decidedAt || draft.editedAt) throw new PermissionError('saveFollowUpDraft may not set decidedAt or editedAt')
        const lead = await store.findLeadById(draft.leadId)
        if (!lead) throw new PermissionError(`saveFollowUpDraft: lead ${draft.leadId} does not exist`)
        return store.insertFollowUp(draft)
      },
    },

    writeActivity: {
      description: 'Add an audit event (type + message) about a lead. Never include personal data in the message.',
      fn: (type, message, leadId) =>
        store.insertActivity({ id: `EV-${Date.now()}-${leadId}-${type}`, type, message, leadId, timestamp: now().toISOString() }),
    },
  }
}
