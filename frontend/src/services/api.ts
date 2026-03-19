import axios from 'axios';
import { MapData, MapLoadSource, SimulationResult } from '../types';

const API_BASE_URL = 'http://localhost:8000'; // Default backend URL

const api = axios.create({
  baseURL: API_BASE_URL,
});

export interface SimulationSummary {
  id: string;
  createdAt: string;
  hours: number;
  mapFile: string;
  stepsUsed: number;
  success: boolean;
  mineralsCollected: number;
  totalMinerals: number;
  savedStep: number;
}

export interface SimulationRecord {
  id: string;
  createdAt: string;
  hours: number;
  mapFile: string;
  mapGrid: string[][];
  savedStep: number;
  result: SimulationResult;
}

const extractStart = (grid: string[][], providedStart?: number[]): [number, number] => {
  if (
    Array.isArray(providedStart)
    && providedStart.length === 2
    && Number.isInteger(providedStart[0])
    && Number.isInteger(providedStart[1])
  ) {
    return [providedStart[0], providedStart[1]];
  }

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === 'S') {
        return [row, col];
      }
    }
  }

  throw new Error('Map data does not contain a valid start point.');
};

export const simulationApi = {
  getMap: async (mapSource: MapLoadSource = 'random-uncomplicated'): Promise<MapData> => {
    const isRandom = mapSource.startsWith('random');
    const complexity = mapSource === 'random-complicated' ? 'complicated' : 'uncomplicated';
    const response = await api.get('/map', {
      params: { random_map: isRandom, complexity },
    });
    const grid = response.data.data || [];

    return {
      grid,
      filename: response.data.filename || 'mars_map_50x50.csv',
      sourceFilename: response.data.source_filename || response.data.filename || 'mars_map_50x50.csv',
      start: extractStart(grid, response.data.start),
    };
  },
  
  uploadMap: async (file: File): Promise<MapData> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/upload-map', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    const grid = response.data.data || [];

    return {
      grid,
      filename: response.data.filename,
      sourceFilename: response.data.source_filename || response.data.filename,
      start: extractStart(grid, response.data.start),
    };
  },
  
  startSimulation: async (
    hours: number,
    mapFile: string,
    startOverride?: [number, number] | null,
  ): Promise<SimulationResult> => {
    const payload: {
      map_file: string;
      time_limit_hours: number;
      collect_all: boolean;
      start_override?: [number, number];
    } = {
      map_file: mapFile,
      time_limit_hours: hours,
      collect_all: false,
    };

    if (startOverride) {
      payload.start_override = startOverride;
    }

    const response = await api.post('/simulate', payload);
    return response.data;
  },

  // ── Simulation CRUD ──

  listSimulations: async (): Promise<SimulationSummary[]> => {
    const response = await api.get('/simulations');
    return response.data;
  },

  getSimulation: async (id: string): Promise<SimulationRecord> => {
    const response = await api.get(`/simulations/${id}`);
    return response.data;
  },

  deleteSimulation: async (id: string): Promise<void> => {
    await api.delete(`/simulations/${id}`);
  },

  clearSimulations: async (): Promise<void> => {
    await api.delete('/simulations');
  },

  updateSimulationStep: async (id: string, step: number): Promise<void> => {
    await api.patch(`/simulations/${id}/step`, { currentStep: step });
  },
};
