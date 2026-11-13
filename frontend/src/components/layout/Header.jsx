// Page title, plus the Log out button (Stage 8).
export default function Header({ title, subtitle, onLogout }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {onLogout && (
        <button type="button" className="button-secondary logout-button" onClick={onLogout}>
          Log out
        </button>
      )}
    </header>
  )
}
