import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  lazy,
  Suspense,
} from 'react'
import { motion } from 'framer-motion'
import { AppProvider, useApp } from './store/AppContext.jsx'
import { useSocket } from './hooks/useSocket.js'
import { ToastContainer } from './components/ui/Toast.jsx'
import PairingModal from './components/PairingModal.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// ─── SendMsg Context ──────────────────────────────────────────────────────────
// Provides a stable sendMessage function reference throughout the tree,
// without causing re-renders on every socket tick.

export const SendMsgContext = createContext(() => {})

export function useSendMsg() {
  return useContext(SendMsgContext)
}

// ─── Lazy Layouts ─────────────────────────────────────────────────────────────

const DesktopView = lazy(() => import('./layouts/DesktopView.jsx'))
const MobileView  = lazy(() => import('./layouts/MobileView.jsx'))

// ─── Spinner keyframes injected once ─────────────────────────────────────────

const SPIN_STYLE = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

// ─── Loading Fallback ─────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <>
      <style>{SPIN_STYLE}</style>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        style={{
          display:        'grid',
          placeItems:     'center',
          height:         '100svh',
          width:          '100vw',
          background:     'var(--bg)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Animated logo mark */}
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              width:        48,
              height:       48,
              borderRadius: 14,
              background:   'linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%)',
              display:      'grid',
              placeItems:   'center',
              fontSize:     '1.5rem',
              boxShadow:    '0 0 24px rgba(88,166,255,0.35)',
            }}
          >
            📡
          </motion.div>

          {/* Spinning ring */}
          <div
            style={{
              width:        36,
              height:       36,
              borderRadius: '50%',
              border:       '3px solid rgba(88,166,255,0.15)',
              borderTopColor: 'var(--brand)',
              animation:    'ns-spin 0.75s linear infinite',
            }}
          />
        </div>
      </motion.div>
    </>
  )
}

// ─── Mobile Detection Helper ──────────────────────────────────────────────────

function detectMobile() {
  return window.innerWidth < 769 || navigator.maxTouchPoints > 0
}

// ─── AppInner — must be inside AppProvider so hooks work ─────────────────────

function AppInner() {
  const [state] = useApp()
  const { sendMessage } = useSocket()

  // Keep a ref to the latest sendMessage so the stable context value always
  // calls the most-current function without changing identity.
  const sendMsgRef = useRef(sendMessage)
  useEffect(() => {
    sendMsgRef.current = sendMessage
  }, [sendMessage])

  // Stable function identity — created once, delegates to the ref.
  const stableSend = useRef(function () {
    return sendMsgRef.current.apply(this, arguments)
  }).current

  // ── Mobile detection ────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(detectMobile)

  useEffect(() => {
    let frameId = null

    const onResize = () => {
      // Debounce to one animation frame to avoid thrashing
      if (frameId !== null) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        setIsMobile(detectMobile())
        frameId = null
      })
    }

    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [])

  // ── LAN diagnostics heartbeat ─────────────────────────────────────────────
  // Every page load reports in so the host's Network Diagnostics panel can
  // see which devices actually loaded the app over the LAN.
  useEffect(() => {
    const send = () => {
      fetch('/api/diagnose/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: window.location.href,
          name: localStorage.getItem('ns.deviceName') || state.deviceName || 'Device',
        }),
      }).catch(() => {})
    }
    send()
    const timer = setInterval(send, 30000)
    return () => clearInterval(timer)
  }, [state.deviceName])

  // ── Derived flags ───────────────────────────────────────────────────────────
  const showPairing = state.paired === false

  return (
    <SendMsgContext.Provider value={stableSend}>
      <style>{SPIN_STYLE}</style>

      {/* ── Lazy layout — Suspense handles the async chunk load ── */}
      <Suspense fallback={<LoadingSpinner />}>
        {isMobile
          ? <MobileView  sendMessage={stableSend} isMobile={true}  />
          : <DesktopView sendMessage={stableSend} isMobile={false} />
        }
      </Suspense>

      {/* ── Pairing modal — gated on paired === false ── */}
      {showPairing && <PairingModal />}

      {/* ── Toast region — always mounted, renders nothing when empty ── */}
      <ToastContainer />
    </SendMsgContext.Provider>
  )
}

// ─── Root Export ──────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </AppProvider>
  )
}
