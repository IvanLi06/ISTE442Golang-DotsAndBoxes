package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/jackc/pgx/v5/stdlib"
	jwt "github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// =====================
// Config / Secrets
// =====================

var jwtSecret = []byte("SUPER_SECRET_KEY_CHANGE_ME") // TODO: move to ENV for real deployment

// =====================
// Registration Token
// =====================

type RegistrationToken struct {
	Token     string
	IP        string
	UserAgent string
	ExpiresAt time.Time
}

type TokenStore struct {
	mu     sync.Mutex
	tokens map[string]RegistrationToken
}

func NewTokenStore() *TokenStore {
	return &TokenStore{
		tokens: make(map[string]RegistrationToken),
	}
}

func (s *TokenStore) CreateRegistrationToken(ip, ua string, ttl time.Duration) RegistrationToken {
	s.mu.Lock()
	defer s.mu.Unlock()

	t := RegistrationToken{
		Token:     uuid.NewString(),
		IP:        ip,
		UserAgent: ua,
		ExpiresAt: time.Now().UTC().Add(ttl),
	}
	s.tokens[t.Token] = t
	return t
}

func (s *TokenStore) ValidateAndConsume(tokenStr, ip, ua string) (RegistrationToken, bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	token, ok := s.tokens[tokenStr]
	if !ok {
		return RegistrationToken{}, false, "token not found"
	}
	if time.Now().UTC().After(token.ExpiresAt) {
		delete(s.tokens, tokenStr)
		return RegistrationToken{}, false, "token expired"
	}
	if token.IP != ip {
		return RegistrationToken{}, false, "IP mismatch"
	}
	if token.UserAgent != ua {
		return RegistrationToken{}, false, "User-Agent mismatch"
	}

	delete(s.tokens, tokenStr)
	return token, true, ""
}

// =====================
// User & UserStore
// =====================

type User struct {
	ID          int64     `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"displayName"`
	CreatedAt   time.Time `json:"createdAt"`
}

type UserStore struct {
	db *sql.DB
}

func NewUserStore(db *sql.DB) *UserStore {
	return &UserStore{db: db}
}

// CreateUser inserts a new user with bcrypt password hash.
func (s *UserStore) CreateUser(username, displayName, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	query := `
		INSERT INTO users (username, password_hash, display_name)
		VALUES ($1, $2, $3)
		RETURNING id, created_at
	`

	var u User
	err = s.db.QueryRow(query, username, string(hash), displayName).Scan(&u.ID, &u.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			return nil, errors.New("username already taken")
		}
		return nil, err
	}

	u.Username = username
	u.DisplayName = displayName
	return &u, nil
}

// GetUserByUsername returns user + password hash for login.
func (s *UserStore) GetUserByUsername(username string) (*User, string, error) {
	var u User
	var hash string

	query := `
		SELECT id, display_name, password_hash, created_at
		FROM users
		WHERE username = $1
	`

	err := s.db.QueryRow(query, username).Scan(&u.ID, &u.DisplayName, &hash, &u.CreatedAt)
	if err != nil {
		return nil, "", err
	}

	u.Username = username
	return &u, hash, nil
}

