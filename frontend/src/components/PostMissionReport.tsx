import React, { useMemo } from 'react';
import { SimulationResult } from '../types';

interface PostMissionReportProps {
  simulationResult: SimulationResult;
  currentStep: number;
  onClose: () => void;
}

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const PostMissionReport: React.FC<PostMissionReportProps> = ({ simulationResult, currentStep, onClose }) => {
  const summary = useMemo(() => {
    const logs = simulationResult.logs;
    const safeStep = Math.min(Math.max(currentStep, 0), Math.max(logs.length - 1, 0));
    const currentLogs = logs.slice(0, safeStep + 1);

    const totalMinerals = simulationResult.total_minerals ?? Object.keys(simulationResult.all_minerals ?? {}).length;
    const collected = simulationResult.minerals.filter((m) => m.step <= safeStep).length;

    const distance = currentLogs.length ? currentLogs[currentLogs.length - 1].distance_traveled : 0;
    const avgBattery = currentLogs.length
      ? currentLogs.reduce((acc, log) => acc + log.battery, 0) / currentLogs.length
      : 100;

    const lowestBatteryLog = currentLogs.length
      ? currentLogs.reduce((min, log) => (log.battery < min.battery ? log : min), currentLogs[0])
      : null;

    const quadrantStats = { NW: 0, NE: 0, SW: 0, SE: 0 } as Record<'NW' | 'NE' | 'SW' | 'SE', number>;
    simulationResult.minerals
      .filter((mineral) => mineral.step <= safeStep)
      .forEach((mineral) => {
        const [row, col] = mineral.pos;
        const key = row < 25 ? (col < 25 ? 'NW' : 'NE') : col < 25 ? 'SW' : 'SE';
        quadrantStats[key] += 1;
      });

    const bestQuadrant = (Object.entries(quadrantStats).sort((a, b) => b[1] - a[1])[0] ?? ['N/A', 0]) as [string, number];
    const energyEfficiency = distance > 0 ? (collected / distance) * 100 : 0;

    return {
      safeStep,
      collected,
      totalMinerals,
      distance,
      avgBattery,
      energyEfficiency,
      lowestBatteryLog,
      bestQuadrant,
    };
  }, [simulationResult, currentStep]);

  return (
    <section className="panel post-report">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Mission</p>
          <h2 className="panel-title">Post-Report</h2>
        </div>
        <button className="post-report-close" onClick={onClose} aria-label="Close report">
          ✕
        </button>
      </div>

      <div className="post-report-grid">
        <div className="post-metric">
          <span className="metric-label">Collected</span>
          <strong className="metric-value">
            {summary.collected}/{summary.totalMinerals}
          </strong>
        </div>

        <div className="post-metric">
          <span className="metric-label">Distance</span>
          <strong className="metric-value">{summary.distance.toFixed(1)}</strong>
        </div>

        <div className="post-metric">
          <span className="metric-label">Avg battery</span>
          <strong className="metric-value">{summary.avgBattery.toFixed(1)}%</strong>
        </div>

        <div className="post-metric">
          <span className="metric-label">Efficiency</span>
          <strong className="metric-value">{summary.energyEfficiency.toFixed(2)}</strong>
          <span className="metric-sub">minerals / 100 units</span>
        </div>

        <div className="post-metric post-metric--wide">
          <span className="metric-label">Most profitable sector</span>
          <strong className="metric-value">{summary.bestQuadrant[0]}</strong>
          <span className="metric-sub">{summary.bestQuadrant[1]} collected minerals</span>
        </div>

        <div className="post-metric post-metric--wide">
          <span className="metric-label">Most critical moment</span>
          <strong className="metric-value">
            {summary.lowestBatteryLog ? `${summary.lowestBatteryLog.battery.toFixed(0)}%` : 'N/A'}
          </strong>
          <span className="metric-sub">
            {summary.lowestBatteryLog
              ? `Step ${summary.lowestBatteryLog.step} • ${formatTime(6 + summary.lowestBatteryLog.time_hours)}`
              : 'No telemetry'}
          </span>
        </div>
      </div>
    </section>
  );
};

export default PostMissionReport;
