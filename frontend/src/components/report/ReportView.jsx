import ReportPage from './ReportPage.jsx'
import { useReport } from '../../hooks/useReport.js'

// Loads the report only while the Report page is open.
export default function ReportView() {
  const { report, loading, error, refresh } = useReport()
  return <ReportPage report={report} loading={loading} error={error} onRefresh={refresh} />
}
