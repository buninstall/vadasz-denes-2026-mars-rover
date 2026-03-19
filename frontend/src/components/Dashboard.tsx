import React, { useMemo } from 'react';
import { SimulationResult, SimLogEntry, CameraMode } from '../types';

interface DashboardProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
  isPlaying: boolean;
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
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
  onCameraModeChange
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

  return (
    <section className="panel dashboard-panel">
      <div className="panel-header">
        <div>
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
      </div>
    </section>
  );
};

export default Dashboard;
