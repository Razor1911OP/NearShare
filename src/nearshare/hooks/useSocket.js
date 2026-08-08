import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { wsUrl, getServerBase } from '../lib/serverUrl'
import { ConnectionState, classifyError, measureLatency } from '../lib/connectionDiagnostics'

export function useSocket() {
  const [state, dispatch] = useApp()
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const mountedRef = useRef(true)
  const wasConnectedRef = useRef(false)
  const reconnectAttemptsRef = useRef(0)

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  const scheduleReconnect = (connect) => {
    reconnectAttemptsRef.current += 1
    const delay = Math.min(15000, 1000 * (2 ** Math.min(5, reconnectAttemptsRef.current - 1)))
    dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.RETRYING })
    dispatch({
      type: 'LOG_EVENT',
      payload: {
        category: 'websocket',
        level: 'warn',
        message: 'Scheduling reconnect',
        data: { attempt: reconnectAttemptsRef.current, delayMs: delay },
      },
    })
    reconnectTimerRef.current = setTimeout(connect, delay)
  }

  const sendMessage = useCallback((obj) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(obj))
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!state.paired) {
      clearReconnectTimer()
      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.onopen = null
        socketRef.current.close()
        socketRef.current = null
      }
      wasConnectedRef.current = false
      reconnectAttemptsRef.current = 0
      dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
      dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.DISCONNECTED })
      return
    }

    const connect = () => {
      if (!mountedRef.current) return

      clearReconnectTimer()

      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.onopen = null
        socketRef.current.close()
        socketRef.current = null
      }

      dispatch({ type: 'SET_SOCKET_STATUS', payload: 'connecting' })
      dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.SEARCHING })
      dispatch({
        type: 'LOG_EVENT',
        payload: {
          category: 'websocket',
          level: 'info',
          message: 'Searching for backend and opening WebSocket',
          data: { deviceId: state.deviceId },
        },
      })

      const url =
        wsUrl('/events') +
        `?code=${encodeURIComponent(state.pairingCode)}` +
        `&deviceId=${encodeURIComponent(state.deviceId)}` +
        `&name=${encodeURIComponent(state.deviceName)}`

      let ws
      try {
        ws = new WebSocket(url)
      } catch (err) {
        console.error('[useSocket] WebSocket construction failed:', err)
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
        dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.DISCONNECTED })
        dispatch({
          type: 'LOG_ERROR',
          payload: classifyError(err, { url }),
          meta: { url },
        })
        if (mountedRef.current) {
          scheduleReconnect(connect)
        }
        return
      }

      socketRef.current = ws
      dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.NEGOTIATING })
      dispatch({
        type: 'LOG_EVENT',
        payload: {
          category: 'websocket',
          level: 'info',
          message: 'WebSocket negotiation started',
          data: { url },
        },
      })

      ws.onopen = () => {
        if (!mountedRef.current) return
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'connected' })
        dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.AUTHENTICATING })
        dispatch({
          type: 'LOG_EVENT',
          payload: {
            category: 'websocket',
            level: 'info',
            message: 'WebSocket connected, authenticating session',
            data: { url },
          },
        })

        // Trigger latency measurement against the server base URL
        const baseUrl = getServerBase()
        measureLatency(baseUrl).then((result) => {
          if (mountedRef.current) {
            // SET_LATENCY expects a number or null, not the { latencyMs, ok } object
            dispatch({ type: 'SET_LATENCY', payload: result?.latencyMs ?? null })
          }
        }).catch(() => {
          // Silently ignore measurement failures — non-critical
        })
      }

      ws.onclose = (event) => {
        if (!mountedRef.current) return
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
        const closeState = wasConnectedRef.current
          ? ConnectionState.CONNECTION_LOST
          : ConnectionState.DISCONNECTED
        dispatch({ type: 'SET_CONNECTION_STATE', payload: closeState })
        dispatch({
          type: 'LOG_EVENT',
          payload: {
            category: 'websocket',
            level: 'warn',
            message: 'WebSocket closed',
            data: { code: event.code, reason: event.reason || '' },
          },
        })
        dispatch({
          type: 'LOG_ERROR',
          payload: classifyError(event, { url, closeCode: event.code }),
          meta: { url, closeCode: event.code },
        })
        wasConnectedRef.current = false
        if (mountedRef.current) {
          scheduleReconnect(connect)
        }
      }

      ws.onerror = (event) => {
        console.error('[useSocket] WebSocket error:', event)
        dispatch({
          type: 'LOG_ERROR',
          payload: classifyError(event, { url }),
          meta: { url },
        })
        // onclose will also fire after an error, so no additional reconnect here
      }

      ws.onmessage = (event) => {
        if (!mountedRef.current) return
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch (err) {
          console.warn('[useSocket] Failed to parse message:', event.data)
          return
        }

        const { type } = msg

        switch (type) {
          case 'hello':
            reconnectAttemptsRef.current = 0
            dispatch({ type: 'SET_CONNECTION_STATE', payload: ConnectionState.CONNECTED })
            dispatch({
              type: 'LOG_EVENT',
              payload: {
                category: 'pairing',
                level: 'info',
                message: 'Pairing/authentication succeeded',
                data: { devices: Array.isArray(msg.devices) ? msg.devices.length : undefined },
              },
            })
            wasConnectedRef.current = true
            if (msg.devices !== undefined) {
              dispatch({ type: 'SET_DEVICES', payload: msg.devices })
            }
            if (msg.pairingCode !== undefined) {
              dispatch({ type: 'SET_PAIRING_CODE', payload: msg.pairingCode })
            }
            break

          case 'devices':
          case 'device-online':
          case 'device-offline':
            dispatch({ type: 'SET_DEVICES', payload: msg.devices })
            break

          case 'device-paired':
            dispatch({ type: 'SET_DEVICES', payload: msg.devices || [] })
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: `${msg.device?.name || 'A device'} joined`,
                type: 'good',
              },
            })
            break

          case 'files-received':
            dispatch({ type: 'ADD_TRANSFER', payload: msg.upload })
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: `New transfer from ${msg.upload.senderName} — download it in History`,
                type: 'good',
              },
            })
            break

          case 'transfer-offer':
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: `${msg.sender?.name || 'A device'} is sending ${msg.fileCount} file(s)…`,
                type: 'info',
              },
            })
            break

          case 'cross-drag-start':
            dispatch({
              type: 'SET_INCOMING_DRAG',
              payload: {
                sender: msg.sender,
                sessionId: msg.sessionId,
                fileInfo: msg.fileInfo,
                x: 0.5,
                y: 0.5,
              },
            })
            break

          case 'cross-drag-move':
            dispatch({
              type: 'UPDATE_INCOMING_DRAG',
              payload: { x: msg.x, y: msg.y },
            })
            break

          case 'cross-drag-drop':
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: `${msg.sender?.name || 'A device'} dropped files — uploading…`,
                type: 'good',
              },
            })
            dispatch({ type: 'CLEAR_INCOMING_DRAG' })
            break

          case 'cross-drag-cancel':
            dispatch({ type: 'CLEAR_INCOMING_DRAG' })
            dispatch({
              type: 'ADD_TOAST',
              payload: { message: 'Incoming drag cancelled', type: 'warn' },
            })
            break

          case 'clipboard-update':
            dispatch({ type: 'SET_CLIPBOARD', payload: msg.item })
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: `Clipboard synced from ${msg.item?.from?.name || 'a device'}`,
                type: 'info',
              },
            })
            break

          // ── Notes / Messaging ────────────────────────────────────────────
          case 'new-note':
            dispatch({
              type: 'ADD_NOTE',
              payload: {
                deviceId: 'nearshare-chatroom',
                deviceName: msg.sender?.name || 'Device',
                text: msg.text || '',
                html: msg.html || '',
                noteId: msg.noteId,
                fromMe: false,
                at: msg.at,
              },
            })
            // Send read receipt
            if (msg.sender?.id && msg.noteId) {
              sendMessage({
                type: 'note-read',
                noteId: msg.noteId,
                senderId: msg.sender.id,
              })
            }
            break

          case 'note-status':
            dispatch({
              type: 'UPDATE_NOTE_STATUS',
              payload: { noteId: msg.noteId, status: msg.status },
            })
            break

          case 'pairing-denied':
          case 'error':
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: msg.error || 'Connection error',
                type: 'bad',
              },
            })
            dispatch({
              type: 'LOG_ERROR',
              payload: classifyError(
                new Error(msg.error || 'Connection error'),
                { url, device: state.deviceId },
              ),
              meta: { url, messageType: type },
            })
            break

          case 'pong':
            // no-op
            break

          default:
            console.debug('[useSocket] Unhandled message type:', type, msg)
        }
      }
    }

    connect()

    return () => {
      clearReconnectTimer()
      if (socketRef.current) {
        socketRef.current.onclose = null
        socketRef.current.onerror = null
        socketRef.current.onmessage = null
        socketRef.current.onopen = null
        socketRef.current.close()
        socketRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paired, state.pairingCode])

  return { sendMessage }
}
