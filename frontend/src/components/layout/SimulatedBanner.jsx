// Shown on every page so nobody mistakes sample data for live customer data.
export default function SimulatedBanner() {
  return (
    <div className="simulated-banner" role="note">
      <strong>Demo mode:</strong> leads come from the API server (stored in Google Sheets or in memory,
      depending on its setup) and start as simulated sample data. AI classifications and automation runs are
      simulated. No AI or automation service is connected yet.
    </div>
  )
}
