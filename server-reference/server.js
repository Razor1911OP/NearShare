import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import dgram from "node:dgram";
import { execFile } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DEVICE_HOST = String(process.env.DEVICE_HOST || "").trim();
const DIST_DIR = path.join(__dirname, "dist");
const INBOX_DIR = path.join(__dirname, "shared-inbox");
const MAX_FILE_BYTES = Number.parseInt(
  process.env.MAX_FILE_SIZE_BYTES || String(2 * 1024 * 1024 * 1024),
  10,
);

const serverDeviceId = crypto.randomUUID();
const serverDeviceName =
  process.env.DEVICE_NAME || os.hostname() || "NearShare Host";
let pairingCode = makePairingCode();
let latestClipboard = null;

// ── Fastify instance ──────────────────────────────────────────────────────────
const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || "info" },
  bodyLimit: MAX_FILE_BYTES,
});

await fs.promises.mkdir(DIST_DIR, { recursive: true });
await fs.promises.mkdir(INBOX_DIR, { recursive: true });

await fastify.register(multipart, {
  limits: { fileSize: MAX_FILE_BYTES, files: 500, fields: 50 },
});

// Accept binary chunk uploads for resumable transfer engine.
// We parse as Buffer (per chunk) to support any file type safely.
fastify.addContentTypeParser(
  /^(application\/octet-stream|application\/binary|image\/.*|video\/.*|audio\/.*|text\/.*)$/,
  { parseAs: "buffer" },
  (request, body, done) => done(null, body),
);

await fastify.register(fastifyStatic, { root: DIST_DIR, prefix: "/" });

// ── In-memory state ───────────────────────────────────────────────────────────
const pairedDevices = new Map();
const sockets = new Map();
const uploadHistory = [];
const resumableSessions = new Map();
const serverStartedAt = new Date().toISOString();
const diagnosticHits = [];
const clientErrors = [];

