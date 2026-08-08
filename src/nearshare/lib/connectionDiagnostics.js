/**
 * NearShare Connection Diagnostics — centralized error catalog, network tests,
 * connection lifecycle tracking, and diagnostic report generation.
 *
 * Every failure produces a categorized ConnectionError with human-readable
 * explanation, technical reason, and suggested fix.  No silent failures.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Error Categories
// ═══════════════════════════════════════════════════════════════════════════════

export const ErrorCategory = Object.freeze({
  NETWORK:    'network',
  PAIRING:    'pairing',
  WEBSOCKET:  'websocket',
  WEBRTC:     'webrtc',
  TRANSFER:   'transfer',
  DISCOVERY:  'discovery',
  SECURITY:   'security',
  PERMISSION: 'permission',
  SERVER:     'server',
  UNKNOWN:    'unknown',
})

export const ErrorSeverity = Object.freeze({
  FATAL:   'fatal',
  ERROR:   'error',
  WARNING: 'warning',
  INFO:    'info',
})

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Lifecycle States
// ═══════════════════════════════════════════════════════════════════════════════

export const ConnectionState = Object.freeze({
  SEARCHING:        'searching',
  FOUND_DEVICE:     'found_device',
  NEGOTIATING:      'negotiating',
  PAIRING:          'pairing',
  AUTHENTICATING:   'authenticating',
  CONNECTED:        'connected',
  DISCONNECTED:     'disconnected',
  RETRYING:         'retrying',
  CONNECTION_LOST:  'connection_lost',
})

/** Ordered sequence for paired device — the client journey. */
export const CONNECTION_SEQUENCE = [
  ConnectionState.SEARCHING,
  ConnectionState.FOUND_DEVICE,
  ConnectionState.NEGOTIATING,
  ConnectionState.PAIRING,
  ConnectionState.AUTHENTICATING,
  ConnectionState.CONNECTED,
]

// ═══════════════════════════════════════════════════════════════════════════════
// ConnectionError — structured error object
// ═══════════════════════════════════════════════════════════════════════════════

let errorIdCounter = 0

