import { useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store/AppContext.jsx'

export function useSocket() {
  const [state, dispatch] = useApp()
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const mountedRef = useRef(true)

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
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
      dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
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

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host = window.location.host
      const url =
        `${protocol}://${host}/events` +
        `?code=${encodeURIComponent(state.pairingCode)}` +
        `&deviceId=${encodeURIComponent(state.deviceId)}` +
        `&name=${encodeURIComponent(state.deviceName)}`

      let ws
      try {
        ws = new WebSocket(url)
      } catch (err) {
        console.error('[useSocket] WebSocket construction failed:', err)
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
        if (mountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000)
        }
        return
      }

      socketRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'connected' })
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        dispatch({ type: 'SET_SOCKET_STATUS', payload: 'disconnected' })
        if (mountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = (event) => {
        console.error('[useSocket] WebSocket error:', event)
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

          case 'pairing-denied':
          case 'error':
            dispatch({
              type: 'ADD_TOAST',
              payload: {
                message: msg.error || 'Connection error',
                type: 'bad',
              },
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
