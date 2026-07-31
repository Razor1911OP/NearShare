import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { reportClientError } from './lib/errorReport.js'

// Global error capture — never let a crash produce a silent blank page.
// Errors are logged to the console AND reported to the server so the
// Network Diagnostics panel can surface them.
window.addEventListener('error', (event) => {
  console.error('[NearShare] Uncaught error:', event.error || event.message)
  reportClientError({
    message: event.message,
    stack: event.error?.stack,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  console.error('[NearShare] Unhandled rejection:', reason)
  reportClientError({
    message: reason?.message || String(reason),
    stack: reason?.stack,
  })
})

createRoot(document.getElementById('root')).render(<App />)
