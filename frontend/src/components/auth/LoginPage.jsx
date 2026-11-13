import { useState } from 'react'

// Staff login (Stage 8). One password for the contractor's staff (decision D1A).
// The password goes straight to the server; nothing is stored in the browser except the
// HttpOnly session cookie the server sets (JavaScript can't read it).
export default function LoginPage({ onLogin, message, notConfigured = false }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!password) {
      setError('Enter the staff password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await onLogin(password)
      if (!result.success) {
        setError(result.error || 'Login failed.')
        setPassword('')
      }
    } catch (err) {
      setError(err.message || 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="card login-card" aria-labelledby="login-title">
        <h1 id="login-title">LeadPilot</h1>
        <p className="muted">Staff login</p>

        {notConfigured ? (
          <p className="form-error" role="alert">
            Login is not set up on this server yet. In the backend folder, run <code>npm run auth:set-password</code>, then
            restart the backend.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate aria-label="Staff login">
            {message && (
              <p className="muted" role="status">
                {message}
              </p>
            )}
            <div className="field">
              <label htmlFor="staff-password">Password</label>
              <input
                id="staff-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                autoFocus
              />
            </div>
            {error && (
              <p id="login-error" className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
