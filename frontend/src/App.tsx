import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import Scene from './components/Scene';
import Dashboard from './components/Dashboard';
import Controls from './components/Controls';
import LogViewer from './components/LogViewer';
import Minimap from './components/Minimap';
import { useSimulation } from './hooks/useSimulation';
import PostMissionReport from './components/PostMissionReport';
import { SimLogEntry } from './types';

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
    comparisonRuns,
  } = useSimulation();

  const [isLoaded, setIsLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const [reportDismissed, setReportDismissed] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const lastMiningSoundStepRef = useRef(-1);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioContextRef.current) {
      const AudioCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      audioContextRef.current = new AudioCtor();
    }
    return audioContextRef.current;
  }, []);

  const playMiningBeep = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    ctx.resume().catch(() => undefined);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(920, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(560, ctx.currentTime + 0.11);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.16);
  }, [ensureAudioContext]);

  const currentLog: SimLogEntry | null = useMemo(() => {
    if (!simulationResult?.logs?.length) return null;
    return simulationResult.logs[Math.min(currentStep, simulationResult.logs.length - 1)] ?? null;
  }, [simulationResult, currentStep]);
  const isMissionFinished =
    !!simulationResult && currentStep >= Math.max(simulationResult.path.length - 1, 0) && !isPlaying;
  const showPostMissionReport = isMissionFinished && !reportDismissed;
  const showSuccessfulReportOnly = showPostMissionReport && !!simulationResult?.success;

  const handleStep = useCallback((step: number) => {
    setCurrentStep(step);
    setStepOverride(null);
  }, []);

  const handleJumpToStep = useCallback((step: number) => {
    if (!simulationResult) return;
    const boundedStep = Math.max(0, Math.min(step, simulationResult.path.length - 1));
    setCurrentStep(boundedStep);
    setStepOverride(boundedStep);
  }, [simulationResult]);

  const handleComplete = useCallback(() => {
    onSimulationComplete();
    if (simulationResult) {
      setCurrentStep(simulationResult.path.length - 1);
    }
  }, [onSimulationComplete, simulationResult]);

  useEffect(() => {
    if (simulationResult) {
      setCurrentStep(0);
      setStepOverride(0);
      setReportDismissed(false);
    }
  }, [simulationResult]);

  useEffect(() => {
    if (!currentLog || currentLog.step === lastMiningSoundStepRef.current) return;
    if (currentLog.action !== 'mine') return;
    lastMiningSoundStepRef.current = currentLog.step;
    playMiningBeep();
  }, [currentLog, playMiningBeep]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, []);

  if (!map) {
    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">            <h1 className="boot-title">ROVER CONTROL DECK</h1>
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
  return (
    <div className="app-shell">
      <LoadingScreen onLoaded={() => setIsLoaded(true)} />

      {!showSuccessfulReportOnly && (
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
            stepOverride={stepOverride}
            hideHudOverlay={showSuccessfulReportOnly}
          />
        </div>
      )}

      {isLoaded && !showSuccessfulReportOnly && (
        <div className="mission-shell">
          <div className="mission-column mission-column--primary">
            <div className="pointer-events-auto">
              <Dashboard
                simulationResult={simulationResult}
                currentStep={currentStep}
                isPlaying={isPlaying}
              />
            </div>

            <div className="pointer-events-auto">
              <LogViewer simulationResult={simulationResult} currentStep={currentStep} onJumpToStep={handleJumpToStep} />
            </div>
          </div>

          <div className="mission-column mission-column--secondary">
            <div className="pointer-events-auto" style={{ width: 224 }}>
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

      {isLoaded && !showSuccessfulReportOnly && (
        <Minimap
          map={map}
          simulationResult={simulationResult}
          currentStep={currentStep}
          comparisonRuns={comparisonRuns}
        />
      )}

      {showPostMissionReport && simulationResult && (
        <div className="post-report-shell post-report-shell--center pointer-events-auto">
          <PostMissionReport
            simulationResult={simulationResult}
            currentStep={currentStep}
            onClose={() => setReportDismissed(true)}
          />
        </div>
      )}
    </div>
  );
}
