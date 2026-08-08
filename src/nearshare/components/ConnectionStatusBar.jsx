import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import { ConnectionState, signalQuality } from '../lib/connectionDiagnostics.js'

// ─── Spin keyframe (injected once, used by the retrying icon) ──────────────────

const SPIN_CSS = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

// ─── Per-state metadata ────────────────────────────────────────────────────────

const STATE_META = {
  [ConnectionState.SEARCHING]:       { icon: '\uD83D\uDD0D', label: 'Searching',        color: 'var(--warn)',  pulse: true,  spin: false },
  [ConnectionState.FOUND_DEVICE]:    { icon: '\uD83D\uDCE1', label: 'Device Found',     color: 'var(--warn)',  pulse: true,  spin: false },
  [ConnectionState.NEGOTIATING]:     { icon: '\uD83E\uDD1D', label: 'Negotiating',      color: 'var(--warn)',  pulse: true,  spin: false },
  [ConnectionState.PAIRING]:         { icon: '\uD83D\uDD10', label: 'Pairing',          color: 'var(--warn)',  pulse: true,  spin: false },
  [ConnectionState.AUTHENTICATING]:  { icon: '\u2705',      label: 'Authenticating',   color: 'var(--warn)',  pulse: true,  spin: false },
  [ConnectionState.CONNECTED]:       { icon: '\uD83D\uDFE2', label: 'Connected',        color: 'var(--good)',  pulse: false, spin: false },
  [ConnectionState.DISCONNECTED]:    { icon: '\uD83D\uDD34', label: 'Disconnected',     color: 'var(--bad)',   pulse: false, spin: false },
  [ConnectionState.RETRYING]:        { icon: '\uD83D\uDD04', label: 'Retrying\u2026',        color: 'var(--warn)',  pulse: false, spin: true  },
  [ConnectionState.CONNECTION_LOST]: { icon: '\u26A0\uFE0F',  label: 'Connection Lost', color: 'var(--bad)',   pulse: true,  spin: false },
}

// ─── Variants for latency fade-in/out ──────────────────────────────────────────

const latencyVariants = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  exit:    { opacity: 0, x: 8 },
}

// ═══════════════════════════════════════════════════════════════════════════════
// ConnectionStatusBar
// ═══════════════════════════════════════════════════════════════════════════════

export default function ConnectionStatusBar() {
  const [state] = useApp()
  const { connectionState, latencyMs } = state

  const meta       = STATE_META[connectionState] ?? STATE_META[ConnectionState.DISCONNECTED]
  const isConnected = connectionState === ConnectionState.CONNECTED
  const quality     = isConnected ? signalQuality(latencyMs) : null

  // ── Pulse keyframes for active states ─────────────────────────────────────
  const pulseAnim = meta.pulse
    ? { opacity: [1, 0.35, 1] }
    : {}
  const pulseTrans = meta.pulse
    ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
    : {}

  // ── Spinning for retrying ─────────────────────────────────────────────────
  const spinAnim = meta.spin
    ? { rotate: 360 }
    : {}
  const spinTrans = meta.spin
    ? { repeat: Infinity, duration: 1.2, ease: 'linear' }
    : {}

  return (
    <>
      <style>{SPIN_CSS}</style>

      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          gap:           10,
          padding:       '4px 18px',
          minHeight:     36,
          background:    'var(--bg-2)',
          borderBottom:  '1px solid var(--border)',
          fontFamily:    'var(--font)',
          fontSize:      '0.78rem',
          color:         'var(--text-2)',
          lineHeight:    1,
          userSelect:    'none',
          flexShrink:    0,
        }}
      >
        {/* ── Animated status icon ─────────────────────────────────────────── */}
        <motion.span
          aria-hidden="true"
          style={{
            display:         'inline-flex',
            alignItems:      'center',
            justifyContent:  'center',
            fontSize:        '0.95rem',
            lineHeight:      1,
            flexShrink:      0,
          }}
          animate={{ ...pulseAnim, ...spinAnim }}
          transition={{ ...pulseTrans, ...spinTrans }}
        >
          {meta.icon}
        </motion.span>

        {/* ── Status label ─────────────────────────────────────────────────── */}
        <span style={{ color: meta.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {meta.label}
        </span>

        {/* ── Latency / signal quality (connected only) ─────────────────────── */}
        <AnimatePresence mode="wait">
          {isConnected && quality && (
            <motion.span
              key="latency"
              variants={latencyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{
                display:     'inline-flex',
                alignItems:  'center',
                gap:         6,
                whiteSpace:  'nowrap',
                overflow:    'hidden',
              }}
            >
              <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>·</span>
              <span style={{ color: quality.color }}>{quality.label}</span>
              {latencyMs !== null && (
                <>
                  <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>·</span>
                  <span style={{ color: 'var(--text-3)' }}>{latencyMs}ms</span>
                </>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
