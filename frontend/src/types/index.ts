export type BlockType = '.' | '#' | 'B' | 'Y' | 'G' | 'S';

export interface MapData {
  grid: BlockType[][];
}

export interface RoverState {
  x: number;
  y: number;
  battery: number;
  speed: 'slow' | 'normal' | 'fast';
  distanceMoved: number;
  mineralsCollected: {
    B: number;
    Y: number;
    G: number;
  };
}

export interface LogEntry {
  timestamp: string;
  position: { x: number, y: number };
  battery: number;
  speed: string;
  event: string;
}

export interface SimulationState {
  currentTime: string;
  isDay: boolean;
  rover: RoverState;
  logs: LogEntry[];
}

export interface SimLogEntry {
  step: number;
  time_hours: number;
  is_day: boolean;
  position: [number, number]; // [row, col]
  battery: number;
  speed: number;
  distance_traveled: number;
  minerals_collected: string[];
  action: 'start' | 'move' | 'mine';
}

export interface SimMineral {
  pos: [number, number]; // [row, col]
  type: string;
  step: number;
}

export interface SimulationResult {
  path: [number, number][]; // [row, col][]
  minerals: SimMineral[];
  battery: number[];
  steps_used: number;
  success: boolean;
  all_collected?: boolean;
  total_minerals?: number;
  time_budget_steps?: number;
  termination_reason?: string;
  start: [number, number];
  all_minerals: Record<string, string>;
  logs: SimLogEntry[];
}

// Full path from backend: array of [row, col] points
export type PathPoint = [number, number];
