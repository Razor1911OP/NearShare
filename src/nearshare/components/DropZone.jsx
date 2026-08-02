import React, { useRef, useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'

// ─── Spin keyframe (injected once) ───────────────────────────────────────────

const SPIN_CSS = `@keyframes ns-spin { to { transform: rotate(360deg); } }`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b) {
  if (!b || b === 0) return '0 B'
  const k     = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i     = Math.min(Math.floor(Math.log(b) / Math.log(k)), units.length - 1)
  return `${i === 0 ? b : (b / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

// ─── Recursive directory walker ───────────────────────────────────────────────
// Traverses a FileSystemEntry tree and collects all leaf files with relative paths.

async function walkEntry(entry, basePath = '') {
  const myPath = basePath ? `${basePath}/${entry.name}` : entry.name

  if (entry.isFile) {
    return new Promise(resolve =>
      entry.file(f => resolve([{ file: f, relativePath: myPath }]), () => resolve([]))
    )
  }

  if (entry.isDirectory) {
    const reader  = entry.createReader()
    const results = []

    await new Promise(resolve => {
      const readBatch = () => {
        reader.readEntries(async batch => {
          if (!batch.length) return resolve()
          for (const child of batch) {
            const sub = await walkEntry(child, myPath)
            results.push(...sub)
          }
          readBatch()
        }, () => resolve())
      }
      readBatch()
    })

    return results
  }

  return []
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

export default function DropZone({ sendMessage, uploadFiles, isUploading, uploadProgress }) {
  const [state, dispatch] = useApp()
  const { selectedFiles, selectedTargetId, devices } = state

  const [isDragging, setIsDragging]     = useState(false)
  const counterRef                       = useRef(0)
  const fileInputRef                     = useRef(null)
  const folderInputRef                   = useRef(null)

  // ── Spring-driven glow intensity ─────────────────────────────────────────
  // Raw motion value (0 = idle, 1 = dragging) → smoothed via spring
  const glowRaw    = useMotionValue(0)
  const glowSpring = useSpring(glowRaw, { stiffness: 300, damping: 28, mass: 0.8 })

  useEffect(() => {
    glowRaw.set(isDragging ? 1 : 0)
  }, [isDragging, glowRaw])

  // ── Dispatch helpers ──────────────────────────────────────────────────────

  const addEntries = useCallback((raw) => {
    if (!raw.length) return
    const payload = raw.map(({ file, relativePath }) => ({
      file,
      relativePath: relativePath || file.name,
      preview:      null,
      key:          `${relativePath || file.name}:${file.size}`,
    }))
    dispatch({ type: 'ADD_FILES', payload })
  }, [dispatch])

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleDragEnter = useCallback(e => {
    e.preventDefault()
    e.stopPropagation()
    counterRef.current++
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(e => {
    e.preventDefault()
    e.stopPropagation()
    counterRef.current = Math.max(0, counterRef.current - 1)
    if (counterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback(e => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(async e => {
    e.preventDefault()
    e.stopPropagation()
    counterRef.current = 0
    setIsDragging(false)

    const items     = Array.from(e.dataTransfer.items || [])
    const collected = []

    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      if (entry) {
        const walked = await walkEntry(entry)
        collected.push(...walked)
      } else {
        const f = item.getAsFile()
        if (f) collected.push({ file: f, relativePath: f.name })
      }
    }

    addEntries(collected)
  }, [addEntries])

  // ── File input handlers ───────────────────────────────────────────────────

  const handleFileInput = useCallback(e => {
    const raw = Array.from(e.target.files || []).map(f => ({
      file:         f,
      relativePath: f.webkitRelativePath || f.name,
    }))
    addEntries(raw)
    e.target.value = ''
  }, [addEntries])

  const handleFolderInput = useCallback(e => {
    const raw = Array.from(e.target.files || []).map(f => ({
      file:         f,
      relativePath: f.webkitRelativePath || f.name,
    }))
    addEntries(raw)
    e.target.value = ''
  }, [addEntries])

  // ── Derived values ────────────────────────────────────────────────────────

  const totalBytes  = selectedFiles.reduce((s, e) => s + e.file.size, 0)
  const fileCount   = selectedFiles.length
  const target      = devices.find(d => d.id === selectedTargetId)
  const targetName  = target?.name || (selectedTargetId === 'host' ? 'Host' : 'All devices')

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{SPIN_CSS}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── Drop surface ─────────────────────────────────────────────── */}
        <div
          style={{ position: 'relative' }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Springy glow overlay (driven by useSpring) */}
          <motion.div
            aria-hidden
            style={{
              position:     'absolute',
              inset:        -2,
              borderRadius: 'calc(var(--r-lg) + 2px)',
              background:   'radial-gradient(ellipse at 50% 0%, rgba(129,154,148,0.22) 0%, transparent 70%)',
              boxShadow:    '0 0 48px rgba(129,154,148,0.28)',
              opacity:      glowSpring,
              pointerEvents:'none',
              zIndex:       0,
            }}
          />

          <motion.div
            animate={{
              scale:       isDragging ? 1.012 : 1,
              background:  isDragging ? 'rgba(129,154,148,0.055)' : 'rgba(255,255,255,0.018)',
              borderColor: isDragging ? 'rgba(129,154,148,0.80)' : 'rgba(255,255,255,0.13)',
            }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position:       'relative',
              zIndex:         1,
              border:         '2px dashed rgba(255,255,255,0.13)',
              borderRadius:   'var(--r-lg)',
              minHeight:      260,
              padding:        '36px 28px',
              textAlign:      'center',
              cursor:         'default',
              userSelect:     'none',
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            20,
              overflow:       'hidden',
            }}
          >
            {/* Background grid shimmer when dragging */}
            <AnimatePresence>
              {isDragging && (
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  style={{
                    position:        'absolute',
                    inset:           0,
                    backgroundImage: `radial-gradient(circle, rgba(129,154,148,0.06) 1px, transparent 1px)`,
                    backgroundSize:  '28px 28px',
                    pointerEvents:   'none',
                  }}
                />
              )}
            </AnimatePresence>

            {/* Icon box */}
            <motion.div
              animate={{
                scale:     isDragging ? 1.20 : 1,
                rotate:    isDragging ? 6 : 0,
                boxShadow: isDragging
                  ? '0 0 56px rgba(129,154,148,0.60), 0 0 24px rgba(233,131,137,0.30)'
                  : '0 0 28px rgba(129,154,148,0.30)',
              }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              style={{
                width:           76,
                height:          76,
                borderRadius:    22,
                background:      'linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%)',
                display:         'grid',
                placeItems:      'center',
                fontSize:        '2.1rem',
                flexShrink:      0,
                position:        'relative',
                zIndex:          1,
              }}
            >
              ⇄
            </motion.div>

            {/* Heading + subtext */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              <motion.div
                animate={{ color: isDragging ? 'var(--brand)' : 'var(--text)' }}
                transition={{ duration: 0.2 }}
                style={{ fontWeight: 800, fontSize: '1.08rem', marginBottom: 8, letterSpacing: '-0.01em' }}
              >
                {isDragging ? 'Release to add files' : 'Drop files or folders here'}
              </motion.div>
              <div style={{
                color:      'var(--text-2)',
                fontSize:   '0.87rem',
                lineHeight: 1.6,
                maxWidth:   360,
                margin:     '0 auto',
              }}>
                Select files, drag from your device, or use the gesture pad on mobile
              </div>
            </div>

            {/* Action buttons */}
            <div style={{
              display:        'flex',
              gap:            8,
              flexWrap:       'wrap',
              justifyContent: 'center',
              position:       'relative',
              zIndex:         1,
            }}>
              <motion.button
                className="ns-btn primary sm"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => fileInputRef.current?.click()}
              >
                <span>📄</span> Select files
              </motion.button>

              <motion.button
                className="ns-btn sm"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => folderInputRef.current?.click()}
              >
                <span>🗂</span> Select folder
              </motion.button>

              <motion.button
                className="ns-btn sm danger"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                disabled={fileCount === 0}
                onClick={() => dispatch({ type: 'CLEAR_FILES' })}
              >
                <span>✕</span> Clear all
              </motion.button>
            </div>

            {/* Hidden inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
            <input
              ref={folderInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFolderInput}
              {...{ webkitdirectory: '', directory: '', multiple: true }}
            />
          </motion.div>
        </div>

        {/* ── Send bar (appears when files are staged) ──────────────────── */}
        <AnimatePresence>
          {fileCount > 0 && (
            <motion.div
              key="send-bar"
              initial={{ opacity: 0, y: 14, scaleY: 0.88 }}
              animate={{ opacity: 1, y: 0,  scaleY: 1 }}
              exit={{    opacity: 0, y: 10, scaleY: 0.92 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              style={{
                background:     'rgba(255,255,255,0.038)',
                border:         '1px solid var(--border-hi)',
                borderRadius:   'var(--r)',
                padding:        '13px 16px',
                display:        'flex',
                flexDirection:  'column',
                gap:            10,
                transformOrigin:'top',
              }}
            >
              {/* Summary row */}
              <div style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                gap:            12,
                flexWrap:       'wrap',
              }}>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-2)' }}>
                  <strong style={{ color: 'var(--text)', fontWeight: 700 }}>
                    {fileCount} {fileCount === 1 ? 'item' : 'items'}
                  </strong>
                  {' • '}
                  <span>{formatBytes(totalBytes)}</span>
                  <span style={{ color: 'var(--text-3)' }}> selected</span>
                </div>

                <motion.button
                  className="ns-btn primary sm"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  disabled={isUploading}
                  onClick={() => uploadFiles?.()}
                  style={{ flexShrink: 0 }}
                >
                  {isUploading ? (
                    <>
                      <span style={{
                        display:        'inline-block',
                        width:          14,
                        height:         14,
                        borderRadius:   '50%',
                        border:         '2px solid rgba(255,255,255,0.28)',
                        borderTopColor: '#fff',
                        animation:      'ns-spin 0.72s linear infinite',
                        flexShrink:     0,
                      }} />
                      Uploading…
                    </>
                  ) : (
                    `↑ Send to ${targetName}`
                  )}
                </motion.button>
              </div>

              {/* Progress bar */}
              <AnimatePresence>
                {isUploading && (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{    opacity: 0, height: 0 }}
                    transition={{ duration: 0.22 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="ns-progress">
                      <motion.div
                        className="ns-progress-bar"
                        animate={{ width: `${uploadProgress ?? 0}%` }}
                        transition={{ ease: 'easeOut', duration: 0.28 }}
                        style={{ width: `${uploadProgress ?? 0}%` }}
                      />
                    </div>
                    <div style={{
                      marginTop:  5,
                      fontSize:   '0.74rem',
                      color:      'var(--text-3)',
                      textAlign:  'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {uploadProgress ?? 0}%
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </>
  )
}
