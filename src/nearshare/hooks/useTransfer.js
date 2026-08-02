import { useState, useCallback } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { apiUrl } from '../lib/serverUrl'

const RESUME_KEY_PREFIX = 'ns.upload.resume.'
const DEFAULT_PARALLEL_CHUNKS = 4
const MAX_CHUNK_RETRIES = 3

/**
 * Generates a preview URL for image and video files.
 * Returns null for all other file types.
 */
export function generatePreview(file) {
  if (!file) return null
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
    return URL.createObjectURL(file)
  }
  return null
}

function hashString(input) {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

function makeResumeKey(deviceId, targetId, files) {
  const base = files
    .map((entry) => {
      const f = entry.file
      return `${entry.relativePath || f.name}:${f.size}:${f.lastModified}:${f.type || 'application/octet-stream'}`
    })
    .join('|')
  return `${RESUME_KEY_PREFIX}${deviceId}:${targetId}:${hashString(base)}`
}

function normalizeUploadedChunks(uploadedChunks) {
  if (!Array.isArray(uploadedChunks)) return new Set()
  return new Set(uploadedChunks.filter((n) => Number.isInteger(n) && n >= 0))
}

function uploadedBytesForFile(fileSize, chunkSize, totalChunks, uploadedSet) {
  if (!fileSize || fileSize <= 0) return 0
  let bytes = 0
  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedSet.has(i)) continue
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, fileSize)
    bytes += Math.max(0, end - start)
  }
  return bytes
}

