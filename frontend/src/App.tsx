import React, { useCallback, useEffect, useState } from 'react';
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
      const t2 = setTimeout(() => {
        setShow(false);
        onLoaded();
      }, 1800);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [progress, active, onLoaded]);

  if (!show) return null;

  return (
    <div className="boot-screen" style={{ opacity }}>
      <div className="boot-grid">
        <div className="boot-panel">
          <p className="boot-kicker">ARES SURFACE SYSTEMS</p>
          <h1 className="boot-title">ROVER CONTROL DECK</h1>
          <div className="boot-progress-track">
            <div className="boot-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="boot-footer">
            <span>{progress === 100 ? 'CONTROL SURFACE ONLINE' : `INITIALIZING ${Math.round(progress)}%`}</span>
            <span>{active ? 'SYNCING ASSETS' : 'STANDBY'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const countTerrainMinerals = (grid: string[][]) =>
  grid.reduce(
    (total, row) => total + row.filter((cell) => cell === 'B' || cell === 'Y' || cell === 'G').length,
    0,
  );

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
  const [currentStep, setCurrentStep] = useState(0);

  const handleStep = useCallback((step: number) => {
    setCurrentStep(step);
  }, []);

  const handleComplete = useCallback(() => {
    onSimulationComplete();
    if (simulationResult) {
      setCurrentStep(simulationResult.path.length - 1);
    }
  }, [onSimulationComplete, simulationResult]);

  useEffect(() => {
    if (simulationResult) {
      setCurrentStep(0);
    }
  }, [simulationResult]);

  if (!map) {
    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">
            <p className="boot-kicker">ARES SURFACE SYSTEMS</p>
            <h1 className="boot-title">ROVER CONTROL DECK</h1>
            <div className="boot-progress-track">
              <div className="boot-progress-fill" style={{ width: '52%' }} />
            </div>
            <div className="boot-footer">
              <span>FETCHING TERRAIN PACKAGE</span>
              <span>STANDBY</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const mapWidth = map.grid[0]?.length ?? 0;
  const mapHeight = map.grid.length;
  const mapSize = `${mapWidth} x ${mapHeight}`;
  const terrainMinerals = countTerrainMinerals(map.grid);
  const archiveCount = replays.length;
  const missionStatus = !simulationResult
    ? loading
      ? 'Loading'
      : 'Ready'
    : isPlaying
      ? 'Running'
      : simulationResult.success
        ? 'Done'
        : 'Stopped';

  return (
    <div className="app-shell">
      <LoadingScreen onLoaded={() => setIsLoaded(true)} />

      <div
        className="scene-layer"
        style={{
          opacity: isLoaded ? 1 : 0,
          pointerEvents: isLoaded ? 'auto' : 'none',
        }}
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

      {isLoaded && (
        <div className="mission-shell">
          <div className="mission-topbar panel pointer-events-auto">
            <div className="topbar-block">
              <span className="topbar-label">Map</span>
              <strong className="topbar-value">{map.filename}</strong>
            </div>
            <div className="topbar-block">
              <span className="topbar-label">Size</span>
              <strong className="topbar-value">{mapSize}</strong>
            </div>
            <div className="topbar-block">
              <span className="topbar-label">Minerals</span>
              <strong className="topbar-value">{terrainMinerals}</strong>
            </div>
            <div className="topbar-block">
              <span className="topbar-label">Replays</span>
              <strong className="topbar-value">{archiveCount}</strong>
            </div>
            <div className="topbar-block topbar-block--status">
              <span className="topbar-label">Status</span>
              <strong className={`topbar-value ${isPlaying ? 'topbar-value--live' : ''}`}>{missionStatus}</strong>
            </div>
          </div>

          <div className="mission-column mission-column--primary">
            <div className="pointer-events-auto">
              <Dashboard simulationResult={simulationResult} currentStep={currentStep} isPlaying={isPlaying} />
            </div>

            <div className="pointer-events-auto">
              <LogViewer simulationResult={simulationResult} currentStep={currentStep} />
            </div>
          </div>

          <div className="mission-column mission-column--secondary">
            <div className="pointer-events-auto">
              <Controls
                onStart={start}
                onReplay={loadReplay}
                onDeleteReplay={deleteReplay}
                onClearReplays={clearReplays}
                replays={replays}
                isLoading={loading}
                onUploadMap={uploadCustomMap}
                mapFilename={map.filename}
                mapSize={mapSize}
              />
            </div>
          </div>
        </div>
      )}

      {isLoaded && <Minimap map={map} simulationResult={simulationResult} currentStep={currentStep} />}
    </div>
  );
}