// ── Security headers ──────────────────────────────────────────────────────────
fastify.addHook("onRequest", async (req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  // Permissive CORS so any device on the LAN can self-test candidate URLs.
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  if (req.method === "OPTIONS") {
    reply.code(204);
    reply.header("Content-Length", "0");
    return reply.send();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

fastify.get("/api/info", async () => {
  const addresses = getLocalUrls();
  const lanAddresses = addresses.filter((u) => !u.includes("localhost"));
  const primaryLanUrl = getPrimaryLanUrl();

  return {
    app: "NearShare",
    version: "2.1.0",
    deviceHost: DEVICE_HOST || null,
    deviceId: serverDeviceId,
    deviceName: serverDeviceName,
    pairingCode,
    port: PORT,
    addresses,
    lanAddresses,
    primaryLanUrl,
    maxFileSizeBytes: MAX_FILE_BYTES,
    pairedDevices: getDeviceList(),
    inbox: INBOX_DIR,
  };
});

// QR code endpoint — returns base64 PNG for the primary local network URL
fastify.get("/api/qr", async () => {
  const urls = getLocalUrls();
  const primary =
    urls.find((u) => !u.includes("localhost")) || urls[0] || `http://localhost:${PORT}`;
  const qr = await QRCode.toDataURL(primary, {
    width: 256,
    margin: 2,
    color: { dark: "#f8fafc", light: "#060912" },
  });
  return { qr, url: primary };
});

// Lightweight reachability endpoint used by the diagnostics panel
fastify.get("/api/ping", async () => ({ ok: true, at: new Date().toISOString() }));

// Heartbeat — every page load reports in so the host can see which devices
// actually managed to load the app over the LAN.
fastify.post("/api/diagnose/heartbeat", async (request) => {
  const body = request.body || {};
  const entry = {
    url: String(body.url || "unknown").slice(0, 300),
    name: cleanName(body.name),
    ip: request.ip || "unknown",
    userAgent: String(request.headers["user-agent"] || "unknown").slice(0, 200),
    at: new Date().toISOString(),
  };
  const last = diagnosticHits[0];
  const SIXTY_SECONDS = 60 * 1000;
  if (
    last &&
    last.ip === entry.ip &&
    last.name === entry.name &&
    Date.now() - new Date(last.at).getTime() < SIXTY_SECONDS
  ) {
    last.at = entry.at;
    last.url = entry.url;
  } else {
    diagnosticHits.unshift(entry);
    if (diagnosticHits.length > 50) diagnosticHits.pop();
  }
  return { ok: true };
});

// Full network diagnostic report
fastify.get("/api/diagnose", async () => buildDiagnoseReport());

// Client-side error log — phones report render/runtime crashes here so a
// blank screen can always be diagnosed from the host.
fastify.post("/api/diagnose/log", async (request) => {
  const body = request.body || {};
  clientErrors.unshift({
    message: String(body.message || "Unknown client error").slice(0, 500),
    stack: String(body.stack || "").slice(0, 4000),
    url: String(body.url || "unknown").slice(0, 300),
    userAgent: String(request.headers["user-agent"] || "unknown").slice(0, 200),
    at: new Date().toISOString(),
  });
  if (clientErrors.length > 50) clientErrors.pop();
  return { ok: true };
});

// Pairing
fastify.post("/api/pair", async (request, reply) => {
  const body = request.body || {};
  const code = normalizeCode(body.code);
  const name = cleanName(body.name);
  const id = cleanId(body.deviceId) || crypto.randomUUID();

  if (!code || code !== pairingCode) {
    reply.code(401);
    return { ok: false, error: "Invalid pairing code." };
  }

  const device = upsertDevice({
    id,
    name,
    address: request.ip,
    userAgent: request.headers["user-agent"] || "unknown",
  });
  broadcast({
    type: "device-paired",
    device: pubDevice(device),
    devices: getDeviceList(),
  });
  return {
    ok: true,
    device: pubDevice(device),
    host: { deviceId: serverDeviceId, deviceName: serverDeviceName },
  };
});

fastify.post("/api/pairing-code/reset", async () => {
  pairingCode = makePairingCode();
  broadcast({ type: "pairing-code-reset", pairingCode });
  return { ok: true, pairingCode };
});

fastify.get("/api/devices", async () => ({
  host: { id: serverDeviceId, name: serverDeviceName, online: true },
  devices: getDeviceList(),
}));

// Clipboard sync
fastify.post("/api/clipboard", async (request) => {
  const body = request.body || {};
  const item = {
    type: String(body.type || "text").slice(0, 20),
    content: String(body.content || "").slice(0, 500_000),
    senderId: cleanId(body.senderId),
    senderName: cleanName(body.senderName) || "Unknown device",
    at: new Date().toISOString(),
  };
  latestClipboard = item;
  broadcast({ type: "clipboard-update", item }, item.senderId);
  return { ok: true };
});

fastify.get("/api/clipboard/latest", async () => ({ item: latestClipboard }));

// Resumable upload: create or resume a chunk session
fastify.post("/api/upload/session/start", async (request, reply) => {
  const body = request.body || {};
  const senderId = cleanId(body.senderId);
  const senderName = cleanName(body.senderName);
  const targetId = cleanId(body.targetId);
  const gestureMode = Boolean(body.gestureMode);
  const note = String(body.note || "").slice(0, 500);
  const incomingFiles = Array.isArray(body.files) ? body.files : [];
  const resumeUploadId = cleanId(body.resumeUploadId);

  if (!incomingFiles.length) {
    reply.code(400);
    return { ok: false, error: "No files provided." };
  }

  const files = incomingFiles.slice(0, 10000).map((f, idx) => {
    const bytes = clampInt(f?.size, 0, Number.MAX_SAFE_INTEGER);
    const rel = safePath(f?.relativePath || f?.name || `file-${idx}`);
    const originalName = String(f?.name || path.basename(rel)).slice(0, 255);
    const mimeType = String(f?.type || "application/octet-stream").slice(0, 120);
    const lastModified = clampInt(f?.lastModified, 0, Number.MAX_SAFE_INTEGER);
    const signature = makeFileSignature(rel, bytes, mimeType, lastModified);
    return {
      originalName,
      relativePath: rel,
      bytes,
      mimeType,
      lastModified,
      signature,
      totalChunks: 0,
      uploadedChunks: new Set(),
      fileSha256: null,
    };
  });

  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const chunkSize = chooseChunkSize(totalBytes, clampInt(body.preferredChunkSize, 0, 8 * 1024 * 1024));

  // Try resuming an existing session when resumeUploadId is provided
  if (resumeUploadId && resumableSessions.has(resumeUploadId)) {
    const existing = resumableSessions.get(resumeUploadId);
    const matches =
      existing.status === "active" &&
      existing.files.length === files.length &&
      existing.files.every((f, i) => f.signature === files[i].signature);

    if (matches) {
      existing.updatedAt = new Date().toISOString();
      await persistSession(existing);
      return {
        ok: true,
        resumed: true,
        uploadId: existing.uploadId,
        chunkSize: existing.chunkSize,
        files: existing.files.map((f, i) => ({
          index: i,
          relativePath: f.relativePath,
          bytes: f.bytes,
          totalChunks: f.totalChunks,
          uploadedChunks: [...f.uploadedChunks].sort((a, b) => a - b),
        })),
      };
    }
  }

  const uploadId = crypto.randomUUID();
  const now = new Date();
  const folderName = `${formatDateForFolder(now)}-${uploadId.slice(0, 8)}`;
  const uploadRoot = path.join(INBOX_DIR, folderName);
  const chunksRoot = path.join(uploadRoot, ".chunks");
  await fs.promises.mkdir(chunksRoot, { recursive: true });

  files.forEach((f) => {
    f.totalChunks = Math.max(1, Math.ceil(f.bytes / chunkSize));
  });

  const session = {
    uploadId,
    folderName,
    uploadRoot,
    chunksRoot,
    senderId,
    senderName,
    targetId,
    gestureMode,
    note,
    chunkSize,
    status: "active",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    files,
  };

  resumableSessions.set(uploadId, session);
  await persistSession(session);

  return {
    ok: true,
    resumed: false,
    uploadId,
    chunkSize,
    files: session.files.map((f, i) => ({
      index: i,
      relativePath: f.relativePath,
      bytes: f.bytes,
      totalChunks: f.totalChunks,
      uploadedChunks: [],
    })),
  };
});

// Resumable upload: session status
fastify.get("/api/upload/session/:uploadId", async (request, reply) => {
  const uploadId = cleanId(request.params.uploadId);
  if (!uploadId || !resumableSessions.has(uploadId)) {
    reply.code(404);
    return { ok: false, error: "Upload session not found." };
  }

  const session = resumableSessions.get(uploadId);
  return {
    ok: true,
    uploadId: session.uploadId,
    status: session.status,
    chunkSize: session.chunkSize,
    files: session.files.map((f, i) => ({
      index: i,
      signature: f.signature,
      relativePath: f.relativePath,
      bytes: f.bytes,
      totalChunks: f.totalChunks,
      uploadedChunks: [...f.uploadedChunks].sort((a, b) => a - b),
    })),
  };
});

// Resumable upload: receive one chunk
fastify.put("/api/upload/session/:uploadId/chunk", async (request, reply) => {
  const uploadId = cleanId(request.params.uploadId);
  const fileIndex = clampInt(request.query.fileIndex, 0, 100000);
  const chunkIndex = clampInt(request.query.chunkIndex, 0, 100000000);

  if (!uploadId || !resumableSessions.has(uploadId)) {
    reply.code(404);
    return { ok: false, error: "Upload session not found." };
  }

  const session = resumableSessions.get(uploadId);
  if (session.status !== "active") {
    reply.code(409);
    return { ok: false, error: "Upload session is not active." };
  }

  const fileMeta = session.files[fileIndex];
  if (!fileMeta) {
    reply.code(400);
    return { ok: false, error: "Invalid file index." };
  }
  if (chunkIndex < 0 || chunkIndex >= fileMeta.totalChunks) {
    reply.code(400);
    return { ok: false, error: "Invalid chunk index." };
  }

  const fileChunkDir = path.join(session.chunksRoot, `f-${fileIndex}`);
  await fs.promises.mkdir(fileChunkDir, { recursive: true });
  const partPath = path.join(fileChunkDir, `c-${chunkIndex}.part`);
  assertInside(session.uploadRoot, partPath);

  const alreadyHad = fileMeta.uploadedChunks.has(chunkIndex);
  if (!alreadyHad) {
    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      reply.code(415);
      return { ok: false, error: "Chunk body must be binary." };
    }
    await fs.promises.writeFile(partPath, body);
    fileMeta.uploadedChunks.add(chunkIndex);
    session.updatedAt = new Date().toISOString();
    await persistSession(session);
  }

  return {
    ok: true,
    alreadyHad,
    fileIndex,
    chunkIndex,
    receivedChunks: fileMeta.uploadedChunks.size,
    totalChunks: fileMeta.totalChunks,
  };
});

// Resumable upload: finalize and assemble files
fastify.post("/api/upload/session/:uploadId/complete", async (request, reply) => {
  const uploadId = cleanId(request.params.uploadId);
  if (!uploadId || !resumableSessions.has(uploadId)) {
    reply.code(404);
    return { ok: false, error: "Upload session not found." };
  }

  const session = resumableSessions.get(uploadId);
  if (session.status !== "active") {
    reply.code(409);
    return { ok: false, error: "Upload session is not active." };
  }

  const missing = [];
  for (let i = 0; i < session.files.length; i++) {
    const f = session.files[i];
    if (f.uploadedChunks.size !== f.totalChunks) {
      missing.push({
        fileIndex: i,
        relativePath: f.relativePath,
        receivedChunks: f.uploadedChunks.size,
        totalChunks: f.totalChunks,
      });
    }
  }

  if (missing.length > 0) {
    reply.code(409);
    return { ok: false, error: "Upload is incomplete.", missing };
  }

  const savedFiles = [];
  let totalBytes = 0;

  try {
    for (let i = 0; i < session.files.length; i++) {
      const f = session.files[i];
      const dest = path.join(session.uploadRoot, f.relativePath);
      assertInside(session.uploadRoot, dest);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });

      const fd = await fs.promises.open(dest, "w");
      const hash = crypto.createHash("sha256");
      try {
        for (let c = 0; c < f.totalChunks; c++) {
          const partPath = path.join(session.chunksRoot, `f-${i}`, `c-${c}.part`);
          assertInside(session.uploadRoot, partPath);
          const data = await fs.promises.readFile(partPath);
          hash.update(data);
          await fd.write(data);
        }
      } finally {
        await fd.close();
      }

      const stat = await fs.promises.stat(dest);
      const fileSha256 = hash.digest("hex");
      f.fileSha256 = fileSha256;

      totalBytes += stat.size;
      savedFiles.push({
        originalName: f.originalName,
        relativePath: path.relative(session.uploadRoot, dest).replaceAll(path.sep, "/"),
        bytes: stat.size,
        mimeType: f.mimeType || "application/octet-stream",
        sha256: fileSha256,
      });
    }

    const sender = session.senderId ? pairedDevices.get(session.senderId) : null;
    if (sender) {
      sender.lastSeenAt = new Date().toISOString();
      sender.uploads = (sender.uploads || 0) + 1;
    }

    const record = {
      uploadId: session.uploadId,
      senderId: session.senderId,
      senderName: cleanName(session.senderName),
      targetId: session.targetId,
      gestureMode: Boolean(session.gestureMode),
      note: String(session.note || "").slice(0, 500),
      files: savedFiles,
      fileCount: savedFiles.length,
      totalBytes,
      folder: session.folderName,
      receivedAt: new Date().toISOString(),
      method: "chunk-stream",
      resumeEnabled: true,
      verified: true,
    };

    uploadHistory.push(record);
    if (uploadHistory.length > 1000)
      uploadHistory.splice(0, uploadHistory.length - 1000);

    session.status = "completed";
    session.updatedAt = new Date().toISOString();
    await persistSession(session);

    // Clean temporary chunk data after assembly
    await fs.promises.rm(session.chunksRoot, { recursive: true, force: true });

    broadcast({ type: "files-received", upload: record });
    return { ok: true, upload: record };
  } catch (err) {
    fastify.log.error({ err, uploadId }, "Session finalize failed");
    reply.code(500);
    return { ok: false, error: err.message || "Failed to finalize upload." };
  }
});

