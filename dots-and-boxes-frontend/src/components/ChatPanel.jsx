// src/components/ChatPanel.jsx
import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";

export default function ChatPanel({ messages, onSend }) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? user?.userId ?? null;

  const [input, setInput] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const txt = input.trim();
    if (!txt) return;
    if (onSend) onSend(txt);
    setInput("");
  }

  return (
    <div className="chat-panel">
      <h2 className="chat-title">Game Chat</h2>

      <div className="chat-messages">
        {!messages || messages.length === 0 ? (
          <div className="chat-empty">No messages yet. Say hi!</div>
        ) : (
          messages.map((msg, idx) => {
            if (msg.type !== "chat") return null;
            const isMe =
              currentUserId != null &&
              msg.userId != null &&
              msg.userId === currentUserId;

            return (
              <div
                key={idx}
                className={`chat-message-row ${isMe ? "chat-me" : "chat-opp"}`}
                >
                <span className="chat-name">{isMe ? "You" : "Opponent"}:</span>{" "}
                <span className="chat-text">{msg.text}</span>
            </div>
            );
          })
        )}
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
