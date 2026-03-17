import axios from 'axios';
import { MapData } from '../types';

const API_BASE_URL = 'http://localhost:8000'; // Default backend URL
const MIN_TIME_LIMIT_HOURS = 24;

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const simulationApi = {
  getMap: async (): Promise<MapData> => {
<<<<<<< HEAD
    const response = await api.get('/map', { params: { random_map: false } });
    return { grid: response.data.data || [] };
  },
  
  startSimulation: async (hours: number): Promise<any> => {
    const response = await api.post('/simulate', {
      map_file: 'mars_map_50x50.csv',
      time_limit_hours: hours,
      collect_all: true,
=======
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
>>>>>>> 55cb65a (Refactor inference logic and remove legacy components)
    });
    return response.data;
  },
};