// File upload (legacy multipart fallback)
fastify.post("/api/upload", async (request, reply) => {
  if (!request.isMultipart()) {
    reply.code(415);
    return { ok: false, error: "Expected multipart/form-data." };
  }

  const uploadId = crypto.randomUUID();
  const now = new Date();
  const folderName = `${formatDateForFolder(now)}-${uploadId.slice(0, 8)}`;
  const uploadRoot = path.join(INBOX_DIR, folderName);
  await fs.promises.mkdir(uploadRoot, { recursive: true });

  const meta = {
    uploadId,
    senderId: null,
    senderName: "Unknown",
    targetId: null,
    gestureMode: false,
    note: "",
  };
  const savedFiles = [];
  let totalBytes = 0;

  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        applyMeta(meta, part.fieldname, part.value);
        continue;
      }
      if (part.type !== "file") continue;

      const relName = safePath(
        part.fields?.relativePath?.value ||
          part.filename ||
          `file-${Date.now()}`,
      );
      const dest = path.join(uploadRoot, relName);
      assertInside(uploadRoot, dest);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await pipeline(part.file, fs.createWriteStream(dest));

      const stat = await fs.promises.stat(dest);
      totalBytes += stat.size;
      savedFiles.push({
        originalName: part.filename,
        relativePath: path.relative(uploadRoot, dest).replaceAll(path.sep, "/"),
        bytes: stat.size,
        mimeType: part.mimetype || "application/octet-stream",
      });
    }

    if (!savedFiles.length) {
      await fs.promises.rm(uploadRoot, { recursive: true, force: true });
      reply.code(400);
      return { ok: false, error: "No files uploaded." };
    }

    const sender = meta.senderId ? pairedDevices.get(meta.senderId) : null;
    if (sender) {
      sender.lastSeenAt = new Date().toISOString();
      sender.uploads = (sender.uploads || 0) + 1;
    }

    const record = {
      uploadId,
      senderId: meta.senderId,
      senderName: cleanName(meta.senderName),
      targetId: meta.targetId,
      gestureMode: Boolean(meta.gestureMode),
      note: String(meta.note || "").slice(0, 500),
      files: savedFiles,
      fileCount: savedFiles.length,
      totalBytes,
      folder: folderName,
      receivedAt: new Date().toISOString(),
    };

    uploadHistory.push(record);
    if (uploadHistory.length > 1000)
      uploadHistory.splice(0, uploadHistory.length - 1000);

    broadcast({ type: "files-received", upload: record });
    return { ok: true, upload: record };
  } catch (err) {
    fastify.log.error({ err }, "Upload failed");
    await fs.promises.rm(uploadRoot, { recursive: true, force: true });
    reply.code(err.statusCode || 500);
    return { ok: false, error: err.message || "Upload failed." };
  }
});

