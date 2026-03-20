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
  onEnterPhotoMode: () => void;
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
  onJumpToStep,
  onEnterPhotoMode
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
  const batteryState = battery > 65 ? 'Normal' : battery > 35 ? 'Danger' : 'Critical';
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

    const logs = simulationResult.logs;
    const total = logs.length;
    if (total === 0) return { dayNightBlocks: [], markers: [], total: 0 };

    const markers = [];
    const dayNightBlocks = [];
    let currentDayState = logs[0]?.is_day ?? true;
    let stateStartIdx = 0;

    for (let i = 0; i < total; i++) {
      const entry = logs[i];

      if (entry?.action === 'mine') {
        markers.push({
          type: 'mine',
          pct: (i / total) * 100,
          step: i,
        });
      }

      if (i === 0) continue;

      const isDay = entry?.is_day ?? true;
      if (isDay !== currentDayState) {
        dayNightBlocks.push({
          isDay: currentDayState,
          startPct: (stateStartIdx / total) * 100,
          widthPct: ((i - stateStartIdx) / total) * 100,
        });
        currentDayState = isDay;
        stateStartIdx = i;
      }
    }

    dayNightBlocks.push({
      isDay: currentDayState,
      startPct: (stateStartIdx / total) * 100,
      widthPct: ((total - stateStartIdx) / total) * 100,
    });

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

  const [showVitals, setShowVitals] = React.useState(true);
  const [showCamera, setShowCamera] = React.useState(true);
  const [showTimeline, setShowTimeline] = React.useState(true);

  const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         className={`text-gray-500 transition-transform duration-200 ${expanded ? 'rotate-180' : 'rotate-0'}`}>
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );

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

      <div className="dashboard-layout pb-2">
        {/* Vitals Section */}
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[10px] uppercase text-gray-400 font-bold tracking-wider m-0">Telemetry & Vitals</h3>
          <button onClick={() => setShowVitals(!showVitals)} className="cursor-pointer hover:opacity-80 p-1 bg-transparent border-none">
            <ChevronIcon expanded={showVitals} />
          </button>
        </div>
        
        {showVitals && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="metric-card !p-2 col-span-2">
              <div className="flex justify-between items-center mb-1">
                <span className="metric-label !m-0 !text-[9px]">Battery</span>
                <span className="text-[10px] font-bold" style={{ color: batteryTone }}>
                  {batteryState} • {battery.toFixed(0)}%
                </span>
              </div>
              <div className="battery-rail !mt-1 !h-1.5">
                <div className="battery-fill" style={{ width: `${battery}%`, background: batteryTone }} />
              </div>
            </div>

            <div className="metric-card !p-2 flex flex-col justify-center">
              <span className="metric-label !m-0 !text-[9px]">Clock</span>
              <strong className="metric-value !text-sm leading-tight">{simClock}</strong>
              <span className="metric-sub !m-0 !text-[9px]">{elapsedHours} h</span>
            </div>
            
            <div className="metric-card !p-2 flex flex-col justify-center">
              <span className="metric-label !m-0 !text-[9px]">Step</span>
              <strong className="metric-value !text-sm leading-tight">{stepNum}</strong>
              <span className="metric-sub !m-0 !text-[9px]">{routeProgress}% route</span>
            </div>
            
            <div className="metric-card !p-2 flex flex-col justify-center">
              <span className="metric-label !m-0 !text-[9px]">Distance</span>
              <strong className="metric-value !text-sm leading-tight">{distance}</strong>
              <span className="metric-sub !m-0 !text-[9px]">grid units</span>
            </div>
            
            <div className="metric-card !p-2 flex flex-col justify-center">
              <span className="metric-label !m-0 !text-[9px]">Collected</span>
              <strong className="metric-value !text-sm leading-tight">
                {collectedTotal}/{totalMinerals}
              </strong>
              <span className="metric-sub !m-0 !text-[9px] tracking-tighter">
                B {mineralsCollected.B} Y {mineralsCollected.Y} G {mineralsCollected.G}
              </span>
            </div>
            
            <div className="metric-card !p-2 col-span-2 flex justify-between items-center">
              <div>
                <span className="metric-label !m-0 !text-[9px]">Return</span>
                <div className="flex items-center gap-2">
                  <strong className="metric-value !text-sm leading-tight">{mineralProgress}%</strong>
                  <span className="metric-sub !m-0 !text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white">
                    {simulationResult?.returned_home ? 'Yes' : simulationResult ? 'No' : 'N/A'}
                  </span>
                </div>
              </div>
              <span className="metric-sub !m-0 !text-[9px] text-right max-w-[50%] truncate break-words">
                {simulationResult?.termination_reason ?? 'No run loaded.'}
              </span>
            </div>
          </div>
        )}

        {/* Camera Section */}
        <div className={`flex justify-between items-center mb-2 ${showVitals ? 'border-t border-[rgba(255,255,255,0.05)] pt-3 mt-1' : ''}`}>
          <h3 className="text-[10px] uppercase text-gray-400 font-bold tracking-wider m-0">Camera & Display</h3>
          <button onClick={() => setShowCamera(!showCamera)} className="cursor-pointer hover:opacity-80 p-1 bg-transparent border-none">
            <ChevronIcon expanded={showCamera} />
          </button>
        </div>
        
        {showCamera && (
          <div className="metric-card metric-card--battery mb-3">
            <div className="flex gap-2">
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
            <div className="flex justify-between items-center mt-2">
              <span className="metric-sub">
                {cameraMode === 'detached' ? 'WASD to move, Drag to rotate' : 'Auto-tracking mode'}
              </span>
              <button 
                className="command-button command-button--ghost text-[10px] py-1 px-3 border border-gray-700/50 hover:border-gray-500"
                onClick={onEnterPhotoMode}
              >
                Photo Mode
              </button>
            </div>
          </div>
        )}

        {/* Timeline Component */}
        {simulationResult && (
          <div className={`${(showVitals || showCamera) ? 'border-t border-[rgba(255,255,255,0.05)] pt-3 mt-1' : ''}`}>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase text-gray-400 font-bold tracking-wider m-0">Mission Timeline</span>
                <span className="text-[10px] text-gray-500">Time of Day / Minerals</span>
              </div>
              <button 
                onClick={() => setShowTimeline(!showTimeline)} 
                className="cursor-pointer hover:opacity-80 p-1 bg-transparent border-none"
              >
                <ChevronIcon expanded={showTimeline} />
              </button>
            </div>
            
            {showTimeline && (
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
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default Dashboard;
