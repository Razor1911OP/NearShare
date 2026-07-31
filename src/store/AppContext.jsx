import React, { createContext, useContext, useReducer } from 'react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// crypto.randomUUID() is only available in secure contexts (HTTPS or localhost).
// Phones on the LAN open the app over plain http://<lan-ip> — NOT a secure
// context — so we must fall back to getRandomValues/random strings or the app
// would crash at startup and show a blank screen.
function makeDeviceId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }

  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch { /* fall through */ }

  return `ns-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem('ns.deviceId')
  if (!id) {
    id = makeDeviceId()
    localStorage.setItem('ns.deviceId', id)
  }
  return id
}

function defaultDeviceName() {
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    'Unknown'

  const p = platform.toLowerCase()
  if (p.includes('win'))     return 'My Windows'
  if (p.includes('mac'))     return 'My Mac'
  if (p.includes('iphone'))  return 'My iPhone'
  if (p.includes('ipad'))    return 'My iPad'
  if (p.includes('android')) return 'My Android'
  if (p.includes('linux'))   return 'My Linux'
  return 'My Device'
}

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState = {
  deviceId:         getOrCreateDeviceId(),
  deviceName:       localStorage.getItem('ns.deviceName') || defaultDeviceName(),
  paired:           false,
  pairingCode:      '',
  serverInfo:       null,
  socketStatus:     'disconnected',   // 'disconnected' | 'connecting' | 'connected'
  devices:          [],               // [{id,name,online,trusted,pairedAt,lastSeenAt}]
  selectedTargetId: 'host',           // device id or 'host'
  selectedFiles:    [],               // [{file:File, relativePath:string, preview:string|null, key:string}]
  transfers:        [],               // recent upload records
  incomingDrag:     null,             // null | {sender,sessionId,fileInfo,x,y}
  clipboardItem:    null,             // null | {type,content,from,at}
  toasts:           [],               // [{id,message,type,at}]
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {

    // ── Server / Connection ──────────────────────────────────────────────────

    case 'SET_SERVER_INFO':
      return { ...state, serverInfo: action.payload }

    case 'SET_PAIRING_CODE':
      return { ...state, pairingCode: action.payload }

    case 'PAIR':
      return { ...state, paired: true, pairingCode: action.payload ?? state.pairingCode }

    case 'UNPAIR':
      return {
        ...state,
        paired:           false,
        pairingCode:      '',
        socketStatus:     'disconnected',
        devices:          [],
        selectedTargetId: 'host',
        incomingDrag:     null,
      }

    case 'SET_SOCKET_STATUS':
      return { ...state, socketStatus: action.payload }

    // ── Devices / Target ─────────────────────────────────────────────────────

    case 'SET_DEVICES':
      return { ...state, devices: action.payload ?? [] }

    case 'SET_TARGET':
      return { ...state, selectedTargetId: action.payload }

    // ── File Staging ─────────────────────────────────────────────────────────

    case 'ADD_FILES': {
      // Deduplicate by key = relativePath + ':' + file.size
      const map = new Map(state.selectedFiles.map(e => [e.key, e]))
      for (const entry of action.payload) {
        const key = `${entry.relativePath}:${entry.file.size}`
        if (!map.has(key)) {
          map.set(key, { ...entry, key })
        }
      }
      return { ...state, selectedFiles: Array.from(map.values()) }
    }

    case 'REMOVE_FILE':
      return {
        ...state,
        selectedFiles: state.selectedFiles.filter(e => e.key !== action.payload),
      }

    case 'CLEAR_FILES':
      return { ...state, selectedFiles: [] }

    // ── Transfers ────────────────────────────────────────────────────────────

    case 'ADD_TRANSFER':
      return {
        ...state,
        transfers: [action.payload, ...state.transfers].slice(0, 100),
      }

    // ── Incoming Drag ────────────────────────────────────────────────────────

    case 'SET_INCOMING_DRAG':
      return { ...state, incomingDrag: action.payload }

    case 'UPDATE_INCOMING_DRAG': {
      if (!state.incomingDrag) return state
      return {
        ...state,
        incomingDrag: {
          ...state.incomingDrag,
          x: action.payload.x,
          y: action.payload.y,
        },
      }
    }

    case 'CLEAR_INCOMING_DRAG':
      return { ...state, incomingDrag: null }

    // ── Clipboard ────────────────────────────────────────────────────────────

    case 'SET_CLIPBOARD':
      return { ...state, clipboardItem: action.payload }

    // ── Toasts ───────────────────────────────────────────────────────────────

    case 'ADD_TOAST': {
      const toast = {
        id:      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message: action.payload.message ?? '',
        type:    action.payload.type    ?? 'info',
        at:      Date.now(),
      }
      return { ...state, toasts: [...state.toasts, toast] }
    }

    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: state.toasts.filter(t => t.id !== action.payload),
      }

    // ── Fallthrough ──────────────────────────────────────────────────────────

    default:
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[AppContext] Unknown action type:', action.type)
      }
      return state
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Persist deviceName whenever it changes
  React.useEffect(() => {
    localStorage.setItem('ns.deviceName', state.deviceName)
  }, [state.deviceName])

  return (
    <AppContext.Provider value={[state, dispatch]}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useApp must be used inside <AppProvider>')
  }
  return ctx
}
