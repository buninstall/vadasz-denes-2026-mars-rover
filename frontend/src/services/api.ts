import axios from 'axios';
import { MapData } from '../types';

const API_BASE_URL = 'http://localhost:8000'; // Default backend URL
const MIN_TIME_LIMIT_HOURS = 24;

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const simulationApi = {
  getMap: async (): Promise<MapData> => {
    const response = await api.get('/map');
    return {
      grid: response.data.data || [],
      filename: response.data.filename,
      width: response.data.width,
      height: response.data.height,
    };
  },
  
  startSimulation: async (mapFile: string, hours: number): Promise<any> => {
    const response = await api.post('/simulate', {
      map_file: mapFile,
      time_limit_hours: Math.max(MIN_TIME_LIMIT_HOURS, Math.floor(hours)),
    });
    return response.data;
  },
};
