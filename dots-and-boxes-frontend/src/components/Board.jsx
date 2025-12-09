// src/components/Board.jsx
import React from "react";
import { useGame } from "../GameContext";

const SVG_SIZE = 500;
const PADDING = 30; // extra white space around the grid

export default function Board() {
  const { edges, boxes, dimensions, handleEdgeClick, players } = useGame();
  const { numDotsX, numDotsY } = dimensions;

  // We use the inner area (minus padding on all sides) for the grid
  const innerWidth = SVG_SIZE - 2 * PADDING;
  const innerHeight = SVG_SIZE - 2 * PADDING;

  const cellWidth = innerWidth / (numDotsX - 1);
  const cellHeight = innerHeight / (numDotsY - 1);

  function dotPosition(col, row) {
    return {
      cx: PADDING + col * cellWidth,
      cy: PADDING + row * cellHeight,
    };
  }

  function edgePosition(edge) {
    if (edge.type === "h") {
      const x1 = PADDING + edge.col * cellWidth;
      const x2 = PADDING + (edge.col + 1) * cellWidth;
      const y = PADDING + edge.row * cellHeight;
      return { x1, y1: y, x2, y2: y };
    } else {
      const y1 = PADDING + edge.row * cellHeight;
      const y2 = PADDING + (edge.row + 1) * cellHeight;
      const x = PADDING + edge.col * cellWidth;
      return { x1: x, y1, x2: x, y2 };
    }
  }

  function boxPosition(box) {
    const x = PADDING + box.col * cellWidth;
    const y = PADDING + box.row * cellHeight;
    return { x, y, width: cellWidth, height: cellHeight };
  }

  return (
    <svg
      width={SVG_SIZE}
      height={SVG_SIZE}
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      style={{
        background: "white",          // white board
        boxShadow: "0 4px 18px rgba(0,0,0,0.15)",
        borderRadius: "16px"
        // removed borderRadius so corners are square
      }}
    >
      {/* Filled boxes with X */}
      {Object.values(boxes).map((box) => {
        if (!box.owner) return null;
        const { x, y, width, height } = boxPosition(box);
        const color = players[box.owner].color;
        return (
          <g key={box.id}>
            <rect
              x={x + 4}
              y={y + 4}
              width={width - 8}
              height={height - 8}
              fill={color}
              opacity={0.15}
              /* you can set rx/ry to 0 if you also want box corners square */
              rx={0}
              ry={0}
            />
            <line
              x1={x + 10}
              y1={y + 10}
              x2={x + width - 10}
              y2={y + height - 10}
              stroke={color}
              strokeWidth={3}
            />
            <line
              x1={x + width - 10}
              y1={y + 10}
              x2={x + 10}
              y2={y + height - 10}
              stroke={color}
              strokeWidth={3}
            />
          </g>
        );
      })}

      {/* Clickable edges */}
      {Object.values(edges).map((edge) => {
        const { x1, y1, x2, y2 } = edgePosition(edge);
        const ownerColor = edge.claimedBy ? players[edge.claimedBy].color : "#ccc";

        return (
          <g key={edge.id}>
            {/* visible line */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={ownerColor}
              strokeWidth={4}
              strokeLinecap="round"
            />
            {/* invisible hit area for clicks */}
            {!edge.claimedBy && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={18}
                onClick={() => handleEdgeClick(edge.id)}
                style={{ cursor: "pointer" }}
              />
            )}
          </g>
        );
      })}

      {/* Dots */}
      {Array.from({ length: numDotsY }).map((_, row) =>
        Array.from({ length: numDotsX }).map((__, col) => {
          const { cx, cy } = dotPosition(col, row);
          return <circle key={`dot-${row}-${col}`} cx={cx} cy={cy} r={5} fill="#000" />;
        })
      )}
    </svg>
  );
}
