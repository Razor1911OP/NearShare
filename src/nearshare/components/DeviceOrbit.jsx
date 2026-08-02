import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useApp } from '../store/AppContext.jsx'

// ─── Layout constants ─────────────────────────────────────────────────────────

const CONTAINER  = 300          // px — outer div size
const CENTER     = CONTAINER / 2
const ORBIT_R    = 108          // radius of the device ring
const HUB_SIZE   = 68           // central hub diameter
const NODE_SIZE  = 50           // orbiting node diameter
const INNER_RING = ORBIT_R * 0.42  // decorative inner dashed ring

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the (x, y) pixel position for the node at `index` out of `total`.
 * Starts from the top (−π/2) and goes clockwise.
 */
function nodePos(index, total) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2
  return {
    x: CENTER + ORBIT_R * Math.cos(angle),
    y: CENTER + ORBIT_R * Math.sin(angle),
  }
}

/**
 * Returns the first uppercase character of a device name, falling back to '?'.
 */
function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase()
}

function avatarUrl(deviceId) {
  const styles = ['adventurer', 'adventurer-neutral', 'avataaars', 'bottts-neutral', 'fun-emoji']
  const hash = String(deviceId || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const style = styles[hash % styles.length]
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(deviceId || 'unknown')}&size=64`
}

// ─── DeviceNode ───────────────────────────────────────────────────────────────

function DeviceNode({ device, index, total, isSelected, isPulsing, onSelect }) {
  const [hovered, setHovered] = useState(false)
  const pos     = nodePos(index, total)
  const online  = device.online !== false
  const letter  = initial(device.name)
  const avatar  = avatarUrl(device.id)

  // Border / shadow colour derived from state
  const ringColor   = isPulsing  ? 'rgba(129,154,148,0.90)'
                    : isSelected ? 'rgba(129,154,148,0.72)'
                    : online     ? 'rgba(141,186,164,0.48)'
                    :              'rgba(255,255,255,0.10)'

  const glowShadow  = isPulsing
    ? '0 0 0 4px rgba(129,154,148,0.25), 0 0 28px rgba(129,154,148,0.55)'
    : isSelected
    ? '0 0 0 3px rgba(129,154,148,0.18), 0 0 18px rgba(129,154,148,0.30)'
    : online
    ? '0 0 0 2px rgba(141,186,164,0.12), 0 0 12px rgba(141,186,164,0.20)'
    : 'none'

  const nodeBg = online
    ? 'linear-gradient(145deg, rgba(26,35,32,0.95) 0%, rgba(17,23,21,0.95) 100%)'
    : 'rgba(16,22,36,0.75)'

  return (
    <motion.div
      // Spring entrance from center hub outward
      initial={{ scale: 0, opacity: 0, x: CENTER - NODE_SIZE / 2, y: CENTER - NODE_SIZE / 2 }}
      animate={{ scale: 1, opacity: 1, x: pos.x - NODE_SIZE / 2, y: pos.y - NODE_SIZE / 2 }}
      exit={{ scale: 0, opacity: 0, x: CENTER - NODE_SIZE / 2, y: CENTER - NODE_SIZE / 2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.85 }}
      style={{
        position: 'absolute',
        width:    NODE_SIZE,
        height:   NODE_SIZE,
        cursor:   'pointer',
        zIndex:   10,
        // Do not set top/left — we use x/y motion values above
      }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => onSelect(device.id)}
    >
      {/* ── Node circle ────────────────────────────────────────────────────── */}
      <motion.div
        animate={{
          boxShadow: glowShadow,
          borderColor: ringColor,
          // Breathing pulse when this device is the active incoming-drag sender
          scale: isPulsing ? [1, 1.10, 1] : 1,
        }}
        transition={{
          scale:     { duration: 1.3, repeat: isPulsing ? Infinity : 0, ease: 'easeInOut' },
          boxShadow: { duration: 0.30 },
          borderColor:{ duration: 0.30 },
        }}
        whileHover={{ scale: isPulsing ? 1.10 : 1.08 }}
        whileTap={{ scale: 0.93 }}
        style={{
          width:          '100%',
          height:         '100%',
          borderRadius:   '50%',
          background:     nodeBg,
          border:         `2px solid ${ringColor}`,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontSize:       '1.15rem',
          fontWeight:     800,
          color:          online ? 'var(--text)' : 'var(--text-3)',
          userSelect:     'none',
        }}
      >
        <img
          src={avatar}
          alt={device.name || 'device'}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
          }}
          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
        />
        <span style={{ display: 'none', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          {letter}
        </span>
      </motion.div>

      {/* ── Online indicator dot ────────────────────────────────────────────── */}
      <AnimatePresence>
        {online && (
          <motion.div
            key="dot"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            style={{
              position:    'absolute',
              right:       2,
              bottom:      2,
              width:       10,
              height:      10,
              borderRadius:'50%',
              background:  'var(--good)',
              border:      '2px solid var(--bg)',
              boxShadow:   '0 0 6px rgba(141,186,164,0.7)',
              pointerEvents:'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Hover tooltip ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            key="tooltip"
            initial={{ opacity: 0, y: 6, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.90 }}
            transition={{ type: 'spring', stiffness: 480, damping: 30 }}
            style={{
              position:     'absolute',
              top:          NODE_SIZE + 8,
              left:         '50%',
              translateX:   '-50%',
              background:   'var(--surface-hi)',
              border:       '1px solid var(--border-hi)',
              borderRadius: 10,
              padding:      '6px 12px',
              whiteSpace:   'nowrap',
              fontSize:     '0.76rem',
              fontWeight:   600,
              color:        'var(--text)',
              pointerEvents:'none',
              zIndex:       30,
              boxShadow:    'var(--shadow-sm)',
              textAlign:    'center',
              lineHeight:   1.5,
            }}
          >
            {device.name || 'Unknown device'}
            <br />
            <span style={{ fontWeight: 400, color: online ? 'var(--good)' : 'var(--text-3)', fontSize: '0.72rem' }}>
              {online ? '● Online' : '○ Offline'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── DeviceOrbit ──────────────────────────────────────────────────────────────

export default function DeviceOrbit() {
  const [state, dispatch] = useApp()
  const { devices, selectedTargetId, incomingDrag, serverInfo } = state

  const deviceList = useMemo(() => devices ?? [], [devices])
  const count      = deviceList.length
  const hostAvatar = useMemo(() => {
    const sid = serverInfo?.deviceId || 'host-server'
    return avatarUrl(sid)
  }, [serverInfo])

  // The sender of an incoming cross-device drag gets highlighted
  const activeSenderId = incomingDrag?.sender?.id ?? null

  // Orbit circumference for animated dash
  const orbitCircumference = useMemo(() => 2 * Math.PI * ORBIT_R, [])

  const handleSelect = useCallback((id) => {
    dispatch({ type: 'SET_TARGET', payload: id })
  }, [dispatch])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        gap:            18,
        userSelect:     'none',
      }}
    >
      {/* ──────────────── Orbit canvas ──────────────────────────────────── */}
      <div
        style={{
          position:   'relative',
          width:      CONTAINER,
          height:     CONTAINER,
          flexShrink: 0,
        }}
      >
        {/* ── SVG: rings + connection lines ─────────────────────────────── */}
        <svg
          width={CONTAINER}
          height={CONTAINER}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          aria-hidden="true"
        >
          {/* Outer orbit ring — static */}
          <circle
            cx={CENTER} cy={CENTER} r={ORBIT_R}
            fill="none"
            stroke="rgba(129,154,148,0.10)"
            strokeWidth={1.5}
          />

          {/* Animated orbit ring — only visible during incoming drag */}
          <AnimatePresence>
            {activeSenderId && (
              <motion.circle
                key="active-orbit"
                cx={CENTER} cy={CENTER} r={ORBIT_R}
                fill="none"
                stroke="rgba(129,154,148,0.45)"
                strokeWidth={2}
                strokeDasharray={orbitCircumference}
                initial={{ strokeDashoffset: 0, opacity: 0 }}
                animate={{ strokeDashoffset: -orbitCircumference, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  strokeDashoffset: { duration: 2.2, repeat: Infinity, ease: 'linear' },
                  opacity: { duration: 0.3 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Inner decorative dashed ring */}
          <circle
            cx={CENTER} cy={CENTER} r={INNER_RING}
            fill="none"
            stroke="rgba(233,131,137,0.08)"
            strokeWidth={1}
            strokeDasharray="3 7"
          />

          {/* Hub ambient glow ring */}
          <circle
            cx={CENTER} cy={CENTER} r={HUB_SIZE / 2 + 10}
            fill="none"
            stroke="rgba(129,154,148,0.07)"
            strokeWidth={6}
          />

          {/* ── Connection lines: center → each device node ─────────────── */}
          {deviceList.map((device, i) => {
            const pos      = nodePos(i, count)
            const isActive = device.id === activeSenderId
            const isSel    = device.id === selectedTargetId

            return (
              <motion.line
                key={`line-${device.id}`}
                x1={CENTER} y1={CENTER}
                x2={pos.x}  y2={pos.y}
                stroke={
                  isActive ? 'rgba(129,154,148,0.60)'
                  : isSel  ? 'rgba(129,154,148,0.35)'
                  :          'rgba(129,154,148,0.10)'
                }
                strokeWidth={isActive ? 2.5 : isSel ? 1.5 : 1}
                strokeLinecap="round"
                strokeDasharray={isActive ? '5 5' : isSel ? '3 6' : 'none'}
                animate={
                  isActive
                    ? { strokeDashoffset: [0, -20] }
                    : isSel
                    ? { strokeDashoffset: [0, -12] }
                    : {}
                }
                transition={{
                  strokeDashoffset: {
                    duration: isActive ? 0.55 : 0.90,
                    repeat:   Infinity,
                    ease:     'linear',
                  },
                }}
              />
            )
          })}

          {/* ── Dot markers along each line (data-packet effect) ────────── */}
          {deviceList.map((device, i) => {
            const pos      = nodePos(i, count)
            const isActive = device.id === activeSenderId
            if (!isActive) return null

            // Animate a dot travelling from center to node
            const dx = pos.x - CENTER
            const dy = pos.y - CENTER
            return (
              <motion.circle
                key={`packet-${device.id}`}
                r={3.5}
                fill="var(--brand)"
                initial={{ cx: CENTER,  cy: CENTER  }}
                animate={{ cx: pos.x,   cy: pos.y   }}
                transition={{
                  duration:   0.9,
                  repeat:     Infinity,
                  ease:       'easeIn',
                  repeatType: 'loop',
                }}
                style={{ filter: 'blur(0.5px)' }}
              />
            )
          })}
        </svg>

        {/* ── Orbiting device nodes ────────────────────────────────────── */}
        <AnimatePresence>
          {deviceList.map((device, i) => (
            <DeviceNode
              key={device.id}
              device={device}
              index={i}
              total={count}
              isSelected={selectedTargetId === device.id}
              isPulsing={device.id === activeSenderId}
              onSelect={handleSelect}
            />
          ))}
        </AnimatePresence>

        {/* ── Selected-host indicator ring (renders behind hub) ─────────── */}
        <AnimatePresence>
          {selectedTargetId === 'host' && (
            <motion.div
              key="host-selection-ring"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 26 }}
              style={{
                position:    'absolute',
                left:        CENTER - HUB_SIZE / 2 - 6,
                top:         CENTER - HUB_SIZE / 2 - 6,
                width:       HUB_SIZE + 12,
                height:      HUB_SIZE + 12,
                borderRadius:'50%',
                border:      '2px solid rgba(129,154,148,0.75)',
                pointerEvents:'none',
                zIndex:      4,
              }}
            />
          )}
        </AnimatePresence>

        {/* ── Central hub ──────────────────────────────────────────────── */}
        <motion.button
          aria-label="Select host as target"
          onClick={() => handleSelect('host')}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.08 }}
          whileHover={{
            scale:     1.08,
            boxShadow: '0 0 0 10px rgba(129,154,148,0.12), 0 0 40px rgba(129,154,148,0.40)',
          }}
          whileTap={{ scale: 0.94 }}
          style={{
            position:       'absolute',
            left:           CENTER - HUB_SIZE / 2,
            top:            CENTER - HUB_SIZE / 2,
            width:          HUB_SIZE,
            height:         HUB_SIZE,
            borderRadius:   '50%',
            background:     'linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%)',
            border:         'none',
            cursor:         'pointer',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            2,
            zIndex:         5,
            boxShadow:      '0 0 0 6px rgba(129,154,148,0.10), 0 0 26px rgba(129,154,148,0.28)',
            transition:     'box-shadow 0.25s',
          }}
        >
          <span style={{
            fontSize:      '0.58rem',
            fontWeight:    900,
            letterSpacing: '0.12em',
            opacity:       0.88,
            color:         '#fff',
          }}>
            HOST
          </span>
          <img
            src={hostAvatar}
            alt="Host"
            style={{
              width: 24, height: 24, borderRadius: '50%',
              display: 'block', objectFit: 'cover',
            }}
            onError={(e) => { e.target.src = '/icon-192.png'; e.target.style.borderRadius = '4px' }}
          />
          {count > 0 && (
            <span style={{
              fontSize:   '0.55rem',
              fontWeight: 700,
              opacity:    0.7,
              color:      '#fff',
              marginTop:  1,
            }}>
              {count} peer{count !== 1 ? 's' : ''}
            </span>
          )}
        </motion.button>
      </div>

      {/* ──────────────── Legend / status line ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         10,
          fontSize:    '0.78rem',
          color:       'var(--text-3)',
          flexWrap:    'wrap',
          justifyContent: 'center',
        }}
      >
        {count === 0 ? (
          <span>No devices paired yet — scan the QR code to add one</span>
        ) : (
          <>
            <span className="ns-dot-pulse" style={{ width: 7, height: 7 }} />
            <span>
              {count} device{count !== 1 ? 's' : ''} paired
            </span>

            <AnimatePresence mode="wait">
              {selectedTargetId && selectedTargetId !== 'host' && (() => {
                const sel = deviceList.find(d => d.id === selectedTargetId)
                return sel ? (
                  <motion.span
                    key={sel.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    style={{ color: 'var(--brand)', fontWeight: 600 }}
                  >
                    · Sending to {sel.name}
                  </motion.span>
                ) : null
              })()}
            </AnimatePresence>

            <AnimatePresence>
              {activeSenderId && (
                <motion.span
                  key="incoming-label"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  style={{
                    display:     'inline-flex',
                    alignItems:  'center',
                    gap:         5,
                    color:       'var(--brand)',
                    fontWeight:  700,
                    background:  'rgba(129,154,148,0.10)',
                    border:      '1px solid rgba(129,154,148,0.25)',
                    borderRadius: 999,
                    padding:     '2px 9px',
                  }}
                >
                  <span>⟵</span>
                  {incomingDrag?.sender?.name || 'Device'} is dragging…
                </motion.span>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  )
}