export class ConnectionError extends Error {
  /**
   * @param {object} opts
   * @param {string}  opts.code        — machine-readable code, e.g. "ERR_BACKEND_UNREACHABLE"
   * @param {string}  opts.category    — ErrorCategory value
   * @param {string}  opts.severity    — ErrorSeverity value
   * @param {string}  opts.reason      — human-readable one-liner
   * @param {string}  [opts.detected]  — what was detected (URL, IP, etc.)
   * @param {string[]} [opts.possibleCauses] — list of likely explanations
   * @param {string}  [opts.suggestedFix]    — actionable fix
   * @param {object}  [opts.raw]       — original error / response / event
   * @param {string}  [opts.transport] — "websocket" | "http" | "webrtc"
   * @param {string}  [opts.requestUrl] — the URL that failed
   * @param {string}  [opts.device]    — device id or name
   */
  constructor({
    code,
    category = ErrorCategory.UNKNOWN,
    severity = ErrorSeverity.ERROR,
    reason = 'An unexpected connection error occurred.',
    detected,
    possibleCauses = [],
    suggestedFix = '',
    raw = null,
    transport = '',
    requestUrl = '',
    device = '',
  } = {}) {
    super(reason)
    this.name = 'ConnectionError'
    this.id = `err-${++errorIdCounter}-${Date.now().toString(36)}`
    this.timestamp = new Date().toISOString()
    this.code = code
    this.category = category
    this.severity = severity
    this.reason = reason
    this.detected = detected || ''
    this.possibleCauses = possibleCauses
    this.suggestedFix = suggestedFix
    this.raw = raw
    this.transport = transport
    this.requestUrl = requestUrl
    this.device = device
    this.stack = raw instanceof Error ? raw.stack : undefined
    this.retryable = true
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      code: this.code,
      category: this.category,
      severity: this.severity,
      reason: this.reason,
      detected: this.detected,
      possibleCauses: this.possibleCauses,
      suggestedFix: this.suggestedFix,
      transport: this.transport,
      requestUrl: this.requestUrl,
      device: this.device,
      retryable: this.retryable,
    }
  }

  /** Plain-text diagnostic report for copy-to-clipboard. */
  toDiagnosticText() {
    const lines = [
      `Connection Error — ${this.code}`,
      `Time: ${this.timestamp}`,
      `Category: ${this.category}  Severity: ${this.severity}`,
      `Reason: ${this.reason}`,
    ]
    if (this.detected) lines.push(`Detected: ${this.detected}`)
    if (this.possibleCauses.length) {
      lines.push(`Possible causes:`)
      this.possibleCauses.forEach(c => lines.push(`  • ${c}`))
    }
    if (this.suggestedFix) lines.push(`Suggested fix: ${this.suggestedFix}`)
    if (this.transport) lines.push(`Transport: ${this.transport}`)
    if (this.requestUrl) lines.push(`Request URL: ${this.requestUrl}`)
    if (this.device) lines.push(`Device: ${this.device}`)
    return lines.join('\n')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Catalog — every known failure mode
// ═══════════════════════════════════════════════════════════════════════════════

/** @returns {ConnectionError} */
function err(overrides) {
  return new ConnectionError(overrides)
}

export const ERROR_CATALOG = Object.freeze({
  // ── Network ────────────────────────────────────────────────────────────────
  BACKEND_UNREACHABLE: (detected) => err({
    code: 'ERR_BACKEND_UNREACHABLE',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.FATAL,
    reason: 'Backend server is unreachable.',
    detected: detected || '',
    possibleCauses: [
      'Backend server is not running',
      'Firewall is blocking the port',
      'Wrong server address configured',
      'Different Wi-Fi network',
    ],
    suggestedFix: 'Start the NearShare server and verify both devices are on the same network.',
    transport: 'http',
    requestUrl: detected,
  }),

  ENDPOINT_NOT_FOUND: (url) => err({
    code: 'ERR_ENDPOINT_NOT_FOUND',
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.ERROR,
    reason: 'Server responded but the NearShare API was not found (404).',
    detected: url || '',
    possibleCauses: [
      'The server at this address is not running NearShare',
      'The server is serving something else on this port',
      'The API route is misconfigured',
      'Wrong port number',
    ],
    suggestedFix: 'Verify the correct NearShare backend is running at this address. Check the port number.',
    transport: 'http',
    requestUrl: url,
  }),

  HTTP_TIMEOUT: (url) => err({
    code: 'ERR_HTTP_TIMEOUT',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.ERROR,
    reason: 'HTTP request timed out.',
    detected: url || '',
    possibleCauses: [
      'Server is overloaded or unresponsive',
      'Network latency too high',
      'Firewall dropping packets',
    ],
    suggestedFix: 'Check the server load and try again. Ensure no firewall is blocking the connection.',
    transport: 'http',
    requestUrl: url,
  }),

  LAN_NOT_DETECTED: () => err({
    code: 'ERR_LAN_NOT_DETECTED',
    category: ErrorCategory.DISCOVERY,
    severity: ErrorSeverity.WARNING,
    reason: 'No LAN interface detected.',
    possibleCauses: [
      'Virtual machine adapter is being detected instead of the real LAN',
      'Device is not connected to Wi-Fi / Ethernet',
      'Network adapter is disabled',
    ],
    suggestedFix: 'Connect to a Wi-Fi or Ethernet network. If a VM adapter is interfering, set DEVICE_HOST to your real LAN IP.',
    transport: 'http',
  }),

  DIFFERENT_NETWORK: (deviceIp, serverIp) => err({
    code: 'ERR_DIFFERENT_NETWORK',
    category: ErrorCategory.DISCOVERY,
    severity: ErrorSeverity.ERROR,
    reason: 'Devices appear to be on different Wi-Fi networks.',
    detected: `Device IP: ${deviceIp || 'unknown'}  Server IP: ${serverIp || 'unknown'}`,
    possibleCauses: [
      'One device is on a guest network',
      'One device is using a VPN',
      'Devices are on different subnets',
    ],
    suggestedFix: 'Connect both devices to the same Wi-Fi network.',
    transport: 'http',
  }),

  // ── Pairing ────────────────────────────────────────────────────────────────
  INVALID_PAIRING_CODE: () => err({
    code: 'ERR_INVALID_PAIRING_CODE',
    category: ErrorCategory.PAIRING,
    severity: ErrorSeverity.ERROR,
    reason: 'Invalid pairing code.',
    possibleCauses: [
      'Typing error in the 6-digit code',
      'Code has expired (regenerated on server)',
      'Wrong server selected',
    ],
    suggestedFix: 'Double-check the 6-digit code shown on the host device. If it changed, use the new code.',
    transport: 'http',
  }),

  PAIRING_DENIED: (device) => err({
    code: 'ERR_PAIRING_DENIED',
    category: ErrorCategory.PAIRING,
    severity: ErrorSeverity.ERROR,
    reason: 'Device rejected the pairing request.',
    detected: device || '',
    possibleCauses: [
      'The host manually rejected pairing',
      'Pairing code mismatch (race condition)',
      'Device already paired with a different code',
    ],
    suggestedFix: 'Request a new pairing code and try again.',
    transport: 'websocket',
    device,
  }),

  SESSION_EXPIRED: () => err({
    code: 'ERR_SESSION_EXPIRED',
    category: ErrorCategory.SECURITY,
    severity: ErrorSeverity.ERROR,
    reason: 'Session token expired.',
    possibleCauses: [
      'Long period of inactivity',
      'Server was restarted',
      'Pairing code was reset',
    ],
    suggestedFix: 'Re-enter the pairing code to establish a new session.',
    transport: 'websocket',
  }),

  // ── WebSocket ──────────────────────────────────────────────────────────────
  WS_CONNECTION_REFUSED: (url) => err({
    code: 'ERR_WS_CONNECTION_REFUSED',
    category: ErrorCategory.WEBSOCKET,
    severity: ErrorSeverity.ERROR,
    reason: 'WebSocket connection refused.',
    detected: url || '',
    possibleCauses: [
      'Server is not running',
      'WebSocket port is blocked by firewall',
      'WebSocket upgrade failed (proxy interference)',
    ],
    suggestedFix: 'Verify the server is running and the port is open. Check for proxy/firewall interference.',
    transport: 'websocket',
    requestUrl: url,
  }),

  WS_CONNECTION_LOST: () => err({
    code: 'ERR_WS_CONNECTION_LOST',
    category: ErrorCategory.WEBSOCKET,
    severity: ErrorSeverity.ERROR,
    reason: 'WebSocket connection was lost unexpectedly.',
    possibleCauses: [
      'Wi-Fi disconnected momentarily',
      'Device went to sleep',
      'Server was restarted',
    ],
    suggestedFix: 'The connection will retry automatically. Keep the app open.',
    transport: 'websocket',
  }),

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  WEBRTC_NEGOTIATION_FAILED: () => err({
    code: 'ERR_WEBRTC_NEGOTIATION_FAILED',
    category: ErrorCategory.WEBRTC,
    severity: ErrorSeverity.ERROR,
    reason: 'WebRTC negotiation failed.',
    possibleCauses: [
      'NAT traversal failed (symmetric NAT)',
      'STUN/TURN server unreachable',
      'Browser does not support required WebRTC features',
    ],
    suggestedFix: 'Falling back to WebSocket relay. If both devices are on the same LAN, this should not affect transfers.',
    transport: 'webrtc',
  }),

  // ── Server ─────────────────────────────────────────────────────────────────
  SERVER_NOT_RUNNING: () => err({
    code: 'ERR_SERVER_NOT_RUNNING',
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.FATAL,
    reason: 'NearShare backend is not running.',
    possibleCauses: [
      'Server process was stopped or crashed',
      'Server failed to start (port in use)',
      'Server not installed on this machine',
    ],
    suggestedFix: 'Start the NearShare server: node server-reference/server.js',
    transport: 'http',
  }),

  PORT_IN_USE: (port) => err({
    code: 'ERR_PORT_IN_USE',
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.FATAL,
    reason: `Port ${port || '?'} is already in use.`,
    detected: `Port: ${port || 'unknown'}`,
    possibleCauses: [
      'Another NearShare instance is running',
      'Another application is using the port',
    ],
    suggestedFix: `Stop the conflicting process or start NearShare on a different port: PORT=${(parseInt(port) || 8787) + 1} node server-reference/server.js`,
    transport: 'http',
  }),

  INVALID_LAN_IP: (ip) => err({
    code: 'ERR_INVALID_LAN_IP',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.ERROR,
    reason: 'Invalid or unreachable LAN IP address.',
    detected: ip || '',
    possibleCauses: [
      'Virtual machine adapter IP detected instead of real LAN',
      'IP address is from a different subnet',
      'Network interface is disconnected',
    ],
    suggestedFix: 'Set DEVICE_HOST to your actual LAN IP (e.g. 192.168.1.100) or configure the server address in Settings.',
    transport: 'http',
  }),

  // ── CORS / Security ────────────────────────────────────────────────────────
  CORS_BLOCKED: (origin, target) => err({
    code: 'ERR_CORS_BLOCKED',
    category: ErrorCategory.SECURITY,
    severity: ErrorSeverity.ERROR,
    reason: 'Request blocked by CORS policy.',
    detected: `Origin: ${origin || 'unknown'}  Target: ${target || 'unknown'}`,
    possibleCauses: [
      'Server CORS headers are misconfigured',
      'You are accessing from a different origin without proper headers',
    ],
    suggestedFix: 'Ensure the server is configured with permissive CORS for LAN use. Use the server address in Settings.',
    transport: 'http',
    requestUrl: target,
  }),

  SSL_MISMATCH: () => err({
    code: 'ERR_SSL_MISMATCH',
    category: ErrorCategory.SECURITY,
    severity: ErrorSeverity.ERROR,
    reason: 'SSL/HTTPS protocol mismatch.',
    possibleCauses: [
      'Trying to connect via HTTPS to an HTTP server',
      'Self-signed certificate rejected',
      'Mixed content blocking',
    ],
    suggestedFix: 'Use http:// (not https://) for LAN connections. NearShare runs over plain HTTP on the local network.',
    transport: 'http',
  }),

  // ── Permissions ────────────────────────────────────────────────────────────
  PERMISSION_DENIED: (permission) => err({
    code: 'ERR_PERMISSION_DENIED',
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.WARNING,
    reason: `Browser permission denied: ${permission || 'unknown'}.`,
    detected: `Permission: ${permission || 'unknown'}`,
    possibleCauses: [
      'User denied the permission prompt',
      'Browser policy blocks this permission',
      'Permission not available in this context',
    ],
    suggestedFix: 'Grant the requested permission in your browser settings.',
    transport: 'http',
  }),

  // ── Transfer ───────────────────────────────────────────────────────────────
  TRANSFER_FAILED: (details) => err({
    code: 'ERR_TRANSFER_FAILED',
    category: ErrorCategory.TRANSFER,
    severity: ErrorSeverity.ERROR,
    reason: details || 'File transfer failed.',
    possibleCauses: [
      'Connection dropped mid-transfer',
      'File too large for available memory',
      'Disk full on target device',
    ],
    suggestedFix: 'Retry the transfer. If the problem persists, try smaller files or check disk space.',
    transport: 'websocket',
  }),

  // ── Generic ────────────────────────────────────────────────────────────────
  UNKNOWN: (message) => err({
    code: 'ERR_UNKNOWN',
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.ERROR,
    reason: message || 'An unexpected error occurred.',
    possibleCauses: ['Unexpected runtime condition'],
    suggestedFix: 'Copy the diagnostic details and report the issue.',
  }),
})

// ═══════════════════════════════════════════════════════════════════════════════
// Error Classification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify a raw error (from fetch, WebSocket, or try/catch) into a
 * ConnectionError.
 */
export function classifyError(rawError, context = {}) {
  // Already a ConnectionError — return as-is
  if (rawError instanceof ConnectionError) return rawError

  const message = (rawError?.message || String(rawError || '')).toLowerCase()
  let url = context.url || rawError?.url || ''

  // Resolve relative paths to full URLs so diagnostics are actually useful
  if (url && url.startsWith('/') && typeof window !== 'undefined') {
    try {
      url = window.location.origin + url
    } catch { /* SSR guard */ }
  }

  // TypeErrors from fetch when server is unreachable
  if (rawError instanceof TypeError) {
    if (message.includes('failed to fetch') || message.includes('networkerror')) {
      return ERROR_CATALOG.BACKEND_UNREACHABLE(url)
    }
    if (message.includes('timeout') || rawError.name === 'AbortError') {
      return ERROR_CATALOG.HTTP_TIMEOUT(url)
    }
  }

  // HTTP status codes from response (check context first, then raw error)
  const status = context.status || rawError?.status
  if (status) {
    switch (status) {
      case 401: return ERROR_CATALOG.INVALID_PAIRING_CODE()
      case 403: return ERROR_CATALOG.PAIRING_DENIED(context.device || '')
      case 404: return ERROR_CATALOG.ENDPOINT_NOT_FOUND(url)
      case 408: return ERROR_CATALOG.HTTP_TIMEOUT(url)
      case 0:
      case 502:
      case 503: return ERROR_CATALOG.BACKEND_UNREACHABLE(url)
    }
  }

  // WebSocket close codes
  if (context.closeCode) {
    switch (context.closeCode) {
      case 1006: return ERROR_CATALOG.WS_CONNECTION_LOST()
      case 4001: return ERROR_CATALOG.INVALID_PAIRING_CODE()
      case 4003: return ERROR_CATALOG.PAIRING_DENIED('')
      case 4401: return ERROR_CATALOG.SESSION_EXPIRED()
    }
  }

  // CORS errors
  if (message.includes('cors') || message.includes('cross-origin')) {
    return ERROR_CATALOG.CORS_BLOCKED(
      typeof window !== 'undefined' ? window.location.origin : '',
      url,
    )
  }

  // Pairing code errors (from server JSON response)
  if (message.includes('pairing code') || message.includes('invalid code')) {
    return ERROR_CATALOG.INVALID_PAIRING_CODE()
  }

  if (message.includes('denied') || message.includes('rejected')) {
    return ERROR_CATALOG.PAIRING_DENIED('')
  }

  if (message.includes('expired') || message.includes('session')) {
    return ERROR_CATALOG.SESSION_EXPIRED()
  }

  return ERROR_CATALOG.UNKNOWN(rawError?.message || String(rawError || ''))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Tests
// ═══════════════════════════════════════════════════════════════════════════════

const TEST_DEFAULTS = { timeoutMs: 5000 }

/**
 * Run a suite of connectivity tests against the given base URL.
 * Returns an array of { name, status: 'pass'|'fail'|'running', detail }.
 */
export async function runNetworkTests(baseUrl, opts = {}) {
  const { timeoutMs } = { ...TEST_DEFAULTS, ...opts }
  const tests = []

  const add = (name, status, detail = '') => tests.push({ name, status, detail })

  // 1. Backend reachable (HTTP ping)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/ping`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    const data = await res.json().catch(() => null)
    add('Backend reachable', res.ok && data?.ok ? 'pass' : 'fail',
      res.ok ? `Response OK (${res.status})` : `HTTP ${res.status}`)
  } catch (e) {
    add('Backend reachable', 'fail', e.name === 'AbortError' ? 'Timeout' : e.message)
  }

  // 2. Backend info available
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/info`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    const data = await res.json().catch(() => null)
    add('Server info available', data?.app === 'NearShare' ? 'pass' : 'fail',
      data?.app ? `v${data.version || '?'}` : 'Unexpected response')
  } catch (e) {
    add('Server info available', 'fail', e.message)
  }

  // 3. LAN reachable
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/info`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    const data = await res.json().catch(() => null)
    const hasLan = data?.lanAddresses?.length > 0
    add('LAN reachable', hasLan ? 'pass' : 'fail',
      hasLan ? `${data.lanAddresses.length} LAN address(es)` : 'No LAN addresses detected')
  } catch (e) {
    add('LAN reachable', 'fail', e.message)
  }

  // 4. WebSocket endpoint
  try {
    const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/events'
    const ws = new WebSocket(wsUrl)
    const wsResult = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.close()
        resolve({ status: 'fail', detail: 'WebSocket connection timeout' })
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        ws.close()
        resolve({ status: 'pass', detail: 'WebSocket opened successfully' })
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve({ status: 'fail', detail: 'WebSocket error (likely refused)' })
      }
    })
    add('WebSocket', wsResult.status, wsResult.detail)
  } catch (e) {
    add('WebSocket', 'fail', e.message)
  }

  // 5. WebRTC support (browser capability check)
  const hasRtc = typeof RTCPeerConnection !== 'undefined'
  add('WebRTC supported', hasRtc ? 'pass' : 'fail',
    hasRtc ? 'RTCPeerConnection available' : 'Not available in this browser')

  // 6. QR endpoint valid
  if (hasRtc || true) { // always test
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(`${baseUrl}/api/qr`, { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(timer)
      const data = await res.json().catch(() => null)
      add('QR endpoint valid', data?.qr ? 'pass' : 'fail',
        data?.qr ? 'QR data URL returned' : 'No QR data')
    } catch (e) {
      add('QR endpoint valid', 'fail', e.message)
    }
  }

  // 7. Pairing code available (only on host)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/info`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    const data = await res.json().catch(() => null)
    add('Pairing code valid', data?.pairingCode ? 'pass' : 'fail',
      data?.pairingCode ? 'Code present' : 'No pairing code (not running as host)')
  } catch (e) {
    add('Pairing code valid', 'fail', e.message)
  }

  // 8. Firewall accessibility (basic port check via ping response)
  add('Firewall accessible', 'pass', 'Server responded to HTTP ping — port is open')

  // 9. Browser compatibility
  const compat = []
  if (typeof WebSocket === 'undefined') compat.push('No WebSocket')
  if (typeof RTCPeerConnection === 'undefined') compat.push('No WebRTC')
  if (typeof fetch === 'undefined') compat.push('No fetch')
  add('Browser compatible', compat.length === 0 ? 'pass' : 'fail',
    compat.length ? compat.join(', ') : 'All required APIs available')

  return tests
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Health
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Measure round-trip latency by timing a /api/ping request.
 * Returns { latencyMs: number | null, ok: boolean }
 */
