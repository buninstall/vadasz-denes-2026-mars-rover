import React, { useState } from 'react';
import Scene from './components/Scene';
import Dashboard from './components/Dashboard';
import Controls from './components/Controls';
import LogViewer from './components/LogViewer';
import Minimap from './components/Minimap';
import { useSimulation } from './hooks/useSimulation';

export default function App() {
  const { map, state, isRunning, loading, start } = useSimulation();

  if (!map || !state) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-red-600 mb-4"></div>
        <p className="font-mono text-sm uppercase tracking-widest text-gray-400">Loading Mars Terrain...</p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black font-sans text-gray-100">
      {/* 3D Scene Background */}
      <Scene map={map} rover={state.rover} isDay={state.isDay} />
      
      {/* Minimap Overlay */}
      <Minimap map={map} rover={state.rover} />
    </div>
  );
}
