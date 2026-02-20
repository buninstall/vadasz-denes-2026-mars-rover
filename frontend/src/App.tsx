import React, { useState, useEffect } from 'react';
import { useProgress } from '@react-three/drei';
import Scene from './components/Scene';
import Dashboard from './components/Dashboard';
import Controls from './components/Controls';
import LogViewer from './components/LogViewer';
import Minimap from './components/Minimap';
import { useSimulation } from './hooks/useSimulation';

function LoadingScreen({ onLoaded }: { onLoaded: () => void }) {
  const { progress, active } = useProgress();
  const [show, setShow] = useState(true);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (progress === 100 && !active) {
      // Kis késleltetés, hogy biztosan minden renderelődjön és ne legyenek vizuális bugok
      const timer1 = setTimeout(() => setOpacity(0), 800);
      const timer2 = setTimeout(() => {
        setShow(false);
        onLoaded();
      }, 1800);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [progress, active, onLoaded]);

  if (!show) return null;

  return (
    <div 
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-1000"
      style={{ opacity }}
    >
      <div className="flex flex-col items-center">
        <h1 className="text-3xl font-light tracking-[0.3em] text-white mb-8">MARS ROVER</h1>
        <div className="w-64 h-[2px] bg-gray-900 overflow-hidden">
          <div 
            className="h-full bg-white transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-gray-500">
          {progress === 100 ? 'Rendszer indítása...' : `Környezet betöltése ${Math.round(progress)}%`}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { map, state, isRunning, loading, start } = useSimulation();
  const [isLoaded, setIsLoaded] = useState(false);

  if (!map || !state) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-black">
        <div className="flex flex-col items-center">
          <h1 className="text-3xl font-light tracking-[0.3em] text-white mb-8 animate-pulse">MARS ROVER</h1>
          <div className="w-64 h-[2px] bg-gray-900 overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full bg-white w-1/3 animate-ping-pong"></div>
          </div>
          <p className="mt-6 font-mono text-xs uppercase tracking-widest text-gray-500">
            Adatok lekérése...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black font-sans text-gray-100">
      <LoadingScreen onLoaded={() => setIsLoaded(true)} />
      
      {/* 3D Scene Background */}
      <div className="absolute inset-0" style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.5s ease-in', pointerEvents: isLoaded ? 'auto' : 'none' }}>
        <Scene map={map} rover={state.rover} isDay={state.isDay} />
      </div>
      
      {/* Minimap Overlay */}
      {isLoaded && <Minimap map={map} rover={state.rover} />}
    </div>
  );
}
