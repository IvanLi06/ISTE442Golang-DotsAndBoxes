// src/GameContext.jsx
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

const GameContext = createContext(null);

const NUM_BOXES_X = 8;
const NUM_BOXES_Y = 8;

function generateEdges() {
  const edges = {};

  // Horizontal edges
  for (let row = 0; row <= NUM_BOXES_Y; row++) {
    for (let col = 0; col < NUM_BOXES_X; col++) {
      const id = `h-${row}-${col}`;
      edges[id] = { id, type: "h", row, col, claimedBy: null };
    }
  }

  // Vertical edges
  for (let row = 0; row < NUM_BOXES_Y; row++) {
    for (let col = 0; col <= NUM_BOXES_X; col++) {
      const id = `v-${row}-${col}`;
      edges[id] = { id, type: "v", row, col, claimedBy: null };
    }
  }

  return edges;
}

function generateBoxes() {
  const boxes = {};
  for (let row = 0; row < NUM_BOXES_Y; row++) {
    for (let col = 0; col < NUM_BOXES_X; col++) {
      const id = `b-${row}-${col}`;
      boxes[id] = { id, row, col, owner: null };
    }
  }
  return boxes;
}

export function GameProvider({ children }) {
  const [players] = useState({
    p1: { id: "p1", name: "Player 1", color: "#e53935" }, // red
    p2: { id: "p2", name: "Player 2", color: "#1e88e5" }, // blue
  });

  // Whose turn is it?
  const [currentPlayerId, setCurrentPlayerId] = useState("p1");

  // Which slot is THIS browser? 0 => p1, 1 => p2
  const [playerIndex, setPlayerIndex] = useState(0);

  const [edges, setEdges] = useState(() => generateEdges());
  const [boxes, setBoxes] = useState(() => generateBoxes());
  const [winner, setWinner] = useState(null);

  const totalBoxes = NUM_BOXES_X * NUM_BOXES_Y;

  const scores = useMemo(() => {
    const s = { p1: 0, p2: 0 };
    Object.values(boxes).forEach((b) => {
      if (b.owner) s[b.owner] += 1;
    });
    return s;
  }, [boxes]);

  function isBoxComplete(edgesState, boxId) {
    const [_, rowStr, colStr] = boxId.split("-");
    const row = parseInt(rowStr, 10);
    const col = parseInt(colStr, 10);

    const top = edgesState[`h-${row}-${col}`];
    const bottom = edgesState[`h-${row + 1}-${col}`];
    const left = edgesState[`v-${row}-${col}`];
    const right = edgesState[`v-${row}-${col + 1}`];

    return (
      top?.claimedBy &&
      bottom?.claimedBy &&
      left?.claimedBy &&
      right?.claimedBy
    );
  }

  function checkCompletedBoxes(edgesAfterClaim, edge) {
    const newBoxIds = [];

    if (edge.type === "h") {
      if (edge.row > 0) {
        const above = `b-${edge.row - 1}-${edge.col}`;
        if (isBoxComplete(edgesAfterClaim, above)) newBoxIds.push(above);
      }
      if (edge.row < NUM_BOXES_Y) {
        const below = `b-${edge.row}-${edge.col}`;
        if (isBoxComplete(edgesAfterClaim, below)) newBoxIds.push(below);
      }
    } else {
      if (edge.col > 0) {
        const left = `b-${edge.row}-${edge.col - 1}`;
        if (isBoxComplete(edgesAfterClaim, left)) newBoxIds.push(left);
      }
      if (edge.col < NUM_BOXES_X) {
        const right = `b-${edge.row}-${edge.col}`;
        if (isBoxComplete(edgesAfterClaim, right)) newBoxIds.push(right);
      }
    }

    return newBoxIds;
  }

  /**
   * applyMove is called ONLY from GamePage's WebSocket message handler.
   * Every client receives the same move stream, so all boards + turns stay in sync.
   */
  function applyMove(edgeId) {
  if (winner) return;

  setEdges((prevEdges) => {
    const edge = prevEdges[edgeId];
    if (!edge || edge.claimedBy) {
      return prevEdges; // ignore invalid / already-claimed edges
    }

    // Player whose turn it is right now
    const playerId = currentPlayerId;

    // Mark this edge as claimed by that player
    const updatedEdges = {
      ...prevEdges,
      [edgeId]: { ...edge, claimedBy: playerId },
    };

    // Which boxes (0, 1, or 2) just became complete?
    const newBoxIds = checkCompletedBoxes(updatedEdges, edge);

    // Update box ownership + winner
    setBoxes((prevBoxes) => {
      const updatedBoxes = { ...prevBoxes };

      // Give any newly completed boxes to this player
      newBoxIds.forEach((id) => {
        if (!updatedBoxes[id].owner) {
          updatedBoxes[id] = { ...updatedBoxes[id], owner: playerId };
        }
      });

      // Check if all boxes are claimed -> game over & winner
      const claimedCount = Object.values(updatedBoxes).filter(
        (b) => b.owner !== null
      ).length;

      if (claimedCount === totalBoxes) {
        const finalScores = { p1: 0, p2: 0 };
        Object.values(updatedBoxes).forEach((b) => {
          if (b.owner) finalScores[b.owner] += 1;
        });

        if (finalScores.p1 > finalScores.p2) setWinner("p1");
        else if (finalScores.p2 > finalScores.p1) setWinner("p2");
        else setWinner("draw");
      }

      return updatedBoxes;
    });

    // 🔹 Turn logic:
    // If no box was completed, switch turns.
    // If at least one box was completed, same player goes again.
    setCurrentPlayerId((prevTurn) => {
      if (newBoxIds.length > 0) {
        // reward: extra turn
        return prevTurn;
      }
      return prevTurn === "p1" ? "p2" : "p1";
    });

    console.log(
      "[GameContext] applyMove",
      edgeId,
      "by",
      playerId,
      "boxes completed:",
      newBoxIds
    );

    return updatedEdges;
  });
}


  // Fallback single-player click handler (not used by WS path anymore)
  function handleEdgeClick(edgeId) {
    applyMove(edgeId);
  }

  function resetGame() {
    setEdges(generateEdges());
    setBoxes(generateBoxes());
    setCurrentPlayerId("p1");
    setWinner(null);
  }

  const value = {
    players,
    currentPlayerId,
    playerIndex,
    setPlayerIndex,
    edges,
    boxes,
    scores,
    winner,
    dimensions: {
      numBoxesX: NUM_BOXES_X,
      numBoxesY: NUM_BOXES_Y,
      numDotsX: NUM_BOXES_X + 1,
      numDotsY: NUM_BOXES_Y + 1,
    },
    applyMove,
    handleEdgeClick,
    resetGame,
  };

  return (
    <GameContext.Provider value={value}>{children}</GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}
