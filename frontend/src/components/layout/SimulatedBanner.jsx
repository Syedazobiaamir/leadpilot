// Shown on every page so nobody mistakes sample data for live customer data.
export default function SimulatedBanner() {
  return (
    <div className="simulated-banner" role="note">
      <strong>Demo mode:</strong> the sample leads are fictional, and their Hot/Warm/Cold labels are simulated
      sample data (marked “Simulated”). New leads are classified by Gemini AI when the server has an AI key.
      Follow-up emails are SIMULATED: n8n marks them “sent”, but no real email reaches anyone.
    </div>
  )
}
