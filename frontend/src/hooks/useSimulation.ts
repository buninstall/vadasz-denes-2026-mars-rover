import { useState, useEffect, useCallback } from 'react';
import { MapData, ReplayEntry, SimulationResult } from '../types';
import { simulationApi, SimulationSummary } from '../services/api';

export const useSimulation = () => {
  const [map, setMap] = useState<MapData | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replays, setReplays] = useState<ReplayEntry[]>([]);

  // Load map on mount
  useEffect(() => {
    simulationApi.getMap()
      .then((mapData) => setMap(mapData))
      .catch(err => console.error('Error fetching map:', err))
      .finally(() => setLoading(false));
  }, []);

  // Load replays from backend on mount
  const fetchReplays = useCallback(async () => {
    try {
      const summaries = await simulationApi.listSimulations();
      // Convert summaries to ReplayEntry shape (without full result/mapGrid — loaded on demand)
      const entries: ReplayEntry[] = summaries.map((s: SimulationSummary) => ({
        id: s.id,
        createdAt: s.createdAt,
        hours: s.hours,
        mapGrid: [], // loaded on demand when replaying
        result: {
          path: [],
          minerals: [],
          battery: [],
          steps_used: s.stepsUsed,
          success: s.success,
          total_minerals: s.totalMinerals,
          start: [0, 0],
          all_minerals: {},
          logs: [],
        } as SimulationResult,
      }));
      setReplays(entries);
    } catch (err) {
      console.error('Error fetching replays:', err);
    }
  }, []);

  useEffect(() => {
    fetchReplays();
  }, [fetchReplays]);

  const start = async (hours: number) => {
    if (!map) return;
    setLoading(true);
    setIsPlaying(false);
    setSimulationResult(null);
    try {
      const data = await simulationApi.startSimulation(hours, map.filename);
      setSimulationResult(data);
      setIsPlaying(true);

      // Refresh replays from backend (simulation auto-saved by backend)
      fetchReplays();
    } catch (error) {
      console.error('Failed to start simulation', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReplay = useCallback(async (replayId: string) => {
    try {
      setLoading(true);
      const record = await simulationApi.getSimulation(replayId);
      setSimulationResult(record.result);
      if (record.mapGrid && record.mapGrid.length > 0) {
        setMap({ grid: record.mapGrid as any, filename: record.mapFile || 'unknown' });
      }
      setIsPlaying(true);
    } catch (err) {
      console.error('Failed to load replay:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteReplay = useCallback(async (replayId: string) => {
    try {
      await simulationApi.deleteSimulation(replayId);
      setReplays(prev => prev.filter(r => r.id !== replayId));
    } catch (err) {
      console.error('Failed to delete replay:', err);
    }
  }, []);

  const clearReplays = useCallback(async () => {
    try {
      await simulationApi.clearSimulations();
      setReplays([]);
    } catch (err) {
      console.error('Failed to clear replays:', err);
    }
  }, []);

  const onSimulationComplete = () => {
    setIsPlaying(false);
  };

  return {
    map,
    simulationResult,
    isPlaying,
    loading,
    replays,
    start,
    loadReplay,
    deleteReplay,
    clearReplays,
    onSimulationComplete,
  };
};
