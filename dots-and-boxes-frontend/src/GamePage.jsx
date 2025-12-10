// src/GamePage.jsx
import React, { useEffect, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useGame } from "./GameContext";
import { useAuth } from "./auth/AuthContext";

import Board from "./components/Board";
import ScoreBoard from "./components/Scoreboard";
import ChatPanel from "./components/ChatPanel";

const GAME_WS_URL = "ws://localhost:8090/ws/game";

export default function GamePage() {
  const { gameId } = useParams();
  const location = useLocation();
  const { token } = useAuth();

  const {
    players,
    currentPlayerId,
    playerIndex,
    setPlayerIndex,
    applyMove,
  } = useGame();

  const wsRef = useRef(null);

  // 🔹 1. Determine which player THIS browser is, and store in context
  useEffect(() => {
    let idx = -1;

    // 1) Prefer value passed via router state (from LobbyChat.handleStartGame)
    if (
      location.state &&
      typeof location.state.playerIndex === "number" &&
      (location.state.playerIndex === 0 || location.state.playerIndex === 1)
    ) {
      idx = location.state.playerIndex;
      console.log("GamePage: using playerIndex from location.state:", idx);
    } else {
      // 2) Try localStorage (set by LobbyChat)
      const rawRole = window.localStorage.getItem(`game-role:${gameId}`);
      if (rawRole) {
        try {
          const parsed = JSON.parse(rawRole);
          if (
            parsed &&
            (parsed.playerIndex === 0 || parsed.playerIndex === 1)
          ) {
            idx = parsed.playerIndex;
            console.log("GamePage: using playerIndex from localStorage:", idx);
          }
        } catch (e) {
          console.warn("GamePage: failed to parse stored role", e);
        }
      }

      // 3) Fallback: sessionStorage (older behavior)
      if (idx === -1) {
        const stored = window.sessionStorage.getItem(
          `game:${gameId}:playerIndex`
        );
        if (stored === "0" || stored === "1") {
          idx = Number(stored);
          console.log("GamePage: using playerIndex from sessionStorage:", idx);
        }
      }
    }

    if (idx === -1) {
      console.warn(
        "GamePage: No playerIndex found for this client, defaulting to 0"
      );
      idx = 0;
    }

    setPlayerIndex(idx);
    window.sessionStorage.setItem(`game:${gameId}:playerIndex`, String(idx));
    console.log("GamePage: final playerIndex for this tab:", idx);
  }, [location.state, gameId, setPlayerIndex]);

  // 🔹 2. Game WebSocket for receiving moves
  useEffect(() => {
    if (!token || !gameId) return;

    const ws = new WebSocket(
      `${GAME_WS_URL}?token=${encodeURIComponent(
        token
      )}&gameId=${encodeURIComponent(gameId)}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("Game WebSocket connected");

    ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    console.log("Game WS message:", msg);

    if (msg.type === "move" && msg.gameId === gameId) {
      applyMove(msg.edgeId, msg.playerSlot); 
    }
  } catch (err) {
    console.error("invalid game ws msg", err);
  }
};


    ws.onclose = () => console.log("Game WebSocket closed");

    return () => ws.close();
  }, [token, gameId, applyMove]);

  // 🔹 3. Click handler: only sends move; applyMove is called from WS
  function handleEdgeClick(edgeId) {
  const myPlayerId = playerIndex === 0 ? "p1" : "p2";

  if (myPlayerId !== currentPlayerId) {
    console.log("Not your turn");
    return;
  }

  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
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

        <div style={{ marginBottom: 8 }}>
          <div>
            You are{" "}
            <strong>
              {myPlayerId === "p1" ? "Player 1 (Red)" : "Player 2 (Blue)"}
            </strong>
          </div>
          <div>
            Current turn: <strong>{turnLabel}</strong>
          </div>
        </div>

        <Board onEdgeClick={handleEdgeClick} />
        <ScoreBoard />
      </section>

      <aside className="side-panel">
        <ChatPanel />
      </aside>
    </main>
  );
}
