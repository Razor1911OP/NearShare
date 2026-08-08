import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { getServerBase, serverLabel, setServerBase, normalizeBase } from '../lib/serverUrl'

/**
 * Lets the user point this UI at a NearShare host running elsewhere on the LAN
 * (e.g. http://192.168.1.20:8787). Empty = use the current origin.
 *
 * DEVICE_HOST priority:
 *   1. User-defined host (localStorage)
 *   2. Automatically detected LAN IP (from /api/info)
 *   3. Environment variable (VITE_NEARSHARE_SERVER)
 *   4. same origin (development only)
 *
 * Validates by pinging /api/ping before applying.
 */
export default function ServerSetting() {
  const [state] = useApp()
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [validating, setValidating] = useState(false)
  const [lanAddresses, setLanAddresses] = useState([])

  useEffect(() => {
    setValue(getServerBase())
  }, [])

  // Show detected LAN addresses from server info as quick-select suggestions
  useEffect(() => {
    if (state.serverInfo?.lanAddresses?.length) {
      setLanAddresses(state.serverInfo.lanAddresses)
    } else if (state.serverInfo?.addresses?.length) {
      setLanAddresses(state.serverInfo.addresses.filter(a => !a.includes('localhost')))
    }
  }, [state.serverInfo])

  const apply = async (next) => {
    const raw = String(next ?? value).trim()

    // Reset to default (blank = same origin)
    if (raw === '' || next === '') {
      setError('')
      setValidating(false)
      const applied = setServerBase('')
      setValue(applied)
      setSaved(true)
      setTimeout(() => window.location.reload(), 350)
      return
    }

    const normalized = normalizeBase(raw)
    if (!normalized) {
      setError('Invalid address — enter a host like 192.168.1.20:8787')
      return
    }

    setError('')
    setValidating(true)

    // Validate by pinging the backend
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 4000)
      const res = await fetch(`${normalized}/api/ping`, {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      clearTimeout(timer)

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`)
      }

      const applied = setServerBase(raw)
      setValue(applied)
      setSaved(true)
      setValidating(false)
      setTimeout(() => window.location.reload(), 350)
    } catch (err) {
      setValidating(false)
      if (err.name === 'AbortError') {
        setError('Server did not respond — check the address and try again')
      } else if (err.message?.includes('Failed to fetch') || err instanceof TypeError) {
        setError('Cannot reach server — verify it is running and the address is correct')
      } else {
        setError(`Validation failed: ${err.message}`)
      }
    }
  }

  const selectLan = (addr) => {
    setValue(addr)
    setError('')
  }

  return (
    <div style={{ marginTop: 14 }}>
      <span className="ns-label">Server address</span>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="ns-input"
          value={value}
          placeholder={serverLabel()}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => { setValue(e.target.value); if (saved) setSaved(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
          style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}
          aria-label="NearShare server address"
          disabled={validating}
        />
        <button
          type="button"
          className="ns-btn"
          onClick={() => apply()}
          disabled={saved || validating}
        >
          {validating ? 'Testing…' : saved ? 'Saved ✓' : 'Use'}
        </button>
        {getServerBase() && (
          <button type="button" className="ns-btn pewter" onClick={() => apply('')} disabled={validating}>
            Reset
          </button>
        )}
      </div>

      {/* Detected LAN addresses as quick-select chips */}
      {lanAddresses.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {lanAddresses.map((addr) => (
            <button
              key={addr}
              type="button"
              onClick={() => selectLan(addr)}
              style={{
                padding: '4px 11px',
                borderRadius: 999,
                background: value === addr ? 'rgba(129,154,148,0.20)' : 'rgba(129,154,148,0.08)',
                border: `1px solid ${value === addr ? 'rgba(129,154,148,0.45)' : 'rgba(129,154,148,0.18)'}`,
                color: 'var(--brand)',
                fontSize: '0.74rem',
                fontFamily: 'ui-monospace, monospace',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {addr}
            </button>
          ))}
        </div>
      )}

      <p style={{
        margin: '8px 2px 0',
        fontSize: '0.74rem',
        color: error ? 'var(--bad)' : 'var(--text-3)',
        textAlign: 'left',
        lineHeight: 1.4,
      }}>
        {error || `Currently talking to ${serverLabel()} — leave blank to use this page's origin.`}
      </p>
    </div>
  )
}