fastify.get("/api/history", async () => ({
  uploads: uploadHistory.slice(-200).reverse(),
}));

fastify.get("/api/download/:uploadId/:filePath", async (request, reply) => {
  const upload = uploadHistory.find(
    (u) => u.uploadId === request.params.uploadId,
  );
  if (!upload) {
    reply.code(404);
    return { ok: false, error: "Not found." };
  }

  const rel = safePath(request.params.filePath);
  const file = upload.files.find((f) => f.relativePath === rel);
  if (!file) {
    reply.code(404);
    return { ok: false, error: "File not found." };
  }

  const abs = path.join(INBOX_DIR, upload.folder, file.relativePath);
  assertInside(path.join(INBOX_DIR, upload.folder), abs);

  const basename = path.basename(file.relativePath);
  return reply
    .header(
      "Content-Disposition",
      `attachment; filename="${basename.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(basename)}`,
    )
    .type(file.mimeType)
    .send(fs.createReadStream(abs));
});

// SPA fallback — serve index.html for unknown GET routes
fastify.setNotFoundHandler(async (request, reply) => {
  if (request.method !== "GET" || request.url.startsWith("/api/")) {
    reply.code(404);
    return { ok: false, error: "Not found." };
  }
  const indexPath = path.join(DIST_DIR, "index.html");
  const exists = await fs.promises
    .access(indexPath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return reply.type("text/html").send(fs.createReadStream(indexPath));
  }
  reply.code(503);
  return { ok: false, error: "App not built yet. Run: npm run build" };
});

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════════

const wss = new WebSocketServer({
  server: fastify.server,
  path: "/events",
  maxPayload: 4 * 1024 * 1024,
});

wss.on("connection", (socket, request) => {
  const url = new URL(
    request.url || "/events",
    `http://${request.headers.host || "localhost"}`,
  );
  const code = normalizeCode(url.searchParams.get("code"));
  const deviceId =
    cleanId(url.searchParams.get("deviceId")) || crypto.randomUUID();
  const deviceName = cleanName(url.searchParams.get("name"));

  if (code !== pairingCode) {
    send(socket, { type: "pairing-denied", error: "Invalid pairing code." });
    socket.close(1008, "Invalid pairing code");
    return;
  }

  const device = upsertDevice({
    id: deviceId,
    name: deviceName,
    address: request.socket.remoteAddress,
    userAgent: request.headers["user-agent"] || "unknown",
  });
  sockets.set(device.id, socket);
  device.online = true;
  device.lastSeenAt = new Date().toISOString();

  send(socket, {
    type: "hello",
    host: { id: serverDeviceId, name: serverDeviceName },
    self: pubDevice(device),
    devices: getDeviceList(),
    pairingCode,
  });
  broadcast(
    {
      type: "device-online",
      device: pubDevice(device),
      devices: getDeviceList(),
    },
    device.id,
  );

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    device.lastSeenAt = new Date().toISOString();
    handleWsMessage(socket, device, msg);
  });

  socket.on("close", () => {
    sockets.delete(device.id);
    device.online = false;
    device.lastSeenAt = new Date().toISOString();
    broadcast({
      type: "device-offline",
      device: pubDevice(device),
      devices: getDeviceList(),
    });
  });

  socket.on("error", (err) =>
    fastify.log.warn({ err, deviceId: device.id }, "Socket error"),
  );
});

