import React, { useState } from "react";

export default function ChatPanel({ title = "Game Chat" }) {
  const [messages, setMessages] = useState([
    { id: 1, author: "System", text: "Welcome to the chat!" },
  ]);
  const [input, setInput] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;

    // Later: send via WebSocket
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), author: "You", text: input.trim() },
    ]);
    setInput("");
  }

  return (
    <div className="chat-panel">
      <h2>{title}</h2>
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <span className="chat-author">{m.author}:</span>{" "}
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="chat-input-row">
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
