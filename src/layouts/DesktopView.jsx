import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import useTransfer, { generatePreview } from '../hooks/useTransfer.js'
import DeviceOrbit from '../components/DeviceOrbit.jsx'
import DragPortal from '../components/DragPortal.jsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k     = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i     = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  const val   = bytes / Math.pow(k, i)
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`
}

function getFileIcon(filename = '', mime = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','heic','avif'].includes(ext)) return '🖼️'
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return '🎬'
  if (mime.startsWith('audio/') || ['mp3','aac','flac','wav','ogg','m4a'].includes(ext)) return '🎵'
  if (ext === 'pdf') return '📄'
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return '🗜️'
  if (['doc','docx','txt','md','rtf'].includes(ext)) return '📝'
  if (['xls','xlsx','csv'].includes(ext)) return '📊'
  if (['ppt','pptx'].includes(ext)) return '📊'
  if (['js','jsx','ts','tsx','py','rs','go','java','cpp','c','h','html','css','json','yaml','toml'].includes(ext)) return '💻'
  return '📎'
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts) {
  if (!ts) return ''
  const d   = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `Today at ${formatTime(ts)}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + formatTime(ts)
}

// ─── Socket status pill ───────────────────────────────────────────────────────

function StatusPill({ status }) {
  const MAP = {
    connected:    { label: 'Connected',    cls: 'online', dot: true  },
    connecting:   { label: 'Connecting…',  cls: 'info',   dot: false },
    disconnected: { label: 'Offline',      cls: 'offline', dot: false },
  }
  const { label, cls, dot } = MAP[status] ?? MAP.disconnected
  return (
    <span className={`ns-badge ${cls}`}>
      {dot && <span className="ns-dot-pulse" />}
      {label}
    </span>
  )
}

// ─── File chip row ────────────────────────────────────────────────────────────

