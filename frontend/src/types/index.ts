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
