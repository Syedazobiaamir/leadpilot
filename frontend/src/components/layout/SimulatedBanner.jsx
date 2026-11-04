// Shown on every page so nobody mistakes sample data for live customer data.
export default function SimulatedBanner() {
  return (
    <div className="simulated-banner" role="note">
      <strong>Demo mode:</strong> data comes from the local API server, but it is simulated sample data
      held in memory (it resets when the server restarts). AI classifications and automation runs are
      simulated. No AI, database or automation service is connected yet.
    </div>
  )
}
