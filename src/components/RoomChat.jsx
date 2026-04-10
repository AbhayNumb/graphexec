"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PREVIEW_ROOM_ID,
  PREVIEW_USER_ID,
} from "@/lib/roomChatPreview";

const ROLE_ROW = {
  user: { label: "You", rowClass: "rcgpt-row--user" },
  assistant: { label: "Assistant", rowClass: "rcgpt-row--assistant" },
  hitl: { label: "Human in the loop", rowClass: "rcgpt-row--hitl" },
  unknown: { label: "Message", rowClass: "rcgpt-row--unknown" },
};

function formatIst(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function RoomChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orchestratorNotice, setOrchestratorNotice] = useState(null);
  const [orchestratorBannerKind, setOrchestratorBannerKind] = useState(null);
  const [text, setText] = useState("");
  const [sendAs, setSendAs] = useState("user");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/room-messages")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setMessages([]);
          return;
        }
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const ta = inputRef.current;
    if (ta && !text) {
      ta.style.height = "";
    }
  }, [text]);

  const sendMessage = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    setOrchestratorNotice(null);
    setOrchestratorBannerKind(null);
    try {
      const res = await fetch("/api/room-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, sendAs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || res.statusText);
        return;
      }
      const orch = data.orchestrator;
      if (orch?.skipped) {
        if (orch.reason === "human_in_the_loop") {
          setOrchestratorBannerKind("success");
          setOrchestratorNotice(
            "Saved as human-in-the-loop. Orchestrator was not called."
          );
        } else {
          setOrchestratorBannerKind("warn");
          setOrchestratorNotice(
            "Message saved. Orchestrator was skipped (set ORCHESTRATOR_API_KEY in .env.local)."
          );
        }
      } else if (orch && !orch.ok) {
        setOrchestratorBannerKind("warn");
        setOrchestratorNotice(
          `Message saved, but orchestrator failed: ${orch.error || orch.status || "unknown error"}`
        );
      } else if (orch?.ok) {
        const n = orch.formattedMessageStored ?? 0;
        const st = orch.graphStatus ? ` (${orch.graphStatus})` : "";
        if (n > 0) {
          setOrchestratorBannerKind("success");
          setOrchestratorNotice(
            `Run ${orch.runId ? `${orch.runId.slice(0, 8)}…` : "done"}${st}: stored ${n} assistant reply line(s) from formatted_message.`
          );
        } else {
          setOrchestratorBannerKind("warn");
          setOrchestratorNotice(
            `Run completed${st}; no formatted_message text was stored (empty or unparsable).`
          );
        }
      }
      setText("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const deleteChat = async () => {
    if (
      !window.confirm(
        "Delete this room’s chat? This removes all memories and escalations for this room. This cannot be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    setOrchestratorNotice(null);
    setOrchestratorBannerKind(null);
    try {
      const res = await fetch("/api/room-messages", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || res.statusText);
        return;
      }
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rcgpt">
      <header className="rcgpt-topbar">
        <div className="rcgpt-topbar-inner">
          <h1 className="rcgpt-title">Room chat</h1>
          <div className="rcgpt-topbar-actions">
            <button
              type="button"
              className="rcgpt-icon-btn rcgpt-icon-btn--danger"
              onClick={() => void deleteChat()}
              disabled={deleting || loading}
              title="Delete chat (memories + escalations)"
              aria-label="Delete chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
            <button
              type="button"
              className="rcgpt-icon-btn"
              onClick={load}
              disabled={loading}
              title="Refresh messages"
              aria-label="Refresh messages"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </button>
            <details className="rcgpt-details">
              <summary className="rcgpt-details-summary">Thread info</summary>
              <div className="rcgpt-details-body">
                <p>
                  <span className="rcgpt-k">roomId</span>
                  <code className="rcgpt-code">{PREVIEW_ROOM_ID}</code>
                </p>
                <p>
                  <span className="rcgpt-k">userId</span>
                  <code className="rcgpt-code">{PREVIEW_USER_ID}</code>
                </p>
                <p className="rcgpt-details-note">
                  Roles: Assistant if <code>inReplyTo</code>; Human in the loop if{" "}
                  <code>human_in_the_loop</code>; else User. Choose send mode below. On send,
                  the server also POSTs to <code>orchestrator/execute</code> (see env vars).
                </p>
              </div>
            </details>
          </div>
        </div>
      </header>

      <div className="rcgpt-thread" ref={listRef}>
        {loading && messages.length === 0 && (
          <div className="rcgpt-center-msg">
            <div className="rcgpt-typing">
              <span />
              <span />
              <span />
            </div>
            <p>Loading conversation…</p>
          </div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="rcgpt-center-msg">
            <p className="rcgpt-empty-title">No messages yet</p>
            <p className="rcgpt-empty-sub">This room has no thread history.</p>
          </div>
        )}
        {error && (
          <div className="rcgpt-center-msg rcgpt-center-msg--error">
            <p>{error}</p>
          </div>
        )}
        {messages.map((m) => {
          const role = ROLE_ROW[m.role] || ROLE_ROW.unknown;
          const body =
            typeof m.content?.text === "string"
              ? m.content.text
              : JSON.stringify(m.content);
          const isUser = m.role === "user";

          return (
            <div key={m.id} className={`rcgpt-row ${role.rowClass}`}>
              <div className="rcgpt-row-inner">
                {!isUser && (
                  <div className="rcgpt-avatar" aria-hidden>
                    {m.role === "hitl" ? "H" : "A"}
                  </div>
                )}
                <div className="rcgpt-msg-block">
                  <div className="rcgpt-msg-head">
                    <span className="rcgpt-msg-role">{role.label}</span>
                    <span className="rcgpt-msg-time">{formatIst(m.createdAt)}</span>
                  </div>
                  <div
                    className={
                      isUser ? "rcgpt-msg-text rcgpt-msg-text--bubble" : "rcgpt-msg-text"
                    }
                  >
                    {body}
                  </div>
                </div>
                {isUser && (
                  <div className="rcgpt-avatar rcgpt-avatar--user" aria-hidden>
                    U
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rcgpt-composer-wrap">
        {orchestratorNotice && !error && (
          <div
            className={
              orchestratorBannerKind === "success"
                ? "rcgpt-orchestrator-banner rcgpt-orchestrator-banner--ok"
                : "rcgpt-orchestrator-banner"
            }
            role="status"
          >
            {orchestratorNotice}
          </div>
        )}
        <div className="rcgpt-composer-toolbar">
          <span className="rcgpt-send-as-label">Send as</span>
          <div className="rcgpt-segmented" role="group" aria-label="Send as">
            <button
              type="button"
              className={sendAs === "user" ? "active" : ""}
              onClick={() => setSendAs("user")}
            >
              User
            </button>
            <button
              type="button"
              className={sendAs === "hitl" ? "active" : ""}
              onClick={() => setSendAs("hitl")}
            >
              Human in the loop
            </button>
          </div>
        </div>
        <div className="rcgpt-composer">
          <textarea
            ref={inputRef}
            id="room-chat-hitl-input"
            className="rcgpt-input"
            rows={1}
            placeholder={
              sendAs === "hitl"
                ? "Human-in-the-loop message…"
                : "User message (WhatsApp-style row)…"
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const ta = e.target;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />
          <button
            type="button"
            className="rcgpt-send"
            onClick={() => void sendMessage()}
            disabled={sending || !text.trim()}
            title="Send"
            aria-label="Send message"
          >
            {sending ? (
              <span className="rcgpt-send-spinner" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </div>
        <p className="rcgpt-hint">
          Enter to send · Shift+Enter for new line · Then{" "}
          <code>orchestrator/execute</code> is called with your text
        </p>
      </div>
    </div>
  );
}
