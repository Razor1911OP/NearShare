import { useEffect, useState } from 'react'
import { getServerBase, serverLabel, setServerBase, normalizeBase } from '../lib/serverUrl'

/**
 * Lets the user point this UI at a NearShare host running elsewhere on the LAN
 * (e.g. http://192.168.1.20:3000). Empty = use the current origin.
 */
export default function ServerSetting() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setValue(getServerBase()) }, [])

  const apply = (next) => {
    const raw = String(next ?? value).trim()
    if (raw && !normalizeBase(raw)) {
      setError('Enter a host like 192.168.1.20:3000')
      return
    }
    setError('')
    const applied = setServerBase(raw)
    setValue(applied)
    setSaved(true)
    setTimeout(() => window.location.reload(), 350)
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
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply() }}
          style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}
          aria-label="NearShare server address"
        />
        <button type="button" className="ns-btn" onClick={() => apply()} disabled={saved}>
          {saved ? 'Saved' : 'Use'}
        </button>
        {getServerBase() && (
          <button type="button" className="ns-btn pewter" onClick={() => apply('')}>
            Reset
          </button>
        )}
      </div>
      <p style={{
        margin: '8px 2px 0',
        fontSize: '0.74rem',
        color: error ? 'var(--bad)' : 'var(--text-3)',
        textAlign: 'left',
      }}>
        {error || `Currently talking to ${serverLabel()} — leave blank to use this page's origin.`}
      </p>
    </div>
  )
}
