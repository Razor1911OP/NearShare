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
    "Unknown";

  const ua = navigator.userAgent || "";
  let browser = "Browser";
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";

  const p = platform.toLowerCase();
  let os = "Device";
  if (p.includes("win")) os = "Windows";
  else if (p.includes("mac")) os = "Mac";
  else if (p.includes("iphone")) os = "iPhone";
  else if (p.includes("ipad")) os = "iPad";
  else if (p.includes("android")) os = "Android";
  else if (p.includes("linux")) os = "Linux";

  // 4-char random hex suffix so two Chrome-on-Windows devices never collide
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0")
    .toUpperCase();

  return `${browser} on ${os} · ${hex}`;
}

function loadNotes() {
  try { return JSON.parse(localStorage.getItem('ns.notes') || '[]') } catch { return [] }
}
function saveNotes(notes) {
  try { localStorage.setItem('ns.notes', JSON.stringify(notes.slice(-500))) } catch {}
}
function loadUnread() {
  try { return new Set(JSON.parse(localStorage.getItem('ns.unread') || '[]')) } catch { return new Set() }
}
function saveUnread(set) {
  try { localStorage.setItem('ns.unread', JSON.stringify([...set])) } catch {}
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
  failedTransfers:  [],               // [{id,at,error,targetId,note,entries}] retryable failures
  incomingDrag:     null,             // null | {sender,sessionId,fileInfo,x,y}
  clipboardItem:    null,             // null | {type,content,from,at}
  notes:            loadNotes(),      // [{id,deviceId,deviceName,messages:[{id,text,html,fromMe,at,status}]}]
  activeChatId:     null,             // deviceId of currently open chat
  unreadChats:      loadUnread(),     // Set of deviceIds with unread messages
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

    case 'SET_DEVICE_NAME':
      return { ...state, deviceName: action.payload }

    // ── Devices / Target ─────────────────────────────────────────────────────
    case 'CLEAR_TRANSFERS':
      return { ...state, transfers: [], failedTransfers: [] }

    // ── Failed transfers (retryable) ─────────────────────────────────────────

    case 'ADD_FAILED':
      return {
        ...state,
        failedTransfers: [action.payload, ...state.failedTransfers].slice(0, 20),
      }

    case 'REMOVE_FAILED':
      return {
        ...state,
        failedTransfers: state.failedTransfers.filter(f => f.id !== action.payload),
      }

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

    case 'ADD_TRANSFER': {
      const incoming = action.payload
      const dup = state.transfers.find(
        (t) => t.uploadId && incoming.uploadId && t.uploadId === incoming.uploadId,
      )
      if (dup) return state  // already added — server broadcast was redundant
      return {
        ...state,
        transfers: [incoming, ...state.transfers].slice(0, 100),
      }
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

    // ── Notes / Chat ────────────────────────────────────────────────────────

    case 'ADD_NOTE': {
      const { deviceId, deviceName, text, html, noteId, fromMe, at } = action.payload
      const chats = [...state.notes]
      let chat = chats.find(c => c.deviceId === deviceId)
      if (!chat) {
        chat = { deviceId, deviceName, messages: [] }
        chats.push(chat)
      }
      chat = { ...chat, messages: [...chat.messages, { id: noteId, text, html, fromMe, at, status: 'delivered', deviceName }] }
      const idx = chats.findIndex(c => c.deviceId === deviceId)
      chats[idx] = chat
      saveNotes(chats)
      // Mark unread if not from me and chat not active
      const unread = new Set(state.unreadChats)
      if (!fromMe && state.activeChatId !== deviceId) unread.add(deviceId)
      saveUnread(unread)
      return { ...state, notes: chats, unreadChats: unread }
    }

    case 'UPDATE_NOTE_STATUS': {
      const { noteId, status } = action.payload
      const chats = state.notes.map(chat => ({
        ...chat,
        messages: chat.messages.map(m => m.id === noteId ? { ...m, status } : m),
      }))
      saveNotes(chats)
      return { ...state, notes: chats }
    }

    case 'DELETE_NOTE': {
      const { chatId, noteId } = action.payload
      const chats = state.notes.map(chat =>
        chat.deviceId === chatId
          ? { ...chat, messages: chat.messages.filter(m => m.id !== noteId) }
          : chat
      ).filter(chat => chat.messages.length > 0)
      saveNotes(chats)
      return { ...state, notes: chats }
    }

    case 'SET_ACTIVE_CHAT': {
      const unread = new Set(state.unreadChats)
      unread.delete(action.payload)
      saveUnread(unread)
      return { ...state, activeChatId: action.payload, unreadChats: unread }
    }

    case 'CLEAR_CHAT': {
      const chats = state.notes.filter(c => c.deviceId !== action.payload)
      saveNotes(chats)
      return { ...state, notes: chats, activeChatId: state.activeChatId === action.payload ? null : state.activeChatId }
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
