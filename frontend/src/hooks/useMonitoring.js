// Loads the activity log, agent runs (Stage 5) and workflow runs (n8n, Stage 6).
// n8n writes alerts in the background, so the data refreshes itself every 30 seconds.
// It follows the same pattern as useLeads.js. See the comments there.
import { useCallback, useEffect, useState } from 'react'
import { getActivity, getAgentRuns, getWorkflowRuns } from '../services/leadService.js'

// Long in tests, so a test never sees a surprise refresh.
export const MONITORING_REFRESH_MS = import.meta.env.MODE === 'test' ? 600_000 : 30_000

async function loadMonitoring() {
  try {
    // Promise.all runs both requests at the same time instead of one after the other.
    const [events, runs, agentRuns] = await Promise.all([getActivity(), getWorkflowRuns(), getAgentRuns()])
    return { data: { events, runs, agentRuns }, error: null }
  } catch (err) {
    return { data: null, error: err.message || 'Failed to load monitoring data' }
  }
}

export function useMonitoring() {
  const [activity, setActivity] = useState([])
  const [workflowRuns, setWorkflowRuns] = useState([])
  const [agentRuns, setAgentRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const applyResult = useCallback(({ data, error: loadError }) => {
    if (data) {
      setActivity(data.events)
      setWorkflowRuns(data.runs)
      setAgentRuns(data.agentRuns)
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

  // Automatic background refresh, so n8n alerts ("HOT LEAD", "NEEDS A PERSON") show up without
  // reloading the page. A failed refresh shows the error state, like any other load.
  useEffect(() => {
    const timer = setInterval(refresh, MONITORING_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // Full reload with the loading screen, e.g. from a "Try again" button.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyResult(await loadMonitoring())
  }, [applyResult])

  return { activity, workflowRuns, agentRuns, loading, error, reload, refresh }
}
