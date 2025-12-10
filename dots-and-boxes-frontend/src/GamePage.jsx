// src/GamePage.jsx
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { useGame } from "./GameContext";
import { useAuth } from "./auth/AuthContext";

import Board from "./components/Board";
import ScoreBoard from "./components/Scoreboard";
import ChatPanel from "./components/ChatPanel";

const GAME_WS_URL =
  (import.meta.env.VITE_WS_BASE || "ws://localhost:8090") + "/ws/game";

export default function GamePage() {
  const { gameId } = useParams();
  const location = useLocation();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [chatMessages, setChatMessages] = useState([]);
  const [gameEnded, setGameEnded] = useState(false);
  const [endReason, setEndReason] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const {
    players,
    currentPlayerId,
    playerIndex,
    setPlayerIndex,
    applyMove
  } = useGame();

  const wsRef = useRef(null);
  const warningTimeoutRef = useRef(null);

  // 🔹 1. Determine which player THIS browser is, and store in context
  useEffect(() => {
    let idx = -1;

    // 1) Prefer router state passed from lobby "startGame"
    if (
      location.state &&
      typeof location.state.playerIndex === "number" &&
      (location.state.playerIndex === 0 || location.state.playerIndex === 1)
    ) {
      idx = location.state.playerIndex;
    } else {
      // 2) Fallback: restore from sessionStorage on reload
      const stored = window.sessionStorage.getItem(
        `game:${gameId}:playerIndex`
      );
      if (stored === "0" || stored === "1") {
        idx = Number(stored);
      }
    }

    // 3) If we *still* don’t know who this client is, they’re not a player.
    if (idx === -1) {
      console.warn(
        "No playerIndex for this client in game",
        gameId,
        "- redirecting to lobby"
      );
      navigate("/lobby", { replace: true });
      return;
    }

    setPlayerIndex(idx);
    window.sessionStorage.setItem(
      `game:${gameId}:playerIndex`,
      String(idx)
    );
    console.log("Loaded player index for this tab:", idx);
  }, [location.state, gameId, setPlayerIndex, navigate]);

  // 🔹 2. Game WebSocket for receiving moves + chat + endGame
  useEffect(() => {
    if (!token || !gameId) return;

    const ws = new WebSocket(
      `${GAME_WS_URL}?token=${encodeURIComponent(
        token
      )}&gameId=${encodeURIComponent(gameId)}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("Game WebSocket connected");
      // Always start from a clean slate on this connection
      setChatMessages([]);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("Game WS message:", msg);

        if (msg.type === "move" && msg.gameId === gameId) {
          applyMove(msg.edgeId, msg.playerSlot);
        } else if (msg.type === "chat" && msg.gameId === gameId) {
          setChatMessages((prev) => [...prev, msg]);
        } else if (msg.type === "endGame" && msg.gameId === gameId) {
          setGameEnded(true);
          setEndReason(msg.text || "Game ended.");
        }
      } catch (err) {
        console.error("invalid game ws msg", err);
      }
    };

    ws.onclose = () => console.log("Game WebSocket closed");

    return () => ws.close();
  }, [token, gameId, applyMove]);

  function showWarning(msg) {
    setStatusMessage(msg);
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }
    warningTimeoutRef.current = setTimeout(() => {
      setStatusMessage("");
      warningTimeoutRef.current = null;
    }, 2000); // 2 seconds
  }

  // 🔹 3. Click handler: only sends move; applyMove is called from WS
  function handleEdgeClick(edgeId) {
    if (gameEnded) {
      console.log("Game already ended");
      return;
    }
    const myPlayerId = playerIndex === 0 ? "p1" : "p2";

    if (myPlayerId !== currentPlayerId) {
      showWarning("Not your turn. Wait for your opponent.");
      console.log("Not your turn");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showWarning("Connection issue — move not sent.");
      console.warn("Game WS not open");
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "move",
        gameId,
        edgeId,
        playerSlot: myPlayerId,
      })
    );
  }

  function handleSendChat(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("Game WS not open");
      return;
    }

    // Figure out who I am
    const myPlayerId = playerIndex === 0 ? "p1" : "p2";
    const userId = user?.id ?? user?.userId ?? null;
    const displayName =
      user?.displayName ||
      user?.username ||
      (myPlayerId === "p1" ? "Player 1" : "Player 2");

    wsRef.current.send(
      JSON.stringify({
        type: "chat",
        gameId,
        text: trimmed,
        userId,
        displayName,
      })
    );
  }

  function handleEndGameClick() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("Game WS not open");
      return;
    }

    wsRef.current.send(
      JSON.stringify({
        type: "endGame",
        gameId,
        text: "Game ended by a player",
      })
    );

    // (optional) local instant feedback:
    // setGameEnded(true);
    // setEndReason("Game ended by you");
  }

  function handleReturnToLobby() {
    navigate("/lobby");
  }

  const myPlayerId = playerIndex === 0 ? "p1" : "p2";
  const me = players[myPlayerId];
  const turnLabel =
    currentPlayerId === "p1" ? "Player 1 (Red)" : "Player 2 (Blue)";

  console.log("GamePage render:", {
    gameId,
    playerIndex,
    myPlayerId,
    currentPlayerId,
    me,
  });

  return (
    <main className="game-layout">
      <section className="board-section">
        <h1 className="game-title">Dots &amp; Boxes</h1>
        <div className="game-info-row">
          <div className="game-info-item">
            You are{" "}
            <strong>
              {myPlayerId === "p1" ? "Player 1 (Red)" : "Player 2 (Blue)"}
            </strong>
          </div>

          <div className="divider-dash">-</div>
          <div className="game-info-item">
            Current turn: <strong>{turnLabel}</strong>
          </div>
          <div className="divider-dash">-</div>

          <button className="end-game-btn" onClick={handleEndGameClick}>
            End Game
          </button>
        </div>

        {statusMessage && (
          <div className="illegal-move-warning">{statusMessage}</div>
        )}

        {gameEnded && (
          <div className="end-game-banner">
            <p>{endReason || "Game ended by a player"}</p>
            <button className="to-lobby-btn" onClick={handleReturnToLobby}>
              Back to Lobby
            </button>
          </div>
        )}

        <Board onEdgeClick={handleEdgeClick} />
        <ScoreBoard />
      </section>

      <aside className="side-panel">
        <ChatPanel messages={chatMessages} onSend={handleSendChat} />
      </aside>
    </main>
  );
}
