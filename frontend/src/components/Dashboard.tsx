import React, { useMemo } from 'react';
import { SimulationResult, SimLogEntry, CameraMode } from '../types';

interface DashboardProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
  isPlaying: boolean;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  onExit?: () => void;
  onJumpToStep: (step: number) => void;
}

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const Dashboard: React.FC<DashboardProps> = ({ 
  simulationResult, 
  currentStep, 
  isPlaying,
  cameraMode,
  onCameraModeChange,
  onExit,
  onJumpToStep
}) => {
  const log: SimLogEntry | null = useMemo(() => {
    if (!simulationResult?.logs?.length) return null;
    return simulationResult.logs[Math.min(currentStep, simulationResult.logs.length - 1)];
  }, [simulationResult, currentStep]);

  const mineralsCollected = useMemo(() => {
    if (!simulationResult) return { B: 0, Y: 0, G: 0 };
    const acc = { B: 0, Y: 0, G: 0 };
    simulationResult.minerals.forEach((mineral) => {
      if (mineral.step <= currentStep) {
        acc[mineral.type as 'B' | 'Y' | 'G']++;
      }
    });
    return acc;
  }, [simulationResult, currentStep]);

  const battery = log?.battery ?? 100;
  const isDay = log?.is_day ?? true;
  const simClock = log ? formatTime(6 + log.time_hours) : '06:00';
  const elapsedHours = log?.time_hours?.toFixed(1) ?? '0.0';
  const stepNum = log?.step ?? 0;
  const distance = log?.distance_traveled?.toFixed(1) ?? '0.0';
  const totalMinerals = simulationResult
    ? simulationResult.total_minerals ?? Object.keys(simulationResult.all_minerals ?? {}).length
    : 0;
  const collectedTotal = mineralsCollected.B + mineralsCollected.Y + mineralsCollected.G;
  const missionState = !simulationResult
    ? 'Standby'
    : isPlaying
      ? log?.action === 'mine'
        ? 'Sampling'
        : 'Traverse'
      : simulationResult.success
        ? 'Complete'
        : 'Paused';
  const batteryState = battery > 65 ? 'Nominal' : battery > 35 ? 'Reserve' : 'Critical';
  const mineralProgress = totalMinerals > 0 ? Math.round((collectedTotal / totalMinerals) * 100) : 0;
  const routeProgress = simulationResult
    ? Math.round(
        (Math.min(currentStep, simulationResult.path.length - 1) / Math.max(simulationResult.path.length - 1, 1)) * 100,
      )
    : 0;
  const batteryTone =
    battery > 65 ? 'var(--signal-ok)' : battery > 35 ? 'var(--signal-warn)' : 'var(--signal-danger)';

  const timelineMarkers = useMemo(() => {
    if (!simulationResult?.logs) return { dayNightBlocks: [], markers: [], total: 0 };
    
    const markers = [];
    let currentDayState = true;
    let stateStartIdx = 0;
    const total = simulationResult.logs.length;
    const dayNightBlocks = [];
    
    if (total > 0) {
      currentDayState = simulationResult.logs[0]?.is_day ?? true;
    }

    for (let i = 0; i < total; i++) {
       const isDay = simulationResult.logs[i]?.is_day ?? true;
       if (isDay !== currentDayState || i === total - 1) {
          dayNightBlocks.push({
             isDay: currentDayState,
             startPct: (stateStartIdx / total) * 100,
             widthPct: ((i - stateStartIdx) / total) * 100
          });
          currentDayState = isDay;
          stateStartIdx = i;
       }
       if (simulationResult.logs[i]?.action === 'mine') {
          markers.push({
             type: 'mine',
             pct: (i / total) * 100,
             step: i
          });
       }
    }
    return { dayNightBlocks, markers, total };
  }, [simulationResult]);

  const timelineRef = React.useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = React.useState(false);

  const handleScrub = React.useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!timelineRef.current || !simulationResult) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onJumpToStep(Math.round(pct * (simulationResult.path.length - 1)));
  }, [simulationResult, onJumpToStep]);

  React.useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: MouseEvent) => handleScrub(e);
    const onUp = () => setIsScrubbing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isScrubbing, handleScrub]);

  return (
    <section className="panel dashboard-panel">
      <div className="panel-header" style={{ alignItems: 'flex-start' }}>
        {onExit && (
          <button 
            onClick={onExit}
            className="command-button command-button--ghost"
            style={{ padding: '6px', marginRight: '12px', marginTop: '4px' }}
            title="Return to Main Menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </button>
        )}
        <div style={{ flex: 1 }}>
          <p className="panel-kicker">Telemetry</p>
          <h2 className="panel-title">Vitals</h2>
        </div>
        <div className="dashboard-flags">
          <span className={`status-pill ${isPlaying ? 'status-pill--live' : ''}`}>{missionState}</span>
          <span className="status-pill">{isDay ? 'Day cycle' : 'Night cycle'}</span>
        </div>
      </div>

      <div className="dashboard-layout">
        <div className="metric-grid metric-grid--full">
          <div className="metric-card metric-card--battery">
            <div className="metric-topline">
              <span className="metric-label">Battery</span>
              <span className="metric-badge" style={{ color: batteryTone }}>
                {batteryState}
              </span>
            </div>
            <strong className="metric-value" style={{ color: batteryTone }}>
              {battery.toFixed(0)}%
            </strong>
            <div className="battery-rail">
              <div className="battery-fill" style={{ width: `${battery}%`, background: batteryTone }} />
            </div>
          </div>

          <div className="metric-card">
            <span className="metric-label">Clock</span>
            <strong className="metric-value">{simClock}</strong>
            <span className="metric-sub">{elapsedHours} h</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Step</span>
            <strong className="metric-value">{stepNum}</strong>
            <span className="metric-sub">{routeProgress}% route</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Distance</span>
            <strong className="metric-value">{distance}</strong>
            <span className="metric-sub">grid units</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Collected</span>
            <strong className="metric-value">
              {collectedTotal}/{totalMinerals}
            </strong>
            <span className="metric-sub">
              B {mineralsCollected.B} / Y {mineralsCollected.Y} / G {mineralsCollected.G}
            </span>
          </div>
          <div className="metric-card metric-card--status">
            <div className="metric-topline">
              <span className="metric-label">Return</span>
              <span className="metric-badge">{simulationResult?.returned_home ? 'Yes' : simulationResult ? 'No' : 'N/A'}</span>
            </div>
            <strong className="metric-value">{mineralProgress}%</strong>
            <span className="metric-sub">{simulationResult?.termination_reason ?? 'No run loaded.'}</span>
          </div>

          <div className="metric-card metric-card--battery">
            <div className="metric-topline">
              <span className="metric-label">Camera view</span>
            </div>
            <div className="flex gap-2 mt-2">
              <button 
                className={`command-button flex-1 text-[10px] py-1 ${cameraMode === 'follow' ? 'command-button--primary' : 'command-button--ghost'}`}
                onClick={() => onCameraModeChange('follow')}
              >
                Follow
              </button>
              <button 
                className={`command-button flex-1 text-[10px] py-1 ${cameraMode === 'top' ? 'command-button--primary' : 'command-button--ghost'}`}
                onClick={() => onCameraModeChange('top')}
              >
                Top
              </button>
              <button 
                className={`command-button flex-1 text-[10px] py-1 ${cameraMode === 'detached' ? 'command-button--primary' : 'command-button--ghost'}`}
                onClick={() => onCameraModeChange('detached')}
              >
                Detach
              </button>
            </div>
            <span className="metric-sub mt-2 block">
              {cameraMode === 'detached' ? 'WASD to move, Drag to rotate' : 'Auto-tracking mode'}
            </span>
          </div>
        </div>

        {/* Timeline Component */}
        {simulationResult && (
          <div className="mt-5 pt-4 border-t border-[rgba(255,255,255,0.05)]">
            <div className="flex justify-between items-center mb-2">
              <span className="metric-label" style={{ margin: 0 }}>Mission Timeline</span>
              <span className="text-[10px] text-gray-400">Time of Day / Minerals</span>
            </div>
            <div 
              ref={timelineRef}
              className="relative h-4 rounded bg-[#0a0a0a] cursor-pointer overflow-hidden border border-[#262626] transition-colors hover:border-[#404040]"
              onMouseDown={(e) => {
                setIsScrubbing(true);
                handleScrub(e);
              }}
            >
              {timelineMarkers.dayNightBlocks.map((b, i) => (
                <div 
                  key={`bg-${i}`} 
                  className="absolute top-0 bottom-0" 
                  style={{
                    left: `${b.startPct}%`,
                    width: `${b.widthPct}%`,
                    background: b.isDay ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.5)',
                  }} 
                  title={b.isDay ? 'Day Cycle' : 'Night Cycle'}
                />
              ))}

              {timelineMarkers.markers.map((m, i) => (
                <div 
                  key={`m-${i}`} 
                  className="absolute top-0 bottom-0 w-[2px] bg-[var(--signal-ok)] opacity-80" 
                  style={{ left: `${m.pct}%` }} 
                  title="Mineral Sample Collected"
                />
              ))}

              <div 
                className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_8px_white] z-10"
                style={{ 
                  left: `${(currentStep / Math.max(timelineMarkers.total - 1, 1)) * 100}%`,
                  transition: isScrubbing ? 'none' : 'left 0.1s linear'
                }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default Dashboard;
