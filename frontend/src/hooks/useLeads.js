// A custom React Hook: reusable state logic for loading and adding leads.
// Any component that calls useLeads() gets { leads, loading, error, addLead, reload }.
import { useCallback, useEffect, useState } from 'react'
import { createLead, getLeads } from '../services/leadService.js'

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

  // Manual reload, e.g. from a "Try again" button.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyResult(await loadLeads())
  }, [applyResult])

  const addLead = useCallback(async (input) => {
    try {
      const result = await createLead(input)
      if (result.success) {
        // Put the new lead first in the list. This is a new array, not a change to the old
        // one, so React sees the change and re-renders.
        setLeads((current) => [result.lead, ...current])
      }
      return result
    } catch (err) {
      return { success: false, errors: { form: err.message || 'Could not save the lead' } }
    }
  }, [])

  return { leads, loading, error, addLead, reload }
}
