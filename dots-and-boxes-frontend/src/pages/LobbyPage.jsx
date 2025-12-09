import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import LobbyChat from "../components/LobbyChat";

export default function LobbyPage() {
  const { user, logout } = useAuth();

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div>
          <h1>Lobby</h1>
          {user && (
            <p className="lobby-user">
              Logged in as <strong>{user.displayName || user.username}</strong>
            </p>
          )}
        </div>
        <button className="logout-button" onClick={logout}>
          Log out
        </button>
      </header>

      <main className="lobby-content">
        <div style={{ marginBottom: "16px" }}>
          <p>Challenge another player and chat in real-time.</p>
          <Link to="/game/demo" className="primary-link">
            Go to demo game
          </Link>
        </div>

        <LobbyChat />
      </main>
    </div>
  );
}
