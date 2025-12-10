import React, { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

// Adjust if your API is on another host/port
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8090";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("authToken"));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("authUser");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  // Persist changes
  useEffect(() => {
    if (token) {
      localStorage.setItem("authToken", token);
    } else {
      localStorage.removeItem("authToken");
    }
  }, [token]);

  useEffect(() => {
    if (user) {
      localStorage.setItem("authUser", JSON.stringify(user));
    } else {
      localStorage.removeItem("authUser");
    }
  }, [user]);

  async function register({ username, password, displayName }) {
    setLoading(true);
    try {
      // 1. Get registration token (nonce)
      const tokenRes = await fetch(`${API_BASE}/auth/register-token`, {
        method: "POST",
        });
      if (!tokenRes.ok) {
        throw new Error("Failed to obtain registration token");
      }
      const tokenData = await tokenRes.json();

      // 2. Register user with token
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenData.token,
          username,
          password,
          displayName,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Registration failed");
      }

      // We could auto-login here, but let’s just return success
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function login({ username, password }) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Login failed");
      }

      const data = await res.json();
      setToken(data.token);
      setUser(data.user);
      return true;
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  const value = {
    token,
    user,
    loading,
    isAuthenticated: !!token,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
