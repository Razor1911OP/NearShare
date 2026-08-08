import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import { getServerBase, serverLabel } from '../lib/serverUrl.js'
import { runNetworkTests } from '../lib/connectionDiagnostics.js'
import { copyTextToClipboard } from '../lib/clipboard.js'

function formatBytes(bytes = 0) {
  const n = Number(bytes) || 0
  if (n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / (1024 ** i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatRate(bps = 0) {
  if (!bps || bps <= 0) return '0 B/s'
  return `${formatBytes(bps)}/s`
}

function StatRow({ label, value, good = true }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, padding: '10px 12px', borderRadius: 12,
      background: 'linear-gradient(180deg, var(--surface-2), var(--surface))',
      border: '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--text-3)', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600, fontSize: '0.85rem', textAlign: 'right' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: good ? 'var(--good)' : 'var(--bad)' }} />
        {value}
      </span>
    </div>
  )
}

function SummaryItem({ label, value }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 12,
      background: 'var(--surface)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ color: 'var(--text-3)', fontSize: '0.73rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem' }}>{value}</span>
    </div>
  )
}

export default function DiagnosticsPage({ open, onClose }) {
  const [state, dispatch] = useApp()
  const [tests, setTests] = useState([])
  const [running, setRunning] = useState(false)
  const [fps, setFps] = useState(60)
  const [memoryMb, setMemoryMb] = useState(null)

  const runDiagnostics = useCallback(async () => {
    setRunning(true)
    try {
      const base = getServerBase() || window.location.origin
      const results = await runNetworkTests(base, { timeoutMs: 5000 })
      setTests(results)
      dispatch({
        type: 'LOG_EVENT',
        payload: {
          category: 'diagnostics',
          level: 'info',
          message: 'Diagnostics executed',
          data: { results: results.map(r => ({ name: r.name, status: r.status })) },
        },
      })
    } finally {
      setRunning(false)
    }
  }, [dispatch])

  useEffect(() => {
    if (!open) return
    runDiagnostics()
  }, [open, runDiagnostics])

  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = performance.now()
    let frames = 0
    let lastSample = last

    const tick = (now) => {
      frames += 1
      const elapsed = now - lastSample
      if (elapsed >= 500) {
        const currentFps = Math.round((frames * 1000) / elapsed)
        setFps(currentFps)
        frames = 0
        lastSample = now
      }

      if (performance?.memory?.usedJSHeapSize) {
        setMemoryMb(Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)))
      }

      last = now
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const testMap = useMemo(() => {
    const m = new Map()
    for (const t of tests) m.set(t.name, t)
    return m
  }, [tests])

  const pass = (name) => testMap.get(name)?.status === 'pass'

  const backendRunning = pass('Backend reachable')
  const apiReachable = pass('Server info available')
  const lanReachable = pass('LAN reachable')
  const deviceDiscovery = Array.isArray(state.devices) && state.devices.length >= 0 && !!state.serverInfo
  const wsConnected = state.socketStatus === 'connected'
  const webrtcAvailable = typeof RTCPeerConnection !== 'undefined'
  const pairingService = pass('Pairing code valid') || state.paired
  const transferEngine = pass('Browser compatible') && typeof File !== 'undefined' && typeof Blob !== 'undefined'

  const reactErrors = state.eventLog.filter((e) => e?.category === 'react' && e?.level === 'error').length
  const networkErrors = state.errorLog.filter((e) => ['network', 'websocket', 'server', 'discovery'].includes(e?.category)).length

  const exportLogs = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      backend: serverLabel(),
      summary: {
        backendRunning,
        apiReachable,
        lanReachable,
        deviceDiscovery,
        wsConnected,
        webrtcAvailable,
        pairingService,
        transferEngine,
        reactErrors,
        networkErrors,
        memoryMb,
        fps,
        lastPairingAt: state.lastPairingAt,
        lastTransfer: state.lastTransfer,
      },
      tests,
      errors: state.errorLog,
      events: state.eventLog,
      devices: state.devices,
    }

    const json = JSON.stringify(payload, null, 2)
    const ok = await copyTextToClipboard(json)
    dispatch({
      type: 'ADD_TOAST',
      payload: {
        message: ok ? 'Diagnostics exported to clipboard' : 'Could not copy diagnostics',
        type: ok ? 'good' : 'bad',
      },
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(6,10,12,0.74)' }}
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            style={{
              position: 'fixed', zIndex: 121, inset: '20px',
              background: 'var(--bg)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-lg)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: 'var(--shadow)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              padding: '16px 18px', borderBottom: '1px solid var(--border)',
            }}>
              <div>
                <h2 className="ns-display" style={{ margin: 0, fontSize: '1.05rem' }}>NearShare Diagnostics</h2>
                <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: '0.78rem' }}>{serverLabel()}</div>
              </div>
              <button className="ns-btn ghost sm icon" onClick={onClose} style={{ width: 36, height: 36, minHeight: 36, padding: 0 }}>✕</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18, display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gap: 8 }}>
                <StatRow label="Backend Running" value={backendRunning ? 'Yes' : 'No'} good={backendRunning} />
                <StatRow label="API Reachable" value={apiReachable ? 'Yes' : 'No'} good={apiReachable} />
                <StatRow label="LAN Reachable" value={lanReachable ? 'Yes' : 'No'} good={lanReachable} />
                <StatRow label="Device Discovery" value={deviceDiscovery ? 'Ready' : 'Unavailable'} good={deviceDiscovery} />
                <StatRow label="WebSocket Connected" value={wsConnected ? 'Connected' : state.socketStatus} good={wsConnected} />
                <StatRow label="WebRTC Available" value={webrtcAvailable ? 'Available' : 'Unavailable'} good={webrtcAvailable} />
                <StatRow label="Pairing Service" value={pairingService ? 'Healthy' : 'Needs attention'} good={pairingService} />
                <StatRow label="Transfer Engine" value={transferEngine ? 'Ready' : 'Unavailable'} good={transferEngine} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <SummaryItem label="React Errors" value={String(reactErrors)} />
                <SummaryItem label="Network Errors" value={String(networkErrors)} />
                <SummaryItem label="Memory Usage" value={memoryMb !== null ? `${memoryMb} MB` : 'N/A'} />
                <SummaryItem label="FPS" value={String(Math.max(0, fps))} />
                <SummaryItem label="Last Pairing" value={state.lastPairingAt ? 'Success' : 'No pairing yet'} />
                <SummaryItem
                  label="Last Transfer"
                  value={state.lastTransfer
                    ? `${formatBytes(state.lastTransfer.bytes)} @ ${formatRate(state.lastTransfer.bps)}`
                    : 'No transfers yet'}
                />
              </div>

              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ color: 'var(--text-2)', fontWeight: 700, fontSize: '0.85rem' }}>Latest Test Results</div>
                {tests.length === 0 ? (
                  <div style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>No tests run yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {tests.map((t) => (
                      <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                        <span style={{ color: t.status === 'pass' ? 'var(--good)' : 'var(--bad)', width: 14 }}>
                          {t.status === 'pass' ? '✓' : '✕'}
                        </span>
                        <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: 170 }}>{t.name}</span>
                        <span style={{ color: 'var(--text-3)' }}>{t.detail || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{
              borderTop: '1px solid var(--border)', padding: 12,
              display: 'flex', gap: 8, flexWrap: 'wrap',
            }}>
              <button className="ns-btn" onClick={exportLogs}>Export Logs</button>
              <button className="ns-btn primary" onClick={runDiagnostics} disabled={running}>
                {running ? 'Running…' : 'Run Diagnostics'}
              </button>
              <button
                className="ns-btn ghost"
                onClick={() => dispatch({ type: 'CLEAR_EVENT_LOG' })}
                style={{ marginLeft: 'auto' }}
              >
                Clear Event Log ({state.eventLog.length})
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
