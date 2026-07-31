/**
 * Reports client-side errors to the host server so the Network Diagnostics
 * panel can surface why a device shows a blank screen. Never throws.
 */
export function reportClientError({ message, stack, url }) {
  try {
    const payload = {
      message: String(message || 'Unknown client error').slice(0, 500),
      stack: String(stack || '').slice(0, 4000),
      url: String(
        url || (typeof window !== 'undefined' ? window.location.href : '') || 'unknown',
      ).slice(0, 300),
    }
    fetch('/api/diagnose/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  } catch { /* the reporter must never break the app */ }
}