async function uploadChunkWithRetry({ uploadId, fileIndex, chunkIndex, chunkBlob, retries = MAX_CHUNK_RETRIES }) {
  let attempt = 0
  let lastErr = null

  while (attempt < retries) {
    attempt += 1
    try {
      const chunkRes = await fetch(
        apiUrl(`/api/upload/session/${encodeURIComponent(uploadId)}/chunk?fileIndex=${fileIndex}&chunkIndex=${chunkIndex}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunkBlob,
        }
      )

      const chunkBody = await chunkRes.json().catch(() => ({}))
      if (!chunkRes.ok || chunkBody.ok === false) {
        throw new Error(chunkBody.error || `Chunk upload failed (${chunkRes.status})`)
      }
      return chunkBody
    } catch (err) {
      lastErr = err
      if (attempt >= retries) break
      // quick exponential-ish backoff to handle transient Wi-Fi jitter
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }

  throw lastErr || new Error('Chunk upload failed')
}

/**
 * useTransfer — resumable chunk-stream upload with adaptive parallelism.
 */
export default function useTransfer(sendMessage) {
  const [state, dispatch] = useApp()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStats, setUploadStats] = useState(null)

  const uploadFiles = useCallback(
    async (opts = {}) => {
      const {
        targetId = state.selectedTargetId,
        note = '',
        gestureMode = false,
        files: filesOverride = null,
        retryId = null,
      } = opts

      const staged = filesOverride && filesOverride.length ? filesOverride : state.selectedFiles

      if (!staged || staged.length === 0) {
        dispatch({
          type: 'ADD_TOAST',
          payload: { message: 'No files selected.', type: 'warn' },
        })
        throw new Error('No files selected')
      }

      setIsUploading(true)
      setUploadProgress(0)
      setUploadStats(null)

      const totalBytes = staged.reduce((sum, e) => sum + (e.file?.size || 0), 0)
      const effectiveTarget = targetId === 'host' ? '' : targetId
      const resumeKey = makeResumeKey(state.deviceId, effectiveTarget || 'host', staged)
      const rememberedUploadId = localStorage.getItem(resumeKey) || ''

      try {
        const startRes = await fetch(apiUrl('/api/upload/session/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: state.deviceId,
            senderName: state.deviceName,
            targetId: effectiveTarget,
            gestureMode,
            note,
            resumeUploadId: rememberedUploadId,
            files: staged.map((entry) => ({
              name: entry.file.name,
              relativePath: entry.relativePath || entry.file.name,
              size: entry.file.size,
              type: entry.file.type || 'application/octet-stream',
              lastModified: entry.file.lastModified || 0,
            })),
          }),
        })

        const startBody = await startRes.json().catch(() => ({}))
        if (!startRes.ok || startBody.ok === false) {
          throw new Error(startBody.error || `Session start failed (${startRes.status})`)
        }

        const uploadId = startBody.uploadId
        const chunkSize = Number(startBody.chunkSize) || 1024 * 1024
        const remoteFiles = Array.isArray(startBody.files) ? startBody.files : []

        localStorage.setItem(resumeKey, uploadId)

        if (startBody.resumed) {
          dispatch({
            type: 'ADD_TOAST',
            payload: { message: 'Resumed previous interrupted transfer.', type: 'info' },
          })
        }

        let uploadedBytes = 0
        for (let i = 0; i < staged.length; i++) {
          const f = staged[i].file
          const remoteMeta = remoteFiles[i] || {}
          const totalChunks = Number(remoteMeta.totalChunks) || Math.max(1, Math.ceil(f.size / chunkSize))
          const uploadedSet = normalizeUploadedChunks(remoteMeta.uploadedChunks)
          uploadedBytes += uploadedBytesForFile(f.size, chunkSize, totalChunks, uploadedSet)
        }

        if (totalBytes > 0) {
          setUploadProgress(Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))))
        }

        // ── speed / ETA telemetry (EWMA-smoothed) ──
        const startedAt = Date.now()
        const baselineBytes = uploadedBytes
        let lastTick = startedAt
        let lastBytes = uploadedBytes
        let bps = 0

        const bumpProgress = (bytesDelta) => {
          uploadedBytes += bytesDelta
          if (totalBytes > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)))
            setUploadProgress(pct)
          }

          const now = Date.now()
          const dt = now - lastTick
          if (dt >= 250) {
            const instant = ((uploadedBytes - lastBytes) * 1000) / dt
            bps = bps > 0 ? bps * 0.7 + instant * 0.3 : instant
            lastTick = now
            lastBytes = uploadedBytes

            const remaining = Math.max(0, totalBytes - uploadedBytes)
            const avg = ((uploadedBytes - baselineBytes) * 1000) / Math.max(1, now - startedAt)
            const rate = bps > 0 ? bps : avg
            setUploadStats({
              bps: rate,
              etaMs: rate > 0 ? (remaining / rate) * 1000 : null,
              uploadedBytes,
              totalBytes,
              elapsedMs: now - startedAt,
            })
          }
        }

        for (let fileIndex = 0; fileIndex < staged.length; fileIndex++) {
          const entry = staged[fileIndex]
          const file = entry.file
          const remoteMeta = remoteFiles[fileIndex] || {}

          const totalChunks = Number(remoteMeta.totalChunks) || Math.max(1, Math.ceil(file.size / chunkSize))
          const uploadedSet = normalizeUploadedChunks(remoteMeta.uploadedChunks)

          const pendingChunks = []
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            if (!uploadedSet.has(chunkIndex)) pendingChunks.push(chunkIndex)
          }

          const workerCount = Math.min(DEFAULT_PARALLEL_CHUNKS, Math.max(1, pendingChunks.length))

          if (workerCount > 0) {
            let cursor = 0
            const workers = Array.from({ length: workerCount }).map(async () => {
              while (cursor < pendingChunks.length) {
                const myIdx = cursor
                cursor += 1
                const chunkIndex = pendingChunks[myIdx]

                const start = chunkIndex * chunkSize
                const end = Math.min(start + chunkSize, file.size)
                const chunkBlob = file.slice(start, end)

                await uploadChunkWithRetry({
                  uploadId,
                  fileIndex,
                  chunkIndex,
                  chunkBlob,
                })

                uploadedSet.add(chunkIndex)
                bumpProgress(chunkBlob.size)
              }
            })

            await Promise.all(workers)
          }
        }

        const completeRes = await fetch(
          apiUrl(`/api/upload/session/${encodeURIComponent(uploadId)}/complete`),
          { method: 'POST' }
        )
        const completeBody = await completeRes.json().catch(() => ({}))

        if (!completeRes.ok || completeBody.ok === false) {
          throw new Error(completeBody.error || `Finalize failed (${completeRes.status})`)
        }

        localStorage.removeItem(resumeKey)
        setUploadProgress(100)

        if (retryId) dispatch({ type: 'REMOVE_FAILED', payload: retryId })
        if (!filesOverride) dispatch({ type: 'CLEAR_FILES' })

        if (completeBody.upload) {
          dispatch({ type: 'ADD_TRANSFER', payload: completeBody.upload })
        }

        if (typeof sendMessage === 'function') {
          sendMessage({
            type: 'super-drag-drop',
            senderId: state.deviceId,
            senderName: state.deviceName,
            targetId: effectiveTarget,
            fileCount: staged.length,
            uploadId,
          })
        }

        return completeBody
      } catch (err) {
        dispatch({
          type: 'ADD_FAILED',
          payload: {
            id: retryId || `fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now(),
            error: err?.message || 'Upload failed',
            targetId,
            note,
            gestureMode,
            entries: staged,
          },
        })
        dispatch({
          type: 'ADD_TOAST',
          payload: {
            message: err?.message || 'Upload failed',
            type: 'bad',
          },
        })
        throw err
      } finally {
        setIsUploading(false)
        setTimeout(() => {
          setUploadProgress(0)
          setUploadStats(null)
        }, 350)
      }
    },
    [
      state.selectedFiles,
      state.selectedTargetId,
      state.deviceId,
      state.deviceName,
      dispatch,
      sendMessage,
    ]
  )

  return { uploadFiles, isUploading, uploadProgress, uploadStats, generatePreview }
}
