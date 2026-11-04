// Shown on every page so nobody mistakes sample data for live customer data.
export default function SimulatedBanner() {
  return (
    <div className="simulated-banner" role="note">
      <strong>Demo mode:</strong> all leads, AI classifications and automation runs are
      simulated sample data. No AI, database or automation service is connected yet.
    </div>
  )
}
