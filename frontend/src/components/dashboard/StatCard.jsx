// One number on the dashboard, such as "Hot leads: 4".
export default function StatCard({ label, value, hint, tone = 'neutral' }) {
  return (
    <div className={`card stat-card tone-${tone}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint && <p className="stat-hint muted">{hint}</p>}
    </div>
  )
}
