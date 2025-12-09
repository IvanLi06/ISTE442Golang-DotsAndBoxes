import React from "react";
import Board from "./components/Board";
import ScoreBoard from "./components/Scoreboard";
import ChatPanel from "./components/ChatPanel";


export default function GamePage() {
  return (
    <main className="game-layout">
      <section className="board-section">
        <h1 className="game-title">Dots &amp; Boxes</h1>
        <Board />
        <ScoreBoard />
      </section>
      <aside className="side-panel">
        <ChatPanel />
      </aside>
    </main>
  );
}
