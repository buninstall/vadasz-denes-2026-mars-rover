import React, { useMemo } from 'react';
import { SimulationResult, SimLogEntry } from '../types';

interface LogViewerProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
}

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getActionLabel = (log: SimLogEntry) => {
  if (log.action === 'mine') return 'Sample';
  if (log.action === 'start') return 'Boot';
  return 'Move';
};

const getActionCopy = (log: SimLogEntry) => {
  if (log.action === 'mine') return `Mineral capture: ${log.minerals_collected.join(', ')}`;
  if (log.action === 'start') return 'Mission clock engaged and path initialized.';
  return 'Position updated along planned traversal route.';
};

const LogViewer: React.FC<LogViewerProps> = ({ simulationResult, currentStep }) => {
  const visibleLogs: SimLogEntry[] = useMemo(() => {
    if (!simulationResult?.logs) return [];
    const end = Math.min(currentStep, simulationResult.logs.length - 1);
    const filtered: SimLogEntry[] = [];

    for (let i = end; i >= 0 && filtered.length < 24; i--) {
      const log = simulationResult.logs[i];
      if (log.action === 'mine' || log.action === 'start' || i % 6 === 0) {
        filtered.push(log);
      }
    }

    return filtered;
  }, [simulationResult, currentStep]);

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Log</p>
          <h2 className="panel-title">Events</h2>
        </div>
        <div className="dashboard-flags">
          <span className={`status-pill ${simulationResult ? 'status-pill--live' : ''}`}>
            {simulationResult ? 'Live' : 'Idle'}
          </span>
          <span className="status-pill">{visibleLogs.length} entries</span>
        </div>
      </div>

      <div className="log-scroll">
        {visibleLogs.length === 0 ? (
          <div className="log-empty">No data yet.</div>
        ) : (
          visibleLogs.map((log, index) => {
            const actionLabel = getActionLabel(log);
            const mineAction = log.action === 'mine';

            return (
              <article key={`${log.step}-${index}`} className={`log-row ${mineAction ? 'log-row--accent' : ''}`}>
                <div className="log-row-main">
                  <div className="log-headline">
                    <span className={`log-tag ${mineAction ? 'log-tag--amber' : 'log-tag--cyan'}`}>{actionLabel}</span>
                    <strong className="log-time">{formatTime(6 + log.time_hours)}</strong>
                    <span className="log-coords">
                      R{log.position[0]} C{log.position[1]}
                    </span>
                  </div>
                  <p className="log-copy">{getActionCopy(log)}</p>
                </div>

                <div className="log-meta">
                  <span>Step {log.step}</span>
                  <span>{log.battery.toFixed(0)}% battery</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};

export default LogViewer;
