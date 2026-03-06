import { useState, useEffect } from 'react';
import { MapData, SimulationResult } from '../types';
import { simulationApi } from '../services/api';

export const useSimulation = () => {
  const [map, setMap] = useState<MapData | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    simulationApi.getMap()
      .then((mapData) => setMap(mapData))
      .catch(err => console.error('Error fetching map:', err))
      .finally(() => setLoading(false));
  }, []);

  const start = async (hours: number) => {
    if (!map) return;
    setLoading(true);
    setIsPlaying(false);
    setSimulationResult(null);
    try {
      const data = await simulationApi.startSimulation(hours) as SimulationResult;
      setSimulationResult(data);
      setIsPlaying(true);
    } catch (error) {
      console.error('Failed to start simulation', error);
    } finally {
      setLoading(false);
    }
  };

  const onSimulationComplete = () => {
    setIsPlaying(false);
  };

  return { map, simulationResult, isPlaying, loading, start, onSimulationComplete };
};
