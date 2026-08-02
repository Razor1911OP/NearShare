import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "../store/AppContext.jsx";
import { useSendMsg } from "../App.jsx";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const CHATROOM_ID = "nearshare-chatroom";

function formatNoteTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const fmt = { hour: "2-digit", minute: "2-digit" };
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], fmt);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], fmt)
  );
}

function makeNoteId() {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onDelete }) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const longPressRef = useRef(null);
  const isMe = msg.fromMe;

  // Long-press to open menu (works on desktop & mobile)
  const startPress = (e) => {
    longPressRef.current = setTimeout(() => {
      e.preventDefault?.();
      setMenu(true);
    }, 500);
  };
  const cancelPress = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  // Right-click also opens menu on desktop
  const handleContextMenu = (e) => {
    e.preventDefault();
    cancelPress();
    setMenu(true);
  };

  const closeMenu = () => setMenu(false);

  // Close menu on outside click/tap
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    window.addEventListener('touchend', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('touchend', close);
    };
  }, [menu]);

  const handleCopy = () => {
    const text = msg.text || '';
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
    closeMenu();
  };

  const fallbackCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
    document.body.removeChild(ta);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      style={{
        display: "flex",
        justifyContent: isMe ? "flex-end" : "flex-start",
        padding: "3px 0",
        position: "relative",
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={cancelPress}
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onMouseLeave={cancelPress}
    >
      <div style={{ maxWidth: "75%" }}>
        <div
          style={{
            borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            padding: "8px 14px",
            background: isMe
              ? "linear-gradient(135deg, var(--brand), var(--brand-2))"
              : "var(--surface)",
            color: isMe ? "#fff" : "var(--text)",
            wordBreak: "break-word",
            boxShadow: isMe
              ? "0 4px 14px rgba(129,154,148,0.25)"
              : "0 1px 4px rgba(0,0,0,0.15)",
          }}
        >
          {/* Sender name inside the bubble (only for others) */}
          {!isMe && msg.deviceName && (
            <div
              style={{
                fontSize: "0.70rem",
                fontWeight: 700,
                color: "var(--brand)",
                marginBottom: 3,
              }}
            >
              {msg.deviceName}
            </div>
          )}
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.88rem",
              lineHeight: 1.45,
            }}
          >
            {msg.text}
          </div>
          <div
            style={{
              marginTop: 3,
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.64rem",
              opacity: 0.55,
              justifyContent: "flex-end",
            }}
          >
            <span>{formatNoteTime(msg.at)}</span>
          </div>
        </div>
      </div>

      {/* Context menu — centered overlay, works on mobile & desktop */}
      <AnimatePresence>
        {menu && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => { e.stopPropagation(); closeMenu(); }}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9998,
                background: "rgba(0,0,0,0.5)",
              }}
            />
            {/* Menu */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 9999,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "6px",
                minWidth: 220,
                boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {/* Message preview */}
              <div
                style={{
                  padding: "10px 14px",
                  fontSize: "0.80rem",
                  color: "var(--text-2)",
                  lineHeight: 1.4,
                  maxHeight: 80,
                  overflow: "hidden",
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 2,
                }}
              >
                {msg.text.slice(0, 200)}
              </div>

              {/* Copy */}
              <button
                onClick={handleCopy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  border: "none",
                  borderRadius: 10,
                  background: "transparent",
                  color: copied ? "var(--good)" : "var(--text)",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => (e.target.style.background = "var(--surface-hi)")}
                onMouseLeave={(e) => (e.target.style.background = "transparent")}
              >
                {copied ? '✅' : '📋'} {copied ? 'Copied!' : 'Copy message'}
              </button>

              {/* Delete (only own messages) */}
              {isMe && (
                <button
                  onClick={() => { onDelete(msg.id); closeMenu(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    border: "none",
                    borderRadius: 10,
                    background: "transparent",
                    color: "var(--bad)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => (e.target.style.background = "rgba(217,96,95,0.10)")}
                  onMouseLeave={(e) => (e.target.style.background = "transparent")}
                >
                  🗑 Delete message
                </button>
              )}

              {/* Cancel */}
              <button
                onClick={closeMenu}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  padding: "10px 14px",
                  border: "none",
                  borderRadius: 10,
                  background: "var(--surface-hi)",
                  color: "var(--text-2)",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "center",
                  fontWeight: 500,
                  marginTop: 2,
                }}
              >
                Cancel
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── NotesPanel ────────────────────────────────────────────────────────────────

export default function NotesPanel({ compact = false }) {
  const [state, dispatch] = useApp();
  const sendMessage = useSendMsg();
  const { notes, devices, deviceName } = state;

  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Single chatroom — all messages with deviceId = CHATROOM_ID
  const chatroom = notes.find((c) => c.deviceId === CHATROOM_ID);
  const messages = chatroom?.messages || [];

  // Mark chatroom as "read" when viewing
  useEffect(() => {
    dispatch({ type: "SET_ACTIVE_CHAT", payload: CHATROOM_ID });
  }, [dispatch]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    const noteId = makeNoteId();
    const now = new Date().toISOString();

    dispatch({
      type: "ADD_NOTE",
      payload: {
        deviceId: CHATROOM_ID,
        deviceName: deviceName || "You",
        text,
        html: "",
        noteId,
        fromMe: true,
        at: now,
      },
    });

    // Broadcast to all devices (no targetId = everyone)
    sendMessage({
      type: "send-note",
      noteId,
      text,
      html: "",
    });

    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, deviceName, dispatch, sendMessage]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleDelete = useCallback(
    (noteId) => {
      dispatch({
        type: "DELETE_NOTE",
        payload: { chatId: CHATROOM_ID, noteId },
      });
    },
    [dispatch],
  );

  const handleClear = useCallback(() => {
    dispatch({ type: "CLEAR_CHAT", payload: CHATROOM_ID });
  }, [dispatch]);

  const handlePasteClipboard = useCallback(() => {
    navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) setInput((prev) => prev + text);
      })
      .catch(() => {});
  }, []);

  // Count online devices (including host)
  const onlineCount =
    1 + (devices?.filter((d) => d.online !== false).length || 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
        borderRadius: compact ? 0 : 12,
        overflow: "hidden",
        border: compact ? "none" : "1px solid var(--border)",
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, var(--brand), var(--brand-2))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.2rem",
            }}
          >
            💬
          </div>
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.90rem",
                color: "var(--text)",
              }}
            >
              Chatroom
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-3)" }}>
              {onlineCount} device{onlineCount !== 1 ? "s" : ""} connected
            </div>
          </div>
        </div>
        <button
          onClick={handleClear}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: "0.72rem",
            color: "var(--text-3)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          title="Clear chat"
        >
          Clear
        </button>
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
          background: "var(--bg)",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              padding: "40px 0",
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: "0.82rem",
            }}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: 10, opacity: 0.2 }}>
              💬
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.90rem", marginBottom: 4 }}>
              No messages yet
            </div>
            <div>Be the first to say something!</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onDelete={handleDelete}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Typing indicator ──────────────────────────────────────────────── */}
      {messages.length > 0 &&
        messages[messages.length - 1]?.fromMe === false && (
          <div
            style={{
              padding: "0 14px 4px",
              fontSize: "0.66rem",
              color: "var(--text-3)",
              fontStyle: "italic",
            }}
          >
            {messages[messages.length - 1].deviceName} wrote…
          </div>
        )}

      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <button
            onClick={handlePasteClipboard}
            title="Paste from clipboard"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.9rem",
              flexShrink: 0,
            }}
          >
            📋
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a message..."
            rows={1}
            style={{
              flex: 1,
              minHeight: 36,
              maxHeight: 100,
              resize: "none",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              padding: "8px 12px",
              fontSize: "0.86rem",
              color: "var(--text)",
              outline: "none",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "none",
              background: input.trim()
                ? "linear-gradient(135deg, var(--brand), var(--brand-2))"
                : "var(--surface-hi)",
              color: input.trim() ? "#fff" : "var(--text-3)",
              cursor: input.trim() ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1rem",
              flexShrink: 0,
              boxShadow: input.trim()
                ? "0 4px 12px rgba(129,154,148,0.30)"
                : "none",
            }}
          >
            ↑
          </button>
        </div>
        <div
          style={{
            textAlign: "center",
            marginTop: 4,
            fontSize: "0.62rem",
            color: "var(--text-3)",
          }}
        >
          Press Enter to send · All connected devices see messages
        </div>
      </div>
    </div>
  );
}
