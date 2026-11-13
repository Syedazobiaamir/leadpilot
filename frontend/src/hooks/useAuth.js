// The login gate's state (Stage 8): are we logged in? Asks the server once at start, and listens
// for "session ended" (any request that got 401 NOT_LOGGED_IN, e.g. after 8 hours).
//
// status: 'checking'      asking the server
//         'loggedIn'      show the app
//         'loggedOut'     show the login page (message: why, if we know)
//         'notConfigured' the server has no staff password yet
//         'error'         the server can't be reached (message)
import { useCallback, useEffect, useState } from 'react'
import { SESSION_ENDED_EVENT, getSession, loginStaff, logoutStaff } from '../services/leadService.js'

export function useAuth() {
  const [state, setState] = useState({ status: 'checking', message: null })

  const check = useCallback(async () => {
    try {
      const session = await getSession()
      if (!session.configured) setState({ status: 'notConfigured', message: null })
      else setState({ status: session.loggedIn ? 'loggedIn' : 'loggedOut', message: null })
    } catch (err) {
      setState({ status: 'error', message: err.message || 'Could not reach the server.' })
    }
  }, [])

  useEffect(() => {
    let active = true
    getSession()
      .then((session) => {
        if (!active) return
        if (!session.configured) setState({ status: 'notConfigured', message: null })
        else setState({ status: session.loggedIn ? 'loggedIn' : 'loggedOut', message: null })
      })
      .catch((err) => {
        if (active) setState({ status: 'error', message: err.message || 'Could not reach the server.' })
      })
    return () => {
      active = false
    }
  }, [])

  // A request was refused with 401 NOT_LOGGED_IN: back to the login page, saying why.
  useEffect(() => {
    const onEnded = () => setState({ status: 'loggedOut', message: 'Your session ended. Please log in again.' })
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  }, [])

  const login = useCallback(async (password) => {
    const result = await loginStaff(password)
    if (result.success) setState({ status: 'loggedIn', message: null })
    return result
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutStaff()
    } finally {
      // Even if the server can't be reached, leave the app (the cookie expires anyway).
      setState({ status: 'loggedOut', message: 'You are logged out.' })
    }
  }, [])

  return { ...state, login, logout, retry: check }
}