function FileChip({ entry, onRemove }) {
  const { file, preview, key } = entry
  const icon = getFileIcon(file.name, file.type)

  return (
    <motion.div
      className="ns-chip"
      layout
      initial={{ opacity: 0, x: -12, scale: 0.96 }}
      animate={{ opacity: 1, x: 0,   scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {/* Preview thumbnail or icon */}
        {preview ? (
          <img
            src={preview}
            alt=""
            style={{
              width: 36, height: 36, borderRadius: 8,
              objectFit: 'cover', flexShrink: 0,
              border: '1px solid var(--border)',
            }}
          />
        ) : (
          <span style={{ fontSize: '1.4rem', flexShrink: 0, lineHeight: 1 }}>{icon}</span>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="file-name">{file.name}</div>
          <div className="file-meta">{formatBytes(file.size)}</div>
        </div>
      </div>
      <motion.button
        className="ns-btn ghost icon sm"
        onClick={() => onRemove(key)}
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.9 }}
        aria-label={`Remove ${file.name}`}
        style={{ minHeight: 'unset', width: 28, height: 28, borderRadius: 8, flexShrink: 0 }}
      >
        ×
      </motion.button>
    </motion.div>
  )
}

// ─── Download helpers ────────────────────────────────────────────────────────

function downloadHref(upload, file) {
  return `/api/download/${encodeURIComponent(upload.uploadId)}/${encodeURIComponent(file.relativePath)}`
}

function triggerFileDownload(upload, file) {
  const a = document.createElement('a')
  a.href = downloadHref(upload, file)
  a.download = file.originalName || file.relativePath.split('/').pop() || 'file'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function downloadAllFiles(upload) {
  for (const f of upload.files || []) {
    triggerFileDownload(upload, f)
  }
}

// ─── Transfer history card ────────────────────────────────────────────────────

function HistoryCard({ upload }) {
  const [expanded, setExpanded] = useState(false)
  const isIncoming = !upload.gestureMode
  const hasFiles  = Array.isArray(upload.files) && upload.files.length > 0
  const canDownload = !!upload.uploadId && hasFiles

  return (
    <motion.div
      className="ns-history-card"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ cursor: upload.files?.length > 1 ? 'pointer' : 'default' }}
      onClick={() => upload.files?.length > 1 && setExpanded(v => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: '1.3rem', flexShrink: 0, marginTop: 1 }}>
          {isIncoming ? '📥' : '📤'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.35 }}>
            {upload.files?.[0]?.originalName ?? upload.files?.[0]?.name ?? 'Unknown file'}
            {upload.fileCount > 1 && (
              <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>
                {' '}+{upload.fileCount - 1} more
              </span>
            )}
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: '0.76rem', marginTop: 2 }}>
            {isIncoming ? `From ${upload.senderName}` : `To ${upload.targetId || 'Host'}`}
            {' · '}{formatDate(upload.receivedAt)}
          </div>
        </div>
        <span style={{ color: 'var(--good)', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>
          ✓ {formatBytes(upload.files?.reduce((s, f) => s + (f.bytes ?? 0), 0))}
        </span>
      </div>

      {/* Download row */}
      {canDownload && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          {upload.files.length === 1 ? (
            <a
              className="ns-btn sm primary"
              href={downloadHref(upload, upload.files[0])}
              download={upload.files[0].originalName || upload.files[0].relativePath.split('/').pop() || 'file'}
              onClick={(e) => e.stopPropagation()}
              style={{ textDecoration: 'none' }}
            >
              ⬇ Download
            </a>
          ) : (
            <button
              className="ns-btn sm"
              onClick={(e) => { e.stopPropagation(); downloadAllFiles(upload) }}
            >
              ⬇ Download all ({upload.files.length})
            </button>
          )}
          {upload.files.length > 1 && (
            <span style={{ color: 'var(--text-3)', fontSize: '0.74rem' }}>
              or open the list to grab a single file
            </span>
          )}
        </div>
      )}

      {/* Expanded file list */}
      <AnimatePresence>
        {expanded && upload.files?.length > 1 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {upload.files.slice(1).map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: '0.80rem', color: 'var(--text-2)', padding: '2px 0',
                }}>
                  <span style={{ fontSize: '1rem' }}>
                    {getFileIcon(f.originalName || f.relativePath || '', '')}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.originalName || f.relativePath || f.name}
                  </span>
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                    {formatBytes(f.bytes)}
                  </span>
                  {canDownload && (
                    <a
                      href={downloadHref(upload, f)}
                      download={f.originalName || f.relativePath.split('/').pop() || 'file'}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: 'var(--brand)', fontWeight: 700, flexShrink: 0, textDecoration: 'none', padding: '2px 6px' }}
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

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles }) {
  const [draggingOver, setDraggingOver] = useState(false)
  const inputRef = useRef(null)
  const counterRef = useRef(0)

  const processEntries = useCallback(async (items) => {
    const entries = []
    const queue   = []

    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.()
        if (entry) queue.push(entry)
        else {
          const f = item.getAsFile()
          if (f) entries.push({ file: f, relativePath: f.name })
        }
      }
    }

    // Recursively read directory entries
    async function readEntry(entry, path = '') {
      if (entry.isFile) {
        await new Promise((resolve) => {
          entry.file((f) => {
            entries.push({ file: f, relativePath: path + f.name })
            resolve()
          })
        })
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        await new Promise((resolve) => {
          reader.readEntries(async (subEntries) => {
            for (const sub of subEntries) {
              await readEntry(sub, path + entry.name + '/')
            }
            resolve()
          })
        })
      }
    }

    for (const entry of queue) await readEntry(entry)
    return entries
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    counterRef.current = 0
    setDraggingOver(false)
    if (!e.dataTransfer?.items?.length) return
    const entries = await processEntries(Array.from(e.dataTransfer.items))
    if (entries.length > 0) onFiles(entries)
  }, [processEntries, onFiles])

  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    counterRef.current += 1
    setDraggingOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    counterRef.current -= 1
    if (counterRef.current <= 0) {
      counterRef.current = 0
      setDraggingOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e) => { e.preventDefault() }, [])

  const handleInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      onFiles(files.map(f => ({ file: f, relativePath: f.name })))
    }
    e.target.value = ''
  }, [onFiles])

  return (
    <motion.div
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onClick={() => inputRef.current?.click()}
      animate={{
        background:   draggingOver
          ? 'rgba(88,166,255,0.10)'
          : 'rgba(255,255,255,0.025)',
        borderColor:  draggingOver
          ? 'rgba(88,166,255,0.65)'
          : 'rgba(255,255,255,0.09)',
        scale:        draggingOver ? 1.015 : 1,
        boxShadow:    draggingOver
          ? '0 0 0 4px rgba(88,166,255,0.10), inset 0 0 40px rgba(88,166,255,0.06)'
          : '0 0 0 0px rgba(88,166,255,0)',
      }}
      transition={{ duration: 0.18 }}
      style={{
        border:         '2px dashed rgba(255,255,255,0.09)',
        borderRadius:   'var(--r-lg)',
        padding:        '32px 24px',
        textAlign:      'center',
        cursor:         'pointer',
        userSelect:     'none',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            10,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleInputChange}
        tabIndex={-1}
      />

      <motion.div
        animate={{ scale: draggingOver ? 1.18 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        style={{ fontSize: '2.4rem', lineHeight: 1 }}
        aria-hidden="true"
      >
        {draggingOver ? '📂' : '📁'}
      </motion.div>

      <div style={{ fontWeight: 700, fontSize: '0.96rem', color: draggingOver ? 'var(--brand)' : 'var(--text)' }}>
        {draggingOver ? 'Drop to stage files' : 'Drop files or click to browse'}
      </div>

      <div style={{ color: 'var(--text-3)', fontSize: '0.80rem', lineHeight: 1.5 }}>
        Drag folders, images, videos, or any file type.
        <br />
        Supports recursive folder drops.
      </div>
    </motion.div>
  )
}

// ─── DesktopView ──────────────────────────────────────────────────────────────

export default function DesktopView({ sendMessage, isMobile }) {
  const [state, dispatch] = useApp()
  const { uploadFiles, isUploading, uploadProgress } = useTransfer(sendMessage)

  const {
    selectedFiles,
    selectedTargetId,
    devices,
    socketStatus,
    pairingCode,
    deviceName,
    transfers,
  } = state

  const [note, setNote]     = useState('')
  const [activeTab, setActiveTab] = useState('files') // 'files' | 'history'

  // ── Add files dispatcher ──────────────────────────────────────────────────
  const handleFiles = useCallback(async (rawEntries) => {
    const entries = await Promise.all(
      rawEntries.map(async (entry) => {
        const preview = generatePreview(entry.file)
        const key     = `${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`
        return { file: entry.file, relativePath: entry.relativePath, preview, key }
      })
    )
    dispatch({ type: 'ADD_FILES', payload: entries })
  }, [dispatch])

  const handleRemoveFile = useCallback((key) => {
    dispatch({ type: 'REMOVE_FILE', payload: key })
  }, [dispatch])

  const handleClearFiles = useCallback(() => {
    dispatch({ type: 'CLEAR_FILES' })
  }, [dispatch])

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (isUploading || selectedFiles.length === 0) return
    try {
      await uploadFiles({ note, gestureMode: false, targetId: selectedTargetId })
      setNote('')
      setActiveTab('history')
    } catch (_) {
      // Error toast already dispatched by useTransfer
    }
  }, [isUploading, selectedFiles, uploadFiles, note, selectedTargetId])

  // ── Keyboard shortcut: Enter to upload ───────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (
        e.key === 'Enter' &&
        (e.ctrlKey || e.metaKey) &&
        selectedFiles.length > 0 &&
        !isUploading
      ) {
        handleUpload()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUpload, selectedFiles, isUploading])

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalBytes    = selectedFiles.reduce((s, f) => s + (f.file?.size ?? 0), 0)
  const onlineDevices = devices.filter(d => d.online !== false)
  const targetLabel   = selectedTargetId === 'host'
    ? 'Host'
    : (devices.find(d => d.id === selectedTargetId)?.name ?? 'Device')

  return (
    <div className="ns-layout" style={{ gridTemplateRows: '60px 1fr' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="ns-header">
        {/* Logo */}
        <div className="ns-logo">
          <div className="ns-logo-icon" aria-hidden="true">📡</div>
          <span>NearShare</span>
        </div>

        {/* Center info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center' }}>
          <StatusPill status={socketStatus} />

          {pairingCode && (
            <span style={{
              fontFamily:   'ui-monospace, monospace',
              fontSize:     '0.80rem',
              color:        'var(--text-3)',
              background:   'rgba(255,255,255,0.05)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              padding:      '3px 10px',
              letterSpacing:'0.12em',
              cursor:       'pointer',
            }}
            title="Click to copy"
            onClick={() => navigator.clipboard?.writeText(pairingCode)}
            >
              {pairingCode}
            </span>
          )}

          {onlineDevices.length > 0 && (
            <span className="ns-badge info">
              {onlineDevices.length} device{onlineDevices.length !== 1 ? 's' : ''} online
            </span>
          )}
        </div>

        {/* Right: device name + unpair */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-2)', fontSize: '0.85rem', fontWeight: 600 }}>
            {deviceName}
          </span>
          <button
            className="ns-btn sm ghost"
            onClick={() => dispatch({ type: 'UNPAIR' })}
            title="Disconnect and unpair"
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main style={{
        display:         'grid',
        gridTemplateColumns: '320px 1fr',
        gap:             0,
        overflow:        'hidden',
        height:          '100%',
      }}>

        {/* ── Left sidebar: Orbit + device list ──────────────────────────── */}
        <aside style={{
          display:        'flex',
          flexDirection:  'column',
          gap:            0,
          borderRight:    '1px solid var(--border)',
          overflow:       'hidden',
        }}>
          {/* Orbit visualization */}
          <div style={{
            padding:        '20px',
            display:        'flex',
            justifyContent: 'center',
            flexShrink:     0,
            borderBottom:   '1px solid var(--border)',
          }}>
            <DeviceOrbit />
          </div>

          {/* Device list */}
          <div style={{
            flex:        1,
            overflowY:   'auto',
            padding:     '16px',
            display:     'flex',
            flexDirection:'column',
            gap:         8,
          }}>
            <span className="ns-label">Paired devices</span>

            {/* Host row */}
            <div
              className={`ns-device-card${selectedTargetId === 'host' ? ' selected' : ''}`}
              onClick={() => dispatch({ type: 'SET_TARGET', payload: 'host' })}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_TARGET', payload: 'host' })}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
                  display: 'grid', placeItems: 'center', fontSize: '1rem', flexShrink: 0,
                }}>📡</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>Host (this server)</div>
                  <div style={{ color: 'var(--text-3)', fontSize: '0.74rem' }}>shared-inbox</div>
                </div>
              </div>
              <span className="ns-badge online"><span className="ns-dot-pulse" />On</span>
            </div>

            {/* Other devices */}
            <AnimatePresence initial={false}>
              {devices.map((d) => {
                const isOnline = d.online !== false
                const isSel    = selectedTargetId === d.id
                return (
                  <motion.div
                    key={d.id}
                    className={`ns-device-card${isSel ? ' selected' : ''}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                    onClick={() => dispatch({ type: 'SET_TARGET', payload: d.id })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_TARGET', payload: d.id })}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: isOnline
                          ? 'linear-gradient(145deg, rgba(28,42,64,0.9), rgba(16,26,46,0.9))'
                          : 'rgba(30,38,52,0.6)',
                        border: `2px solid ${isOnline ? 'rgba(63,185,80,0.45)' : 'rgba(255,255,255,0.08)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1rem', fontWeight: 800, color: isOnline ? 'var(--text)' : 'var(--text-3)',
                        flexShrink: 0,
                      }}>
                        {(d.name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: '0.88rem',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {d.name || 'Unknown device'}
                        </div>
                        <div style={{ color: 'var(--text-3)', fontSize: '0.74rem' }}>
                          {d.uploads ?? 0} transfer{d.uploads !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <span className={`ns-badge ${isOnline ? 'online' : 'offline'}`}>
                      {isOnline ? <><span className="ns-dot-pulse" />On</> : 'Off'}
                    </span>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {devices.length === 0 && (
              <div className="ns-empty" style={{ padding: '20px 0' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📱</div>
                Scan the QR code to add a device
              </div>
            )}
          </div>
        </aside>

        {/* ── Right panel: Files + History ────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

          {/* Tab bar */}
          <div style={{
            display:     'flex',
            gap:         4,
            padding:     '12px 20px',
            borderBottom:'1px solid var(--border)',
            flexShrink:  0,
          }}>
            {[
              { id: 'files',   label: `Send${selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ''}` },
              { id: 'history', label: `History${transfers.length > 0 ? ` (${transfers.length})` : ''}` },
            ].map(tab => (
              <motion.button
                key={tab.id}
                className={`ns-btn sm${activeTab === tab.id ? ' primary' : ' ghost'}`}
                onClick={() => setActiveTab(tab.id)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                style={{ minWidth: 90 }}
              >
                {tab.label}
              </motion.button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <AnimatePresence mode="wait">

              {/* ── Send tab ──────────────────────────────────────────────── */}
              {activeTab === 'files' && (
                <motion.div
                  key="files-tab"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  {/* Drop zone */}
                  <DropZone onFiles={handleFiles} />

                  {/* Staged files */}
                  <AnimatePresence initial={false}>
                    {selectedFiles.length > 0 && (
                      <motion.div
                        key="staged"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span className="ns-label" style={{ marginBottom: 0 }}>
                            Staged — {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
                          </span>
                          <button
                            className="ns-btn ghost sm"
                            onClick={handleClearFiles}
                            style={{ color: 'var(--bad)', borderColor: 'rgba(248,81,73,0.25)' }}
                          >
                            Clear all
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <AnimatePresence initial={false}>
                            {selectedFiles.map(entry => (
                              <FileChip
                                key={entry.key}
                                entry={entry}
                                onRemove={handleRemoveFile}
                              />
                            ))}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Note field (optional) */}
                  {selectedFiles.length > 0 && (
                    <div>
                      <label className="ns-label" htmlFor="dv-note">
                        Note (optional)
                      </label>
                      <textarea
                        id="dv-note"
                        className="ns-textarea"
                        placeholder="Add a short message to the recipient…"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        rows={2}
                        style={{ minHeight: 60, resize: 'none' }}
                      />
                    </div>
                  )}

                  {/* Send button */}
                  <AnimatePresence>
                    {selectedFiles.length > 0 && (
                      <motion.div
                        key="send-btn-area"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                      >
                        <motion.button
                          className="ns-btn primary"
                          onClick={handleUpload}
                          disabled={isUploading || selectedFiles.length === 0}
                          whileHover={isUploading ? {} : { scale: 1.02, boxShadow: '0 14px 36px rgba(88,166,255,0.40)' }}
                          whileTap={isUploading ? {} : { scale: 0.98 }}
                          style={{ width: '100%', justifyContent: 'center', gap: 10, fontSize: '1rem' }}
                        >
                          {isUploading ? (
                            <>
                              <span style={{
                                display: 'inline-block', width: 16, height: 16,
                                borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.3)',
                                borderTopColor: '#fff', animation: 'ns-spin 0.7s linear infinite',
                              }} />
                              Uploading…
                            </>
                          ) : (
                            <>
                              <span>📤</span>
                              Send to {targetLabel}
                              <span style={{ opacity: 0.65, fontSize: '0.80rem', fontWeight: 500 }}>
                                ⌘↵
                              </span>
                            </>
                          )}
                        </motion.button>

                        {/* Progress bar */}
                        <AnimatePresence>
                          {isUploading && (
                            <motion.div
                              key="progress"
                              initial={{ opacity: 0, scaleY: 0 }}
                              animate={{ opacity: 1, scaleY: 1 }}
                              exit={{ opacity: 0 }}
                              style={{ transformOrigin: 'top' }}
                            >
                              <div className="ns-progress">
                                <motion.div
                                  className="ns-progress-bar"
                                  animate={{ width: `${uploadProgress}%` }}
                                  transition={{ ease: 'easeOut', duration: 0.3 }}
                                />
                              </div>
                              <div style={{
                                textAlign: 'right', fontSize: '0.76rem',
                                color: 'var(--text-3)', marginTop: 4,
                              }}>
                                {uploadProgress}%
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* ── History tab ────────────────────────────────────────────── */}
              {activeTab === 'history' && (
                <motion.div
                  key="history-tab"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <AnimatePresence initial={false}>
                    {transfers.length > 0 ? (
                      transfers.map((upload, i) => (
                        <HistoryCard key={upload.id ?? i} upload={upload} />
                      ))
                    ) : (
                      <motion.div
                        key="empty-history"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="ns-empty"
                        style={{ padding: '48px 0' }}
                      >
                        <div style={{ fontSize: '2rem', marginBottom: 10 }}>📭</div>
                        No transfers yet — send some files!
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </section>
      </main>

      {/* ── Desktop receiving drag portal ────────────────────────────────── */}
      <DragPortal isMobile={false} sendMessage={sendMessage} uploadFiles={uploadFiles} />
    </div>
  )
}
