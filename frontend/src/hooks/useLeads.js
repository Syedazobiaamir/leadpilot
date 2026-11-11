// A custom React Hook: reusable state logic for loading, adding and AI-qualifying leads.
// Any component that calls useLeads() gets { leads, loading, error, addLead, requalify, reload }.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  QUALIFICATION_POLL_MS,
  QUALIFICATION_WATCH_MS,
  createLead,
  getLeads,
  requalifyLead,
} from '../services/leadService.js'

// Fetches leads without touching React state, so it can't throw:
// it returns { data, error } instead.
async function loadLeads() {
  try {
    return { data: await getLeads(), error: null }
  } catch (err) {
    return { data: null, error: err.message || 'Failed to load leads' }
  }
}

export function useLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true) // true from the start: the first load begins immediately
  const [error, setError] = useState(null)

  // Leads whose AI result we are waiting for: lead ID → when we started waiting.
  // A ref, not state: changing it must not re-render by itself. pollTick drives the polling.
  const watching = useRef(new Map())
  const [pollTick, setPollTick] = useState(0)

  // Stores the result of loadLeads() in state.
  const applyResult = useCallback(({ data, error: loadError }) => {
    if (data) setLeads(data)
    // Show the failure honestly instead of an empty table that looks like "no leads".
    setError(loadError)
    setLoading(false)
  }, [])

  // Load leads once, when the component first appears on screen.
  useEffect(() => {
    let active = true
    loadLeads().then((result) => {
      if (active) applyResult(result) // ignore results that arrive after the component is gone
    })
    return () => {
      active = false // cleanup, run when the component leaves the screen
    }
  }, [applyResult])

  /** Start waiting for the AI result of this lead. */
  const watch = useCallback((id) => {
    watching.current.set(id, Date.now())
    setPollTick((tick) => tick + 1)
  }, [])

  // POLLING: while we wait for AI results, quietly re-fetch the leads every few seconds.
  // Stops for a lead when it is no longer "pending", or after QUALIFICATION_WATCH_MS
  // (e.g. when AI is switched off on the server, the lead would stay pending forever).
  useEffect(() => {
    if (watching.current.size === 0) return
    const run = { cancelled: false } // an object, so cleanup can flag it without reassigning a variable
    const timer = setTimeout(async () => {
      const { data } = await loadLeads()
      if (run.cancelled) return
      if (data) setLeads(data) // a failed poll is not shown as an error: the next one may work
      for (const [id, since] of watching.current) {
        const lead = data?.find((l) => l.id === id)
        const done = data && (!lead || lead.qualificationStatus !== 'pending')
        if (done || Date.now() - since > QUALIFICATION_WATCH_MS) watching.current.delete(id)
      }
      if (watching.current.size > 0) setPollTick((tick) => tick + 1) // schedule the next poll
    }, QUALIFICATION_POLL_MS)
    return () => {
      run.cancelled = true
      clearTimeout(timer) // no polling after the component is gone
    }
  }, [pollTick])

  // Manual reload, e.g. from a "Try again" button.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyResult(await loadLeads())
  }, [applyResult])

  const addLead = useCallback(
    async (input, options) => {
      try {
        const result = await createLead(input, options)
        if (result.success) {
          // Put the new lead first in the list. This is a new array, not a change to the old
          // one, so React sees the change and re-renders.
          setLeads((current) => [result.lead, ...current])
          // The server qualifies new leads with AI in the background: wait for the result.
          if (result.lead.qualificationStatus === 'pending') watch(result.lead.id)
        }
        return result
      } catch (err) {
        return { success: false, errors: { form: err.message || 'Could not save the lead' } }
      }
    },
    [watch],
  )

  /** Asks the server to (re)qualify one lead with AI. Returns { success, lead } or { success: false, error }. */
  const requalify = useCallback(
    async (id) => {
      const result = await requalifyLead(id)
      if (result.success) {
        setLeads((current) => current.map((lead) => (lead.id === id ? result.lead : lead)))
        watch(id)
      }
      return result
    },
    [watch],
  )

  return { leads, loading, error, addLead, requalify, reload }
}
