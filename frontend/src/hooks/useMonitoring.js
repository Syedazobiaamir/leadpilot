// Loads the activity log and workflow runs for the monitoring screens.
// It follows the same pattern as useLeads.js. See the comments there.
import { useCallback, useEffect, useState } from 'react'
import { getActivity, getWorkflowRuns } from '../services/leadService.js'

async function loadMonitoring() {
  try {
    // Promise.all runs both requests at the same time instead of one after the other.
    const [events, runs] = await Promise.all([getActivity(), getWorkflowRuns()])
    return { data: { events, runs }, error: null }
  } catch (err) {
    return { data: null, error: err.message || 'Failed to load monitoring data' }
  }
}

export function useMonitoring() {
  const [activity, setActivity] = useState([])
  const [workflowRuns, setWorkflowRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const applyResult = useCallback(({ data, error: loadError }) => {
    if (data) {
      setActivity(data.events)
      setWorkflowRuns(data.runs)
    }
    setError(loadError)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    loadMonitoring().then((result) => {
      if (active) applyResult(result)
    })
    return () => {
      active = false
    }
  }, [applyResult])

  // Background refresh (used after a lead is saved): current data stays on screen meanwhile.
  const refresh = useCallback(async () => {
    applyResult(await loadMonitoring())
  }, [applyResult])

  // Full reload with the loading screen, e.g. from a "Try again" button.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyResult(await loadMonitoring())
  }, [applyResult])

  return { activity, workflowRuns, loading, error, reload, refresh }
}