function handleWsMessage(socket, sender, msg) {
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "ping":
      send(socket, { type: "pong", at: new Date().toISOString() });
      break;

    case "gesture":
      broadcast(
        {
          type: "gesture",
          sender: pubDevice(sender),
          gesture: sanitizeGesture(msg.gesture),
          payload: sanitizePayload(msg.payload),
          at: new Date().toISOString(),
        },
        sender.id,
      );
      break;

    // OriginOS-style cross-device drag
    case "cross-drag-start":
      broadcast(
        {
          type: "cross-drag-start",
          sender: pubDevice(sender),
          sessionId: cleanId(msg.sessionId) || crypto.randomUUID(),
          fileInfo: sanitizePayload(msg.fileInfo),
        },
        sender.id,
      );
      break;

    case "cross-drag-move":
      forward(sender.id, msg.targetId, {
        type: "cross-drag-move",
        sender: pubDevice(sender),
        sessionId: cleanId(msg.sessionId),
        x: clamp(Number(msg.x), 0, 1),
        y: clamp(Number(msg.y), 0, 1),
      });
      break;

    case "cross-drag-drop":
      forward(sender.id, msg.targetId, {
        type: "cross-drag-drop",
        sender: pubDevice(sender),
        sessionId: cleanId(msg.sessionId),
        targetId: cleanId(msg.targetId),
        uploadHint: sanitizePayload(msg.uploadHint),
      });
      break;

    case "cross-drag-cancel":
      broadcast(
        {
          type: "cross-drag-cancel",
          sender: pubDevice(sender),
          sessionId: cleanId(msg.sessionId),
        },
        sender.id,
      );
      break;

    // Clipboard bridge
    case "clipboard-sync": {
      const item = {
        type: String(msg.contentType || "text").slice(0, 20),
        content: String(msg.content || "").slice(0, 500_000),
        from: pubDevice(sender),
        at: new Date().toISOString(),
      };
      latestClipboard = item;
      broadcast({ type: "clipboard-update", item }, sender.id);
      break;
    }

    case "super-drag-start":
      broadcast(
        {
          type: "super-drag-start",
          sender: pubDevice(sender),
          itemCount: clampInt(msg.itemCount, 0, 1000),
        },
        sender.id,
      );
      break;

    case "super-drag-drop":
      forward(sender.id, msg.targetId, {
        type: "super-drag-drop",
        sender: pubDevice(sender),
        targetId: cleanId(msg.targetId),
        uploadHint: sanitizePayload(msg.uploadHint),
      });
      break;

    case "transfer-offer":
      forward(sender.id, msg.targetId, {
        type: "transfer-offer",
        sender: pubDevice(sender),
        offerId: cleanId(msg.offerId) || crypto.randomUUID(),
        fileCount: clampInt(msg.fileCount, 0, 10000),
        totalBytes: clampInt(msg.totalBytes, 0, Number.MAX_SAFE_INTEGER),
        names: Array.isArray(msg.names)
          ? msg.names.slice(0, 25).map((n) => String(n).slice(0, 180))
          : [],
      });
      break;

    case "devices-request":
      send(socket, { type: "devices", devices: getDeviceList() });
      break;

    // ── Notes / Messaging ─────────────────────────────────────────────────
    case "send-note": {
      const noteId = cleanId(msg.noteId) || crypto.randomUUID();
      const payload = {
        type: "new-note",
        noteId,
        sender: pubDevice(sender),
        text: String(msg.text || "").slice(0, 8000),
        html: String(msg.html || "").slice(0, 16000),
        at: new Date().toISOString(),
        replyTo: cleanId(msg.replyTo) || null,
      };

      // Deliver to target
      if (msg.targetId) {
        forward(sender.id, msg.targetId, payload);
      } else {
        // Broadcast to all connected devices
        broadcast(payload, sender.id);
      }

      // Confirm delivery back to sender
      send(socket, {
        type: "note-status",
        noteId,
        status: "delivered",
        at: payload.at,
      });
      break;
    }

    case "note-read": {
      const nid = cleanId(msg.noteId);
      if (nid && msg.senderId) {
        forward(sender.id, msg.senderId, {
          type: "note-status",
          noteId: nid,
          status: "read",
          at: new Date().toISOString(),
        });
      }
      break;
    }

    default:
      send(socket, {
        type: "error",
        error: `Unknown message type: ${String(msg.type || "").slice(0, 40)}`,
      });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function upsertDevice({ id, name, address, userAgent }) {
  const existing = pairedDevices.get(id);
  const now = new Date().toISOString();
  if (existing) {
    if (name) existing.name = name;
    if (address) existing.address = address;
    existing.online = true;
    existing.lastSeenAt = now;
    return existing;
  }
  const device = {
    id,
    name: name || "Nearby device",
    address: address || "unknown",
    userAgent: userAgent || "unknown",
    online: true,
    trusted: true,
    uploads: 0,
    pairedAt: now,
    lastSeenAt: now,
  };
  pairedDevices.set(id, device);
  return device;
}

function pubDevice(d) {
  return {
    id: d.id,
    name: d.name,
    online: Boolean(d.online),
    trusted: Boolean(d.trusted),
    uploads: d.uploads || 0,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
  };
}

function getDeviceList() {
  return [...pairedDevices.values()]
    .map(pubDevice)
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    );
}