// GetUserByID is used for WebSocket lobby to show names.
func (s *UserStore) GetUserByID(id int64) (*User, error) {
	var u User
	query := `
		SELECT username, display_name, created_at
		FROM users
		WHERE id = $1
	`
	u.ID = id
	err := s.db.QueryRow(query, id).Scan(&u.Username, &u.DisplayName, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// =====================
// JWT Helpers
// =====================

func generateJWT(userID int64) (string, error) {
	claims := jwt.MapClaims{
		"userId": userID,
		"exp":    time.Now().UTC().Add(24 * time.Hour).Unix(), // 1 day
		"iat":    time.Now().UTC().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func parseJWT(tokenStr string) (int64, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return 0, errors.New("invalid token")
	}

	claims := token.Claims.(jwt.MapClaims)
	return int64(claims["userId"].(float64)), nil
}

// =====================
// Lobby WebSocket
// =====================

type LobbyMessage struct {
	Type        string    `json:"type"`        // "chat"
	UserID      int64     `json:"userId"`
	DisplayName string    `json:"displayName"`
	Text        string    `json:"text"`
	SentAt      time.Time `json:"sentAt"`
}

type LobbyUser struct {
	UserID      int64  `json:"userId"`
	DisplayName string `json:"displayName"`
}

type LobbyPresence struct {
	Type  string      `json:"type"`  // "presence"
	Users []LobbyUser `json:"users"`
}


type LobbyClient struct {
	hub  *LobbyHub
	conn *websocket.Conn
	send chan []byte
	user *User
}

type LobbyHub struct {
	clients    map[*LobbyClient]bool
	broadcast  chan []byte
	register   chan *LobbyClient
	unregister chan *LobbyClient
}

type LobbyInbound struct {
	Type           string `json:"type"`          // "chat", "challenge", "challengeAccept"
	Text           string `json:"text"`          // for chat
	TargetUserID   int64  `json:"targetUserId"`  // for challenge
	OpponentUserID int64  `json:"opponentUserId"`// for challengeAccept
}

type LobbyChallengeOffer struct {
	Type         string `json:"type"`         // "challengeOffer"
	FromUserID   int64  `json:"fromUserId"`
	FromName     string `json:"fromName"`
	TargetUserID int64  `json:"targetUserId"`
}

type LobbyStartGame struct {
	Type      string  `json:"type"`
	GameID    string  `json:"gameId"`
	PlayerIDs []int64 `json:"playerIds"` // two players
}



func NewLobbyHub() *LobbyHub {
	return &LobbyHub{
		clients:    make(map[*LobbyClient]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *LobbyClient),
		unregister: make(chan *LobbyClient),
	}
}

func (h *LobbyHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.broadcastPresence()
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.broadcastPresence()
			}
		case msg := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}

func (h *LobbyHub) currentUsers() []LobbyUser {
	seen := make(map[int64]bool)
	var users []LobbyUser

	for c := range h.clients {
		if c.user == nil {
			continue
		}
		if seen[c.user.ID] {
			continue
		}
		seen[c.user.ID] = true

		displayName := c.user.DisplayName
		if displayName == "" {
			displayName = c.user.Username
		}

		users = append(users, LobbyUser{
			UserID:      c.user.ID,
			DisplayName: displayName,
		})
	}
	return users
}

func (h *LobbyHub) broadcastPresence() {
	users := h.currentUsers()
	p := LobbyPresence{
		Type:  "presence",
		Users: users,
	}
	data, err := json.Marshal(p)
	if err != nil {
		log.Println("presence marshal error:", err)
		return
	}

	for c := range h.clients {
		select {
		case c.send <- data:
		default:
			delete(h.clients, c)
			close(c.send)
		}
	}
}



func (c *LobbyClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Println("lobby read error:", err)
			}
			break
		}

		var payload LobbyInbound
		if err := json.Unmarshal(message, &payload); err != nil {
			continue
		}

		switch payload.Type {
		case "challenge":
			if payload.TargetUserID == 0 {
				continue
			}

			fromName := c.user.DisplayName
			if fromName == "" {
				fromName = c.user.Username
			}

			offer := LobbyChallengeOffer{
				Type:         "challengeOffer",
				FromUserID:   c.user.ID,
				FromName:     fromName,
				TargetUserID: payload.TargetUserID,
			}

			out, err := json.Marshal(offer)
			if err != nil {
				continue
			}
			c.hub.broadcast <- out

		case "challengeAccept":
			if payload.OpponentUserID == 0 {
				continue
			}

			// Create a temporary gameId (later we store in DB)
			gameID := uuid.NewString()

			gameRegistry.Register(gameID, c.user.ID, payload.OpponentUserID)

			start := LobbyStartGame{
				Type:      "startGame",
				GameID:    gameID,
				PlayerIDs: []int64{c.user.ID, payload.OpponentUserID},
			}

			out, err := json.Marshal(start)
			if err != nil {
				continue
			}
			c.hub.broadcast <- out

		default:
			// Treat as chat (fallback)
			txt := payload.Text
			if strings.TrimSpace(txt) == "" {
				continue
			}

			chat := LobbyMessage{
				Type:        "chat",
				UserID:      c.user.ID,
				DisplayName: c.user.DisplayName,
				Text:        txt,
				SentAt:      time.Now().UTC(),
			}

			out, err := json.Marshal(chat)
			if err != nil {
				continue
			}
			c.hub.broadcast <- out
		}
	}
}


func (c *LobbyClient) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Println("lobby write error:", err)
			break
		}
	}
}

var wsUpgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        // For dev; you can tighten this later.
        return true
    },
}



// =====================
// Game WebSocket
// =====================

