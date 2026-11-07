// A colored label for Hot / Warm / Cold.
// Without a classification it shows the AI status instead: "Pending" (AI hasn't answered yet,
// or AI is off) or "AI failed" (the AI couldn't classify it; it can be retried).
export default function LeadBadge({ classification, qualificationStatus }) {
  if (classification) {
    return <span className={`badge badge-${classification.toLowerCase()}`}>{classification}</span>
  }
  if (qualificationStatus === 'failed') {
    return <span className="badge badge-failed">AI failed</span>
  }
  return <span className="badge badge-pending">Pending</span>
}
