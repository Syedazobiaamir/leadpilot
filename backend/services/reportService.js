// OPERATIONAL REPORT (Stage 8, core feature #12): how is the business and the system doing?
// Computed on request from the data we already store (leads, agent runs, follow-ups, workflow
// runs, recoveries). Nothing new is stored. Counts never contain personal data.
//
// Honest labels:
//   - SIMULATED sample leads (aiModel "simulated") count as leads, but never as AI results.
//   - "AI requests today" is an ESTIMATE from our own agent runs: eval scripts and manual checks
//     use the same quota but aren't recorded here. Gemini's free-tier day ends at midnight
//     Pacific time (America/Los_Angeles), so "today" is counted in that time zone.
//   - Sample workflow runs (from earlier stages) are left out of the automation numbers.
import * as leadStore from './leadStore.js'
import { parseReviewFlags, withQualificationDefaults } from './leadService.js'
import { REVIEW_FLAGS } from '../agents/validationAgent.js'

export const PERIOD_DAYS = 7
export const AI_DAILY_LIMIT = 20 // gemini-2.5-flash free tier (verified 2026-11-05)
const AI_TIME_ZONE = 'America/Los_Angeles'
const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight (start of today) in a time zone, as a Date. */
export function startOfDayIn(timeZone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  )
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offset = Math.round((wallClockAsUtc - date.getTime()) / 60_000) * 60_000 // e.g. -8 h in winter
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offset)
}

// "Time to qualify" measures the AUTOMATIC flow (form → AI answer). A lead re-qualified by hand
// days later would make it look like days, so only answers within 24 h of the form count, and the
// MEDIAN is used (one odd value can't distort it). Found with the developer's real data.
const AUTOMATIC_WINDOW_MINUTES = 24 * 60
const median = (numbers) => {
  if (numbers.length === 0) return null
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null)
const average = (numbers) => (numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null)
const countBy = (items, keyOf) => items.reduce((acc, item) => ((acc[keyOf(item)] = (acc[keyOf(item)] ?? 0) + 1), acc), {})
const isRealWorkflowRun = (run) => run.id.startsWith('WF-n8n-') || run.id.startsWith('WF-be-')

/** Builds the report. `now` is a function (tests pass a fixed clock). */
export async function buildOverview({ store = leadStore, now = () => new Date() } = {}) {
  const at = now()
  const since = new Date(at.getTime() - PERIOD_DAYS * DAY_MS)
  const recent = (iso) => Boolean(iso) && Date.parse(iso) >= since.getTime()

  const [rawLeads, agentRuns, followUps, workflowRuns, recoveries] = await Promise.all([
    store.listLeads(), store.listAgentRuns(), store.listFollowUps(), store.listWorkflowRuns(), store.listRecoveries(),
  ])

  // ---- Leads (same labels as the API: old sample rows without an AI model are "simulated")
  const leads = rawLeads.map(withQualificationDefaults)
  const recentLeads = leads.filter((l) => recent(l.createdAt))
  const flagsOf = (l) => parseReviewFlags(l.reviewFlags)
  const perDay = Array.from({ length: PERIOD_DAYS }, (_, i) => {
    const day = new Date(at.getTime() - (PERIOD_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10)
    return { date: day, count: leads.filter((l) => l.createdAt?.slice(0, 10) === day).length }
  })
  const byClass = { Hot: 0, Warm: 0, Cold: 0, Unclassified: 0 }
  for (const l of leads) byClass[['Hot', 'Warm', 'Cold'].includes(l.classification) ? l.classification : 'Unclassified']++
  const realAiLeads = recentLeads.filter((l) => l.qualificationStatus === 'qualified' && l.aiModel && l.aiModel !== 'simulated' && l.qualifiedAt)
  const minutesToQualify = realAiLeads.map((l) => (Date.parse(l.qualifiedAt) - Date.parse(l.createdAt)) / 60_000).filter((m) => m >= 0 && m <= AUTOMATIC_WINDOW_MINUTES)

  // ---- AI (agent runs that called Gemini: qualification + follow-up drafts)
  const aiRuns = agentRuns.filter((r) => ['qualification', 'followup'].includes(r.agent) && ['success', 'failed'].includes(r.status))
  const recentAi = aiRuns.filter((r) => recent(r.startedAt))
  const qualificationRuns = recentAi.filter((r) => r.agent === 'qualification')
  const dayStart = startOfDayIn(AI_TIME_ZONE, at)
  const requestsToday = aiRuns.filter((r) => Date.parse(r.startedAt) >= dayStart.getTime() && r.errorKind !== 'quota_exhausted').length

  // ---- Follow-ups
  const fStatus = countBy(followUps, (f) => f.status)

  // ---- Automation (real runs only)
  const realRuns = workflowRuns.filter((r) => isRealWorkflowRun(r) && recent(r.startedAt))

  // ---- Self-healing
  const rStatus = countBy(recoveries, (r) => r.status)

  return {
    generatedAt: at.toISOString(),
    period: { days: PERIOD_DAYS, since: since.toISOString() },
    leads: {
      total: leads.length,
      lastPeriod: recentLeads.length,
      perDay,
      byClass,
      hotShare: share(byClass.Hot, byClass.Hot + byClass.Warm + byClass.Cold),
      simulated: leads.filter((l) => l.aiModel === 'simulated').length,
      needsReview: leads.filter((l) => flagsOf(l).some((c) => REVIEW_FLAGS[c]?.severity === 'review')).length,
      blocked: leads.filter((l) => flagsOf(l).some((c) => REVIEW_FLAGS[c]?.severity === 'block')).length,
      medianMinutesToQualify: minutesToQualify.length > 0 ? Math.round(median(minutesToQualify) * 10) / 10 : null,
    },
    ai: {
      qualificationRuns: qualificationRuns.length,
      qualificationSuccessRate: share(qualificationRuns.filter((r) => r.status === 'success').length, qualificationRuns.length),
      runs: recentAi.length,
      failed: recentAi.filter((r) => r.status === 'failed').length,
      avgSeconds: recentAi.length > 0 ? Math.round(average(recentAi.map((r) => r.durationMs)) / 100) / 10 : null,
      failureKinds: countBy(recentAi.filter((r) => r.status === 'failed'), (r) => r.errorKind ?? 'unknown'),
      requestsToday,
      dailyLimit: AI_DAILY_LIMIT,
      quotaResetsAt: new Date(startOfDayIn(AI_TIME_ZONE, new Date(dayStart.getTime() + DAY_MS + 2 * 60 * 60 * 1000)).getTime()).toISOString(),
    },
    followUps: {
      waitingForApproval: fStatus.draft ?? 0,
      inProgress: (fStatus.approved ?? 0) + (fStatus.sending ?? 0),
      sent: fStatus.sent ?? 0,
      rejected: fStatus.rejected ?? 0,
    },
    automation: {
      runs: realRuns.length,
      success: realRuns.filter((r) => r.status === 'success').length,
      failed: realRuns.filter((r) => r.status === 'failed').length,
      escalated: realRuns.filter((r) => r.status === 'escalated').length,
    },
    selfHealing: {
      retrying: rStatus.pending_retry ?? 0,
      needsPerson: rStatus.escalated ?? 0,
      recovered: rStatus.recovered ?? 0,
    },
  }
}
