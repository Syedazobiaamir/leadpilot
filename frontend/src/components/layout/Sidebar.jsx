// Main navigation. Instead of a router library, App keeps the current page in state
// and this component just reports which page was clicked.
// pages: [{ id, label }]
export default function Sidebar({ pages, currentPage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">LP</span>
        <span className="brand-name">LeadPilot</span>
      </div>
      <nav aria-label="Main">
        <ul className="nav-list">
          {pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                className={`nav-item ${currentPage === page.id ? 'active' : ''}`}
                aria-current={currentPage === page.id ? 'page' : undefined}
                onClick={() => onNavigate(page.id)}
              >
                {page.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
