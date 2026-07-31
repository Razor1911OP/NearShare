import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'
import useTransfer, { generatePreview } from '../hooks/useTransfer.js'
import DeviceOrbit from '../components/DeviceOrbit.jsx'
import DragPortal from '../components/DragPortal.jsx'

// ─── Spin keyframe (shared with other components) ─────────────────────────────
const SPIN_CSS = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  const val = bytes / Math.pow(k, i)
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`
}

function getFileIcon(filename = '', mime = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','heic','avif','bmp'].includes(ext)) return '🖼️'
  if (mime.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return '🎬'
  if (mime.startsWith('audio/') || ['mp3','aac','flac','wav','ogg','m4a'].includes(ext)) return '🎵'
  if (ext === 'pdf') return '📄'
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return '🗜️'
  if (['doc','docx','txt','md','rtf'].includes(ext)) return '📝'
  if (['xls','xlsx','csv'].includes(ext)) return '📊'
  if (['ppt','pptx'].includes(ext)) return '🗂️'
  if (['js','jsx','ts','tsx','py','rs','go','java','cpp','c','html','css','json'].includes(ext)) return '💻'
  return '📎'
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Bottom nav tab ids ───────────────────────────────────────────────────────
const TABS = [
  { id: 'send',    icon: '📤', label: 'Send'    },
  { id: 'devices', icon: '📡', label: 'Devices' },
  { id: 'history', icon: '📋', label: 'History' },
]

// ─── Socket status badge ──────────────────────────────────────────────────────
function StatusDot({ status }) {
  const colors = {
    connected:    'var(--good)',
    connecting:   'var(--warn)',
    disconnected: 'var(--text-3)',
  }
  const color = colors[status] ?? colors.disconnected

  return (
    <motion.div
      animate={status === 'connecting'
        ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }
        : { scale: 1, opacity: 1 }
      }
      transition={status === 'connecting'
        ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
        : {}
      }
      style={{
        width:        8,
        height:       8,
        borderRadius: '50%',
        background:   color,
        flexShrink:   0,
        boxShadow:    status === 'connected' ? `0 0 6px ${color}` : 'none',
      }}
    />
  )
}

// ─── Mobile file chip (touch-friendly, swipe-to-remove) ──────────────────────
function MobileFileChip({ entry, onRemove }) {
  const { file, preview, key } = entry

  const x         = useMotionValue(0)
  const background = useSpring(0, { stiffness: 200, damping: 24 })
  const dragRef   = useRef(false)

  const icon = getFileIcon(file.name, file.type)
  const isImg = !!preview

  return (
    <motion.div
      layout
      drag="x"
      dragConstraints={{ left: -80, right: 0 }}
      dragElastic={{ left: 0.25, right: 0.05 }}
      onDragStart={() => { dragRef.current = true }}
      onDragEnd={(_, info) => {
        dragRef.current = false
        if (info.offset.x < -60) {
          onRemove(key)
        } else {
          x.set(0)
        }
      }}
      initial={{ opacity: 0, x: -16, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.90 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      style={{
        x,
        display:        'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap:            10,
        alignItems:     'center',
        padding:        '11px 13px',
        borderRadius:   'var(--r)',
        background:     'rgba(255,255,255,0.04)',
        border:         '1px solid var(--border)',
        touchAction:    'pan-y',
        cursor:         'grab',
        userSelect:     'none',
        overflow:       'hidden',
        position:       'relative',
      }}
    >
      {/* Delete hint behind */}
      <div style={{
        position:       'absolute',
        right:          0,
        top:            0,
        bottom:         0,
        width:          80,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'linear-gradient(90deg, transparent, rgba(248,81,73,0.85))',
        borderRadius:   'var(--r)',
        pointerEvents:  'none',
        color:          '#fff',
        fontSize:       '1rem',
        fontWeight:     700,
      }}>
        ✕
      </div>

      {/* File icon / thumbnail */}
      {isImg ? (
        <img
          src={preview}
          alt=""
          style={{
            width: 38, height: 38, borderRadius: 8,
            objectFit: 'cover', flexShrink: 0,
            border: '1px solid var(--border)',
          }}
        />
      ) : (
        <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      )}

      {/* Name + size */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight:     600,
          fontSize:       '0.88rem',
          overflow:       'hidden',
          textOverflow:   'ellipsis',
          whiteSpace:     'nowrap',
        }}>
          {file.name}
        </div>
        <div style={{ color: 'var(--text-2)', fontSize: '0.75rem', marginTop: 2 }}>
          {formatBytes(file.size)}
        </div>
      </div>

      {/* Remove button */}
      <motion.button
        className="ns-btn ghost icon sm"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(key) }}
        whileTap={{ scale: 0.88 }}
        aria-label={`Remove ${file.name}`}
        style={{
          minHeight:    'unset',
          width:        28,
          height:       28,
          borderRadius: 8,
          padding:      0,
          flexShrink:   0,
          fontSize:     '1.1rem',
          color:        'var(--text-3)',
        }}
      >
        ×
      </motion.button>
    </motion.div>
  )
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function downloadHref(upload, file) {
  return `/api/download/${encodeURIComponent(upload.uploadId)}/${encodeURIComponent(file.relativePath)}`
}

function downloadAllFiles(upload) {
  for (const f of upload.files || []) {
    const a = document.createElement('a')
    a.href = downloadHref(upload, f)
    a.download = f.originalName || f.relativePath.split('/').pop() || 'file'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

// ─── History card (compact for mobile) ───────────────────────────────────────
function MobileHistoryCard({ upload, index }) {
  const isIncoming = !upload.gestureMode
  const totalBytes = upload.files?.reduce((s, f) => s + (f.bytes ?? 0), 0) ?? 0
  const firstName  = upload.files?.[0]?.originalName ?? upload.files?.[0]?.relativePath ?? 'Unknown'
  const canDownload = !!upload.uploadId && Array.isArray(upload.files) && upload.files.length > 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 380, damping: 28 }}
      style={{
        display:        'flex',
        flexDirection:  'column',
        gap:            10,
        padding:        '13px 14px',
        borderRadius:  'var(--r)',
        background:    'rgba(255,255,255,0.03)',
        border:        '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: 1 }}>
          {isIncoming ? '📥' : '📤'}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight:   600,
            fontSize:     '0.88rem',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            lineHeight:   1.3,
          }}>
            {firstName}
            {upload.fileCount > 1 && (
              <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>
                {' '}+{upload.fileCount - 1}
              </span>
            )}
          </div>
          <div style={{ color: 'var(--text-3)', fontSize: '0.74rem', marginTop: 3 }}>
            {isIncoming ? `From ${upload.senderName}` : `Sent · ${formatBytes(totalBytes)}`}
            {' · '}{formatTime(upload.receivedAt)}
          </div>
        </div>

        <span style={{
          color:      'var(--good)',
          fontSize:   '0.76rem',
          fontWeight: 700,
          flexShrink: 0,
          paddingTop: 2,
        }}>
          ✓
        </span>
      </div>

      {/* Download button */}
      {canDownload && (
        <button
          className="ns-btn sm"
          onClick={() => downloadAllFiles(upload)}
          style={{ fontSize: '0.78rem', minHeight: 34 }}
        >
          ⬇ Download{upload.fileCount > 1 ? ` all (${upload.fileCount})` : ''}
        </button>
      )}
    </motion.div>
  )
}

// ─── Send Tab ─────────────────────────────────────────────────────────────────
function SendTab({ sendMessage, uploadFiles, isUploading, uploadProgress }) {
  const [state, dispatch] = useApp()
  const { selectedFiles, selectedTargetId, devices } = state
  const fileInputRef = useRef(null)

  const totalBytes = selectedFiles.reduce((s, f) => s + (f.file?.size ?? 0), 0)
  const fileCount  = selectedFiles.length

  const targetDevice  = devices?.find(d => d.id === selectedTargetId)
  const targetLabel   = selectedTargetId === 'host'
    ? 'Host'
    : (targetDevice?.name ?? 'Target Device')

  // ── Add files ──────────────────────────────────────────────────────────────
  const handleFileInput = useCallback(async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    e.target.value = ''

    const entries = await Promise.all(
      files.map(async (f) => {
        const preview = generatePreview(f)
        const key     = `${f.name}:${f.size}:${f.lastModified}`
        return { file: f, relativePath: f.name, preview, key }
      })
    )
    dispatch({ type: 'ADD_FILES', payload: entries })
  }, [dispatch])

  const handleRemove = useCallback((key) => {
    dispatch({ type: 'REMOVE_FILE', payload: key })
  }, [dispatch])

  const handleClear = useCallback(() => {
    dispatch({ type: 'CLEAR_FILES' })
  }, [dispatch])

  const handleSend = useCallback(async () => {
    if (isUploading || fileCount === 0) return
    try {
      await uploadFiles({ gestureMode: false, targetId: selectedTargetId })
    } catch (_) {
      // Error toast already shown by useTransfer
    }
  }, [isUploading, fileCount, uploadFiles, selectedTargetId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Scrollable staged list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 0' }}>

        {/* Pick files button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />

        <motion.button
          className="ns-btn"
          onClick={() => fileInputRef.current?.click()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          style={{
            width:          '100%',
            justifyContent: 'center',
            gap:            10,
            background:     'rgba(88,166,255,0.08)',
            border:         '2px dashed rgba(88,166,255,0.28)',
            borderRadius:   'var(--r)',
            padding:        '18px 14px',
            flexDirection:  'column',
            minHeight:      fileCount === 0 ? 140 : 60,
            transition:     'min-height 0.3s ease',
          }}
        >
          <span style={{ fontSize: fileCount === 0 ? '2rem' : '1.2rem', lineHeight: 1 }}>
            📁
          </span>
          <span style={{
            fontWeight: 600,
            fontSize:   fileCount === 0 ? '0.95rem' : '0.85rem',
            color:      'var(--text-2)',
          }}>
            {fileCount === 0 ? 'Tap to choose files' : 'Add more files'}
          </span>
          {fileCount === 0 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
              Images, videos, documents, anything
            </span>
          )}
        </motion.button>

        {/* Staged files list */}
        <AnimatePresence initial={false}>
          {fileCount > 0 && (
            <motion.div
              key="staged-list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22,1,0.36,1] }}
              style={{ overflow: 'hidden', marginTop: 14 }}
            >
              {/* Header */}
              <div style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                marginBottom:   10,
              }}>
                <span className="ns-label" style={{ marginBottom: 0 }}>
                  {fileCount} file{fileCount !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
                </span>
                <button
                  className="ns-btn ghost sm"
                  onClick={handleClear}
                  style={{ color: 'var(--bad)', borderColor: 'rgba(248,81,73,0.20)', minHeight: 'unset', padding: '4px 10px', fontSize: '0.76rem' }}
                >
                  Clear
                </button>
              </div>

              {/* Swipe-to-remove hint (shows once) */}
              <motion.div
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  fontSize:    '0.72rem',
                  color:       'var(--text-3)',
                  textAlign:   'center',
                  marginBottom: 8,
                  display:     'flex',
                  alignItems:  'center',
                  justifyContent:'center',
                  gap:         5,
                }}
              >
                <span>←</span> Swipe left to remove
              </motion.div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <AnimatePresence initial={false}>
                  {selectedFiles.map(entry => (
                    <MobileFileChip
                      key={entry.key}
                      entry={entry}
                      onRemove={handleRemove}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Target info line */}
        <AnimatePresence>
          {fileCount > 0 && (
            <motion.div
              key="target-info"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            7,
                marginTop:      16,
                fontSize:       '0.80rem',
                color:          'var(--text-3)',
              }}
            >
              <span>Sending to</span>
              <span style={{
                color:       'var(--brand)',
                fontWeight:  700,
                background:  'rgba(88,166,255,0.10)',
                border:      '1px solid rgba(88,166,255,0.25)',
                borderRadius: 999,
                padding:     '2px 10px',
              }}>
                {targetLabel}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        <AnimatePresence>
          {fileCount === 0 && (
            <motion.div
              key="empty-send"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="ns-empty"
              style={{ paddingTop: 28 }}
            >
              <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>✨</div>
              Pick files above, then tap Send to transfer
              <br />
              <span style={{ fontSize: '0.74rem', opacity: 0.7 }}>
                Or hold &amp; drag the pill to do it gesturally
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom padding for send button */}
        <div style={{ height: fileCount > 0 ? 110 : 16 }} />
      </div>

      {/* ── Send button — pinned at bottom of tab ─────────────────────────── */}
      <AnimatePresence>
        {fileCount > 0 && (
          <motion.div
            key="send-footer"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            style={{
              padding:        '10px 14px 12px',
              borderTop:      '1px solid var(--border)',
              background:     'var(--surface)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              flexShrink:     0,
            }}
          >
            {/* Progress */}
            <AnimatePresence>
              {isUploading && (
                <motion.div
                  key="mob-progress"
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ transformOrigin: 'top', marginBottom: 8 }}
                >
                  <div className="ns-progress">
                    <motion.div
                      className="ns-progress-bar"
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ ease: 'easeOut', duration: 0.25 }}
                    />
                  </div>
                  <div style={{
                    textAlign:  'right',
                    fontSize:   '0.72rem',
                    color:      'var(--text-3)',
                    marginTop:  3,
                  }}>
                    {uploadProgress}%
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              className="ns-btn primary"
              onClick={handleSend}
              disabled={isUploading || fileCount === 0}
              whileHover={isUploading ? {} : { scale: 1.02 }}
              whileTap={isUploading ? {} : { scale: 0.97 }}
              style={{
                width:          '100%',
                justifyContent: 'center',
                gap:            10,
                fontSize:       '1rem',
                minHeight:      50,
              }}
            >
              {isUploading ? (
                <>
                  <span style={{
                    display:        'inline-block',
                    width:          18,
                    height:         18,
                    borderRadius:   '50%',
                    border:         '2.5px solid rgba(255,255,255,0.28)',
                    borderTopColor: '#fff',
                    animation:      'ns-spin 0.7s linear infinite',
                    flexShrink:     0,
                  }} />
                  Sending…
                </>
              ) : (
                <>
                  <span>📤</span>
                  Send {fileCount} file{fileCount !== 1 ? 's' : ''} to {targetLabel}
                </>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Devices Tab ──────────────────────────────────────────────────────────────
function DevicesTab() {
  const [state, dispatch] = useApp()
  const { devices, selectedTargetId } = state

  return (
    <div style={{ overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Orbit */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
        <DeviceOrbit />
      </div>

      <hr className="ns-divider" />

      {/* Target list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="ns-label">Send target</span>

        {/* Host row */}
        <motion.div
          className={`ns-device-card${selectedTargetId === 'host' ? ' selected' : ''}`}
          onClick={() => dispatch({ type: 'SET_TARGET', payload: 'host' })}
          whileTap={{ scale: 0.98 }}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_TARGET', payload: 'host' })}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
              display: 'grid', placeItems: 'center',
              fontSize: '1.1rem', flexShrink: 0,
            }}>
              📡
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Host (Server)</div>
              <div style={{ color: 'var(--text-3)', fontSize: '0.76rem', marginTop: 2 }}>
                Files saved to shared-inbox
              </div>
            </div>
          </div>
          <span className="ns-badge online">
            <span className="ns-dot-pulse" />
            On
          </span>
        </motion.div>

        {/* Other devices */}
        <AnimatePresence initial={false}>
          {devices.map((d, i) => {
            const online = d.online !== false
            const sel    = selectedTargetId === d.id
            return (
              <motion.div
                key={d.id}
                className={`ns-device-card${sel ? ' selected' : ''}`}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 30 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => dispatch({ type: 'SET_TARGET', payload: d.id })}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && dispatch({ type: 'SET_TARGET', payload: d.id })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: online
                      ? 'linear-gradient(145deg, rgba(28,42,64,0.95), rgba(16,26,46,0.95))'
                      : 'rgba(30,38,52,0.6)',
                    border: `2px solid ${online ? 'rgba(63,185,80,0.45)' : 'rgba(255,255,255,0.08)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.1rem', fontWeight: 800,
                    color: online ? 'var(--text)' : 'var(--text-3)',
                    flexShrink: 0,
                  }}>
                    {(d.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: '0.9rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {d.name || 'Unknown'}
                    </div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.76rem', marginTop: 2 }}>
                      {d.uploads ?? 0} transfer{d.uploads !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <span className={`ns-badge ${online ? 'online' : 'offline'}`}>
                  {online ? <><span className="ns-dot-pulse" />On</> : 'Off'}
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {devices.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="ns-empty"
          >
            <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>📱</div>
            No other devices yet.
            <br />
            Scan the QR code on the Pair screen to add one.
          </motion.div>
        )}
      </div>

      {/* Bottom padding for nav */}
      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function HistoryTab() {
  const [state] = useApp()
  const { transfers } = state

  return (
    <div style={{ overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <AnimatePresence initial={false}>
        {transfers.length > 0 ? (
          transfers.map((upload, i) => (
            <MobileHistoryCard key={upload.id ?? i} upload={upload} index={i} />
          ))
        ) : (
          <motion.div
            key="empty-history"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="ns-empty"
            style={{ paddingTop: 48 }}
          >
            <div style={{ fontSize: '2rem', marginBottom: 10 }}>📭</div>
            No transfers yet.
            <br />
            <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>
              Files you send or receive will appear here.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ height: 8 }} />
    </div>
  )
}

// ─── MobileView ───────────────────────────────────────────────────────────────
export default function MobileView({ sendMessage, isMobile }) {
  const [state, dispatch] = useApp()
  const { uploadFiles, isUploading, uploadProgress } = useTransfer(sendMessage)

  const {
    socketStatus,
    pairingCode,
    deviceName,
    selectedFiles,
    incomingDrag,
  } = state

  const [activeTab, setActiveTab] = useState('send')

  // When an incoming drag starts, surface the send tab so user can see the
  // incoming ghost overlay (handled by DragPortal, desktop mode NOT shown here
  // since this IS the mobile sender — but if somehow this device is a receiver
  // too, show an indicator on devices tab)
  useEffect(() => {
    if (incomingDrag) {
      setActiveTab('devices')
    }
  }, [!!incomingDrag])  // eslint-disable-line react-hooks/exhaustive-deps

  const fileCount = selectedFiles?.length ?? 0

  return (
    <>
      <style>{SPIN_CSS}</style>

      <div className="ns-layout">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="ns-header">
          {/* Logo */}
          <div className="ns-logo">
            <div className="ns-logo-icon" style={{ width: 32, height: 32, borderRadius: 9, fontSize: '1rem' }}>
              📡
            </div>
            <span style={{ fontSize: '1rem' }}>NearShare</span>
          </div>

          {/* Status + code */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={socketStatus} />

            {pairingCode && (
              <span
                onClick={() => navigator.clipboard?.writeText(pairingCode)}
                style={{
                  fontFamily:   'ui-monospace, monospace',
                  fontSize:     '0.76rem',
                  color:        'var(--text-3)',
                  background:   'rgba(255,255,255,0.05)',
                  border:       '1px solid var(--border)',
                  borderRadius: 6,
                  padding:      '2px 8px',
                  letterSpacing:'0.1em',
                  cursor:       'pointer',
                }}
              >
                {pairingCode}
              </span>
            )}

            {/* Disconnect */}
            <motion.button
              className="ns-btn ghost sm icon"
              onClick={() => dispatch({ type: 'UNPAIR' })}
              whileTap={{ scale: 0.88 }}
              title="Disconnect"
              style={{ minHeight: 'unset', width: 32, height: 32, borderRadius: 9 }}
            >
              ⏏
            </motion.button>
          </div>
        </header>

        {/* ── Main content area ────────────────────────────────────────────── */}
        <main style={{ overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              {activeTab === 'send' && (
                <SendTab
                  sendMessage={sendMessage}
                  uploadFiles={uploadFiles}
                  isUploading={isUploading}
                  uploadProgress={uploadProgress}
                />
              )}
              {activeTab === 'devices' && <DevicesTab />}
              {activeTab === 'history' && <HistoryTab />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* ── Bottom navigation ────────────────────────────────────────────── */}
        <nav style={{
          display:        'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop:      '1px solid var(--border)',
          background:     'var(--surface)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id

            // Badge count
            let badge = null
            if (tab.id === 'send' && fileCount > 0) badge = fileCount
            if (tab.id === 'history' && state.transfers.length > 0) badge = state.transfers.length

            // Dot indicator for incoming drag on devices tab
            const showPulse = tab.id === 'devices' && !!incomingDrag

            return (
              <motion.button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                whileTap={{ scale: 0.92 }}
                style={{
                  display:        'flex',
                  flexDirection:  'column',
                  alignItems:     'center',
                  justifyContent: 'center',
                  gap:            3,
                  border:         'none',
                  background:     'transparent',
                  cursor:         'pointer',
                  padding:        '8px 4px',
                  position:       'relative',
                }}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* Active indicator pill */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      style={{
                        position:    'absolute',
                        top:         6,
                        left:        '50%',
                        translateX:  '-50%',
                        width:       32,
                        height:      32,
                        borderRadius: '50%',
                        background:  'rgba(88,166,255,0.12)',
                        zIndex:      0,
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Icon */}
                <motion.span
                  animate={{
                    scale:  isActive ? 1.15 : 1,
                    filter: isActive ? 'none' : 'grayscale(0.3) opacity(0.7)',
                  }}
                  transition={{ type: 'spring', stiffness: 480, damping: 28 }}
                  style={{
                    fontSize:   '1.2rem',
                    lineHeight: 1,
                    position:   'relative',
                    zIndex:     1,
                  }}
                >
                  {tab.icon}

                  {/* Count badge */}
                  {badge != null && (
                    <motion.span
                      key={badge}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                      style={{
                        position:     'absolute',
                        top:          -5,
                        right:        -8,
                        background:   'var(--brand)',
                        color:        '#fff',
                        fontSize:     '0.58rem',
                        fontWeight:   800,
                        borderRadius: 999,
                        padding:      '1px 4px',
                        lineHeight:   1.3,
                        border:       '1.5px solid var(--bg)',
                        minWidth:     14,
                        textAlign:    'center',
                      }}
                    >
                      {badge > 99 ? '99+' : badge}
                    </motion.span>
                  )}

                  {/* Pulse dot for incoming drag */}
                  {showPulse && (
                    <motion.span
                      animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                      style={{
                        position:     'absolute',
                        top:          -4,
                        right:        -6,
                        width:        8,
                        height:       8,
                        borderRadius: '50%',
                        background:   'var(--brand)',
                        border:       '1.5px solid var(--bg)',
                      }}
                    />
                  )}
                </motion.span>

                {/* Label */}
                <motion.span
                  animate={{ color: isActive ? 'var(--brand)' : 'var(--text-3)' }}
                  transition={{ duration: 0.18 }}
                  style={{
                    fontSize:   '0.65rem',
                    fontWeight: isActive ? 700 : 500,
                    lineHeight: 1,
                    position:   'relative',
                    zIndex:     1,
                  }}
                >
                  {tab.label}
                </motion.span>
              </motion.button>
            )
          })}
        </nav>
      </div>

      {/* ── Mobile drag portal — floats above everything ──────────────────── */}
      {/* Only renders when files are selected (fileCount > 0) */}
      <DragPortal
        isMobile={true}
        sendMessage={sendMessage}
        uploadFiles={uploadFiles}
      />
    </>
  )
}
