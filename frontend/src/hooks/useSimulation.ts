import { useState, useEffect, useCallback } from 'react';
import { ActiveMapSource, ComparisonRun, MapData, MapLoadSource, ReplayEntry, SimulationResult } from '../types';
import { simulationApi, SimulationSummary } from '../services/api';

export const useSimulation = () => {
  const [map, setMap] = useState<MapData | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replays, setReplays] = useState<ReplayEntry[]>([]);
  const [comparisonRuns, setComparisonRuns] = useState<ComparisonRun[]>([]);
  const [mapSource, setMapSource] = useState<ActiveMapSource>('random');
  const [currentSimId, setCurrentSimId] = useState<string | null>(null);

  const saveSimulationStep = useCallback(async (step: number) => {
    if (currentSimId) {
      try {
        await simulationApi.updateSimulationStep(currentSimId, step);
      } catch (err) {
        console.error('Failed to save simulation step:', err);
      }
    }
  }, [currentSimId]);

  const registerComparisonRun = useCallback((result: SimulationResult, label: string, runId?: string) => {
    const id = runId ?? `live-${Date.now()}`;
    const entry: ComparisonRun = {
      id,
      label,
      path: result.path,
      mineralsCollected: result.minerals.length,
      stepsUsed: result.steps_used,
      success: result.success,
    };

    setComparisonRuns((prev) => {
      const withoutCurrent = prev.filter((item) => item.id !== id);
      return [entry, ...withoutCurrent].slice(0, 4);
    });
  }, []);

  const loadMap = useCallback(async (source: MapLoadSource): Promise<MapData> => {
    setLoading(true);
    try {
      const mapData = await simulationApi.getMap(source);
      setMap(mapData);
      setMapSource(source);
      setSimulationResult(null);
      setCurrentSimId(null);
      setIsPlaying(false);
      return mapData;
    } finally {
      setLoading(false);
    }
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
        savedStep: s.savedStep,
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
    setLoading(true);
    setIsPlaying(false);
    setSimulationResult(null);
    setCurrentSimId(null);

    try {
      if (!map) {
        throw new Error('No map available to run simulation');
      }

      const data = await simulationApi.startSimulation(hours, map.filename);
      setSimulationResult(data);
      setCurrentSimId(data.sim_id || null);
      setIsPlaying(true);
      registerComparisonRun(data, `Live ${new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}`);

      // Refresh replays from backend (simulation auto-saved by backend)
      fetchReplays();
    } catch (error) {
      console.error('Failed to start simulation', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadCustomMap = async (file: File) => {
    setLoading(true);
    try {
      const newMap = await simulationApi.uploadMap(file);
      setMap(newMap);
      setMapSource('custom');
      setSimulationResult(null);
      setCurrentSimId(null);
      setIsPlaying(false);
    } catch (error) {
      console.error('Failed to upload map', error);
      alert('Failed to upload custom map. Ensure it is a valid 50x50 CSV with exactly one "S".');
    } finally {
      setLoading(false);
    }
  };

  const loadReplay = useCallback(async (replayId: string) => {
    try {
      setLoading(true);
      const record = await simulationApi.getSimulation(replayId);
      setSimulationResult(record.result);
      setCurrentSimId(record.id);
      if (record.mapGrid && record.mapGrid.length > 0) {
        let replayStart: [number, number] | null = null;
        if (Array.isArray(record.result.start) && record.result.start.length === 2) {
          replayStart = [record.result.start[0], record.result.start[1]];
        }

        if (!Array.isArray(replayStart) || replayStart.length !== 2) {
          let foundStart: [number, number] | null = null;
          for (let row = 0; row < record.mapGrid.length; row++) {
            for (let col = 0; col < record.mapGrid[row].length; col++) {
              if (record.mapGrid[row][col] === 'S') {
                foundStart = [row, col];
                break;
              }
            }
            if (foundStart) break;
          }
          replayStart = foundStart;
        }

        if (!replayStart) {
          throw new Error('Replay map does not contain a valid start point');
        }

        setMap({
          grid: record.mapGrid as any,
          filename: record.mapFile || 'unknown',
          sourceFilename: record.mapFile || 'unknown',
          start: replayStart,
        });
      }
      setIsPlaying(true);
      registerComparisonRun(
        record.result,
        `Replay ${new Date(record.createdAt).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}`,
        replayId,
      );
    } catch (err) {
      console.error('Failed to load replay:', err);
    } finally {
      setLoading(false);
    }
  }, [registerComparisonRun]);

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

  const restoreSimulation = useCallback((savedMap: MapData, savedResult: SimulationResult) => {
    setMap(savedMap);
    setSimulationResult(savedResult);
    setCurrentSimId(savedResult.sim_id || null);
    setIsPlaying(false);
  }, []);

  const resetSimulation = useCallback(() => {
    setMap(null);
    setSimulationResult(null);
    setCurrentSimId(null);
    setIsPlaying(false);
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
    comparisonRuns,
    mapSource,
    loadMap,
    start,
    loadReplay,
    deleteReplay,
    clearReplays,
    onSimulationComplete,
    uploadCustomMap,
    resetSimulation,
    restoreSimulation,
    currentSimId,
    saveSimulationStep,
  };
};
