import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import { copyTextToClipboard } from '../lib/clipboard.js'
import { apiUrl } from '../lib/serverUrl'

const SPIN_CSS = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

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

function SummaryCell({ label, value, bad = false }) {
  return (
    <div
      style={{
        padding: '9px 12px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: `1px solid ${bad ? 'rgba(217,96,95,0.35)' : 'var(--border)'}`,
        minWidth: 0,
      }}
    >
      <div style={{ color: 'var(--text-3)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: '0.84rem',
          fontWeight: 700,
          color: bad ? 'var(--bad)' : 'var(--text)',
          marginTop: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
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

/**
 * NetworkDiagnostics — live LAN troubleshooting panel.
 * Shows the URL to open on other devices, which devices actually loaded the
 * app (heartbeat), every network interface, firewall state, and a copyable
 * JSON report for support.
 */
export default function NetworkDiagnostics({ onClose }) {
  const [state, dispatch] = useApp()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ping, setPing] = useState({})

  const run = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/diagnose'), { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
      setReport(data)
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load diagnostics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    run()
    const timer = setInterval(run, 4000)
    return () => clearInterval(timer)
  }, [run])

  const testUrl = useCallback(async (url) => {
    setPing((p) => ({ ...p, [url]: 'testing' }))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3500)
    try {
      const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal })
      const body = await res.json().catch(() => ({}))
      setPing((p) => ({ ...p, [url]: body.ok === true ? 'ok' : 'fail' }))
    } catch {
      setPing((p) => ({ ...p, [url]: 'fail' }))
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const copyText = useCallback(async (text, label) => {
    const ok = await copyTextToClipboard(text)
    dispatch({
      type: 'ADD_TOAST',
      payload: {
        message: ok
          ? `${label} copied to clipboard`
          : `Could not copy ${label.toLowerCase()} automatically — select the text manually`,
        type: ok ? 'good' : 'bad',
      },
    })
  }, [dispatch])

  const copyReport = useCallback(() => {
    const payload = {
      generatedAt: new Date().toISOString(),
      pageOrigin: window.location.origin,
      pageHref: window.location.href,
      deviceName: state.deviceName,
      report,
    }
    copyText(JSON.stringify(payload, null, 2), 'Diagnostic report')
  }, [report, state.deviceName, copyText])

  const port = report?.port ?? 8787
  const urls = report?.candidateUrls ?? []
  const ifaces = report?.interfaces ?? []
  const hits = report?.hits ?? []
  const errors = report?.clientErrors ?? []
  const firewall = report?.firewall
  const fwCommand = `netsh advfirewall firewall add rule name="NearShare ${port}" dir=in action=allow protocol=TCP localport=${port}`

  return (
    <>
      <style>{SPIN_CSS}</style>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 150,
          background: 'rgba(6,9,18,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '18px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 680,
            maxHeight: '88vh',
            overflowY: 'auto',
            background: 'var(--surface-hi)',
            border: '1px solid var(--border-hi)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow)',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '1.3rem' }}>🔧</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>Network diagnostics</div>
                <div style={{ color: 'var(--text-3)', fontSize: '0.76rem' }}>
                  Auto-refreshes · report is generated for support
                </div>
              </div>
            </div>
            <motion.button
              className="ns-btn ghost icon sm"
              onClick={onClose}
              whileTap={{ scale: 0.9 }}
              aria-label="Close diagnostics"
              style={{ minHeight: 'unset', width: 34, height: 34, borderRadius: 10 }}
            >
              ×
            </motion.button>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(217,96,95,0.10)',
                border: '1px solid rgba(217,96,95,0.30)',
                color: 'var(--bad)',
                fontSize: '0.85rem',
                lineHeight: 1.5,
              }}
            >
              ✕ {error} — is the server running? (npm start, or npm run dev:server)
            </div>
          )}

          {loading && !report && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-2)', fontSize: '0.9rem' }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: '2.5px solid rgba(129,154,148,0.20)',
                  borderTopColor: 'var(--brand)',
                  animation: 'ns-spin 0.7s linear infinite',
                }}
              />
              Collecting diagnostics…
            </div>
          )}

          {report && (
            <>
              {/* ── Primary URL ─────────────────────────────────────────── */}
              <Section title="1 · Open this on the other device (same Wi-Fi)">
                {report.primaryLanUrl ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <a
                      href={report.primaryLanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        color: 'var(--brand)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        background: 'rgba(129,154,148,0.10)',
                        border: '1px solid rgba(129,154,148,0.30)',
                        borderRadius: 10,
                        padding: '8px 14px',
                      }}
                    >
                      {report.primaryLanUrl}
                    </a>
                    <motion.button
                      className="ns-btn sm ghost"
                      whileTap={{ scale: 0.94 }}
                      onClick={() => copyText(report.primaryLanUrl, 'URL')}
                      style={{ fontSize: '0.76rem' }}
                    >
                      📋 Copy
                    </motion.button>
                  </div>
                ) : (
                  <div style={{ color: 'var(--bad)', fontSize: '0.85rem' }}>
                    No LAN URL detected — see report below.
                  </div>
                )}
                <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', lineHeight: 1.5 }}>
                  Scan the QR on the Pair screen or open this address. When the page loads on that device,
                  it automatically appears in section 4.
                </div>
              </Section>

              {/* ── Server summary ──────────────────────────────────────── */}
              <Section title="2 · Server status">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                  <SummaryCell label="Host" value={report.hostname} />
                  <SummaryCell label="Platform" value={`${report.platform} ${report.release}`} />
                  <SummaryCell label="Port" value={String(report.port)} />
                  <SummaryCell label="Started" value={formatTime(report.serverStartedAt)} />
                  <SummaryCell
                    label="Build (dist)"
                    value={report.dist?.exists ? `present (${formatTime(report.dist.modifiedAt)})` : 'MISSING — run npm run build'}
                    bad={!report.dist?.exists}
                  />
                  <SummaryCell
                    label="Listen probe"
                    value={report.listenProbe?.ok ? `ok (ephemeral :${report.listenProbe.port})` : `FAILED (${report.listenProbe?.error})`}
                    bad={!report.listenProbe?.ok}
                  />
                </div>
              </Section>

              {/* ── Candidate URLs ──────────────────────────────────────── */}
              <Section title="3 · Reachability test (from this device)">
                {urls.length === 0 ? (
                  <div style={{ color: 'var(--bad)', fontSize: '0.85rem' }}>
                    No LAN URLs found. Check the Wi-Fi connection and run again.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {urls.map((url) => {
                      const status = ping[url]
                      return (
                        <div
                          key={url}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: '0.82rem',
                              color: 'var(--text-2)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {url}
                          </span>
                          {status === 'testing' ? (
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                border: '2px solid rgba(129,154,148,0.20)',
                                borderTopColor: 'var(--brand)',
                                animation: 'ns-spin 0.7s linear infinite',
                              }}
                            />
                          ) : status === 'ok' ? (
                            <span style={{ color: 'var(--good)', fontWeight: 800 }}>✓ reachable</span>
                          ) : status === 'fail' ? (
                            <span style={{ color: 'var(--bad)', fontWeight: 700 }}>✕ unreachable</span>
                          ) : null}
                          <motion.button
                            className="ns-btn sm ghost"
                            whileTap={{ scale: 0.94 }}
                            onClick={() => testUrl(url)}
                            style={{ fontSize: '0.74rem', minHeight: 30 }}
                          >
                            Test
                          </motion.button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ color: 'var(--text-3)', fontSize: '0.76rem', lineHeight: 1.5 }}>
                  A failed test usually means the IP belongs to a virtual adapter (VM / Docker / VPN). The
                  real Wi-Fi IP is what other devices need.
                </div>
              </Section>

              {/* ── Interfaces ───────────────────────────────────────────── */}
              <Section title="Network interfaces (IPv4)">
                {ifaces.length === 0 ? (
                  <div style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>None found.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {ifaces.map((itf) => (
                      <div
                        key={`${itf.name}-${itf.address}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 10px',
                          borderRadius: 10,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            color: itf.candidate ? 'var(--brand)' : 'var(--text-2)',
                          }}
                        >
                          {itf.address}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            color: 'var(--text-3)',
                            fontSize: '0.74rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {itf.name}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {itf.candidate && <Pill tone="brand">LAN</Pill>}
                          {itf.virtual && <Pill tone="warn">virtual</Pill>}
                          {itf.internal && <Pill tone="muted">internal</Pill>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Devices that loaded ──────────────────────────────────── */}
              <Section title="4 · Devices that successfully loaded the app">
                {hits.length === 0 ? (
                  <div style={{ color: 'var(--text-3)', fontSize: '0.84rem', lineHeight: 1.5, padding: '10px 0' }}>
                    None yet. Open{' '}
                    <strong style={{ color: 'var(--brand)' }}>{report.primaryLanUrl}</strong> on the other
                    device — it will appear here within seconds. If it never appears, the problem is the
                    network path (firewall / wrong IP / router AP isolation) and the report below will show why.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {hits.map((h, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 10px',
                          borderRadius: 10,
                          background: 'rgba(141,186,164,0.05)',
                          border: '1px solid rgba(141,186,164,0.20)',
                        }}
                      >
                        <span style={{ color: 'var(--good)', fontWeight: 800 }}>✓</span>
                        <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{h.name || 'Device'}</span>
                        <span
                          style={{
                            color: 'var(--text-3)',
                            fontSize: '0.74rem',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h.url || h.ip}
                        </span>
                        <span style={{ color: 'var(--text-3)', fontSize: '0.72rem' }}>{formatTime(h.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Client-side errors ────────────────────────────────────── */}
              <Section title="5 · Client-side errors reported (blank screen fixes)">
                {errors.length === 0 ? (
                  <div style={{ color: 'var(--good)', fontSize: '0.84rem', padding: '10px 0' }}>
                    ✓ No client errors reported. If a device shows a blank page but no error here,
                    the page never reached the JS bundle (browser-level block) or the device never
                    loaded at all.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {errors.map((err, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          padding: '9px 12px',
                          borderRadius: 10,
                          background: 'rgba(217,96,95,0.06)',
                          border: '1px solid rgba(217,96,95,0.25)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--bad)', fontWeight: 700, fontSize: '0.84rem', flex: 1, minWidth: 160 }}>
                            {err.message}
                          </span>
                          <span style={{ color: 'var(--text-3)', fontSize: '0.72rem' }}>{formatTime(err.at)}</span>
                        </div>
                        <div style={{ color: 'var(--text-3)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {err.url} · {err.userAgent}
                        </div>
                        {err.stack && (
                          <pre
                            style={{
                              margin: 0,
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: 'rgba(0,0,0,0.25)',
                              fontSize: '0.68rem',
                              fontFamily: 'ui-monospace, monospace',
                              color: 'var(--text-2)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              maxHeight: 90,
                              overflowY: 'auto',
                            }}
                          >
                            {err.stack}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Firewall ─────────────────────────────────────────────── */}
              {firewall && (
                <Section title="Firewall check">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill tone={firewall.status === 'rule_present' ? 'good' : firewall.status === 'no_rule' ? 'bad' : 'muted'}>
                      {firewall.status === 'rule_present'
                        ? 'rule present'
                        : firewall.status === 'no_rule'
                          ? 'no inbound rule'
                          : firewall.status === 'check_failed'
                            ? 'could not check'
                            : 'not checked'}
                    </Pill>
                    <span style={{ color: 'var(--text-2)', fontSize: '0.8rem', flex: 1, minWidth: 200 }}>
                      {firewall.hint}
                    </span>
                  </div>
                  {firewall.status === 'no_rule' && (
                    <div style={{ marginTop: 6 }}>
                      <pre
                        style={{
                          margin: 0,
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border)',
                          fontSize: '0.76rem',
                          fontFamily: 'ui-monospace, monospace',
                          color: 'var(--text-2)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {fwCommand}
                      </pre>
                      <motion.button
                        className="ns-btn sm ghost"
                        whileTap={{ scale: 0.94 }}
                        onClick={() => copyText(fwCommand, 'Firewall command')}
                        style={{ marginTop: 6, fontSize: '0.76rem' }}
                      >
                        📋 Copy firewall command
                      </motion.button>
                    </div>
                  )}
                </Section>
              )}

              {/* ── Copy report ──────────────────────────────────────────── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <motion.button
                  className="ns-btn primary"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={copyReport}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  📋 Copy full diagnostic report
                </motion.button>
                <div style={{ color: 'var(--text-3)', fontSize: '0.76rem', textAlign: 'center', lineHeight: 1.5 }}>
                  Paste the copied JSON into your support chat — it includes every interface, the chosen URL,
                  firewall state and which devices loaded the app.
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </>
  )
}
