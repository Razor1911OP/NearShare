import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import NetworkDiagnostics from './NetworkDiagnostics.jsx'

// ─── Spin keyframe (injected once) ───────────────────────────────────────────

const SPIN_CSS = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

// ─── Animated Digit Display ───────────────────────────────────────────────────
// Each digit slides in from below with a spring, staggered per position.

function AnimatedDigit({ char, index }) {
  return (
    <motion.span
      key={char}
      initial={{ opacity: 0, y: 12, scale: 0.75 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type:      'spring',
        stiffness: 520,
        damping:   30,
        delay:     index * 0.045,
      }}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          46,
        height:         56,
        borderRadius:   12,
        background:     char === '·'
          ? 'rgba(255,255,255,0.04)'
          : 'rgba(88,166,255,0.12)',
        border:         char === '·'
          ? '1.5px solid rgba(255,255,255,0.08)'
          : '1.5px solid rgba(88,166,255,0.32)',
        fontFamily:     'ui-monospace, "Cascadia Code", monospace',
        fontSize:       '1.9rem',
        fontWeight:     800,
        color:          char === '·' ? 'var(--text-3)' : 'var(--brand)',
        letterSpacing:  0,
        boxShadow:      char === '·'
          ? 'none'
          : '0 0 16px rgba(88,166,255,0.18)',
        transition:     'background 0.2s, border-color 0.2s, box-shadow 0.2s',
      }}
    >
      {char}
    </motion.span>
  )
}

function AnimatedCode({ code }) {
  const TOTAL = 6
  const chars = code
    ? String(code).padEnd(TOTAL, '·').slice(0, TOTAL).split('')
    : Array(TOTAL).fill('·')

  return (
    <div
      style={{
        display:        'flex',
        gap:            8,
        justifyContent: 'center',
        flexWrap:       'wrap',
      }}
    >
      {chars.map((c, i) => (
        // key includes both index and char so framer re-mounts on change
        <AnimatedDigit key={`${i}-${c}`} char={c} index={i} />
      ))}
    </div>
  )
}

// ─── QR Spinner ───────────────────────────────────────────────────────────────

function QrSpinner() {
  return (
    <div
      style={{
        width:         44,
        height:        44,
        borderRadius:  '50%',
        border:        '3px solid rgba(88,166,255,0.14)',
        borderTopColor:'var(--brand)',
        animation:     'ns-spin 0.75s linear infinite',
      }}
    />
  )
}

// ─── PairingModal ─────────────────────────────────────────────────────────────

