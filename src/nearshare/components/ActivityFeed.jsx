import React, { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import { apiUrl } from '../lib/serverUrl'
import useTransfer from '../hooks/useTransfer.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  const val = bytes / Math.pow(k, i)
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`
}

const KIND_MAP = [
  { id: 'image', icon: '🖼️', tint: 'var(--brand)',   ext: ['jpg','jpeg','png','gif','webp','svg','heic','avif','bmp'], mime: 'image/' },
  { id: 'video', icon: '🎬', tint: 'var(--brand-2)', ext: ['mp4','mov','avi','mkv','webm'], mime: 'video/' },
  { id: 'audio', icon: '🎵', tint: 'var(--brand-2)', ext: ['mp3','aac','flac','wav','ogg','m4a'], mime: 'audio/' },
  { id: 'pdf',   icon: '📄', tint: 'var(--bad)',     ext: ['pdf'] },
  { id: 'zip',   icon: '🗜️', tint: 'var(--warn)',    ext: ['zip','rar','7z','tar','gz','bz2'] },
  { id: 'doc',   icon: '📝', tint: 'var(--brand-4, #AAA7AE)', ext: ['doc','docx','txt','md','rtf'] },
  { id: 'sheet', icon: '📊', tint: 'var(--good)',    ext: ['xls','xlsx','csv'] },
  { id: 'slide', icon: '🗂️', tint: 'var(--warn)',    ext: ['ppt','pptx'] },
  { id: 'code',  icon: '💻', tint: 'var(--brand)',   ext: ['js','jsx','ts','tsx','py','rs','go','java','cpp','c','h','html','css','json','yaml','toml','sh'] },
]

export function fileKind(filename = '', mime = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  for (const k of KIND_MAP) {
    if (k.mime && mime.startsWith(k.mime)) return k
    if (k.ext.includes(ext)) return k
  }
  return { id: 'file', icon: '📎', tint: 'var(--text-3)' }
}

export function getFileIcon(filename = '', mime = '') {
  return fileKind(filename, mime).icon
}

function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const s = Math.round(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = new Date(ts)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function downloadHref(upload, file) {
  return apiUrl(`/api/download/${encodeURIComponent(upload.uploadId)}/${encodeURIComponent(file.relativePath)}`)
}

async function downloadAllFiles(upload) {
  const files = upload.files || []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const a = document.createElement('a')
    a.href = downloadHref(upload, f)
    a.download = f.originalName || f.relativePath?.split('/').pop() || 'file'
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 100)
    if (i < files.length - 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }
}

// ─── File type strip ──────────────────────────────────────────────────────────

function TypeStrip({ files = [] }) {
  const counts = useMemo(() => {
    const map = new Map()
    for (const f of files) {
      const k = fileKind(f.originalName || f.relativePath || '', f.mime || '')
      const prev = map.get(k.id) || { ...k, n: 0 }
      prev.n += 1
      map.set(k.id, prev)
    }
    return Array.from(map.values()).slice(0, 5)
  }, [files])

  if (counts.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {counts.map(k => (
        <span
          key={k.id}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-2)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderLeft: `2px solid ${k.tint}`,
            borderRadius: 6, padding: '2px 7px',
          }}
        >
          <span aria-hidden="true">{k.icon}</span>{k.n}
        </span>
      ))}
    </div>
  )
}

// ─── Live transfer card ───────────────────────────────────────────────────────

function formatRate(bps) {
  if (!bps || bps <= 0) return null
  return `${formatBytes(bps)}/s`
}

function formatEta(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 1) return 'almost done'
  if (s < 60) return `${s}s left`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s left`
  return `${Math.floor(m / 60)}h ${m % 60}m left`
}

function LiveCard({ progress, count, bytes, target, stats }) {
  const rate = formatRate(stats?.bps)
  const eta = formatEta(stats?.etaMs)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        padding: '13px 14px',
        borderRadius: 'var(--r)',
        background: 'linear-gradient(180deg, var(--surface-2), var(--surface))',
        border: '1px solid var(--border-hi)',
        borderLeft: '3px solid var(--brand-2, var(--brand))',
        boxShadow: '0 2px 0 rgba(0,0,0,0.35), 0 10px 24px rgba(0,0,0,0.28)',
        display: 'flex', flexDirection: 'column', gap: 9,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <motion.span
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          style={{ fontSize: '1.2rem' }}
          aria-hidden="true"
        >
          📤
        </motion.span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
            Sending {count} file{count !== 1 ? 's' : ''} → {target}
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: '0.74rem', marginTop: 2 }}>
            {stats?.totalBytes
              ? `${formatBytes(stats.uploadedBytes)} / ${formatBytes(stats.totalBytes)}`
              : `${formatBytes(bytes)} in flight`}
          </div>
        </div>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '0.85rem', color: 'var(--brand)' }}>
          {progress}%
        </span>
      </div>
      <div className="ns-progress">
        <motion.div
          className="ns-progress-bar"
          animate={{ width: `${progress}%` }}
          transition={{ ease: 'easeOut', duration: 0.25 }}
        />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: 'var(--text-3)',
      }}>
        <span>{rate || 'measuring…'}</span>
        <span>{eta || ''}</span>
      </div>
    </motion.div>
  )
}

