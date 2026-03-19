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
    saveSimulationStep,
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
  const [photoMode, setPhotoMode] = useState(false);
  const [localPaused, setLocalPaused] = useState(false);
  const [keepSessionOnExit, setKeepSessionOnExit] = useState(false);
  const [savedSession, setSavedSession] = useState<any>(null);
  const [showSavedSimulations, setShowSavedSimulations] = useState(false);
  const [pendingJumpStep, setPendingJumpStep] = useState<number | null>(null);
  const [showRandomOptions, setShowRandomOptions] = useState(false);

  // Mark loaded if we are already in simulation
  useEffect(() => {
    if (map && simulationResult) {
      setIsLoaded(true);
    }
  }, [map, simulationResult]);

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
  }, []); // Only run once on mount! Removed loadMap dependency to avoid infinite loops if loadMap changes.

  useEffect(() => {
    if (map && !showResumePrompt) {
      if (keepSessionOnExit) setKeepSessionOnExit(false);
      localStorage.setItem('mars_rover_saved_session', JSON.stringify({
        map,
        simulationResult,
        currentStep
      }));
    } else if (!map && !keepSessionOnExit) {
      localStorage.removeItem('mars_rover_saved_session');
    }
  }, [simulationResult, map, currentStep, showResumePrompt, keepSessionOnExit]);

  // Handle refresh warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (map) {
        e.preventDefault();
        e.returnValue = ''; // Trigger browser built-in dialog
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [map]);

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
      if (pendingJumpStep !== null) {
        setCurrentStep(pendingJumpStep);
        setStepOverride(pendingJumpStep);
        setPendingJumpStep(null);
      } else {
        setCurrentStep(0);
        setStepOverride(0);
      }
      setReportDismissed(false);
    }
  }, [simulationResult, pendingJumpStep]);

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

  if (showSavedSimulations) {
    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">
            <h1 className="boot-title">PREVIOUS SIMULATIONS</h1>
            <p style={{ color: '#9ca3af', marginBottom: 24, fontSize: '0.95rem' }}>Select a past simulation to load or resume.</p>
            
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto mb-6 pr-2 custom-scrollbar">
              {replays.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: '0.9rem', fontStyle: 'italic' }}>No saved simulations found.</p>
              ) : (
                replays.map(r => {
                  const date = new Date(r.createdAt);
                  const hh = date.getHours().toString().padStart(2, '0');
                  const mm = date.getMinutes().toString().padStart(2, '0');
                  return (
                    <button 
                      key={r.id}
                      className="command-button command-button--ghost text-left flex justify-between items-center"
                      style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)' }}
                      onClick={() => {
                        setPendingJumpStep(r.savedStep || 0);
                        loadReplay(r.id);
                        setShowSavedSimulations(false);
                      }}
                    >
                      <span className="font-mono text-sm">{date.toLocaleDateString()} {hh}:{mm}</span>
                      <span className="text-xs text-gray-500">Step {r.savedStep || 0} / {r.result.steps_used}</span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="boot-actions">
              <button
                className="command-button command-button--secondary boot-choice-btn"
                onClick={() => setShowSavedSimulations(false)}
              >
                Back to Menu
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

    if (showRandomOptions) {
      return (
        <div className="boot-screen boot-screen--standalone">
          <div className="boot-grid" style={{ width: 'min(1200px, 95vw)', padding: '40px' }}>
            <div className="boot-panel" style={{ width: '100%', maxWidth: 'none' }}>
              <div 
                className="boot-actions" 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'row', 
                  gap: '20px', 
                  gridTemplateColumns: 'none',
                  margin: 0,
                  width: '100%'
                }}
              >
                <button
                  className="command-button command-button--primary boot-choice-btn"
                  style={{ 
                    flex: 2,
                    padding: '48px 24px', 
                    fontSize: '1.5rem', 
                    letterSpacing: '0.15em',
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.15) 100%)',
                    borderColor: '#10b981',
                    borderRadius: '16px',
                    fontWeight: 600
                  }}
                  onClick={() => handleInitialMapSelection('random-uncomplicated')}
                  disabled={loading}
                >
                  UNCOMPLICATED
                </button>

                <button
                  className="command-button command-button--primary boot-choice-btn"
                  style={{ 
                    flex: 2,
                    padding: '48px 24px', 
                    fontSize: '1.5rem', 
                    letterSpacing: '0.15em',
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.15) 100%)',
                    borderColor: '#ef4444',
                    borderRadius: '16px',
                    fontWeight: 600
                  }}
                  onClick={() => handleInitialMapSelection('random-complicated')}
                  disabled={loading}
                >
                  COMPLICATED
                </button>

                <button
                  className="command-button command-button--secondary boot-choice-btn"
                  style={{ 
                    flex: 1,
                    padding: '48px 24px',
                    fontSize: '1.2rem',
                    borderRadius: '16px'
                  }}
                  onClick={() => setShowRandomOptions(false)}
                  disabled={loading}
                >
                  BACK
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="boot-screen boot-screen--standalone">
        <div className="boot-grid">
          <div className="boot-panel">
            <p className="boot-kicker">Mission setup</p>
            <h1 className="boot-title">ROVER CONTROL DECK</h1>

            <div className="boot-actions">
              <button
                className="command-button command-button--primary boot-choice-btn"
                onClick={() => setShowRandomOptions(true)}
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

            <div className="boot-actions" style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                className="command-button command-button--ghost boot-choice-btn"
                onClick={() => setShowSavedSimulations(true)}
                disabled={loading}
              >
                Previous simulations
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
  const mapSourceLabel = mapSource.startsWith('random')
    ? `Random backend (${mapSource === 'random-complicated' ? 'Complicated' : 'Uncomplicated'})`
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
        {map && (
          <Scene
            map={map}
            simulationResult={simulationResult}
            isPlaying={isPlaying}
            stepDurationSec={0.06}
            onStep={handleStep}
            onComplete={handleComplete}
            stepOverride={stepOverride}
            cameraMode={cameraMode}
            hideHudOverlay={photoMode}
            localPaused={localPaused}
            setLocalPaused={setLocalPaused}
          />
        )}
      </div>

      {isLoaded && (
        <div 
          className="mission-shell transition-opacity duration-300 pointer-events-none"
          style={{ opacity: photoMode ? 0 : 1 }}
        >
          <div className="mission-column mission-column--primary flex flex-col h-screen py-4 pointer-events-none">
            <div className="pointer-events-auto shrink-0 mb-3">
              <Dashboard
                simulationResult={simulationResult}
                currentStep={currentStep}
                isPlaying={isPlaying}
                cameraMode={cameraMode}
                onCameraModeChange={setCameraMode}
                onExit={() => setShowExitConfirm(true)}
                onJumpToStep={handleJumpToStep}
                onEnterPhotoMode={() => setPhotoMode(true)}
              />
            </div>

            <div className="pointer-events-auto mt-auto w-full flex flex-col min-h-0 overflow-hidden" style={{ maxHeight: '75vh' }}>
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
        <div style={{ opacity: photoMode ? 0 : 1, transition: 'opacity 0.3s' }}>
          <Minimap
            map={map}
            simulationResult={simulationResult}
            currentStep={currentStep}
            comparisonRuns={comparisonRuns}
          />
        </div>
      )}

      {photoMode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[9999]">
          <div className="flex items-center gap-4 bg-black/60 backdrop-blur-md border border-white/20 rounded-full py-2 px-6 shadow-2xl">
            {/* Play/Pause */}
            <button 
              className="text-white hover:text-[#10b981] transition-colors"
              onClick={() => setLocalPaused(!localPaused)}
              title={localPaused || !isPlaying ? "Restore Time" : "Halt Time"}
            >
              {localPaused || !isPlaying ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
              )}
            </button>
            <div className="w-[1px] h-6 bg-white/20" />
            
            {/* Camera Modes */}
            <div className="flex gap-2">
              <button 
                className={`text-xs uppercase font-bold px-3 py-1 rounded-full transition-colors ${cameraMode === 'follow' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setCameraMode('follow')}
              >Follow</button>
              <button 
                className={`text-xs uppercase font-bold px-3 py-1 rounded-full transition-colors ${cameraMode === 'top' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setCameraMode('top')}
              >Top</button>
              <button 
                className={`text-xs uppercase font-bold px-3 py-1 rounded-full transition-colors ${cameraMode === 'detached' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
                onClick={() => setCameraMode('detached')}
              >Free</button>
            </div>
            
            <div className="w-[1px] h-6 bg-white/20" />
            
            {/* Exit Photo Mode */}
            <button
              className="text-gray-400 hover:text-[#ef4444] transition-colors flex items-center gap-2 text-xs uppercase font-bold"
              onClick={() => setPhotoMode(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
              Exit
            </button>
          </div>
        </div>
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
              <div className="boot-actions flex-col sm:flex-row">
                <button
                  className="command-button command-button--primary boot-choice-btn"
                  style={{ background: '#10b981', borderColor: '#34d399' }}
                  onClick={async () => {
                    setKeepSessionOnExit(true);
                    await saveSimulationStep(currentStep);
                    resetSimulation();
                    setShowExitConfirm(false);
                  }}
                >
                  Save & Exit to Menu
                </button>
                <button
                  className="command-button command-button--primary boot-choice-btn"
                  style={{ background: '#dc2626', borderColor: '#ef4444' }}
                  onClick={() => {
                    localStorage.removeItem('mars_rover_saved_session');
                    resetSimulation();
                    setShowExitConfirm(false);
                  }}
                >
                  Discard & Exit
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
