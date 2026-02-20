import axios from 'axios';
import { MapData, SimulationState } from '../types';

const API_BASE_URL = 'http://localhost:8000'; // Default backend URL

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const simulationApi = {
  getMap: async (): Promise<MapData> => {
    const response = await api.get('/map');
    return { grid: response.data.data || [] };
  },
  
  startSimulation: async (hours: number): Promise<{ simulationId: string }> => {
    const response = await api.post('/start', { hours });
    return response.data;
  },
  
  getStep: async (simulationId: string, currentStep: number): Promise<SimulationState> => {
    const response = await api.get(`/step/${simulationId}/${currentStep}`);
    return response.data;
  },
};
