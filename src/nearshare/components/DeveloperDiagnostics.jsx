import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import {
  signalQuality,
  buildDiagnosticReport,
  runNetworkTests,
} from '../lib/connectionDiagnostics.js'
import { getServerBase, serverLabel } from '../lib/serverUrl.js'
import { copyTextToClipboard } from '../lib/clipboard.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d.getTime())
    ? String(ts)
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Pill({ tone = 'muted', children }) {
  const styles = {
    muted: { background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid var(--border)' },
    good:  { background: 'rgba(141,186,164,0.12)', color: 'var(--good)', border: '1px solid rgba(141,186,164,0.30)' },
    bad:   { background: 'rgba(217,96,95,0.12)', color: 'var(--bad)', border: '1px solid rgba(217,96,95,0.30)' },
    warn:  { background: 'rgba(217,165,102,0.12)', color: 'var(--warn)', border: '1px solid rgba(217,165,102,0.30)' },
    brand: { background: 'rgba(129,154,148,0.12)', color: 'var(--brand)', border: '1px solid rgba(129,154,148,0.30)' },
  }[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: '0.70rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        ...styles,
      }}
    >
      {children}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="ns-label" style={{ marginBottom: 0 }}>{title}</span>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{
        color: 'var(--text-3)',
        fontSize: '0.73rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        minWidth: 120,
        flexShrink: 0,
        paddingTop: 1,
      }}>
        {label}
      </span>
      <span style={{
        color: 'var(--text)',
        fontSize: '0.82rem',
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
        wordBreak: 'break-all',
        lineHeight: 1.45,
      }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

// ─── Error Log Entry ─────────────────────────────────────────────────────────

function ErrorEntry({ err }) {
  const [expanded, setExpanded] = useState(false)

  const sevColor = {
    FATAL: 'var(--bad)',
    ERROR: 'var(--bad)',
    WARNING: 'var(--warn)',
    INFO: 'var(--info)',
  }[err.severity] || 'var(--text-2)'

  return (
    <div
      style={{
        background: 'rgba(217,96,95,0.06)',
        border: '1px solid rgba(217,96,95,0.20)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded((p) => !p)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
        aria-expanded={expanded}
      >
        {/* Red dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: sevColor,
            flexShrink: 0,
          }}
        />
        <span style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.76rem',
          fontWeight: 700,
          color: 'var(--bad)',
          flexShrink: 0,
        }}>
          {err.code}
        </span>
        <span style={{
          flex: 1,
          fontSize: '0.80rem',
          color: 'var(--text-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {err.reason}
        </span>
        <span style={{
          color: 'var(--text-3)',
          fontSize: '0.68rem',
          flexShrink: 0,
        }}>
          {formatTime(err.timestamp)}
        </span>
        <span style={{
          color: 'var(--text-3)',
          fontSize: '0.7rem',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          ▾
        </span>
      </button>

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                padding: '10px 12px 12px',
                borderTop: '1px solid rgba(217,96,95,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <InfoRow label="Timestamp" value={err.timestamp} mono />
              <InfoRow label="Category" value={err.category} />
              <InfoRow label="Severity" value={err.severity} />
              {err.detected && <InfoRow label="Detected" value={err.detected} />}
              {err.possibleCauses && err.possibleCauses.length > 0 && (
                <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{
                    color: 'var(--text-3)',
                    fontSize: '0.73rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    display: 'block',
                    marginBottom: 4,
                  }}>
                    Possible Causes
                  </span>
                  {err.possibleCauses.map((c, i) => (
                    <div key={i} style={{ color: 'var(--text-2)', fontSize: '0.78rem', lineHeight: 1.5, paddingLeft: 8 }}>
                      • {c}
                    </div>
                  ))}
                </div>
              )}
              {err.suggestedFix && <InfoRow label="Suggested Fix" value={err.suggestedFix} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * DeveloperDiagnostics — expandable developer panel with connection info,
 * browser details, error log, and network tests. Toggled via the
 * `developerMode` flag in AppContext.
 */
export default function DeveloperDiagnostics() {
  const [state, dispatch] = useApp()
  const [testResults, setTestResults] = useState(null)
  const [testRunning, setTestRunning] = useState(false)

  const open = state.developerMode

  const toggle = useCallback(() => {
    dispatch({ type: 'TOGGLE_DEVELOPER_MODE' })
  }, [dispatch])

  const clearErrors = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR_LOG' })
  }, [dispatch])

  const sigQuality = signalQuality(state.latencyMs)

  const runTests = useCallback(async () => {
    setTestRunning(true)
    setTestResults(null)
    try {
      const base = getServerBase() || window.location.origin
      const results = await runNetworkTests(base)
      setTestResults(results)
    } catch {
      setTestResults([{ name: 'Test Runner', status: 'fail', detail: 'Could not execute network tests.' }])
    } finally {
      setTestRunning(false)
    }
  }, [])

  const copyReport = useCallback(async () => {
    const report = buildDiagnosticReport({
      backendUrl: serverLabel(),
      deviceName: state.deviceName,
      deviceId: state.deviceId,
      pairingCode: state.pairingCode,
      pairingToken: state.pairingCode,
      connectionMethod: state.serverInfo?.primaryLanUrl ? 'LAN' : 'same-origin',
      connectionState: state.connectionState,
      transport: 'websocket',
      errorLog: state.errorLog,
      serverInfo: state.serverInfo,
      latencyMs: state.latencyMs,
    })

    try {
      const ok = await copyTextToClipboard(JSON.stringify(report, null, 2))
      dispatch({
        type: 'ADD_TOAST',
        payload: { message: ok ? 'Diagnostic report copied to clipboard' : 'Could not copy — select text manually', type: ok ? 'good' : 'bad' },
      })
    } catch {
      dispatch({
        type: 'ADD_TOAST',
        payload: { message: 'Could not copy — select text manually', type: 'bad' },
      })
    }
  }, [state, dispatch])

  const browserInfo = (() => {
    const ua = navigator.userAgent || ''
    let name = 'Unknown'
    if (ua.includes('Firefox')) name = 'Firefox'
    else if (ua.includes('Edg')) name = 'Edge'
    else if (ua.includes('Chrome')) name = 'Chrome'
    else if (ua.includes('Safari')) name = 'Safari'
    return `${name}`
  })()

  const platformInfo = navigator.userAgentData?.platform || navigator.platform || 'Unknown'

  const permInfo = (() => {
    const parts = []
    if (navigator.permissions) parts.push('Permissions API available')
    else parts.push('Permissions API unavailable')
    try {
      // @ts-ignore
      if (navigator.connection) parts.push(`Network: ${navigator.connection.effectiveType || 'unknown'}`)
    } catch { /* ignore */ }
    return parts.join(' · ')
  })()

  // ── Keyboard ─────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') toggle() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, toggle])

  const serverBase = getServerBase() || (typeof window !== 'undefined' ? window.location.origin : '')

  return (
    <>
      {/* ── Toggle Button ───────────────────────────────────────────────── */}
      <motion.button
        className="ns-btn ghost sm"
        onClick={toggle}
        whileTap={{ scale: 0.94 }}
        title={open ? 'Close developer diagnostics' : 'Open developer diagnostics'}
        aria-label={open ? 'Close developer diagnostics' : 'Open developer diagnostics'}
        style={{
          fontSize: '0.74rem',
          minHeight: 30,
          padding: '0 10px',
          color: open ? 'var(--brand-2)' : 'var(--text-3)',
          borderColor: open ? 'rgba(233,131,137,0.35)' : undefined,
        }}
      >
        ⚙ Dev
      </motion.button>

      {/* ── Panel Overlay ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Scrim */}
            <motion.div
              key="dev-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={toggle}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 140,
                background: 'rgba(6,9,18,0.80)',
              }}
            />

            {/* Modal */}
            <motion.div
              key="dev-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Developer Diagnostics"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                zIndex: 141,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(640px, 94vw)',
                maxHeight: '90vh',
                overflowY: 'auto',
                background: 'var(--surface-hi)',
                border: '1px solid var(--border-hi)',
                borderRadius: 'var(--r-lg)',
                boxShadow: 'var(--shadow)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                  flexShrink: 0,
                  position: 'sticky',
                  top: 0,
                  background: 'var(--surface-hi)',
                  borderTopLeftRadius: 'var(--r-lg)',
                  borderTopRightRadius: 'var(--r-lg)',
                  zIndex: 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2rem' }}>🔬</span>
                  <h2 className="ns-display" style={{ margin: 0, fontSize: '1rem' }}>Developer Diagnostics</h2>
                </div>
                <button
                  className="ns-btn ghost sm icon"
                  onClick={toggle}
                  aria-label="Close diagnostics"
                  style={{ width: 36, height: 36, minHeight: 36, borderRadius: 10, padding: 0 }}
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 22, overflowY: 'auto' }}>

                {/* ── Connection ─────────────────────────────────────────── */}
                <Section title="🔗 Connection">
                  <InfoRow label="Backend URL" value={serverBase} mono />
                  <InfoRow label="Server Label" value={serverLabel()} />
                  {state.serverInfo && (
                    <>
                      {state.serverInfo.lanAddresses && state.serverInfo.lanAddresses.length > 0 && (
                        <InfoRow
                          label="LAN IPs"
                          value={state.serverInfo.lanAddresses.join(', ')}
                          mono
                        />
                      )}
                      {state.serverInfo.primaryLanUrl && (
                        <InfoRow label="Primary LAN URL" value={state.serverInfo.primaryLanUrl} mono />
                      )}
                      {state.serverInfo.deviceHost && (
                        <InfoRow label="Device Host" value={state.serverInfo.deviceHost} mono />
                      )}
                      {state.serverInfo.port && (
                        <InfoRow label="Port" value={String(state.serverInfo.port)} />
                      )}
                      {state.serverInfo.version && (
                        <InfoRow label="Server Version" value={state.serverInfo.version} />
                      )}
                    </>
                  )}
                  <InfoRow
                    label="Pairing Code"
                    value={state.pairingCode || '(none)'}
                    mono
                  />
                  <InfoRow
                    label="Connection State"
                    value={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {state.connectionState}
                        <Pill
                          tone={
                            state.connectionState === 'CONNECTED' ? 'good'
                            : state.connectionState === 'DISCONNECTED' ? 'muted'
                            : 'warn'
                          }
                        >
                          {state.connectionState}
                        </Pill>
                      </span>
                    }
                  />
                  <InfoRow
                    label="Socket Status"
                    value={state.socketStatus || '—'}
                  />
                  <InfoRow
                    label="Latency"
                    value={state.latencyMs !== null ? `${state.latencyMs} ms` : '—'}
                    mono
                  />
                  <InfoRow
                    label="Signal Quality"
                    value={
                      <span style={{ color: sigQuality.color, fontWeight: 700 }}>
                        {sigQuality.label}
                      </span>
                    }
                  />
                  <InfoRow label="Device ID" value={state.deviceId} mono />
                  <InfoRow label="Device Name" value={state.deviceName} />
                </Section>

                {/* ── Browser & Platform ─────────────────────────────────── */}
                <Section title="🌐 Browser & Platform">
                  <InfoRow label="Browser" value={browserInfo} />
                  <InfoRow label="Platform" value={platformInfo} />
                  <InfoRow
                    label="User Agent"
                    value={navigator.userAgent || '—'}
                    mono
                  />
                  <InfoRow label="Page Origin" value={window.location.origin} mono />
                  <InfoRow label="Page Href" value={window.location.href} mono />
                  <InfoRow label="Permissions" value={permInfo} />
                  <InfoRow
                    label="Online"
                    value={navigator.onLine ? 'Yes' : 'No'}
                  />
                </Section>

                {/* ── Error Log ──────────────────────────────────────────── */}
                <Section title="⚠ Error Log">
                  {state.errorLog.length === 0 ? (
                    <div style={{ color: 'var(--good)', fontSize: '0.84rem', padding: '8px 0' }}>
                      ✓ No errors logged.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {state.errorLog.map((err) => (
                        <ErrorEntry key={err.id || err.timestamp} err={err} />
                      ))}
                    </div>
                  )}
                </Section>

                {/* ── Network Tests ──────────────────────────────────────── */}
                <Section title="🔄 Network Tests">
                  {testResults ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {testResults.map((t, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '8px 12px',
                            borderRadius: 10,
                            background: t.status === 'pass' ? 'rgba(141,186,164,0.08)' : 'rgba(217,96,95,0.08)',
                            border: `1px solid ${t.status === 'pass' ? 'rgba(141,186,164,0.22)' : 'rgba(217,96,95,0.22)'}`,
                          }}
                        >
                          <span style={{
                            color: t.status === 'pass' ? 'var(--good)' : 'var(--bad)',
                            fontWeight: 800,
                            fontSize: '0.9rem',
                            flexShrink: 0,
                            marginTop: 1,
                          }}>
                            {t.status === 'pass' ? '✓' : '✗'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              color: t.status === 'pass' ? 'var(--good)' : 'var(--bad)',
                            }}>
                              {t.name}
                            </div>
                            {t.detail && (
                              <div style={{
                                color: 'var(--text-3)',
                                fontSize: '0.72rem',
                                marginTop: 2,
                                lineHeight: 1.4,
                                wordBreak: 'break-all',
                              }}>
                                {t.detail}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <motion.button
                    className="ns-btn ghost"
                    onClick={runTests}
                    whileTap={{ scale: 0.97 }}
                    disabled={testRunning}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {testRunning ? 'Running tests…' : testResults ? 'Re-run Tests' : 'Run Tests'}
                  </motion.button>
                </Section>

                {/* ── Actions ────────────────────────────────────────────── */}
                <div style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <motion.button
                    className="ns-btn primary"
                    whileTap={{ scale: 0.97 }}
                    onClick={copyReport}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    📋 Copy Report as JSON
                  </motion.button>
                  <motion.button
                    className="ns-btn ghost"
                    whileTap={{ scale: 0.97 }}
                    onClick={clearErrors}
                    disabled={state.errorLog.length === 0}
                    style={{
                      width: '100%',
                      justifyContent: 'center',
                      color: state.errorLog.length > 0 ? 'var(--bad)' : undefined,
                      borderColor: state.errorLog.length > 0 ? 'rgba(217,96,95,0.25)' : undefined,
                    }}
                  >
                    Clear Error Log ({state.errorLog.length})
                  </motion.button>
                  <motion.button
                    className="ns-btn ghost"
                    whileTap={{ scale: 0.97 }}
                    onClick={toggle}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Close
                  </motion.button>
                </div>

                <div style={{ height: 8 }} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
