// Shown on every page so nobody mistakes sample data for live customer data.
export default function SimulatedBanner() {
  return (
    <div className="simulated-banner" role="note">
      <strong>Demo mode:</strong> the sample leads are fictional, and their Hot/Warm/Cold labels are simulated
      sample data (marked “Simulated”). New leads are classified by Gemini AI when the server has an AI key.
      Automation runs are simulated. No automation service is connected yet.
    </div>
  )
}
