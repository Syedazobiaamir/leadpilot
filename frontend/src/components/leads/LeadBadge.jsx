// A colored label for Hot / Warm / Cold. A lead with no classification yet shows "Pending".
export default function LeadBadge({ classification }) {
  const label = classification ?? 'Pending'
  return <span className={`badge badge-${label.toLowerCase()}`}>{label}</span>
}
