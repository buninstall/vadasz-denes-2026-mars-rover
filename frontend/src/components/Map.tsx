import React from 'react';
import { MapData, RoverState } from '../types';

interface MapProps {
  map: MapData;
  rover: RoverState;
}

const Map: React.FC<MapProps> = ({ map, rover }) => {
  return (
    <div className="flex flex-col items-center bg-gray-900 p-4 rounded-lg overflow-auto max-h-[70vh]">
      <div 
        className="grid gap-px bg-gray-700 shadow-2xl" 
        style={{ 
          gridTemplateColumns: `repeat(50, 12px)`, 
          gridTemplateRows: `repeat(50, 12px)` 
        }}
      >
        {map.grid.map((row, y) => 
          row.map((cell, x) => {
            const isRover = rover.x === x && rover.y === y;
            let bgColor = 'bg-stone-600';

            switch(cell) {
              case '#': bgColor = 'bg-gray-800'; break;
              case 'B': bgColor = 'bg-blue-400'; break;
              case 'Y': bgColor = 'bg-yellow-400'; break;
              case 'G': bgColor = 'bg-green-400'; break;
              case 'S': bgColor = 'bg-red-400 font-bold'; break;
            }

            return (
              <div 
                key={`${x}-${y}`} 
                className={`w-[12px] h-[12px] relative ${bgColor} flex items-center justify-center`}
              >
                {isRover && (
                  <div className="absolute inset-0 bg-red-600 animate-pulse rounded-full z-10 border-2 border-white" title="Rover" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Map;
