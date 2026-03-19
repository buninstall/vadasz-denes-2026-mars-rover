import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import Scene from './components/Scene';
import Dashboard from './components/Dashboard';
import Controls from './components/Controls';
import LogViewer from './components/LogViewer';
import Minimap from './components/Minimap';
import { useSimulation } from './hooks/useSimulation';
import PostMissionReport from './components/PostMissionReport';
import { MapLoadSource, SimLogEntry, CameraMode } from './types';

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
    mapSource,
    loadMap,
    start,
    loadReplay,
    deleteReplay,
    clearReplays,
    onSimulationComplete,
    uploadCustomMap,
    comparisonRuns,
    restoreSimulation,
    resetSimulation,
  } = useSimulation();

  const [isLoaded, setIsLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const [reportDismissed, setReportDismissed] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('follow');
  const startupFileInputRef = useRef<HTMLInputElement>(null);

  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [savedSession, setSavedSession] = useState<any>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('mars_rover_saved_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.map && parsed.simulationResult && parsed.currentStep !== undefined) {
          setSavedSession(parsed);
          setShowResumePrompt(true);
        }
      }
    } catch (e) {
      console.error('Failed to parse saved session', e);
    }
  }, []);

  useEffect(() => {
    if (simulationResult && map && !showResumePrompt) {
      localStorage.setItem('mars_rover_saved_session', JSON.stringify({
        map,
        simulationResult,
        currentStep
      }));
    } else if (!simulationResult) {
      localStorage.removeItem('mars_rover_saved_session');
    }
  }, [simulationResult, map, currentStep, showResumePrompt]);

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

  const handleInitialMapSelection = useCallback(async (source: MapLoadSource) => {
    setMapLoadError(null);
    try {
      await loadMap(source);
    } catch (error) {
      console.error('Failed to load map from backend', error);
      setMapLoadError('Failed to load map from backend.');
    }
  }, [loadMap]);

  if (showResumePrompt && savedSession) {
    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">
            <h1 className="boot-title">RESUME SIMULATION</h1>
            <p style={{ color: '#9ca3af', marginBottom: 24, fontSize: '0.95rem' }}>An unfinished simulation was found. Do you want to resume it from where you left off?</p>
            <div className="boot-actions">
              <button
                className="command-button command-button--primary boot-choice-btn"
                onClick={() => {
                  restoreSimulation(savedSession.map, savedSession.simulationResult);
                  setCurrentStep(savedSession.currentStep);
                  setStepOverride(savedSession.currentStep);
                  setShowResumePrompt(false);
                  setSavedSession(null);
                }}
              >
                Yes, Resume
              </button>
              <button
                className="command-button command-button--secondary boot-choice-btn"
                onClick={() => {
                  localStorage.removeItem('mars_rover_saved_session');
                  setShowResumePrompt(false);
                  setSavedSession(null);
                }}
              >
                No, Discard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!map) {
    const statusText = loading ? 'FETCHING TERRAIN PACKAGE' : 'SELECT STARTUP MAP SOURCE';
    const stateText = loading ? 'SYNCING BACKEND' : 'AWAITING COMMAND';

    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">
            <p className="boot-kicker">Mission setup</p>
            <h1 className="boot-title">ROVER CONTROL DECK</h1>

            <div className="boot-actions">
              <button
                className="command-button command-button--primary boot-choice-btn"
                onClick={() => handleInitialMapSelection('random')}
                disabled={loading}
              >
                Random map
              </button>

              <button
                className="command-button command-button--secondary boot-choice-btn"
                onClick={() => handleInitialMapSelection('static')}
                disabled={loading}
              >
                Static map
              </button>

              <input
                ref={startupFileInputRef}
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={(event) => {
                  if (!event.target.files || event.target.files.length === 0) return;
                  setMapLoadError(null);
                  uploadCustomMap(event.target.files[0]);
                  event.target.value = '';
                }}
              />

              <button
                className="command-button command-button--ghost boot-choice-btn"
                onClick={() => startupFileInputRef.current?.click()}
                disabled={loading}
              >
                Custom map upload
              </button>
            </div>

            {mapLoadError && <p className="boot-error">{mapLoadError}</p>}

            <div className="boot-footer">
              <span>{statusText}</span>
              <span>{stateText}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const mapWidth = map.grid[0]?.length ?? 0;
  const mapHeight = map.grid.length;
  const mapSourceLabel = mapSource === 'random'
    ? 'Random backend'
    : mapSource === 'static'
      ? 'Static backend'
      : 'Custom upload';
  const mapSize = `${mapWidth} x ${mapHeight} • ${mapSourceLabel}`;
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
          stepOverride={stepOverride}
          cameraMode={cameraMode}
        />
      </div>

      {isLoaded && (
        <div className="mission-shell">
          <div className="mission-column mission-column--primary">
            <div className="pointer-events-auto">
              <Dashboard
                simulationResult={simulationResult}
                currentStep={currentStep}
                isPlaying={isPlaying}
                cameraMode={cameraMode}
                onCameraModeChange={setCameraMode}
                onExit={() => setShowExitConfirm(true)}
                onJumpToStep={handleJumpToStep}
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
                mapFilename={map.sourceFilename ?? map.filename}
                mapSize={mapSize}
              />
            </div>
          </div>
        </div>
      )}

      {isLoaded && (
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

      {showExitConfirm && (
        <div className="boot-screen boot-screen--standalone" style={{ zIndex: 9999 }}>
          <div className="boot-grid">
            <div className="boot-panel">
              <h1 className="boot-title" style={{ color: '#ef4444' }}>ABORT MISSION?</h1>
              <p style={{ color: '#9ca3af', marginBottom: 24, fontSize: '0.95rem' }}>Are you sure you want to end the current simulation and return to the main menu? Unsaved progress will be tracked by auto-save.</p>
              <div className="boot-actions">
                <button
                  className="command-button command-button--primary boot-choice-btn"
                  style={{ background: '#dc2626', borderColor: '#ef4444' }}
                  onClick={() => {
                    resetSimulation();
                    setShowExitConfirm(false);
                  }}
                >
                  Yes, Abort
                </button>
                <button
                  className="command-button command-button--secondary boot-choice-btn"
                  onClick={() => setShowExitConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