type GameClient struct {
	hub    *GameHub
	conn   *websocket.Conn
	send   chan []byte
	userID int64
	gameID string
	db     *sql.DB   
}


type GameMove struct {
    Type       string `json:"type"`
    GameID     string `json:"gameId"`
    EdgeID string `json:"edgeId,omitempty"`
	Text   string `json:"text,omitempty"`
	UserID int64  `json:"userId,omitempty"`
    PlayerSlot string `json:"playerSlot,omitempty"` // "p1" or "p2"
	DisplayName string    `json:"displayName,omitempty"`
	SentAt     time.Time `json:"sentAt,omitempty"`
}


type GameHub struct {
	// gameID -> set of clients
	games      map[string]map[*GameClient]bool
	register   chan *GameClient
	unregister chan *GameClient
	broadcast  chan GameMove
}

type StoredMove struct {
	EdgeID     string
	PlayerSlot string
}

func saveMove(db *sql.DB, gameID string, userID int64, edgeID, slot string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(
		`INSERT INTO moves (game_id, user_id, edge_id, player_slot)
         VALUES ($1, $2, $3, $4)`,
		gameID, userID, edgeID, slot,
	)
	return err
}

func loadMoves(db *sql.DB, gameID string) ([]StoredMove, error) {
	if db == nil {
		return nil, nil
	}
	rows, err := db.Query(
		`SELECT edge_id, player_slot
         FROM moves
         WHERE game_id = $1
         ORDER BY id ASC`,
		gameID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var moves []StoredMove
	for rows.Next() {
		var m StoredMove
		if err := rows.Scan(&m.EdgeID, &m.PlayerSlot); err != nil {
			return nil, err
		}
		moves = append(moves, m)
	}
	return moves, rows.Err()
}



func saveGameChat(db *sql.DB, gameID string, userID int64, displayName, text string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(
		`INSERT INTO chat_messages (game_id, user_id, display_name, message, room_type)
         VALUES ($1, $2, $3, $4, 'game')`,
		gameID, userID, displayName, text,
	)
	return err
}

func loadGameChat(db *sql.DB, gameID string) ([]GameMove, error) {
    if db == nil {
        return nil, nil
    }

    rows, err := db.Query(
        `SELECT user_id, message, created_at
           FROM chat_messages
          WHERE game_id = $1 AND room_type = 'game'
          ORDER BY created_at ASC, id ASC`,
        gameID,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var msgs []GameMove
    for rows.Next() {
        var userID int64
        var msgText string
        var createdAt time.Time
        if err := rows.Scan(&userID, &msgText, &createdAt); err != nil {
            return nil, err
        }
        msgs = append(msgs, GameMove{
            Type:   "chat",
            GameID: gameID,
            UserID: userID,
            Text:   msgText,
            SentAt: createdAt,
        })
    }
    return msgs, rows.Err()
}





func NewGameHub() *GameHub {
	return &GameHub{
		games:      make(map[string]map[*GameClient]bool),
		register:   make(chan *GameClient),
		unregister: make(chan *GameClient),
		broadcast:  make(chan GameMove),
	}
}

func (h *GameHub) Run() {
	for {
		select {
		case client := <-h.register:
			if _, ok := h.games[client.gameID]; !ok {
				h.games[client.gameID] = make(map[*GameClient]bool)
			}
			h.games[client.gameID][client] = true

		case client := <-h.unregister:
			if room, ok := h.games[client.gameID]; ok {
				if _, exists := room[client]; exists {
					delete(room, client)
					close(client.send)
					if len(room) == 0 {
						delete(h.games, client.gameID)
					}
				}
			}

		case move := <-h.broadcast:
			if room, ok := h.games[move.GameID]; ok {
				data, err := json.Marshal(move)
				if err != nil {
					continue
				}
				for c := range room {
					select {
					case c.send <- data:
					default:
						delete(room, c)
						close(c.send)
					}
				}
			}
		}
	}
}

//  from browser
type GameInbound struct {
	Type   string `json:"type"`   
	GameID string `json:"gameId"` 
	EdgeID string `json:"edgeId"` 
	Text   string `json:"text"`   
}

func (c *GameClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var incoming GameMove
		if err := json.Unmarshal(message, &incoming); err != nil {
			continue
		}

		switch incoming.Type {
		case "move":
			if incoming.EdgeID == "" {
				continue
			}

			// Frontend will send "p1" or "p2"
			slot := incoming.PlayerSlot
			if slot != "p1" && slot != "p2" {
				continue
			}

			// 1) Persist move in DB
			if err := saveMove(c.db, c.gameID, c.userID, incoming.EdgeID, slot); err != nil {
				log.Println("saveMove error:", err)
			}

			// 2) Broadcast canonical move to all clients
			move := GameMove{
				Type:       "move",
				GameID:     c.gameID,
				EdgeID:     incoming.EdgeID,
				PlayerSlot: slot,
			}
			c.hub.broadcast <- move

		case "chat":
			txt := strings.TrimSpace(incoming.Text)
			if txt == "" {
				continue
			}

			// Use client-sent displayName if present; otherwise fall back.
			displayName := incoming.DisplayName
			if displayName == "" {
				displayName = "Player"
			}

			// Save chat to DB
			if err := saveGameChat(c.db, c.gameID, c.userID, displayName, txt); err != nil {
				log.Println("saveGameChat error:", err)
			}

			// Broadcast chat to both players
			out := GameMove{
				Type:        "chat",
				GameID:      c.gameID,
				Text:        txt,
				UserID:      c.userID,
				DisplayName: displayName,
				SentAt:      time.Now().UTC(),
			}
			c.hub.broadcast <- out

		case "endGame":
			txt := strings.TrimSpace(incoming.Text)
			if txt == "" {
				txt = "Game ended by a player"
			}

			out := GameMove{
				Type:   "endGame",
				GameID: c.gameID,
				Text:   txt,
			}
			c.hub.broadcast <- out
		}
	}
}




func (c *GameClient) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Println("game write error:", err)
			break
		}
	}
}