// ─── History card ─────────────────────────────────────────────────────────────

function ActivityCard({ upload, index, compact }) {
  const [expanded, setExpanded] = useState(false)
  const isIncoming = !upload.gestureMode
  const files = Array.isArray(upload.files) ? upload.files : []
  const canDownload = !!upload.uploadId && files.length > 0
  const totalBytes = files.reduce((s, f) => s + (f.bytes ?? 0), 0)
  const first = files[0]
  const firstName = first?.originalName ?? first?.relativePath ?? 'Unknown file'
  const kind = fileKind(firstName, first?.mime || '')
  const multi = files.length > 1

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(index, 6) * 0.03, type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: compact ? '12px 13px' : '14px 15px',
        borderRadius: 'var(--r)',
        background: 'linear-gradient(180deg, var(--surface-2), var(--surface))',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${isIncoming ? 'var(--good)' : kind.tint}`,
        boxShadow: '0 2px 0 rgba(0,0,0,0.34), 0 8px 18px rgba(0,0,0,0.26)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <span
          aria-hidden="true"
          style={{
            fontSize: '1.15rem', flexShrink: 0,
            width: 34, height: 34, borderRadius: 10,
            display: 'grid', placeItems: 'center',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          {kind.icon}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 650, fontSize: '0.88rem', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {firstName}
            {multi && (
              <span style={{ color: 'var(--text-2)', fontWeight: 400 }}> +{files.length - 1} more</span>
            )}
          </div>
          <div style={{
            color: 'var(--text-3)', fontSize: '0.74rem', marginTop: 3,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            <span style={{
              color: isIncoming ? 'var(--good)' : 'var(--brand)',
              fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              fontSize: '0.64rem',
            }}>
              {isIncoming ? '↓ Received' : '↑ Sent'}
            </span>
            <span>·</span>
            <span>{isIncoming ? (upload.senderName || 'Unknown') : (upload.targetId || 'Host')}</span>
            <span>·</span>
            <span>{formatBytes(totalBytes)}</span>
            <span>·</span>
            <span>{relativeTime(upload.receivedAt)}</span>
          </div>
        </div>
      </div>

      {multi && <TypeStrip files={files} />}

      {upload.note && (
        <div style={{
          fontSize: '0.78rem', color: 'var(--text-2)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '7px 9px',
        }}>
          “{upload.note}”
        </div>
      )}

      {canDownload && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {multi ? (
            <>
              <button className="ns-btn sm" onClick={() => downloadAllFiles(upload)}>
                ⬇ Download all ({files.length})
              </button>
              <button className="ns-btn sm ghost" onClick={() => setExpanded(v => !v)}>
                {expanded ? 'Hide files' : 'Show files'}
              </button>
            </>
          ) : (
            <a
              className="ns-btn sm primary"
              href={downloadHref(upload, first)}
              download={first.originalName || first.relativePath?.split('/').pop() || 'file'}
              style={{ textDecoration: 'none' }}
            >
              ⬇ Download
            </a>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && multi && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {files.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: '0.78rem', color: 'var(--text-2)', padding: '3px 0',
                }}>
                  <span aria-hidden="true">{fileKind(f.originalName || f.relativePath || '', f.mime || '').icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.originalName || f.relativePath}
                  </span>
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{formatBytes(f.bytes)}</span>
                  {canDownload && (
                    <a
                      href={downloadHref(upload, f)}
                      download={f.originalName || f.relativePath?.split('/').pop() || 'file'}
                      style={{ color: 'var(--brand)', fontWeight: 700, textDecoration: 'none', padding: '2px 6px' }}
                      aria-label={`Download ${f.originalName || f.relativePath}`}
                    >
                      ⬇
                    </a>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Failed transfer card ─────────────────────────────────────────────────────

function FailedCard({ record, onRetry, onDismiss, busy }) {
  const entries = Array.isArray(record.entries) ? record.entries : []
  const bytes = entries.reduce((s, e) => s + (e.file?.size || 0), 0)
  const firstName = entries[0]?.file?.name || 'Transfer'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      style={{
        padding: '13px 14px',
        borderRadius: 'var(--r)',
        background: 'linear-gradient(180deg, var(--surface-2), var(--surface))',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--bad)',
        boxShadow: '0 2px 0 rgba(0,0,0,0.34), 0 8px 18px rgba(0,0,0,0.26)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <span aria-hidden="true" style={{
          fontSize: '1.1rem', width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>⚠️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 650, fontSize: '0.88rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {firstName}
            {entries.length > 1 && (
              <span style={{ color: 'var(--text-2)', fontWeight: 400 }}> +{entries.length - 1} more</span>
            )}
          </div>
          <div style={{
            color: 'var(--text-3)', fontSize: '0.74rem', marginTop: 3,
            display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span style={{
              color: 'var(--bad)', fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', fontSize: '0.64rem',
            }}>✕ Failed</span>
            <span>·</span>
            <span>{record.targetId && record.targetId !== 'host' ? record.targetId : 'Host'}</span>
            <span>·</span>
            <span>{formatBytes(bytes)}</span>
            <span>·</span>
            <span>{relativeTime(record.at)}</span>
          </div>
        </div>
      </div>

      <div style={{
        fontSize: '0.76rem', color: 'var(--text-2)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '7px 9px', wordBreak: 'break-word',
      }}>
        {record.error}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="ns-btn sm" onClick={onRetry} disabled={busy || entries.length === 0}>
          {busy ? 'Retrying…' : '↻ Retry'}
        </button>
        <button className="ns-btn sm ghost" onClick={onDismiss}>Dismiss</button>
      </div>
    </motion.div>
  )
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'received', label: 'Received' },
  { id: 'sent',     label: 'Sent' },
]

export default function ActivityFeed({
  compact = false,
  isUploading = false,
  uploadProgress = 0,
  uploadStats = null,
  liveCount = 0,
  liveBytes = 0,
  liveTarget = 'Host',
}) {
  const [state, dispatch] = useApp()
  const { transfers, failedTransfers = [] } = state
  const [filter, setFilter] = useState('all')
  const { uploadFiles } = useTransfer(null)
  const [retryingId, setRetryingId] = useState(null)

  const retry = async (record) => {
    setRetryingId(record.id)
    try {
      await uploadFiles({
        files: record.entries,
        note: record.note,
        gestureMode: record.gestureMode,
        targetId: record.targetId,
        retryId: record.id,
      })
    } catch { /* toast already shown */ }
    setRetryingId(null)
  }

  const shown = useMemo(() => {
    if (filter === 'all') return transfers
    const wantIncoming = filter === 'received'
    return transfers.filter(t => (!t.gestureMode) === wantIncoming)
  }, [transfers, filter])

  const totals = useMemo(() => {
    let bytes = 0, files = 0
    for (const t of transfers) {
      for (const f of t.files || []) { bytes += f.bytes ?? 0; files += 1 }
    }
    return { bytes, files }
  }, [transfers])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>

      {/* Filters + totals */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map(f => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`ns-btn sm${active ? '' : ' ghost'}`}
                style={{
                  minHeight: compact ? 36 : 30,
                  padding: '4px 12px',
                  fontSize: '0.76rem',
                  fontWeight: active ? 800 : 600,
                }}
                aria-pressed={active}
              >
                {f.label}
              </button>
            )
          })}
        </div>
        {totals.files > 0 && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace' }}>
            {totals.files} files · {formatBytes(totals.bytes)}
          </span>
        )}
      </div>

      {/* Feed */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 8,
        WebkitOverflowScrolling: 'touch',
      }}>
        <AnimatePresence initial={false}>
          {isUploading && (
            <LiveCard
              key="live"
              progress={uploadProgress}
              stats={uploadStats}
              count={liveCount}
              bytes={liveBytes}
              target={liveTarget}
            />
          )}

          {filter !== 'received' && failedTransfers.map(record => (
            <FailedCard
              key={record.id}
              record={record}
              busy={retryingId === record.id}
              onRetry={() => retry(record)}
              onDismiss={() => dispatch({ type: 'REMOVE_FAILED', payload: record.id })}
            />
          ))}

          {shown.length > 0 ? (
            shown.map((upload, i) => (
              <ActivityCard key={upload.id ?? `${upload.uploadId}-${i}`} upload={upload} index={i} compact={compact} />
            ))
          ) : !isUploading && failedTransfers.length === 0 ? (
            <motion.div
              key={`empty-${filter}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="ns-empty"
              style={{ padding: '40px 12px' }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 10 }}>
                {filter === 'sent' ? '📤' : filter === 'received' ? '📥' : '📭'}
              </div>
              {filter === 'all'
                ? 'No transfers yet'
                : filter === 'sent'
                  ? 'Nothing sent from this device yet'
                  : 'Nothing received yet'}
              <br />
              <span style={{ fontSize: '0.76rem', opacity: 0.75 }}>
                Files move here the moment a transfer completes.
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
