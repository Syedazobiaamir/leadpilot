import { useState } from 'react'
import './App.css'
import Sidebar from './components/layout/Sidebar.jsx'
import Header from './components/layout/Header.jsx'
import SimulatedBanner from './components/layout/SimulatedBanner.jsx'
import StatsOverview from './components/dashboard/StatsOverview.jsx'
import LeadCaptureForm from './components/leads/LeadCaptureForm.jsx'
import LeadFilters from './components/leads/LeadFilters.jsx'
import LeadTable from './components/leads/LeadTable.jsx'
import LeadDetail from './components/leads/LeadDetail.jsx'
import AutomationStatus from './components/monitoring/AutomationStatus.jsx'
import ActivityLog from './components/monitoring/ActivityLog.jsx'
import AgentRuns from './components/monitoring/AgentRuns.jsx'
import { useLeads } from './hooks/useLeads.js'
import { useMonitoring } from './hooks/useMonitoring.js'
import { filterLeads } from './utils/leadStats.js'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', title: 'Dashboard', subtitle: 'Lead pipeline and automation health at a glance' },
  { id: 'leads', label: 'Leads', title: 'Leads', subtitle: 'Search, filter and review customer inquiries' },
  { id: 'new-lead', label: 'New Lead', title: 'Capture a new lead', subtitle: 'Enter a customer inquiry. It is validated before it is saved.' },
  { id: 'monitoring', label: 'Automation', title: 'Automation monitoring', subtitle: 'AI agent runs, n8n workflow runs and the audit log' },
]

const DEFAULT_FILTERS = { classification: 'All', status: 'All', search: '' }

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selectedLeadId, setSelectedLeadId] = useState(null)

  const { leads, loading: leadsLoading, error: leadsError, addLead, requalify, reload: reloadLeads } = useLeads()
  const {
    activity,
    workflowRuns,
    agentRuns,
    loading: monLoading,
    error: monError,
    reload: reloadMonitoring,
    refresh: refreshMonitoring,
  } = useMonitoring()

  const page = PAGES.find((p) => p.id === currentPage)
  const loading = leadsLoading || monLoading
  const error = leadsError || monError

  // Save the lead, then refresh the activity log in the background so the new
  // "lead captured" event shows up. "refresh" doesn't switch to the loading screen,
  // so the form's success message stays visible.
  async function handleCreateLead(data) {
    const result = await addLead(data)
    if (result.success) refreshMonitoring()
    return result
  }

  function openLead(id) {
    setSelectedLeadId(id)
    setCurrentPage('leads')
  }

  function renderPage() {
    if (error) {
      return (
        <div className="card error-state" role="alert">
          <p>Something went wrong: {error}</p>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              reloadLeads()
              reloadMonitoring()
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    if (loading) {
      return <p className="loading" role="status">Loading data…</p>
    }

    switch (currentPage) {
      case 'leads': {
        const visibleLeads = filterLeads(leads, filters)
        const selectedLead = leads.find((lead) => lead.id === selectedLeadId)
        return (
          <>
            <LeadFilters filters={filters} onChange={setFilters} />
            <p className="muted result-count">
              Showing {visibleLeads.length} of {leads.length} leads
            </p>
            <div className={selectedLead ? 'split' : ''}>
              <LeadTable leads={visibleLeads} selectedId={selectedLeadId} onSelect={setSelectedLeadId} />
              <LeadDetail lead={selectedLead} onClose={() => setSelectedLeadId(null)} onRequalify={requalify} />
            </div>
          </>
        )
      }
      case 'new-lead':
        return <LeadCaptureForm onSubmit={handleCreateLead} />
      case 'monitoring':
        return (
          <>
            <div className="two-col">
              <section className="card">
                <h2>Agent runs</h2>
                <p className="muted small">Real records of what each AI agent did (newest first).</p>
                <AgentRuns runs={agentRuns} />
              </section>
              <section className="card">
                <h2>Activity &amp; audit log</h2>
                <ActivityLog events={activity} />
              </section>
            </div>
            <section className="card">
              <h2>Workflow runs</h2>
              <p className="muted small">
                Runs marked <strong>n8n</strong> are real n8n automation runs. <strong>Not delivered</strong> means the
                backend could not reach n8n. <strong>Sample</strong> runs are simulated data from earlier stages.
                Refreshes every 30 seconds.
              </p>
              <AutomationStatus runs={workflowRuns} />
            </section>
          </>
        )
      default: {
        const hotLeads = leads.filter((lead) => lead.classification === 'Hot').slice(0, 4)
        return (
          <>
            <StatsOverview leads={leads} workflowRuns={workflowRuns} />
            <div className="two-col">
              <section className="card">
                <h2>Hot leads to call first</h2>
                <ul className="hot-list">
                  {hotLeads.map((lead) => (
                    <li key={lead.id}>
                      <button type="button" className="link-button" onClick={() => openLead(lead.id)}>
                        {lead.name}
                      </button>
                      <span className="muted">
                        {lead.serviceType} · score {lead.score}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="card">
                <h2>Recent agent runs</h2>
                <AgentRuns runs={agentRuns} limit={4} />
              </section>
            </div>
            <section className="card">
              <h2>Recent activity</h2>
              <ActivityLog events={activity} limit={5} />
            </section>
          </>
        )
      }
    }
  }

  return (
    <div className="app-shell">
      <Sidebar pages={PAGES} currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className="main">
        <SimulatedBanner />
        <Header title={page.title} subtitle={page.subtitle} />
        {renderPage()}
      </main>
    </div>
  )
}