type GameRegistry struct {
	mu    sync.RWMutex
	games map[string][]int64 // exactly two players per game
}

func NewGameRegistry() *GameRegistry {
	return &GameRegistry{
		games: make(map[string][]int64),
	}
}

func (gr *GameRegistry) Register(gameID string, p1, p2 int64) {
	gr.mu.Lock()
	defer gr.mu.Unlock()
	gr.games[gameID] = []int64{p1, p2}
}

func (gr *GameRegistry) IsPlayerInGame(gameID string, userID int64) bool {
	gr.mu.RLock()
	defer gr.mu.RUnlock()

	players, ok := gr.games[gameID]
	if !ok {
		return false
	}
	for _, id := range players {
		if id == userID {
			return true
		}
	}
	return false
}



var gameRegistry = NewGameRegistry()






// =====================
// Server Struct
// =====================

type Server struct {
	db         *sql.DB
	tokenStore *TokenStore
	userStore  *UserStore
	lobbyHub   *LobbyHub
	gameHub    *GameHub   
}

func NewServer(db *sql.DB) *Server {
	s := &Server{
		db:         db,
		tokenStore: NewTokenStore(),
		userStore:  NewUserStore(db),
		lobbyHub:   NewLobbyHub(),
		gameHub:    NewGameHub(), 
	}
	go s.gameHub.Run() // 👈 VERY IMPORTANT

    return s
}

// =====================
// JSON & Utility Helpers
// =====================

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func getIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func getUA(r *http.Request) string {
	if ua := r.Header.Get("User-Agent"); ua != "" {
		return ua
	}
	return "unknown"
}

// =====================
// HTTP Handlers
// =====================

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// POST /auth/register-token
func (s *Server) handleRegisterToken(w http.ResponseWriter, r *http.Request) {
	t := s.tokenStore.CreateRegistrationToken(getIP(r), getUA(r), 10*time.Minute)
	writeJSON(w, 200, map[string]any{
		"token":     t.Token,
		"expiresAt": t.ExpiresAt.Format(time.RFC3339),
	})
}