function send(socket, msg) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId = null) {
  for (const [id, socket] of sockets.entries()) {
    if (id !== exceptId) send(socket, msg);
  }
}

function forward(senderId, targetId, msg) {
  const tid = cleanId(targetId);
  if (tid && sockets.has(tid)) {
    send(sockets.get(tid), msg);
    return;
  }
  broadcast(msg, senderId);
}

function applyMeta(meta, field, value) {
  const f = String(field || "").trim();
  if (f === "senderId") meta.senderId = cleanId(value);
  else if (f === "senderName") meta.senderName = cleanName(value);
  else if (f === "targetId") meta.targetId = cleanId(value);
  else if (f === "gestureMode")
    meta.gestureMode = value === "true" || value === true;
  else if (f === "note") meta.note = String(value || "").slice(0, 500);
}

function safePath(input) {
  const pieces = String(input || "file")
    .replaceAll("\\", "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001F]/g, "_").slice(0, 200));
  return (pieces.join("/") || `file-${Date.now()}`).slice(0, 2000);
}

function assertInside(root, candidate) {
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const e = new Error("Unsafe path rejected.");
    e.statusCode = 400;
    throw e;
  }
}

function makePairingCode() {
  return crypto.randomInt(100000, 999999).toString();
}
function normalizeCode(v) {
  return String(v || "")
    .replace(/\D/g, "")
    .slice(0, 6);
}
function cleanId(v) {
  const s = String(v || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, "")
    .slice(0, 120);
  return s || null;
}
function cleanName(v) {
  return (
    String(v || "Nearby device")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Nearby device"
  );
}
function sanitizeGesture(v) {
  const g = String(v || "unknown")
    .trim()
    .toLowerCase();
  return [
    "pick",
    "drop",
    "pinch",
    "release",
    "hover",
    "cancel",
    "unknown",
    "swipe-left",
    "swipe-right",
    "swipe-up",
    "swipe-down",
  ].includes(g)
    ? g
    : "unknown";
}
function sanitizePayload(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  const r = {};
  for (const [k, v] of Object.entries(p).slice(0, 30)) {
    const sk = String(k)
      .replace(/[^a-zA-Z0-9._:-]/g, "")
      .slice(0, 60);
    if (!sk) continue;
    if (typeof v === "number") r[sk] = Number.isFinite(v) ? v : 0;
    else if (typeof v === "boolean") r[sk] = v;
    else if (typeof v === "string") r[sk] = v.slice(0, 400);
  }
  return r;
}
function clamp(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}
function clampInt(v, min, max) {
  return clamp(Math.floor(Number(v)), min, max);
}

function chooseChunkSize(totalBytes, preferred = 0) {
  if (preferred >= 64 * 1024 && preferred <= 8 * 1024 * 1024) {
    return preferred;
  }
  if (totalBytes <= 25 * 1024 * 1024) return 256 * 1024;
  if (totalBytes <= 500 * 1024 * 1024) return 1024 * 1024;
  if (totalBytes <= 5 * 1024 * 1024 * 1024) return 2 * 1024 * 1024;
  return 4 * 1024 * 1024;
}

function makeFileSignature(relativePath, bytes, mimeType, lastModified) {
  return crypto
    .createHash("sha256")
    .update(`${relativePath}|${bytes}|${mimeType}|${lastModified}`)
    .digest("hex");
}

async function persistSession(session) {
  const sessionPath = path.join(session.uploadRoot, ".session.json");
  assertInside(session.uploadRoot, sessionPath);
  const serializable = {
    uploadId: session.uploadId,
    folderName: session.folderName,
    senderId: session.senderId,
    senderName: session.senderName,
    targetId: session.targetId,
    gestureMode: session.gestureMode,
    note: session.note,
    chunkSize: session.chunkSize,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    files: session.files.map((f) => ({
      originalName: f.originalName,
      relativePath: f.relativePath,
      bytes: f.bytes,
      mimeType: f.mimeType,
      lastModified: f.lastModified,
      signature: f.signature,
      totalChunks: f.totalChunks,
      uploadedChunks: [...f.uploadedChunks].sort((a, b) => a - b),
      fileSha256: f.fileSha256 || null,
    })),
  };
  await fs.promises.writeFile(sessionPath, JSON.stringify(serializable, null, 2), "utf8");
}

function formatDateForFolder(d) {
  return d.toISOString().replace(/[:.]/g, "-");
}
const VIRTUAL_INTERFACE_PATTERN =
  /vmware|virtualbox|hyper-v|hyperv|vbox|docker|vethernet|wsl|tailscale|zerotier|wireguard|loopback|utun|tap[0-9]|tun[0-9]|nordvpn|expressvpn|surfshark|hamachi|radmin|isatap/i;

function getInterfaceReport() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      const address = String(a.address);
      const internal = Boolean(a.internal);
      const virtual = VIRTUAL_INTERFACE_PATTERN.test(name);
      const octets = address.split(".").map(Number);
      const privateRange =
        octets.length === 4 &&
        (octets[0] === 10 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168));
      const loopback = octets.length === 4 && octets[0] === 127;
      const candidate = !internal && !virtual && !loopback && privateRange;
      let score = 0;
      if (candidate) score = 100;
      else if (!internal && !virtual && !loopback) score = 80;
      else if (!internal && privateRange) score = 30;
      else if (!internal) score = 10;
      list.push({
        name,
        address,
        internal,
        virtual,
        private: privateRange,
        loopback,
        candidate,
        score,
      });
    }
  }
  return list.sort((x, y) => y.score - x.score);
}

