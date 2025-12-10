// src/components/LobbyChat.jsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

const WS_URL = "ws://localhost:8090/ws/lobby";

export default function LobbyChat() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const currentUserId = user?.id ?? user?.userId ?? null;

  const [messages, setMessages] = useState([]);
  const [players, setPlayers] = useState([]);
  const [input, setInput] = useState("");
  const [incomingOffer, setIncomingOffer] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Lobby WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "chat") {
          setMessages((prev) => [...prev, msg]);
        } else if (msg.type === "presence") {
          setPlayers(msg.users || []);
        } else if (msg.type === "challengeOffer") {
          handleChallengeOffer(msg);
        } else if (msg.type === "startGame") {
          handleStartGame(msg);
        }
      } catch (e) {
        console.error("Invalid message", e);
      }
    };

    ws.onclose = () => {
      console.log("Lobby WebSocket closed");
    };

    return () => {
      ws.close();
    };
  }, [token]);

  function handleChallengeOffer(msg) {
    if (!currentUserId) return;

    console.log("challengeOffer received", { msg, currentUserId });

    if (msg.targetUserId === currentUserId) {
      // I am being challenged
      setIncomingOffer({
        fromUserId: msg.fromUserId,
        fromName: msg.fromName,
        targetUserId: msg.targetUserId,
      });
    } else if (msg.fromUserId === currentUserId) {
      // I sent the challenge
      setMessages((prev) => [
        ...prev,
        {
          type: "chat",
          displayName: "System",
          text: `Challenge sent to player ${msg.targetUserId}`,
        },
      ]);
    }
  }

  function handleStartGame(msg) {
    if (!currentUserId) return;
    const players = msg.playerIds || [];
    const idx = players.indexOf(currentUserId);

    console.log("startGame received", {
      msg,
      currentUserId,
      players,
      idx,
    });

    if (idx !== -1) {
      // Save my role for this gameId (for reloads)
      const roleInfo = {
        gameId: msg.gameId,
        playerIndex: idx, // 0 = Player 1, 1 = Player 2
        players,
      };
      localStorage.setItem(`game-role:${msg.gameId}`, JSON.stringify(roleInfo));

      // 🔹 Pass my playerIndex via router state so GamePage knows who I am
      navigate(`/game/${msg.gameId}`, {
        state: { playerIndex: idx },
      });
    } else {
      console.warn(
        "Could not find currentUserId in playerIds for startGame",
        msg
      );
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (
      !input.trim() ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const payload = { type: "chat", text: input.trim() };
    wsRef.current.send(JSON.stringify(payload));
    setInput("");
  }

  function handleChallengeClick(targetUserId) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!currentUserId || currentUserId === targetUserId) return;

    const payload = {
      type: "challenge",
      targetUserId,
    };
    wsRef.current.send(JSON.stringify(payload));
  }

  function acceptOffer() {
    if (
      !incomingOffer ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return;

    const payload = {
      type: "challengeAccept",
      opponentUserId: incomingOffer.fromUserId,
    };
    wsRef.current.send(JSON.stringify(payload));
    setIncomingOffer(null);
  }

  function declineOffer() {
    setIncomingOffer(null);
  }

  return (
    <div className="lobby-chat-layout">
      {/* Players panel */}
      <div className="lobby-players-panel">
        <h2>Players in Lobby</h2>
        {players.length === 0 ? (
          <p className="lobby-players-empty">No other players yet.</p>
        ) : (
          <ul className="lobby-players-list">
            {players.map((p) => (
              <li key={p.userId} className="lobby-player-row">
                <span className="lobby-player-name">
                  {p.displayName}
                  <span style={{ opacity: 0.6, fontSize: "0.75rem" }}>
                    {" "}
                    (id: {p.userId})
                  </span>
                </span>
                {currentUserId && currentUserId !== p.userId ? (
                  <button
                    className="lobby-challenge-button"
                    onClick={() => handleChallengeClick(p.userId)}
                  >
                    Challenge
                  </button>
                ) : (
                  <button className="lobby-challenge-button" disabled>
                    You
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Chat + Challenge banner */}
      <div className="chat-panel">
        <h2>Lobby Chat</h2>

        {incomingOffer && (
          <div className="lobby-challenge-banner">
            <p>
              <strong>{incomingOffer.fromName}</strong> challenged you to a
              game.
            </p>
            <div className="lobby-challenge-actions">
              <button onClick={acceptOffer}>Accept</button>
              <button onClick={declineOffer}>Decline</button>
            </div>
          </div>
        )}

        <div className="chat-messages">
          {messages.map((m, idx) => (
            <div key={idx} className="chat-message">
              <span className="chat-author">
                {m.displayName || m.userId || "System"}:
              </span>{" "}
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
    </div>
  );
}
