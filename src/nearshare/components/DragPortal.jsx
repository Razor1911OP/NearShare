import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'

// ─── Constants ────────────────────────────────────────────────────────────────

const LONG_PRESS_MS    = 400    // ms before drag activates
const THROTTLE_MS      = 48     // ~20 fps for socket position updates
const RELEASE_ZONE     = 0.22   // top 22% of screen triggers send

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k     = 1024
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i     = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  const val   = bytes / Math.pow(k, i)
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`
}

function getFileIcon(filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const MAP = {
    // Images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️',
    svg: '🖼️', heic: '🖼️', avif: '🖼️', bmp: '🖼️',
    // Video
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    // Audio
    mp3: '🎵', aac: '🎵', flac: '🎵', wav: '🎵', ogg: '🎵', m4a: '🎵',
    // Docs
    pdf: '📄', doc: '📝', docx: '📝', txt: '📝', md: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📊', pptx: '📊',
    // Archives
    zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
    // Code
    js: '💻', jsx: '💻', ts: '💻', tsx: '💻', py: '💻',
    rs: '💻', go: '💻', java: '💻', cpp: '💻', c: '💻',
    html: '💻', css: '💻', json: '💻',
  }
  return MAP[ext] || '📎'
}

function makeSessionId() {
  return `drag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Particle Trail ───────────────────────────────────────────────────────────
// Each particle is a motion.div whose position springs with increasing lag,
// creating a natural comet-tail behind the dragged card.

const PARTICLES = [
  { stiffness: 180, damping: 24, mass: 1.0, size: 9,  opacity: 0.65, blur: 0   },
  { stiffness: 130, damping: 20, mass: 1.3, size: 7,  opacity: 0.45, blur: 0.5 },
  { stiffness: 90,  damping: 18, mass: 1.7, size: 5,  opacity: 0.30, blur: 1   },
  { stiffness: 60,  damping: 16, mass: 2.2, size: 3.5,opacity: 0.18, blur: 1.5 },
  { stiffness: 38,  damping: 14, mass: 2.8, size: 2.5,opacity: 0.10, blur: 2   },
]

// Separate component so each particle's springs are created unconditionally.
function ParticleTrail({ rawX, rawY, visible }) {
  // One pair of springs per particle, always mounted
  const springs = PARTICLES.map((p) => ({
    // eslint-disable-next-line react-hooks/rules-of-hooks
    sx: useSpring(rawX, { stiffness: p.stiffness, damping: p.damping, mass: p.mass }),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    sy: useSpring(rawY, { stiffness: p.stiffness, damping: p.damping, mass: p.mass }),
    ...p,
  }))

  return (
    <AnimatePresence>
      {visible && PARTICLES.map((p, i) => (
        <motion.div
          key={`particle-${i}`}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: p.opacity, scale: 1 }}
          exit={{ opacity: 0, scale: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position:     'fixed',
            left:         0,
            top:          0,
            x:            springs[i].sx,
            y:            springs[i].sy,
            translateX:   '-50%',
            translateY:   '-50%',
            width:        p.size,
            height:       p.size,
            borderRadius: '50%',
            background:   'var(--brand)',
            filter:       `blur(${p.blur}px)`,
            pointerEvents:'none',
            zIndex:       82,
          }}
        />
      ))}
    </AnimatePresence>
  )
}

// ─── Mobile Drag Portal (Sending) ─────────────────────────────────────────────

