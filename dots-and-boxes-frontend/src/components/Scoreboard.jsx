// src/components/Scoreboard.jsx
import React from "react";
import { useGame } from "../GameContext";

export default function ScoreBoard() {
  const { players, scores, currentPlayerId, playerIndex, winner } = useGame();

  const myPlayerId = playerIndex === 0 ? "p1" : "p2";

  function renderCard(playerId) {
    const p = players[playerId];
    const isMyCard = myPlayerId === playerId;
    const isTurn = currentPlayerId === playerId;

    return (
      <div
        className="score-card"
        style={{
          borderRadius: "16px",
          padding: "10px 16px",
          border: isTurn ? "2px solid #22c55e" : "1px solid rgba(148,163,184,0.6)",
          background: "rgba(15,23,42,0.9)",
          minWidth: "150px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "999px",
              background: p.color,
            }}
          />
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          {isMyCard && (
            <span
              style={{
                marginLeft: 6,
                fontSize: "0.75rem",
                padding: "2px 6px",
                borderRadius: 999,
                background: "rgba(59,130,246,0.2)",
                color: "#bfdbfe",
              }}
            >
              You
            </span>
          )}
        </div>

        <div>Score: {scores[playerId]}</div>

        {isTurn && (
          <div
            style={{
              marginTop: 4,
              fontSize: "0.8rem",
              color: "#22c55e",
            }}
          >
            Current Turn
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 24,
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      {renderCard("p1")}
      {renderCard("p2")}

      {winner && (
        <div style={{ marginLeft: 16, fontSize: "0.9rem" }}>
          {winner === "draw" ? (
            <strong>Game over: Draw</strong>
          ) : (
            <strong>
              Game over: {winner === "p1" ? "Player 1" : "Player 2"} wins!
            </strong>
          )}
        </div>
      )}
    </div>
  );
}
