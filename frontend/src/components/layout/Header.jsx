export default function Header({ title, subtitle }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </header>
  )
}
