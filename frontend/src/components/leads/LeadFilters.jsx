// "Controlled" inputs: App owns the filter values and this component only displays
// them and reports changes. That keeps one source of truth.
const CLASSIFICATIONS = ['All', 'Hot', 'Warm', 'Cold', 'Pending']
const STATUSES = ['All', 'New', 'Contacted', 'Qualified', 'Won', 'Lost']

export default function LeadFilters({ filters, onChange }) {
  const update = (field) => (event) => onChange({ ...filters, [field]: event.target.value })

  return (
    <div className="filters" role="search">
      <div className="field">
        <label htmlFor="filter-search">Search</label>
        <input
          id="filter-search"
          type="search"
          placeholder="Name, email, service or ZIP"
          value={filters.search}
          onChange={update('search')}
        />
      </div>
      <div className="field">
        <label htmlFor="filter-class">Classification</label>
        <select id="filter-class" value={filters.classification} onChange={update('classification')}>
          {CLASSIFICATIONS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-status">Status</label>
        <select id="filter-status" value={filters.status} onChange={update('status')}>
          {STATUSES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