type registerReq struct {
	Token       string `json:"token"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

// POST /auth/register
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	if req.Token == "" || req.Username == "" || req.Password == "" || req.DisplayName == "" {
		writeError(w, 400, "missing fields")
		return
	}

	_, ok, msg := s.tokenStore.ValidateAndConsume(req.Token, getIP(r), getUA(r))
	if !ok {
		writeError(w, 400, "invalid token: "+msg)
		return
	}

	u, err := s.userStore.CreateUser(req.Username, req.DisplayName, req.Password)
	if err != nil {
		if err.Error() == "username already taken" {
			writeError(w, 409, err.Error())
			return
		}
		writeError(w, 500, "failed to create user")
		return
	}

	writeJSON(w, 200, map[string]any{"user": u})
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// POST /auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	u, hash, err := s.userStore.GetUserByUsername(req.Username)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		writeError(w, 401, "invalid credentials")
		return
	}

	token, err := generateJWT(u.ID)
	if err != nil {
		writeError(w, 500, "failed to create token")
		return
	}

	writeJSON(w, 200, map[string]any{
		"token": token,
		"user":  u,
	})
}

// GET /auth/me (protected)
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("userId").(int64)
	writeJSON(w, 200, map[string]any{"userId": uid})
}

// GET /ws/lobby?token=JWT
func (s *Server) handleLobbyWS(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		writeError(w, http.StatusUnauthorized, "missing token")
		return
	}

	userID, err := parseJWT(tokenStr)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	user, err := s.userStore.GetUserByID(userID)
	if err != nil {
		log.Println("GetUserByID error:", err)
		user = &User{ID: userID, Username: "user", DisplayName: "Player"}
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("websocket upgrade error:", err)
		return
	}

	client := &LobbyClient{
		hub:  s.lobbyHub,
		conn: conn,
		send: make(chan []byte, 256),
		user: user,
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}




// GET /ws/game?token=JWT&gameId=...
// GET /ws/game?token=JWT&gameId=...
func (s *Server) handleGameWS(w http.ResponseWriter, r *http.Request) {
    tokenStr := r.URL.Query().Get("token")
    gameID := r.URL.Query().Get("gameId")
    if tokenStr == "" || gameID == "" {
        writeError(w, http.StatusUnauthorized, "missing token or gameId")
        return
    }

    userID, err := parseJWT(tokenStr)
    if err != nil {
        writeError(w, http.StatusUnauthorized, "invalid token")
        return
    }
    log.Printf("handleGameWS: user %d joining game %s", userID, gameID)

    conn, err := wsUpgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Println("game websocket upgrade error:", err)
        return
    }

    // 1) Replay existing moves
    moves, err := loadMoves(s.db, gameID)
    if err != nil {
        log.Println("loadMoves error:", err)
    } else {
        for _, m := range moves {
            replay := GameMove{
                Type:       "move",
                GameID:     gameID,
                EdgeID:     m.EdgeID,
                PlayerSlot: m.PlayerSlot,
            }
            data, err := json.Marshal(replay)
            if err != nil {
                continue
            }
            if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
                log.Println("replay move write error:", err)
                break
            }
        }
    }

    // 2) Replay existing chat messages
    chats, err := loadGameChat(s.db, gameID)
    if err != nil {
        log.Println("loadGameChat error:", err)
    } else {
        for _, ch := range chats {
            data, err := json.Marshal(ch)
            if err != nil {
                continue
            }
            if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
                log.Println("replay chat write error:", err)
                break
            }
        }
    }

    // 3) Join hub for live updates
    client := &GameClient{
        hub:    s.gameHub,
        db:     s.db,
        conn:   conn,
        send:   make(chan []byte, 256),
        userID: userID,
        gameID: gameID,
    }

    s.gameHub.register <- client

    go client.writePump()
    go client.readPump()
}




// =====================
// Auth Middleware
// =====================

func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			writeError(w, 401, "missing token")
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")
		uid, err := parseJWT(tokenStr)
		if err != nil {
			writeError(w, 401, "invalid token")
			return
		}
		ctx := context.WithValue(r.Context(), "userId", uid)
		next(w, r.WithContext(ctx))
	}
}

// =====================
// CORS Middleware (HTTP only)
// =====================

func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(200)
			return
		}

		h.ServeHTTP(w, r)
	})
}

// =====================
// main
// =====================

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal("failed to open DB:", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatal("failed to ping DB:", err)
	}

	log.Println("Connected to Postgres")

	srv := NewServer(db)

	// start lobby hub
	go srv.lobbyHub.Run()
	go srv.gameHub.Run()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", srv.handleHealth)
	mux.HandleFunc("/auth/register-token", srv.handleRegisterToken)
	mux.HandleFunc("/auth/register", srv.handleRegister)
	mux.HandleFunc("/auth/login", srv.handleLogin)
	mux.HandleFunc("/auth/me", srv.authMiddleware(srv.handleMe))
	mux.HandleFunc("/ws/lobby", srv.handleLobbyWS)
	mux.HandleFunc("/ws/game", srv.handleGameWS)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090" // local dev default
	}
	log.Println("Listening on port", port)
	log.Fatal(http.ListenAndServe(":"+port, withCORS(mux)))
}
