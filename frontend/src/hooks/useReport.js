// Loads the operational report (Stage 8) when the Report page opens; "Refresh" loads it again.
import { useCallback, useEffect, useState } from 'react'
import { getReport } from '../services/leadService.js'

export function useReport() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await getReport())
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load the report')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    getReport()
      .then((data) => {
        if (active) setReport(data)
      })
      .catch((err) => {
        if (active) setError(err.message || 'Could not load the report')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return { report, loading, error, refresh: load }
}
