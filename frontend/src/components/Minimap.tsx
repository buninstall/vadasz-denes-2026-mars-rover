import React from 'react';
import { MapData, RoverState } from '../types';

interface MinimapProps {
  map: MapData;
  rover: RoverState;
}

const Minimap: React.FC<MinimapProps> = ({ map, rover }) => {
  const { grid } = map;
  const cellSize = 3; // pixels per cell

  const getCellColor = (cell: string): string => {
    switch (cell) {
      case '#': return '#6B7280'; // Gray for obstacles
      case 'B': return '#3B82F6'; // Blue mineral
      case 'Y': return '#FBBF24'; // Yellow mineral
      case 'G': return '#10B981'; // Green mineral
      case 'S': return '#8B4513'; // Brown for start
      case '.': return '#4B2E1F'; // Dark brown for terrain
      default: return '#4B2E1F';
    }
  };

  return (
    <div className="fixed top-4 right-4 bg-black/80 backdrop-blur-sm p-3 rounded-lg border border-gray-700 z-50">
      <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2 font-bold">Map Overview</h3>
      <div className="relative" style={{ width: `${cellSize * 50}px`, height: `${cellSize * 50}px` }}>
        {grid.map((row, y) =>
          row.map((cell, x) => (
            <div
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: `${x * cellSize}px`,
                top: `${y * cellSize}px`,
                width: `${cellSize}px`,
                height: `${cellSize}px`,
                backgroundColor: getCellColor(cell),
                opacity: cell === '.' ? 0.3 : 0.8,
              }}
            />
          ))
        )}
        {/* Rover indicator */}
        <div
          style={{
            position: 'absolute',
            left: `${rover.x * cellSize}px`,
            top: `${rover.y * cellSize}px`,
            width: `${cellSize}px`,
            height: `${cellSize}px`,
            backgroundColor: '#EF4444',
            border: '1px solid #FFF',
            boxShadow: '0 0 4px #EF4444',
            zIndex: 10,
          }}
        />
      </div>
      <div className="mt-2 text-[10px] text-gray-500">
        Rover: ({rover.x}, {rover.y})
      </div>
    </div>
  );
};

export default Minimap;