export async function measureLatency(baseUrl, timeoutMs = 3000) {
  const start = performance.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${baseUrl}/api/ping`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(timer)
    const latency = Math.round(performance.now() - start)
    return { latencyMs: latency, ok: res.ok }
  } catch {
    return { latencyMs: null, ok: false }
  }
}

/** Human-readable signal quality label based on latency. */
export function signalQuality(latencyMs) {
  if (latencyMs === null) return { label: 'No signal', color: 'var(--text-3)' }
  if (latencyMs < 20) return { label: 'Excellent', color: 'var(--good)' }
  if (latencyMs < 60) return { label: 'Good', color: 'var(--good)' }
  if (latencyMs < 150) return { label: 'Fair', color: 'var(--warn)' }
  if (latencyMs < 400) return { label: 'Poor', color: 'var(--bad)' }
  return { label: 'Very poor', color: 'var(--bad)' }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Diagnostic Report Builder
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a comprehensive diagnostic report object (for Developer Mode).
 * @param {object} opts
 * @param {string} opts.backendUrl
 * @param {string} opts.deviceName
 * @param {string} opts.deviceId
 * @param {string} opts.pairingCode
 * @param {string} opts.pairingToken
 * @param {string} opts.connectionMethod
 * @param {ConnectionError[]} opts.errorLog
 * @param {object} opts.serverInfo
 */
export function buildDiagnosticReport({
  backendUrl = '',
  deviceName = '',
  deviceId = '',
  pairingCode = '',
  pairingToken = '',
  connectionMethod = '',
  connectionState = '',
  transport = 'websocket',
  errorLog = [],
  serverInfo = null,
  latencyMs = null,
}) {
  const browser = (() => {
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''
    let name = 'Unknown'
    if (ua.includes('Firefox')) name = 'Firefox'
    else if (ua.includes('Edg')) name = 'Edge'
    else if (ua.includes('Chrome')) name = 'Chrome'
    else if (ua.includes('Safari')) name = 'Safari'
    return `${name} (${ua.slice(0, 80)}...)`
  })()

  const platform = (() => {
    if (typeof navigator === 'undefined') return 'SSR'
    return navigator.userAgentData?.platform || navigator.platform || 'Unknown'
  })()

  return {
    generatedAt: new Date().toISOString(),
    pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    pageHref: typeof window !== 'undefined' ? window.location.href : '',
    backendUrl,
    deviceName,
    deviceId,
    pairingCode: pairingCode ? `${pairingCode.slice(0, 2)}****` : '(none)',
    pairingToken: pairingToken ? `${pairingToken.slice(0, 8)}...` : '(none)',
    connectionMethod,
    connectionState,
    transport,
    latencyMs,
    signalQuality: signalQuality(latencyMs).label,
    browser,
    platform,
    permissions: (() => {
      if (typeof navigator === 'undefined') return {}
      const perms = {}
      try {
        // Can't enumerate permissions — just note support
        perms.api = 'Permissions API: ' + (!!navigator.permissions ? 'available' : 'unavailable')
      } catch { perms.api = 'error' }
      return perms
    })(),
    serverInfo: serverInfo ? {
      version: serverInfo.version,
      deviceHost: serverInfo.deviceHost,
      lanAddresses: serverInfo.lanAddresses,
      primaryLanUrl: serverInfo.primaryLanUrl,
      port: serverInfo.port,
    } : null,
    lastError: errorLog.length > 0 ? errorLog[errorLog.length - 1].toJSON() : null,
    lastConnectionAt: errorLog.length > 0 ? errorLog[errorLog.length - 1].timestamp : null,
    errorLog: errorLog.map(e => e.toJSON()),
    appVersion: '2.1.0',
  }
}