function getLocalUrls() {
  const urls = [];
  const seen = new Set();
  for (const r of getInterfaceReport()) {
    if (r.internal || r.loopback) continue;
    const url = `http://${r.address}:${PORT}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  const localUrl = `http://localhost:${PORT}`;
  if (!seen.has(localUrl)) urls.push(localUrl);
  return urls;
}

function getPrimaryLanUrl() {
  if (DEVICE_HOST) {
    return `http://${String(DEVICE_HOST).replace(/^https?:\/\//, "")}:${PORT}`;
  }
  const urls = getLocalUrls();
  return urls.find((u) => !u.includes("localhost")) || urls[0] || `http://localhost:${PORT}`;
}

async function getDistInfo() {
  const indexPath = path.join(DIST_DIR, "index.html");
  try {
    const st = await fs.promises.stat(indexPath);
    return { exists: true, bytes: st.size, modifiedAt: st.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, modifiedAt: null };
  }
}

function getFirewallStatus() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({
        status: "unknown",
        hint: "Non-Windows host — make sure the OS firewall allows inbound TCP on the chosen port.",
      });
      return;
    }
    const ruleName = `NearShare ${PORT}`;
    execFile(
      "netsh",
      ["advfirewall", "firewall", "show", "rule", `name=${ruleName}`],
      { timeout: 2500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve({
            status: "check_failed",
            hint:
              "Could not query Windows Firewall automatically. Open Windows Security → " +
              "Firewall & network protection → Allow an app through firewall and allow " +
              `Node.js on TCP port ${PORT}.`,
          });
          return;
        }
        if (stdout && stdout.includes("NearShare")) {
          resolve({ status: "rule_present", hint: `Inbound firewall rule '${ruleName}' exists.` });
          return;
        }
        resolve({
          status: "no_rule",
          hint:
            "No inbound firewall rule for NearShare was found — Windows may be silently " +
            "blocking other devices. Run this in an Administrator terminal to allow it:",
        });
      },
    );
  });
}

function probeListen() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (err) => {
      resolve({ ok: false, error: err.code || err.message });
    });
    srv.listen({ port: 0, host: "0.0.0.0" }, () => {
      const addr = srv.address();
      srv.close(() => resolve({ ok: true, port: addr && addr.port }));
    });
  });
}

async function buildDiagnoseReport() {
  const [dist, firewall, listenProbe] = await Promise.all([
    getDistInfo(),
    getFirewallStatus(),
    probeListen(),
  ]);
  return {
    ok: true,
    app: "NearShare",
    version: "2.1.0",
    serverStartedAt,
    now: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    port: PORT,
    hostBinding: HOST,
    deviceHost: DEVICE_HOST || null,
    boundAddress: fastify.server.address() || null,
    interfaces: getInterfaceReport(),
    candidateUrls: getLocalUrls(),
    primaryLanUrl: getPrimaryLanUrl(),
    dist,
    firewall,
    listenProbe,
    hits: [...diagnosticHits],
    clientErrors: [...clientErrors],
    uploadHistoryCount: uploadHistory.length,
    resumableSessionCount: resumableSessions.size,
  };
}

