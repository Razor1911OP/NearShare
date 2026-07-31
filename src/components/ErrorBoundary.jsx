import React, { Component } from 'react'
import { copyTextToClipboard } from '../lib/clipboard.js'
import { reportClientError } from '../lib/errorReport.js'

/**
 * ErrorBoundary — catches render-time crashes and shows the error on screen
 * instead of a silent blank page. The error is also sent to the server so the
 * Network Diagnostics panel can collect it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    reportClientError({
      message: error?.message || String(error),
      stack: `${error?.stack || ''}\n${info?.componentStack || ''}`,
    })
  }

  handleCopy = async () => {
    const { error, info } = this.state
    const text = `${error?.message || String(error)}\n\n${error?.stack || ''}\n\n${info?.componentStack || ''}`
    await copyTextToClipboard(text)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100svh',
          width: '100vw',
          background: 'var(--bg)',
          padding: '24px',
          color: 'var(--text)',
          fontFamily: 'var(--font)',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: '100%',
            background: 'var(--surface-hi)',
            border: '1px solid rgba(248,81,73,0.35)',
            borderRadius: 'var(--r-lg)',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>NearShare hit an error</div>
              <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>
                This has been reported to the server automatically.
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(248,81,73,0.10)',
              border: '1px solid rgba(248,81,73,0.30)',
              color: 'var(--bad)',
              fontSize: '0.88rem',
              fontWeight: 600,
              lineHeight: 1.5,
              wordBreak: 'break-word',
            }}
          >
            {error?.message || String(error)}
          </div>

          {error?.stack && (
            <pre
              style={{
                margin: 0,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid var(--border)',
                fontSize: '0.72rem',
                fontFamily: 'ui-monospace, monospace',
                color: 'var(--text-2)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {error.stack}
            </pre>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              className="ns-btn sm"
              onClick={this.handleCopy}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              📋 Copy error
            </button>
            <button
              className="ns-btn primary sm"
              onClick={this.handleReload}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              ↻ Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
