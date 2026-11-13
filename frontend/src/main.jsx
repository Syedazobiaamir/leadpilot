import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import RequestPage from './components/public/RequestPage.jsx'

// Stage 9: two pages on one site.
//   /request  → the PUBLIC customer form (no login; the server protects it with a rate limit + honeypot)
//   anything else → the staff dashboard (behind the login)
// The host (vercel.json, and Vite locally) serves index.html for every path; this picks the page.
const isPublicForm = window.location.pathname.replace(/\/+$/, '') === '/request'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isPublicForm ? <RequestPage /> : <App />}
  </StrictMode>,
)
