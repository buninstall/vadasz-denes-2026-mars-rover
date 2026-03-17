import React, { useState, useEffect, useCallback } from 'react';
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
      const t1 = setTimeout(() => setOpacity(0), 800);
      const t2 = setTimeout(() => { setShow(false); onLoaded(); }, 1800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
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
          <div className="h-full bg-white transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-gray-500">
          {progress === 100 ? 'Rendszer indítása...' : `Betöltés ${Math.round(progress)}%`}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const {
    map,
    simulationResult,
    isPlaying,
    loading,
    replays,
    start,
    loadReplay,
    deleteReplay,
    clearReplays,
    onSimulationComplete,
    uploadCustomMap,
  } = useSimulation();
  const [isLoaded, setIsLoaded] = useState(false);
  // currentStep is updated by the Scene's onStep callback — only every 10 sim-steps
  const [currentStep, setCurrentStep] = useState(0);

  const handleStep = useCallback((step: number) => {
    setCurrentStep(step);
  }, []);

  const handleComplete = useCallback(() => {
    onSimulationComplete();
    // Set to last step
    if (simulationResult) setCurrentStep(simulationResult.path.length - 1);
  }, [onSimulationComplete, simulationResult]);

  // Reset step counter when a new simulation starts
  useEffect(() => {
    if (simulationResult) setCurrentStep(0);
  }, [simulationResult]);

  if (!map) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-black">
        <h1 className="text-3xl font-light tracking-[0.3em] text-white mb-8 animate-pulse">MARS ROVER</h1>
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-gray-500">Térkép betöltése…</p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black font-sans text-gray-100">
      <LoadingScreen onLoaded={() => setIsLoaded(true)} />

      {/* 3D Scene */}
      <div
        className="absolute inset-0"
        style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.5s ease-in', pointerEvents: isLoaded ? 'auto' : 'none' }}
      >
        <Scene
          map={map}
          simulationResult={simulationResult}
          isPlaying={isPlaying}
          stepDurationSec={0.06}
          onStep={handleStep}
          onComplete={handleComplete}
        />
      </div>

      {/* HUD Overlay */}
      {isLoaded && (
        <div className="absolute inset-0 pointer-events-none flex flex-col p-4" style={{ gap: 8 }}>
          {/* Top row: Dashboard left, Controls right */}
          <div className="flex justify-between items-start gap-4">
            <div className="pointer-events-auto">
              <Dashboard simulationResult={simulationResult} currentStep={currentStep} isPlaying={isPlaying} />
            </div>
            <div className="pointer-events-auto">
              <Controls
                onStart={start}
                onReplay={loadReplay}
                onDeleteReplay={deleteReplay}
                onClearReplays={clearReplays}
                replays={replays}
                isLoading={loading}
                onUploadMap={uploadCustomMap}
              />
            </div>
          </div>

          {/* Bottom-left: Log viewer */}
          <div className="mt-auto pointer-events-auto" style={{ width: 380 }}>
            <LogViewer simulationResult={simulationResult} currentStep={currentStep} />
          </div>
        </div>
      )}

      {/* Minimap — fixed bottom-right (self-positioned) */}
      {isLoaded && (
        <Minimap map={map} simulationResult={simulationResult} currentStep={currentStep} />
      )}
    </div>
  );
}
