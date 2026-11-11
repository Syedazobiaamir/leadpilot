// Follow-up drafts of ONE lead (Stage 5): load them, ask the AI for a new draft (and wait
// for it), and record a person's decision (approve / reject / edit).
// Stage 6: after an approval, n8n "sends" the follow-up (SIMULATED) in the background, so we
// check again for a while until the server says "sent".
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
  const [sendWatch, setSendWatch] = useState(null) // { id, started, tick } while waiting for n8n
  const [sendNote, setSendNote] = useState(null) // shown if n8n doesn't confirm in time

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

  // After an approval: check every few seconds until n8n has marked the follow-up "sent".
  // Not an error if it doesn't happen: n8n may simply be off. We say so honestly.
  useEffect(() => {
    if (!sendWatch) return
    const run = { cancelled: false }
    const timer = setTimeout(async () => {
      const result = await getFollowUps(leadId)
      if (run.cancelled) return
      if (result.success) setFollowUps(result.followUps)
      const current = result.success ? result.followUps.find((f) => f.id === sendWatch.id) : null
      if (current?.status === 'sent') {
        setSendWatch(null)
      } else if (Date.now() - sendWatch.started > QUALIFICATION_WATCH_MS) {
        setSendWatch(null)
        setSendNote('n8n has not confirmed sending yet. If n8n is not running, it stays "approved" and the Recovery Agent hands it to n8n again later; check the Automation page.')
      } else {
        setSendWatch((watch) => watch && { ...watch, tick: watch.tick + 1 }) // check again
      }
    }, QUALIFICATION_POLL_MS)
    return () => {
      run.cancelled = true
      clearTimeout(timer)
    }
  }, [sendWatch, leadId])

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

  /** A person approves: then wait for n8n to send it. */
  const approve = useCallback(
    async (id) => {
      setSendNote(null)
      const result = await decide(() => approveFollowUp(id))
      if (result.success) setSendWatch({ id, started: Date.now(), tick: 0 })
      return result
    },
    [decide],
  )

  return {
    followUps,
    loading,
    error,
    generating,
    waitingForSend: Boolean(sendWatch),
    sendNote,
    requestDraft,
    approve,
    reject: (id) => decide(() => rejectFollowUp(id)),
    edit: (id, changes) => decide(() => editFollowUp(id, changes)),
  }
}
