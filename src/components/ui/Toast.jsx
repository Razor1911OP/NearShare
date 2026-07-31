import React, { useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../../store/AppContext.jsx'

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISS_DURATION = {
  good:    4000,
  warn:    4000,
  info:    4000,
  bad:     6000,
  default: 4000,
}

// Accent color per type — used for the progress drain bar and icon tint
const TYPE_META = {
  good: { icon: '✓', color: 'var(--good)',   label: 'Success' },
  warn: { icon: '⚠', color: 'var(--warn)',   label: 'Warning' },
  bad:  { icon: '✕', color: 'var(--bad)',    label: 'Error'   },
  info: { icon: 'ℹ', color: 'var(--info)',   label: 'Info'    },
}

// Framer-motion variants
const toastVariants = {
  initial: {
    opacity:    0,
    x:          56,
    scale:      0.92,
    filter:     'blur(4px)',
  },
  animate: {
    opacity:    1,
    x:          0,
    scale:      1,
    filter:     'blur(0px)',
    transition: {
      type:      'spring',
      stiffness: 420,
      damping:   34,
      mass:      0.9,
    },
  },
  exit: {
    opacity:    0,
    x:          56,
    scale:      0.88,
    filter:     'blur(2px)',
    transition: {
      duration: 0.22,
      ease:     [0.22, 1, 0.36, 1],
    },
  },
}

// ─── Single Toast ─────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  const duration      = DISMISS_DURATION[toast.type] ?? DISMISS_DURATION.default
  const meta          = TYPE_META[toast.type] ?? { icon: '●', color: 'var(--brand)', label: 'Notice' }
  const timerRef      = useRef(null)
  const startedAtRef  = useRef(Date.now())
  const remainingRef  = useRef(duration)

  // ── Auto-dismiss timer ──────────────────────────────────────────────────────
  const scheduleRemoval = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id)
    }, remainingRef.current)
  }, [toast.id, onDismiss])

  useEffect(() => {
    scheduleRemoval()
    return () => clearTimeout(timerRef.current)
  }, [scheduleRemoval])

  // ── Pause on hover ──────────────────────────────────────────────────────────
  const handleMouseEnter = useCallback(() => {
    clearTimeout(timerRef.current)
    remainingRef.current -= Date.now() - startedAtRef.current
  }, [])

  const handleMouseLeave = useCallback(() => {
    startedAtRef.current = Date.now()
    scheduleRemoval()
  }, [scheduleRemoval])

  // ── Derived class name ──────────────────────────────────────────────────────
  const toastClass = `ns-toast${toast.type ? ` ${toast.type}` : ''}`

  return (
    <motion.div
      layout
      layoutId={toast.id}
      className={toastClass}
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      role="alert"
      aria-label={`${meta.label}: ${toast.message}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        // Override the CSS animation — framer-motion owns the transition
        animation:  'none',
        display:    'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap:        12,
        alignItems: 'flex-start',
        position:   'relative',
        overflow:   'hidden',
      }}
    >
      {/* ── Type icon ────────────────────────────────────────────────────────── */}
      <span
        aria-hidden="true"
        style={{
          fontSize:   '1rem',
          lineHeight: 1.5,
          color:      meta.color,
          fontWeight: 700,
          flexShrink: 0,
          marginTop:  1,
        }}
      >
        {meta.icon}
      </span>

      {/* ── Message ──────────────────────────────────────────────────────────── */}
      <span style={{ lineHeight: 1.5, wordBreak: 'break-word' }}>
        {toast.message}
      </span>

      {/* ── Close button ─────────────────────────────────────────────────────── */}
      <motion.button
        className="ns-btn ghost icon sm"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        whileHover={{ scale: 1.12, background: 'rgba(255,255,255,0.08)' }}
        whileTap={{ scale: 0.92 }}
        style={{
          minHeight:    'unset',
          width:        26,
          height:       26,
          borderRadius: 8,
          padding:      0,
          flexShrink:   0,
          fontSize:     '1rem',
          lineHeight:   1,
          color:        'var(--text-2)',
          marginTop:    -1,
        }}
      >
        ×
      </motion.button>

      {/* ── Drain bar — shrinks to zero over the dismiss duration ──────────── */}
      <motion.div
        aria-hidden="true"
        initial={{ scaleX: 1, transformOrigin: 'left' }}
        animate={{ scaleX: 0, transformOrigin: 'left' }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        style={{
          position:     'absolute',
          left:         0,
          bottom:       0,
          height:       2,
          width:        '100%',
          background:   meta.color,
          opacity:      0.45,
          borderRadius: 1,
          pointerEvents:'none',
        }}
      />
    </motion.div>
  )
}

// ─── Toast Container ──────────────────────────────────────────────────────────

export function ToastContainer() {
  const [state, dispatch] = useApp()

  const handleDismiss = useCallback(
    (id) => dispatch({ type: 'REMOVE_TOAST', payload: id }),
    [dispatch]
  )

  return (
    <div
      className="ns-toast-region"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false} mode="sync">
        {state.toasts.map((toast) => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={handleDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
