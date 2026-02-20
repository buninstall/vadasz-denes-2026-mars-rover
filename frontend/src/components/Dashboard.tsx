import React from 'react';
import { SimulationState } from '../types';

interface DashboardProps {
  state: SimulationState;
}

const Dashboard: React.FC<DashboardProps> = ({ state }) => {
  const { battery, distanceMoved, mineralsCollected } = state.rover;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-800 text-white rounded-xl shadow-lg border border-gray-700">
      <div className="flex flex-col p-4 bg-gray-900 rounded-lg border border-gray-700">
        <span className="text-gray-400 text-xs uppercase tracking-wider">Battery Power</span>
        <span className={`text-3xl font-bold mt-1 ${battery < 20 ? 'text-red-500' : 'text-green-400'}`}>
          {battery.toFixed(1)}%
        </span>
      </div>
      
      <div className="flex flex-col p-4 bg-gray-900 rounded-lg border border-gray-700">
        <span className="text-gray-400 text-xs uppercase tracking-wider">Environment</span>
        <span className="text-3xl font-bold mt-1 flex items-center gap-2">
          {state.isDay ? 'Day ☀️' : 'Night 🌙'}
        </span>
      </div>

      <div className="flex flex-col p-4 bg-gray-900 rounded-lg border border-gray-700">
        <span className="text-gray-400 text-xs uppercase tracking-wider">Mineral Samples</span>
        <div className="flex gap-3 items-center mt-1">
          <span className="text-blue-400 font-bold text-xl">{mineralsCollected.B}</span>
          <span className="text-yellow-400 font-bold text-xl">{mineralsCollected.Y}</span>
          <span className="text-green-400 font-bold text-xl">{mineralsCollected.G}</span>
        </div>
      </div>

      <div className="flex flex-col p-4 bg-gray-900 rounded-lg border border-gray-700">
        <span className="text-gray-400 text-xs uppercase tracking-wider">Total Traversed</span>
        <span className="text-3xl font-bold mt-1 text-indigo-400">{distanceMoved.toFixed(1)} km</span>
      </div>
    </div>
  );
};

export default Dashboard;
