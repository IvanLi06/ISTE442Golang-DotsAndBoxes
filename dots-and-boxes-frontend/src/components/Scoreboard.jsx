import React from "react";
import { useGame } from "../GameContext";

export default function ScoreBoard() {
  const { players, currentPlayerId, scores, winner, resetGame } = useGame();

  const winnerText =
    winner === "draw"
      ? "Game over: it's a draw!"
      : winner
      ? `Game over: ${players[winner].name} wins!`
      : null;

  return (
    <div className="scoreboard">
      <div className="players-row">
        {Object.values(players).map((p) => (
          <div
            key={p.id}
            className="player-card"
            style={{
              borderColor: p.id === currentPlayerId ? p.color : "transparent",
            }}
          >
            <div className="player-name">
              <span className="color-dot" style={{ backgroundColor: p.color }} />
              {p.name}
            </div>
            <div className="player-score">Score: {scores[p.id]}</div>
            {p.id === currentPlayerId && !winner && (
              <div className="turn-indicator">Your turn</div>
            )}
          </div>
        ))}
      </div>

      {winnerText && <div className="winner-banner">{winnerText}</div>}

      <button className="reset-button" onClick={resetGame}>
        New Game
      </button>
    </div>
  );
}
