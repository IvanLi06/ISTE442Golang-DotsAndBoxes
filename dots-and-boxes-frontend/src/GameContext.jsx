import React, { createContext, useContext, useMemo, useState } from "react";

const GameContext = createContext(null);

// 4x4 boxes => 5x5 dots
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

  const [currentPlayerId, setCurrentPlayerId] = useState("p1");
  const [edges, setEdges] = useState(() => generateEdges());
  const [boxes, setBoxes] = useState(() => generateBoxes());
  const [winner, setWinner] = useState(null);

  const scores = useMemo(() => {
    const result = { p1: 0, p2: 0 };
    Object.values(boxes).forEach((b) => {
      if (b.owner) result[b.owner] += 1;
    });
    return result;
  }, [boxes]);

  const totalBoxes = NUM_BOXES_X * NUM_BOXES_Y;

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

  function handleEdgeClick(edgeId) {
    // Later: send move to server instead of mutating locally
    setEdges((prevEdges) => {
      const edge = prevEdges[edgeId];
      if (!edge || edge.claimedBy || winner) return prevEdges;

      const updatedEdges = {
        ...prevEdges,
        [edgeId]: { ...edge, claimedBy: currentPlayerId },
      };

      const newBoxIds = checkCompletedBoxes(updatedEdges, edge);

      if (newBoxIds.length > 0) {
        setBoxes((prevBoxes) => {
          const updatedBoxes = { ...prevBoxes };
          newBoxIds.forEach((id) => {
            if (!updatedBoxes[id].owner) {
              updatedBoxes[id] = {
                ...updatedBoxes[id],
                owner: currentPlayerId,
              };
            }
          });

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
        // same player’s turn (extra move)
      } else {
        setCurrentPlayerId((prev) => (prev === "p1" ? "p2" : "p1"));
      }

      return updatedEdges;
    });
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
