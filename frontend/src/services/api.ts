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
  
  startSimulation: async (hours: number): Promise<any> => {
    const response = await api.post('/simulate', { map_file: 'mars_map_50x50.csv', time_limit_hours: hours });
    return response.data;
  },
};
