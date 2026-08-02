/**
 * Central place that decides which NearShare backend the UI talks to.
 *
 * Priority:
 *   1. localStorage override (set from the UI, e.g. http://192.168.1.20:3000)
 *   2. VITE_NEARSHARE_SERVER build-time env
 *   3. same origin (default when the UI is served by the Fastify host)
 */

const STORAGE_KEY = 'nearshare:serverUrl'

const listeners = new Set()

function envBase() {
  try {
    return (import.meta.env?.VITE_NEARSHARE_SERVER || '').trim()
  } catch {
    return ''
  }
}

export function normalizeBase(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let withScheme = raw
  if (!/^https?:\/\//i.test(withScheme)) withScheme = `http://${withScheme}`
  try {
    const u = new URL(withScheme)
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

/** Base origin for the backend, or '' when using the current origin. */
export function getServerBase() {
  if (typeof window === 'undefined') return ''
  let stored = ''
  try {
    stored = localStorage.getItem(STORAGE_KEY) || ''
  } catch { /* private mode */ }
  return normalizeBase(stored) || normalizeBase(envBase())
}

export function setServerBase(value) {
  const normalized = normalizeBase(value)
  try {
    if (normalized) localStorage.setItem(STORAGE_KEY, normalized)
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
  listeners.forEach((fn) => {
    try { fn(normalized) } catch { /* ignore */ }
  })
  return normalized
}

export function onServerBaseChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Absolute (or same-origin) URL for an API path like '/api/info'. */
export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = getServerBase()
  return base ? `${base}${p}` : p
}

/** WebSocket URL for a path like '/events'. */
export function wsUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = getServerBase()
  if (base) return `${base.replace(/^http/i, 'ws')}${p}`
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}${p}`
}

/** Human label for the currently targeted server. */
export function serverLabel() {
  const base = getServerBase()
  if (base) return base
  if (typeof window === 'undefined') return 'same origin'
  return window.location.origin
}