function MobileDragPortal({ sendMessage, uploadFiles }) {
  const [state] = useApp()
  const { selectedFiles, selectedTargetId, devices, deviceId, deviceName } = state

  // ── Drag state ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle') // 'idle' | 'pressing' | 'dragging' | 'releasing'
  const [nearTop, setNearTop]     = useState(false)
  const [dragResult, setDragResult] = useState(null) // 'sent' | 'cancelled' | null

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const longPressTimer  = useRef(null)
  const sessionId       = useRef(null)
  const throttleStamp   = useRef(0)
  const pointerIdRef    = useRef(null)
  const launchRef       = useRef(null)  // the pill element

  // ── Motion values for the draggable card ─────────────────────────────────────
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)

  const cardX = useSpring(rawX, { stiffness: 320, damping: 30, mass: 0.75 })
  const cardY = useSpring(rawY, { stiffness: 320, damping: 30, mass: 0.75 })

  // Rotate the card slightly as it moves (feels more physical)
  const cardRotate = useTransform(
    rawX,
    [0, window.innerWidth],
    [-4, 4]
  )

  // ── Derived ───────────────────────────────────────────────────────────────────
  const fileCount  = selectedFiles?.length ?? 0
  const totalBytes = useMemo(
    () => (selectedFiles ?? []).reduce((s, f) => s + (f.file?.size ?? 0), 0),
    [selectedFiles]
  )
  const isDragging = phase === 'dragging'
  const isPressing = phase === 'pressing'

  const targetDevice = devices?.find(d => d.id === selectedTargetId)
  const targetName   = selectedTargetId === 'host'
    ? 'Host'
    : (targetDevice?.name ?? 'Target Device')

  // ── Cleanup on unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    return () => clearTimeout(longPressTimer.current)
  }, [])

  // ── Pointer handlers ──────────────────────────────────────────────────────────

  const startDragSession = useCallback((clientX, clientY) => {
    sessionId.current = makeSessionId()
    rawX.set(clientX)
    rawY.set(clientY)
    setPhase('dragging')
    setNearTop(false)

    sendMessage({
      type:     'cross-drag-start',
      sessionId: sessionId.current,
      sender:   { id: deviceId, name: deviceName },
      fileInfo: {
        count:     fileCount,
        totalSize: totalBytes,
        files: (selectedFiles ?? []).map(f => ({
          name: f.file?.name ?? '',
          size: f.file?.size ?? 0,
          type: f.file?.type ?? '',
        })),
      },
    })
  }, [deviceId, deviceName, fileCount, totalBytes, selectedFiles, sendMessage, rawX, rawY])

  const onPointerDown = useCallback((e) => {
    if (fileCount === 0) return
    e.preventDefault()

    const clientX = e.clientX
    const clientY = e.clientY

    pointerIdRef.current = e.pointerId
    rawX.set(clientX)
    rawY.set(clientY)
    setPhase('pressing')

    longPressTimer.current = setTimeout(() => {
      startDragSession(clientX, clientY)
    }, LONG_PRESS_MS)
  }, [fileCount, rawX, rawY, startDragSession])

  const onPointerMove = useCallback((e) => {
    if (phase !== 'dragging' && phase !== 'pressing') return
    if (e.pointerId !== pointerIdRef.current) return

    const clientX = e.clientX
    const clientY = e.clientY

    rawX.set(clientX)
    rawY.set(clientY)

    if (phase !== 'dragging') return

    const normY = clientY / window.innerHeight
    setNearTop(normY < RELEASE_ZONE)

    // Throttled socket broadcast
    const now = Date.now()
    if (now - throttleStamp.current >= THROTTLE_MS) {
      throttleStamp.current = now
      sendMessage({
        type:      'cross-drag-move',
        sessionId: sessionId.current,
        x:         clientX / window.innerWidth,
        y:         normY,
      })
    }
  }, [phase, rawX, rawY, sendMessage])

  const finalizeDrag = useCallback(async (clientY) => {
    clearTimeout(longPressTimer.current)

    if (phase !== 'dragging') {
      setPhase('idle')
      return
    }

    const isRelease = (clientY / window.innerHeight) < RELEASE_ZONE
    setPhase('releasing')
    setDragResult(isRelease ? 'sent' : 'cancelled')

    if (isRelease) {
      sendMessage({
        type:      'cross-drag-drop',
        sessionId: sessionId.current,
        sender:    { id: deviceId, name: deviceName },
      })
      try {
        await uploadFiles({ gestureMode: true, targetId: selectedTargetId })
      } catch (err) {
        console.warn('[DragPortal] Upload failed:', err)
      }
    } else {
      sendMessage({
        type:      'cross-drag-cancel',
        sessionId: sessionId.current,
      })
    }

    // Reset after exit animation plays
    setTimeout(() => {
      setPhase('idle')
      setDragResult(null)
      setNearTop(false)
      rawX.set(0)
      rawY.set(0)
    }, 600)
  }, [phase, sendMessage, deviceId, deviceName, uploadFiles, selectedTargetId, rawX, rawY])

  const onPointerUp = useCallback((e) => {
    clearTimeout(longPressTimer.current)
    if (phase === 'pressing') { setPhase('idle'); return }
    finalizeDrag(e.clientY)
  }, [phase, finalizeDrag])

  const onPointerCancel = useCallback(() => {
    clearTimeout(longPressTimer.current)
    if (phase === 'dragging') {
      sendMessage({ type: 'cross-drag-cancel', sessionId: sessionId.current })
    }
    setPhase('idle')
    setNearTop(false)
    rawX.set(0)
    rawY.set(0)
  }, [phase, sendMessage, rawX, rawY])

  // ── Don't render if no files staged ─────────────────────────────────────────
  if (fileCount === 0) return null

  // ── Card exit variant depends on result ─────────────────────────────────────
  const cardExit = dragResult === 'sent'
    ? { opacity: 0, y: -220, scale: 0.65, rotate: -6, filter: 'blur(4px)' }
    : { opacity: 0, scale: 0.75, filter: 'blur(2px)' }

  const firstFile = selectedFiles?.[0]

  return (
    <>
      {/* ── Launch-pad pill ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'idle' && (
          <motion.div
            key="launch-pad"
            ref={launchRef}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 440, damping: 30 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={{
              position:   'fixed',
              bottom:     88,
              left:       '50%',
              translateX: '-50%',
              zIndex:     80,
              touchAction:'none',
              userSelect: 'none',
              cursor:     'grab',
            }}
          >
            <motion.div
              whileHover={{ scale: 1.04, boxShadow: '0 12px 36px rgba(129,154,148,0.35)' }}
              whileTap={{ scale: 0.97 }}
              className="ns-card"
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        12,
                padding:    '11px 20px',
                background: 'linear-gradient(135deg, rgba(129,154,148,0.16) 0%, rgba(233,131,137,0.13) 100%)',
                border:     '1px solid rgba(129,154,148,0.32)',
                boxShadow:  '0 6px 24px rgba(129,154,148,0.18)',
              }}
            >
              <span style={{ fontSize: '1.3rem' }}>
                {getFileIcon(firstFile?.file?.name)}
              </span>

              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>
                  {fileCount} file{fileCount !== 1 ? 's' : ''}&nbsp;
                  <span style={{ color: 'var(--text-2)', fontWeight: 400, fontSize: '0.82rem' }}>
                    · {formatBytes(totalBytes)}
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-2)', marginTop: 2 }}>
                  Hold &amp; drag up → {targetName}
                </div>
              </div>

              {/* Grip dots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.35 }}>
                {[0,1,2].map(r => (
                  <div key={r} style={{ display: 'flex', gap: 3 }}>
                    {[0,1].map(c => (
                      <div key={c} style={{
                        width: 3, height: 3, borderRadius: '50%',
                        background: 'var(--text-2)',
                      }} />
                    ))}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Long-press "charging" indicator ─────────────────────────────────── */}
      <AnimatePresence>
        {isPressing && (
          <motion.div
            key="press-ring"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            style={{
              position:   'fixed',
              bottom:     88,
              left:       '50%',
              translateX: '-50%',
              zIndex:     83,
              pointerEvents:'none',
            }}
          >
            <svg width={160} height={8}>
              <rect width={160} height={8} rx={4} fill="rgba(129,154,148,0.12)" />
              <motion.rect
                height={8} rx={4}
                fill="var(--brand)"
                initial={{ width: 0 }}
                animate={{ width: 160 }}
                transition={{ duration: LONG_PRESS_MS / 1000, ease: 'linear' }}
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Active drag state ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {isDragging && (
          <>
            {/* Dim overlay — shifts colour when near top */}
            <motion.div
              key="drag-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              style={{
                position:  'fixed',
                inset:     0,
                background: nearTop
                  ? 'rgba(129,154,148,0.06)'
                  : 'rgba(6,9,18,0.52)',
                zIndex:    75,
                touchAction:'none',
                transition:'background 0.3s ease',
              }}
            />

            {/* "Release to send" zone indicator at top */}
            <motion.div
              key="release-zone"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: nearTop ? 1 : 0.45, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              style={{
                position:      'fixed',
                top:           20,
                left:          '50%',
                translateX:    '-50%',
                zIndex:        86,
                pointerEvents: 'none',
                whiteSpace:    'nowrap',
              }}
            >
              <motion.div
                animate={{
                  scale:      nearTop ? [1, 1.04, 1] : 1,
                  background: nearTop
                    ? 'rgba(129,154,148,0.22)'
                    : 'rgba(129,154,148,0.09)',
                  borderColor: nearTop
                    ? 'rgba(129,154,148,0.70)'
                    : 'rgba(129,154,148,0.22)',
                  boxShadow:  nearTop
                    ? '0 0 32px rgba(129,154,148,0.40)'
                    : '0 0 0 rgba(129,154,148,0)',
                }}
                transition={{ scale: { duration: 0.8, repeat: nearTop ? Infinity : 0, ease: 'easeInOut' } }}
                style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            8,
                  padding:        '9px 20px',
                  borderRadius:   999,
                  border:         '1px solid rgba(129,154,148,0.22)',
                  fontSize:       '0.92rem',
                  fontWeight:     700,
                  color:          nearTop ? 'var(--brand)' : 'var(--text-2)',
                  transition:     'color 0.2s',
                }}
              >
                🚀 Release to send to {targetName}
              </motion.div>
            </motion.div>

            {/* Particle trail */}
            <ParticleTrail rawX={rawX} rawY={rawY} visible={isDragging} />

            {/* Draggable file card */}
            <motion.div
              key="drag-card"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1.10, opacity: 1, rotate: cardRotate }}
              exit={cardExit}
              transition={{
                scale:   { type: 'spring', stiffness: 420, damping: 26 },
                opacity: { duration: 0.18 },
                rotate:  { type: 'spring', stiffness: 180, damping: 22 },
              }}
              style={{
                position:    'fixed',
                left:        0,
                top:         0,
                x:           cardX,
                y:           cardY,
                translateX:  '-50%',
                translateY:  '-50%',
                zIndex:      84,
                pointerEvents:'none',
                filter:      `drop-shadow(0 18px 40px rgba(129,154,148,${nearTop ? 0.55 : 0.35}))`,
                willChange:  'transform',
              }}
            >
              <div style={{
                background:     'linear-gradient(145deg, rgba(21,29,26,0.98), rgba(14,22,40,0.98))',
                border:         `1.5px solid rgba(129,154,148,${nearTop ? 0.75 : 0.45})`,
                borderRadius:   18,
                padding:        '16px 20px',
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            8,
                minWidth:       160,
                boxShadow:      nearTop
                  ? '0 0 0 1px rgba(129,154,148,0.25), inset 0 1px 0 var(--surface-hi)'
                  : 'inset 0 1px 0 var(--surface-hi)',
                transition:     'border-color 0.25s, box-shadow 0.25s',
              }}>
                {/* Icon + count */}
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <span style={{ fontSize: '2.6rem', lineHeight: 1 }}>
                    {getFileIcon(firstFile?.file?.name)}
                  </span>
                  {fileCount > 1 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      style={{
                        position:       'absolute',
                        top:            -6,
                        right:          -10,
                        background:     'var(--brand)',
                        color:          '#fff',
                        fontSize:       '0.66rem',
                        fontWeight:     800,
                        borderRadius:   999,
                        padding:        '1px 5px',
                        lineHeight:     1.4,
                        border:         '1.5px solid rgba(14,22,40,0.9)',
                        whiteSpace:     'nowrap',
                      }}
                    >
                      +{fileCount - 1}
                    </motion.span>
                  )}
                </div>

                <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text)', textAlign: 'center' }}>
                  {fileCount} file{fileCount !== 1 ? 's' : ''}
                </div>

                <div style={{ color: 'var(--text-2)', fontSize: '0.78rem' }}>
                  {formatBytes(totalBytes)}
                </div>

                <div style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            5,
                  padding:        '3px 10px',
                  borderRadius:   999,
                  background:     nearTop ? 'rgba(129,154,148,0.22)' : 'rgba(129,154,148,0.10)',
                  border:         '1px solid rgba(129,154,148,0.30)',
                  color:          'var(--brand)',
                  fontSize:       '0.74rem',
                  fontWeight:     700,
                  transition:     'background 0.25s',
                }}>
                  <span>→</span> {targetName}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Releasing state: "sent" confirmation burst ─────────────────────── */}
      <AnimatePresence>
        {phase === 'releasing' && dragResult === 'sent' && (
          <motion.div
            key="sent-burst"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            style={{
              position:       'fixed',
              top:            '50%',
              left:           '50%',
              translateX:     '-50%',
              translateY:     '-50%',
              zIndex:         90,
              pointerEvents:  'none',
              textAlign:      'center',
            }}
          >
            <div style={{
              background:     'rgba(141,186,164,0.15)',
              border:         '1px solid rgba(141,186,164,0.40)',
              borderRadius:   24,
              padding:        '20px 32px',
              boxShadow:      '0 8px 40px rgba(141,186,164,0.25)',
            }}>
              <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🚀</div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--good)' }}>
                Sent to {targetName}!
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Desktop Receiving Portal ─────────────────────────────────────────────────

function DesktopDragPortal() {
  const [state] = useApp()
  const { incomingDrag } = state

  // ── Spring-tracked ghost position ─────────────────────────────────────────
  const ghostRawX = useMotionValue(typeof window !== 'undefined' ? window.innerWidth  / 2 : 0)
  const ghostRawY = useMotionValue(typeof window !== 'undefined' ? window.innerHeight / 2 : 0)
  const ghostX    = useSpring(ghostRawX, { stiffness: 160, damping: 22, mass: 0.9 })
  const ghostY    = useSpring(ghostRawY, { stiffness: 160, damping: 22, mass: 0.9 })

  // Track last position so exit animation knows where to launch from
  const lastPos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  useEffect(() => {
    if (incomingDrag) {
      const px = incomingDrag.x * window.innerWidth
      const py = incomingDrag.y * window.innerHeight
      ghostRawX.set(px)
      ghostRawY.set(py)
      lastPos.current = { x: px, y: py }
    }
  }, [incomingDrag?.x, incomingDrag?.y, ghostRawX, ghostRawY])

  // ── Derived ────────────────────────────────────────────────────────────────
  const fileInfo   = incomingDrag?.fileInfo
  const senderName = incomingDrag?.sender?.name ?? 'A device'
  const fileCount  = fileInfo?.count ?? 1
  const firstName  = fileInfo?.files?.[0]?.name ?? 'file'
  const totalSize  = fileInfo?.totalSize ?? 0

  return (
    <AnimatePresence>
      {incomingDrag && (
        <>
          {/* ── Background overlay ─────────────────────────────────────────── */}
          <motion.div
            key="desktop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{
              position:      'fixed',
              inset:         0,
              background:    'rgba(6,9,18,0.42)',
              zIndex:        90,
              pointerEvents: 'none',
            }}
          />

          {/* ── Top banner ─────────────────────────────────────────────────── */}
          <motion.div
            key="desktop-banner"
            initial={{ opacity: 0, y: -48, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -36, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            style={{
              position:      'fixed',
              top:           72,
              left:          '50%',
              translateX:    '-50%',
              zIndex:        96,
              pointerEvents: 'none',
              whiteSpace:    'nowrap',
            }}
          >
            <div style={{
              display:        'inline-flex',
              alignItems:     'center',
              gap:            10,
              padding:        '10px 22px',
              borderRadius:   999,
              background:     'rgba(24,32,30,0.96)',
              border:         '1px solid rgba(129,154,148,0.36)',
              boxShadow:      '0 8px 36px rgba(129,154,148,0.22)',
              fontSize:       '0.92rem',
              fontWeight:     600,
              color:          'var(--text)',
            }}>
              <span>📱</span>
              <span>
                <strong style={{ color: 'var(--brand)' }}>{senderName}</strong>
                {' '}is dragging{' '}
                <strong>{fileCount}</strong> file{fileCount !== 1 ? 's' : ''}
                {totalSize > 0 && (
                  <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>
                    {' '}({formatBytes(totalSize)})
                  </span>
                )}
                {' '}to you…
              </span>
              <div className="ns-dot-pulse" />
            </div>
          </motion.div>

          {/* ── Ghost file card ─────────────────────────────────────────────── */}
          <motion.div
            key="desktop-ghost"
            initial={{ opacity: 0, scale: 0.55 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{
              opacity: 0,
              scale:   0.30,
              y:       window.innerHeight * 0.5 - lastPos.current.y,
              x:       window.innerWidth  * 0.5 - lastPos.current.x,
              transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
            }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            style={{
              position:      'fixed',
              left:          0,
              top:           0,
              x:             ghostX,
              y:             ghostY,
              translateX:    '-50%',
              translateY:    '-50%',
              zIndex:        93,
              pointerEvents: 'none',
              willChange:    'transform',
            }}
          >
            {/* ── Portal glow ring ─────────────────────────────────────────── */}
            <motion.div
              animate={{
                scale:   [1, 1.22, 1],
                opacity: [0.55, 0.22, 0.55],
              }}
              transition={{
                duration:   2.0,
                repeat:     Infinity,
                ease:       'easeInOut',
              }}
              style={{
                position:    'absolute',
                inset:       -36,
                borderRadius:'50%',
                background:  'radial-gradient(circle, rgba(129,154,148,0.38) 0%, rgba(233,131,137,0.18) 40%, transparent 70%)',
                pointerEvents:'none',
                filter:      'blur(2px)',
              }}
            />

            {/* Rotating outer ring */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
              style={{
                position:    'absolute',
                inset:       -20,
                borderRadius:'50%',
                border:      '1.5px dashed rgba(129,154,148,0.35)',
                pointerEvents:'none',
              }}
            />

            {/* ── File card ────────────────────────────────────────────────── */}
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background:     'linear-gradient(145deg, rgba(21,29,26,0.98), rgba(14,22,40,0.97))',
                border:         '1.5px solid rgba(129,154,148,0.55)',
                borderRadius:   20,
                padding:        '18px 22px',
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            9,
                minWidth:       150,
                boxShadow:      [
                  '0 10px 50px rgba(129,154,148,0.35)',
                  '0 0 0 1px rgba(129,154,148,0.12)',
                  'inset 0 1px 0 var(--surface-hi)',
                ].join(', '),
              }}
            >
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <span style={{ fontSize: '2.8rem', lineHeight: 1 }}>
                  {getFileIcon(firstName)}
                </span>
                {fileCount > 1 && (
                  <span style={{
                    position:    'absolute',
                    top:         -6,
                    right:       -12,
                    background:  'var(--brand)',
                    color:       '#fff',
                    fontSize:    '0.68rem',
                    fontWeight:  800,
                    borderRadius: 999,
                    padding:     '1px 6px',
                    lineHeight:  1.4,
                    border:      '1.5px solid rgba(14,22,40,0.95)',
                    whiteSpace:  'nowrap',
                  }}>
                    +{fileCount - 1}
                  </span>
                )}
              </div>

              <div style={{
                fontWeight:     700,
                fontSize:       '0.88rem',
                color:          'var(--text)',
                textAlign:      'center',
                maxWidth:       130,
                overflow:       'hidden',
                textOverflow:   'ellipsis',
                whiteSpace:     'nowrap',
                lineHeight:     1.3,
              }}>
                {firstName}
              </div>

              {fileCount > 1 && (
                <div style={{ color: 'var(--text-2)', fontSize: '0.76rem' }}>
                  +{fileCount - 1} more file{fileCount - 1 !== 1 ? 's' : ''}
                </div>
              )}

              {totalSize > 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: '0.74rem' }}>
                  {formatBytes(totalSize)}
                </div>
              )}

              {/* INCOMING badge */}
              <motion.div
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            5,
                  padding:        '3px 11px',
                  borderRadius:   999,
                  background:     'rgba(129,154,148,0.16)',
                  border:         '1px solid rgba(129,154,148,0.38)',
                  color:          'var(--brand)',
                  fontSize:       '0.70rem',
                  fontWeight:     800,
                  letterSpacing:  '0.06em',
                  textTransform:  'uppercase',
                }}
              >
                <div className="ns-dot-pulse" style={{ width: 6, height: 6 }} />
                Incoming
              </motion.div>
            </motion.div>
          </motion.div>

          {/* ── Drop zone highlight grid lines ──────────────────────────────── */}
          <motion.div
            key="drop-target-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            style={{
              position:      'fixed',
              inset:         0,
              zIndex:        91,
              pointerEvents: 'none',
              backgroundImage: [
                'linear-gradient(rgba(129,154,148,0.03) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(129,154,148,0.03) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: '48px 48px',
            }}
          />
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function DragPortal({ isMobile, sendMessage, uploadFiles }) {
  if (isMobile) {
    return (
      <MobileDragPortal
        sendMessage={sendMessage}
        uploadFiles={uploadFiles}
      />
    )
  }
  return <DesktopDragPortal />
}
