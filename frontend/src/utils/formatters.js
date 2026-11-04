// Small display helpers. These are "pure functions": same input, same output,
// with no side effects, which makes them easy to test.

/** Turns "5125550147" or "+1 512-555-0147" into "(512) 555-0147". */
export function formatPhone(phone) {
  if (!phone) return ''
  let digits = String(phone).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length !== 10) return String(phone) // can't format it, so show it unchanged
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/** "2026-11-03T14:05:00Z" -> "Nov 3, 2026, 2:05 PM" (in the viewer's time zone). */
export function formatDateTime(isoString) {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** 0.4567 -> "45.7%" */
export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return '0%'
  return `${Math.round(ratio * 1000) / 10}%`
}