export default function PairingModal() {
  const [state, dispatch] = useApp()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [deviceName, setDeviceName] = useState(
    () => localStorage.getItem('ns.deviceName') || state.deviceName || ''
  )
  const [code, setCode]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState(null)

  // ── Remote data ─────────────────────────────────────────────────────────────
  const [qrSrc, setQrSrc]           = useState(null)
  const [qrLoading, setQrLoading]   = useState(true)
  const [serverInfo, setServerInfo] = useState(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  const codeInputRef = useRef(null)

  // ── Fetch QR ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setQrLoading(true)

    fetch('/api/qr')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.qr) setQrSrc(data.qr)
      })
      .catch(() => {/* QR unavailable — show fallback */})
      .finally(() => { if (!cancelled) setQrLoading(false) })

    return () => { cancelled = true }
  }, [])

  // ── Fetch server info ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    fetch('/api/info')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setServerInfo(data)
        // Persist pairing code into global state (used by socket reconnect etc.)
        if (data.pairingCode) {
          dispatch({ type: 'SET_SERVER_INFO', payload: data })
        }
      })
      .catch(() => {/* info unavailable */})

    return () => { cancelled = true }
  }, [dispatch])

  // ── Auto-fill code when server exposes it ─────────────────────────────────────
  useEffect(() => {
    if (serverInfo?.pairingCode && !code) {
      setCode(String(serverInfo.pairingCode))
    }
  }, [serverInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle code input — digits only, max 6 ──────────────────────────────────
  const handleCodeChange = useCallback((e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(val)
    if (formError) setFormError(null)
  }, [formError])

  // ── Handle name input ────────────────────────────────────────────────────────
  const handleNameChange = useCallback((e) => {
    setDeviceName(e.target.value)
  }, [])

  // ── Submit pairing ───────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    const trimmedCode = code.trim()
    const trimmedName = deviceName.trim() || state.deviceName

    if (trimmedCode.length < 4) {
      setFormError('Please enter the pairing code (at least 4 digits).')
      codeInputRef.current?.focus()
      return
    }

    setSubmitting(true)
    setFormError(null)

    // Persist chosen name immediately
    localStorage.setItem('ns.deviceName', trimmedName)

    try {
      const res = await fetch('/api/pair', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          code:     trimmedCode,
          name:     trimmedName,
          deviceId: state.deviceId,
        }),
      })

      const data = await res.json()

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Server error ${res.status}`)
      }

      // Triggers useSocket to connect (state.paired flips to true)
      dispatch({ type: 'PAIR', payload: trimmedCode })
    } catch (err) {
      setFormError(err.message || 'Pairing failed — check the code and try again.')
    } finally {
      setSubmitting(false)
    }
  }, [code, deviceName, state.deviceId, state.deviceName, dispatch])

  // ── Derived ──────────────────────────────────────────────────────────────────
  // "Server device" = the machine running the Node server, which will have
  // pairingCode in /api/info.  On a plain browser client this will be null.
  const isServerDevice   = Boolean(serverInfo?.pairingCode)
  const networkAddresses = (serverInfo?.lanAddresses?.length
    ? serverInfo.lanAddresses
    : (serverInfo?.addresses ?? []).filter((a) => !String(a).includes('localhost')))
  const primaryLanUrl    = serverInfo?.primaryLanUrl || networkAddresses[0] || ''
  const serverCode       = serverInfo?.pairingCode ? String(serverInfo.pairingCode) : ''

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{SPIN_CSS}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        style={{
          position:           'fixed',
          inset:              0,
          background:         'rgba(6,9,18,0.96)',
          backdropFilter:     'blur(12px)',
          WebkitBackdropFilter:'blur(12px)',
          zIndex:             100,
          overflowY:          'auto',
          overflowX:          'hidden',
          display:            'flex',
          alignItems:         'flex-start',
          justifyContent:     'center',
          padding:            '28px 16px 60px',
        }}
      >
        {/* ── Ambient glow orbs behind modal ─────────────────────────────────── */}
        <div aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
          <div style={{
            position:   'absolute', top: '-10%', left: '50%',
            transform:  'translateX(-50%)',
            width:      600, height: 400,
            borderRadius:'50%',
            background: 'radial-gradient(ellipse, rgba(88,166,255,0.12) 0%, transparent 70%)',
            filter:     'blur(40px)',
          }} />
          <div style={{
            position:   'absolute', bottom: '5%', right: '-5%',
            width:      400, height: 300,
            borderRadius:'50%',
            background: 'radial-gradient(ellipse, rgba(188,140,255,0.10) 0%, transparent 70%)',
            filter:     'blur(40px)',
          }} />
        </div>

        {/* ── Scrollable content card ────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 64, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28, delay: 0.06 }}
          style={{
            position:       'relative',
            zIndex:         1,
            width:          '100%',
            maxWidth:       460,
            display:        'flex',
            flexDirection:  'column',
            gap:            20,
          }}
        >
          {/* ── Logo + tagline ──────────────────────────────────────────────── */}
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 24, delay: 0.12 }}
              style={{
                display:        'inline-flex',
                alignItems:     'center',
                gap:            10,
                marginBottom:   14,
              }}
            >
              <div
                className="ns-logo-icon"
                style={{ width: 44, height: 44, borderRadius: 13, fontSize: '1.3rem' }}
              >
                📡
              </div>
              <span style={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.02em' }}>
                NearShare
              </span>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              style={{
                margin:     0,
                color:      'var(--text-2)',
                fontSize:   '1.05rem',
                fontWeight: 500,
              }}
            >
              Drag files between devices like magic ✨
            </motion.p>
          </div>

          {/* ── QR Code card ────────────────────────────────────────────────── */}
          <motion.div
            className="ns-card ns-panel"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.20, type: 'spring', stiffness: 320, damping: 28 }}
          >
            <span className="ns-label">Open on another device</span>

            {/* QR image / spinner */}
            <div
              style={{
                minHeight:       180,
                display:         'flex',
                flexDirection:   'column',
                alignItems:      'center',
                justifyContent:  'center',
                gap:             14,
                marginTop:       12,
                marginBottom:    8,
              }}
            >
              <AnimatePresence mode="wait">
                {qrLoading ? (
                  <motion.div
                    key="qr-loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <QrSpinner />
                  </motion.div>
                ) : qrSrc ? (
                  <motion.img
                    key="qr-img"
                    src={qrSrc}
                    alt="QR code — scan to open NearShare on another device"
                    initial={{ opacity: 0, scale: 0.82 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    style={{
                      width:           168,
                      height:          168,
                      borderRadius:    16,
                      background:      '#060912',
                      padding:         6,
                      imageRendering:  'pixelated',
                      border:          '1px solid rgba(88,166,255,0.20)',
                      boxShadow:       '0 8px 32px rgba(88,166,255,0.18)',
                    }}
                  />
                ) : (
                  <motion.div
                    key="qr-unavailable"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={{
                      width:          168,
                      height:         168,
                      borderRadius:   16,
                      border:         '2px dashed rgba(255,255,255,0.10)',
                      display:        'grid',
                      placeItems:     'center',
                      color:          'var(--text-3)',
                      fontSize:       '0.85rem',
                      textAlign:      'center',
                      padding:        16,
                    }}
                  >
                    QR code<br />unavailable
                  </motion.div>
                )}
              </AnimatePresence>

              <span style={{ color: 'var(--text-2)', fontSize: '0.86rem' }}>
                Scan to open on another device (same Wi-Fi)
              </span>
            </div>

            {/* Network addresses */}
            {networkAddresses.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <span className="ns-label">LAN addresses</span>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 7,
                    justifyContent: 'center',
                    marginTop: 8,
                  }}
                >
                  {networkAddresses.map((addr, i) => (
                    <motion.a
                      key={addr}
                      href={addr}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.05 * i, type: 'spring', stiffness: 400, damping: 26 }}
                      whileHover={{ scale: 1.05, borderColor: 'rgba(88,166,255,0.55)' }}
                      whileTap={{ scale: 0.97 }}
                      style={{
                        display: 'inline-block',
                        padding: '4px 13px',
                        borderRadius: 999,
                        background: 'rgba(88,166,255,0.09)',
                        border: '1px solid rgba(88,166,255,0.24)',
                        color: 'var(--brand)',
                        fontSize: '0.80rem',
                        textDecoration: 'none',
                        fontFamily: 'ui-monospace, monospace',
                        letterSpacing: '-0.01em',
                        transition: 'border-color 0.18s',
                      }}
                    >
                      {addr}
                    </motion.a>
                  ))}
                </div>

                {primaryLanUrl && (
                  <p
                    style={{
                      margin: '10px 0 0',
                      color: 'var(--text-3)',
                      fontSize: '0.76rem',
                      textAlign: 'center',
                      lineHeight: 1.45,
                    }}
                  >
                    If scan fails, open:&nbsp;
                    <a
                      href={primaryLanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--brand)' }}
                    >
                      {primaryLanUrl}
                    </a>
                  </p>
                )}
              </div>
            )}

            {/* ── Diagnose network button ─────────────────────────────────── */}
            <motion.button
              className="ns-btn ghost sm"
              onClick={() => setShowDiagnostics(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              style={{ marginTop: 12, width: '100%', color: 'var(--text-2)' }}
            >
              🔧 Diagnose network
            </motion.button>
          </motion.div>

          {/* ── Server pairing code display (only on host machine) ──────────── */}
          <AnimatePresence>
            {isServerDevice && (
              <motion.div
                className="ns-card ns-panel"
                key="server-code-card"
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                style={{ textAlign: 'center' }}
              >
                <span className="ns-label">Your pairing code</span>

                <div style={{ margin: '14px 0 10px' }}>
                  <AnimatedCode code={serverCode} />
                </div>

                <p style={{
                  margin:    0,
                  color:     'var(--text-3)',
                  fontSize:  '0.80rem',
                  lineHeight: 1.5,
                }}>
                  Enter this code on other devices to pair with this machine.
                </p>

                {/* Shimmer copy hint */}
                <motion.button
                  className="ns-btn ghost sm"
                  onClick={() => navigator.clipboard?.writeText(serverCode)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-2)' }}
                >
                  📋 Copy code
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Divider ─────────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.30 }}
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <hr className="ns-divider" style={{ flex: 1, margin: 0 }} />
            <span style={{
              color:      'var(--text-3)',
              fontSize:   '0.78rem',
              whiteSpace: 'nowrap',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}>
              or enter the pairing code
            </span>
            <hr className="ns-divider" style={{ flex: 1, margin: 0 }} />
          </motion.div>

          {/* ── Pair form ───────────────────────────────────────────────────── */}
          <motion.form
            className="ns-card ns-panel"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, type: 'spring', stiffness: 320, damping: 28 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            noValidate
          >
            {/* Device name */}
            <div>
              <label className="ns-label" htmlFor="pm-device-name">
                Your name for this device
              </label>
              <input
                id="pm-device-name"
                className="ns-input"
                type="text"
                placeholder="e.g. My iPhone, Work Laptop…"
                value={deviceName}
                onChange={handleNameChange}
                autoComplete="off"
                autoCapitalize="words"
                maxLength={40}
              />
            </div>

            {/* Code input */}
            <div>
              <label className="ns-label" htmlFor="pm-pair-code">
                6-digit pairing code
              </label>
              <input
                id="pm-pair-code"
                ref={codeInputRef}
                className="ns-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="• • • • • •"
                value={code}
                onChange={handleCodeChange}
                autoComplete="one-time-code"
                style={{
                  letterSpacing: '0.22em',
                  fontSize:      '1.3rem',
                  textAlign:     'center',
                  fontFamily:    'ui-monospace, monospace',
                  fontWeight:    700,
                }}
              />
            </div>

            {/* Inline error */}
            <AnimatePresence mode="wait">
              {formError && (
                <motion.p
                  key="form-error"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -4, height: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    margin:     0,
                    padding:    '9px 13px',
                    borderRadius: 10,
                    background: 'rgba(248,81,73,0.10)',
                    border:     '1px solid rgba(248,81,73,0.28)',
                    color:      'var(--bad)',
                    fontSize:   '0.86rem',
                    lineHeight: 1.45,
                  }}
                >
                  ✕ {formError}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.button
              type="submit"
              className="ns-btn primary"
              disabled={submitting || code.length < 4}
              whileHover={submitting ? {} : { scale: 1.02, boxShadow: '0 12px 32px rgba(88,166,255,0.35)' }}
              whileTap={submitting ? {} : { scale: 0.98 }}
              style={{ width: '100%', justifyContent: 'center', gap: 10 }}
            >
              {submitting ? (
                <>
                  <span
                    style={{
                      display:       'inline-block',
                      width:         16,
                      height:        16,
                      borderRadius:  '50%',
                      border:        '2.5px solid rgba(255,255,255,0.28)',
                      borderTopColor:'#fff',
                      animation:     'ns-spin 0.7s linear infinite',
                      flexShrink:    0,
                    }}
                  />
                  Pairing…
                </>
              ) : (
                <>
                  <span>🔗</span> Pair &amp; Connect
                </>
              )}
            </motion.button>
          </motion.form>

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            style={{
              textAlign:  'center',
              color:      'var(--text-3)',
              fontSize:   '0.79rem',
              margin:     0,
              lineHeight: 1.6,
            }}
          >
            🔒 All transfers stay on your local Wi-Fi.
            <br />
            Nothing leaves your network.
          </motion.p>
        </motion.div>
      </motion.div>

      {/* ── Network diagnostics overlay ──────────────────────────────────── */}
      {showDiagnostics && (
        <NetworkDiagnostics onClose={() => setShowDiagnostics(false)} />
      )}
    </>
  )
}