async function restoreResumableSessionsFromDisk() {
  const folders = await fs.promises.readdir(INBOX_DIR, { withFileTypes: true });

  for (const entry of folders) {
    if (!entry.isDirectory()) continue;

    const uploadRoot = path.join(INBOX_DIR, entry.name);
    const sessionPath = path.join(uploadRoot, ".session.json");

    const exists = await fs.promises
      .access(sessionPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;

    try {
      const raw = await fs.promises.readFile(sessionPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed?.uploadId || parsed.status !== "active") continue;

      const files = Array.isArray(parsed.files)
        ? parsed.files.map((f) => ({
            originalName: String(f.originalName || path.basename(String(f.relativePath || "file"))).slice(0, 255),
            relativePath: safePath(f.relativePath),
            bytes: clampInt(f.bytes, 0, Number.MAX_SAFE_INTEGER),
            mimeType: String(f.mimeType || "application/octet-stream").slice(0, 120),
            lastModified: clampInt(f.lastModified, 0, Number.MAX_SAFE_INTEGER),
            signature:
              String(f.signature || "") ||
              makeFileSignature(
                safePath(f.relativePath),
                clampInt(f.bytes, 0, Number.MAX_SAFE_INTEGER),
                String(f.mimeType || "application/octet-stream"),
                clampInt(f.lastModified, 0, Number.MAX_SAFE_INTEGER),
              ),
            totalChunks: Math.max(1, clampInt(f.totalChunks, 1, 100000000)),
            uploadedChunks: new Set(
              Array.isArray(f.uploadedChunks)
                ? f.uploadedChunks.filter((n) => Number.isInteger(n) && n >= 0)
                : [],
            ),
            fileSha256: typeof f.fileSha256 === "string" ? f.fileSha256 : null,
          }))
        : [];

      const session = {
        uploadId: cleanId(parsed.uploadId),
        folderName: entry.name,
        uploadRoot,
        chunksRoot: path.join(uploadRoot, ".chunks"),
        senderId: cleanId(parsed.senderId),
        senderName: cleanName(parsed.senderName),
        targetId: cleanId(parsed.targetId),
        gestureMode: Boolean(parsed.gestureMode),
        note: String(parsed.note || "").slice(0, 500),
        chunkSize: clampInt(parsed.chunkSize, 64 * 1024, 8 * 1024 * 1024),
        status: "active",
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        files,
      };

      if (session.uploadId && files.length > 0) {
        resumableSessions.set(session.uploadId, session);
      }
    } catch (err) {
      fastify.log.warn({ err, sessionPath }, "Failed to restore resumable session");
    }
  }
}

async function restoreUploadHistoryFromDisk() {
  const folders = await fs.promises.readdir(INBOX_DIR, { withFileTypes: true });
  const restored = [];

  for (const entry of folders) {
    if (!entry.isDirectory()) continue;

    const uploadRoot = path.join(INBOX_DIR, entry.name);
    const sessionPath = path.join(uploadRoot, ".session.json");

    const exists = await fs.promises
      .access(sessionPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;

    try {
      const parsed = JSON.parse(await fs.promises.readFile(sessionPath, "utf8"));
      if (!parsed?.uploadId || parsed.status !== "completed") continue;

      const rawFiles = Array.isArray(parsed.files) ? parsed.files : [];
      if (!rawFiles.length) continue;

      const verified = [];
      for (const f of rawFiles) {
        const rel = safePath(f?.relativePath);
        if (!rel) continue;
        const abs = path.join(uploadRoot, rel);
        assertInside(uploadRoot, abs);
        try {
          const st = await fs.promises.stat(abs);
          verified.push({
            originalName: String(f.originalName || path.basename(rel)).slice(0, 255),
            relativePath: path.relative(uploadRoot, abs).replaceAll(path.sep, "/"),
            bytes: st.size,
            mimeType: String(f.mimeType || "application/octet-stream").slice(0, 120),
            sha256: typeof f.fileSha256 === "string" ? f.fileSha256 : undefined,
          });
        } catch {
          // file no longer on disk — skip this entry
        }
      }

      if (!verified.length) continue;

      restored.push({
        uploadId: cleanId(parsed.uploadId),
        senderId: cleanId(parsed.senderId),
        senderName: cleanName(parsed.senderName),
        targetId: cleanId(parsed.targetId),
        gestureMode: Boolean(parsed.gestureMode),
        note: String(parsed.note || "").slice(0, 500),
        files: verified,
        fileCount: verified.length,
        totalBytes: verified.reduce((s, f) => s + f.bytes, 0),
        folder: entry.name,
        receivedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
        method: "chunk-stream",
        resumeEnabled: true,
        verified: true,
        restored: true,
      });
    } catch (err) {
      fastify.log.warn({ err, sessionPath }, "Failed to restore history record");
    }
  }

  restored.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  uploadHistory.push(...restored.slice(0, 1000));
  if (uploadHistory.length > 1000) uploadHistory.splice(0, uploadHistory.length - 1000);
  if (restored.length > 0) {
    fastify.log.info(`Restored ${restored.length} completed transfer record(s) from disk`);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
await restoreResumableSessionsFromDisk();
await restoreUploadHistoryFromDisk();

try {
  await fastify.listen({ host: HOST, port: PORT });
} catch (err) {
  fastify.log.error(`Could not listen on ${HOST}:${PORT} — ${err.message}`);
  fastify.log.error(
    "Is another NearShare instance already running? Stop it first, " +
      `or start a second instance with PORT=${PORT + 1} npm start`,
  );
  process.exit(1);
}

const urls = getLocalUrls();
const primary = getPrimaryLanUrl();

fastify.log.info(`NearShare v2.1 running — pairing code: ${pairingCode}`);
fastify.log.info(`Reachable URLs for other devices:`);
for (const u of urls) fastify.log.info(`  ${u}`);
fastify.log.info(`Diagnostics: ${primary}/api/diagnose`);

if (DEVICE_HOST) {
  fastify.log.info(`DEVICE_HOST override active — advertising ${primary}`);
} else if (!urls.some((u) => !u.includes("localhost"))) {
  fastify.log.warn(
    "No LAN interface detected. Other devices cannot reach this server. " +
      "If you are sure the IP is reachable, start with DEVICE_HOST=<your-lan-ip> npm start",
  );
}

qrcodeTerminal.generate(primary, { small: true });

// ─── LAN Discovery Beacon (UDP broadcast) ────────────────────────────────────
// Announces the server on the LAN every 5 seconds so clients can auto-discover it.
const DISCOVERY_PORT = 8788;
const DISCOVERY_MESSAGE = JSON.stringify({
  type: "nearshare-discover",
  port: PORT,
  host: primary,
  name: serverDeviceName,
  pairingCode,
  version: "2.1.0",
});

const beacon = dgram.createSocket("udp4");
beacon.bind(() => {
  beacon.setBroadcast(true);
  fastify.log.info(`Discovery beacon broadcasting to UDP :${DISCOVERY_PORT} every 5s`);
});

let discoveryTimer = setInterval(() => {
  beacon.send(
    DISCOVERY_MESSAGE,
    DISCOVERY_PORT,
    "255.255.255.255",
    (err) => {
      if (err && err.code !== "EADDRNOTAVAIL") {
        // Non-critical — don't crash on broadcast failures
        fastify.log.debug(`Discovery broadcast skipped: ${err.message}`);
      }
    },
  );
}, 5000);

// Clean shutdown
const cleanup = () => {
  clearInterval(discoveryTimer);
  beacon.close();
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
