import axios from 'axios';
import { MapData, ReplayEntry, SimulationResult } from '../types';

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
}

export interface SimulationRecord {
  id: string;
  createdAt: string;
  hours: number;
  mapFile: string;
  mapGrid: string[][];
  result: SimulationResult;
}

export const simulationApi = {
  getMap: async (): Promise<MapData> => {
    const response = await api.get('/map', { params: { random_map: true } });
    return { grid: response.data.data || [], filename: response.data.filename || 'mars_map_50x50.csv' };
  },
  
  startSimulation: async (hours: number, mapFile: string): Promise<SimulationResult> => {
    const response = await api.post('/simulate', {
      map_file: mapFile,
      time_limit_hours: hours,
      collect_all: false,
    });
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
};
