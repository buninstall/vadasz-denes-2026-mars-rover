import { useState, useEffect } from 'react';
import { SimulationState, MapData } from '../types';
import { simulationApi } from '../services/api';

const findStartPosition = (map: MapData): { x: number; y: number } => {
  for (let y = 0; y < map.grid.length; y++) {
    for (let x = 0; x < map.grid[y].length; x++) {
      if (map.grid[y][x] === 'S') {
        return { x, y };
      }
    }
  }
  return { x: 0, y: 0 }; // fallback
};

export const useSimulation = () => {
  const [map, setMap] = useState<MapData | null>(null);
  const [state, setState] = useState<SimulationState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  // Initialize: get map
  useEffect(() => {
    simulationApi.getMap()
      .then((mapData) => {
        setMap(mapData);
        
        // Initialize rover at start position
        const startPos = findStartPosition(mapData);
        setState({
          currentTime: "06:00",
          isDay: true,
          rover: {
            x: startPos.x,
            y: startPos.y,
            battery: 100,
            speed: 'normal' as const,
            distanceMoved: 0,
            mineralsCollected: { B: 0, Y: 0, G: 0 }
          },
          logs: []
        });
      })
      .catch(err => console.error("Error fetching map:", err))
      .finally(() => setLoading(false));
  }, []);

  const start = async (hours: number) => {
    setLoading(true);
    try {
      const { simulationId } = await simulationApi.startSimulation(hours);
      setIsRunning(true);
      // Logic for polling/step fetching would go here in a production app
      // For now, this is a placeholder for the integration
    } catch (error) {
      console.error('Failed to start simulation', error);
    } finally {
      setLoading(false);
    }
  };

  return { map, state, isRunning, loading, start };
};
