// Follow-up drafts of ONE lead (Stage 5): load them, ask the AI for a new draft (and wait
// for it), and record a person's decision (approve / reject / edit).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  QUALIFICATION_POLL_MS,
  QUALIFICATION_WATCH_MS,
  approveFollowUp,
  editFollowUp,
  getFollowUps,
  rejectFollowUp,
  requestFollowUp,
} from '../services/leadService.js'

export function useFollowUps(leadId) {
  const [followUps, setFollowUps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false) // waiting for the AI to write a draft
  const [pollTick, setPollTick] = useState(0) // changing it schedules the next check
  const waitStarted = useRef(0)
  const countBefore = useRef(0)

  // Load when the lead changes.
  useEffect(() => {
    const run = { cancelled: false }
    getFollowUps(leadId).then((result) => {
      if (run.cancelled) return
      if (result.success) setFollowUps(result.followUps)
      setError(result.success ? null : result.error)
      setLoading(false)
    })
    return () => {
      run.cancelled = true
    }
  }, [leadId])

  // While the AI writes a draft (in the background on the server), check every few seconds.
  // Stops when a new follow-up appears, or after the watch time (e.g. the AI failed).
  useEffect(() => {
    if (!generating) return
    const run = { cancelled: false }
    const timer = setTimeout(async () => {
      const result = await getFollowUps(leadId)
      if (run.cancelled) return
      if (result.success) setFollowUps(result.followUps)
      if (result.success && result.followUps.length > countBefore.current) {
        setGenerating(false) // the new draft is here
      } else if (Date.now() - waitStarted.current > QUALIFICATION_WATCH_MS) {
        setGenerating(false)
        setError('No draft arrived. The AI may be unavailable or out of quota; details are in the activity log.')
      } else {
        setPollTick((tick) => tick + 1) // check again
      }
    }, QUALIFICATION_POLL_MS)
    return () => {
      run.cancelled = true
      clearTimeout(timer)
    }
  }, [generating, leadId, pollTick])

  /** Ask the Follow-up Agent for a draft. */
  const requestDraft = useCallback(async () => {
    setError(null)
    const result = await requestFollowUp(leadId)
    if (!result.success) {
      setError(result.error)
      return result
    }
    countBefore.current = followUps.length
    waitStarted.current = Date.now()
    setGenerating(true)
    return result
  }, [leadId, followUps.length])

  /** Run a decision (approve/reject/edit) and put the updated follow-up in the list. */
  const decide = useCallback(async (action) => {
    setError(null)
    const result = await action()
    if (result.success) {
      setFollowUps((list) => list.map((f) => (f.id === result.followUp.id ? result.followUp : f)))
    } else {
      setError(result.error)
    }
    return result
  }, [])

  return {
    followUps,
    loading,
    error,
    generating,
    requestDraft,
    approve: (id) => decide(() => approveFollowUp(id)),
    reject: (id) => decide(() => rejectFollowUp(id)),
    edit: (id, changes) => decide(() => editFollowUp(id, changes)),
  }
}
