import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import useTheme from '../hooks/useTheme.js'
import ServerSetting from './ServerSetting.jsx'
import { serverLabel } from '../lib/serverUrl'

function Row({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="ns-label" style={{ marginBottom: 0 }}>{label}</span>
      {children}
      {hint && (
        <p style={{ margin: 0, fontSize: '0.73rem', color: 'var(--text-3)', lineHeight: 1.5 }}>{hint}</p>
      )}
    </div>
  )
}

/**
 * Slide-over settings sheet: device identity, appearance, server target and
 * local data controls. Works as a right-side panel on desktop and a bottom
 * sheet on mobile.
 */
export default function SettingsPanel({ open, onClose, mobile = false }) {
  const [state, dispatch] = useApp()
  const { theme, toggleTheme } = useTheme()
  const [name, setName] = useState(state.deviceName)
  const [savedName, setSavedName] = useState(false)

  useEffect(() => { setName(state.deviceName) }, [state.deviceName])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const saveName = () => {
    const next = name.trim()
    if (!next) return
    dispatch({ type: 'SET_DEVICE_NAME', payload: next })
    setSavedName(true)
    setTimeout(() => setSavedName(false), 1400)
  }

  const clearHistory = () => {
    dispatch({ type: 'CLEAR_TRANSFERS' })
    dispatch({ type: 'ADD_TOAST', payload: { message: 'Transfer history cleared', type: 'info' } })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="settings-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 90,
              background: 'rgba(6,10,12,0.62)',
            }}
          />

          <motion.aside
            key="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={mobile ? { y: '100%' } : { x: '100%' }}
            animate={mobile ? { y: 0 } : { x: 0 }}
            exit={mobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            style={{
              position: 'fixed',
              zIndex: 91,
              right: 0,
              bottom: 0,
              top: mobile ? 'auto' : 0,
              left: mobile ? 0 : 'auto',
              width: mobile ? 'auto' : 'min(400px, 92vw)',
              maxHeight: mobile ? '82vh' : '100%',
              display: 'flex',
              flexDirection: 'column',
              background: 'linear-gradient(180deg, var(--surface-2), var(--surface))',
              borderTop: '1px solid var(--border-hi)',
              borderLeft: mobile ? 'none' : '1px solid var(--border-hi)',
              borderTopLeftRadius: mobile ? 20 : 0,
              borderTopRightRadius: mobile ? 20 : 0,
              boxShadow: '0 -18px 50px rgba(0,0,0,0.55), -18px 0 50px rgba(0,0,0,0.45)',
              paddingBottom: mobile ? 'env(safe-area-inset-bottom, 0px)' : 0,
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <h2 className="ns-display" style={{ margin: 0, fontSize: '1rem' }}>Settings</h2>
              <button
                className="ns-btn ghost sm icon"
                onClick={onClose}
                aria-label="Close settings"
                style={{ width: 36, height: 36, minHeight: 36, borderRadius: 10, padding: 0 }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              padding: '18px', display: 'flex', flexDirection: 'column', gap: 22,
              WebkitOverflowScrolling: 'touch',
            }}>

              <Row label="Device name" hint="How this device appears to everyone else on the network.">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="ns-input"
                    value={name}
                    maxLength={40}
                    spellCheck={false}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveName() }}
                    style={{ flex: 1, minWidth: 0 }}
                    aria-label="Device name"
                  />
                  <button className="ns-btn" onClick={saveName} disabled={!name.trim()}>
                    {savedName ? 'Saved' : 'Save'}
                  </button>
                </div>
              </Row>

              <hr className="ns-divider" />

              <Row label="Appearance" hint="Follows your system on first load, then remembers your choice.">
                <button
                  className="ns-btn pewter"
                  onClick={toggleTheme}
                  style={{ justifyContent: 'space-between', width: '100%' }}
                >
                  <span>{theme === 'dark' ? '🌙 Dark' : '☀️ Light'}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.76rem' }}>
                    Switch to {theme === 'dark' ? 'light' : 'dark'}
                  </span>
                </button>
              </Row>

              <hr className="ns-divider" />

              <Row label="Connection" hint={`Currently talking to ${serverLabel()}.`}>
                <div style={{ marginTop: -10 }}>
                  <ServerSetting />
                </div>
              </Row>

              <hr className="ns-divider" />

              <Row
                label="Local data"
                hint="History lives only in this browser tab's memory — clearing it never deletes files on the host."
              >
                <button
                  className="ns-btn ghost"
                  onClick={clearHistory}
                  disabled={state.transfers.length === 0}
                  style={{ color: 'var(--bad)', borderColor: 'rgba(217,96,95,0.25)', width: '100%', justifyContent: 'center' }}
                >
                  Clear transfer history ({state.transfers.length})
                </button>
              </Row>

              <hr className="ns-divider" />

              <Row label="Session">
                <button
                  className="ns-btn ghost"
                  onClick={() => { onClose?.(); dispatch({ type: 'UNPAIR' }) }}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  ⏏ Disconnect &amp; unpair
                </button>
                <div style={{
                  fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem',
                  color: 'var(--text-3)', marginTop: 2, wordBreak: 'break-all',
                }}>
                  id {state.deviceId}
                </div>
              </Row>

              <div style={{ height: 8 }} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
