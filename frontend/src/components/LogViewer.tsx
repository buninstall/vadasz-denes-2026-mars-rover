import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SimulationResult, SimLogEntry } from '../types';

interface LogViewerProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
  onJumpToStep?: (step: number) => void;
}

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

type LogFilter = 'all' | 'events' | 'samples';

interface TimelineEntry {
  log: SimLogEntry;
  previous: SimLogEntry | null;
  isAlert: boolean;
  isTransition: boolean;
}

const getActionLabel = (entry: TimelineEntry) => {
  const { log, previous, isAlert } = entry;
  if (log.action === 'mine') return 'Sample';
  if (log.action === 'start') return 'Boot';
  if (previous && previous.is_day !== log.is_day) return log.is_day ? 'Sunrise' : 'Nightfall';
  if (isAlert) return 'Alert';
  return 'Move';
};

const getActionCopy = (entry: TimelineEntry) => {
  const { log, previous, isAlert, isTransition } = entry;
  if (log.action === 'mine') {
    return `Sampling: ${log.minerals_collected.join(', ')} • speed ${log.speed.toFixed(1)}x`;
  }
  if (log.action === 'start') {
    return 'Mission started, route and telemetry active.';
  }
  if (isTransition) {
    return log.is_day ? 'Day cycle activated, charging stable.' : 'Night cycle, energy discipline required.';
  }
  const batteryDelta = previous ? log.battery - previous.battery : 0;
  const batteryTrend = batteryDelta > 0.01 ? `+${batteryDelta.toFixed(1)}%` : `${batteryDelta.toFixed(1)}%`;
  const distanceDelta = previous ? Math.max(0, log.distance_traveled - previous.distance_traveled) : 0;

  if (isAlert) {
    return `Critical energy zone • battery ${log.battery.toFixed(0)}% • dist +${distanceDelta.toFixed(1)}`;
  }

  return `Movement updated • energy ${batteryTrend} • dist +${distanceDelta.toFixed(1)}`;
};

const LogViewer: React.FC<LogViewerProps> = ({ simulationResult, currentStep, onJumpToStep }) => {
  const [filter, setFilter] = useState<LogFilter>('events');
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleLogs: TimelineEntry[] = useMemo(() => {
    if (!simulationResult?.logs?.length) return [];
    const end = Math.min(currentStep, simulationResult.logs.length - 1);
    const logs = simulationResult.logs.slice(0, end + 1);
    const filtered: TimelineEntry[] = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const previous = i > 0 ? logs[i - 1] : null;
      const isTransition = !!previous && previous.is_day !== log.is_day;
      const isAlert = log.battery <= 26;

      const isEvent = log.action === 'start' || log.action === 'mine' || isTransition || isAlert;
      const shouldKeep =
        filter === 'samples'
          ? log.action === 'mine'
          : filter === 'events'
            ? isEvent
            : isEvent || log.step % 3 === 0;

      if (shouldKeep) {
        filtered.push({ log, previous, isAlert, isTransition });
      }
    }

    return filtered.slice(-48);
  }, [simulationResult, currentStep, filter]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleLogs.length, currentStep]);

  return (
    <section className="panel log-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Log</p>
          <h2 className="panel-title">Timeline</h2>
        </div>
        <div className="dashboard-flags">
          <span className={`status-pill ${simulationResult ? 'status-pill--live' : ''}`}>
            {simulationResult ? 'Live' : 'Idle'}
          </span>
          <span className="status-pill">{visibleLogs.length} entries</span>
        </div>
      </div>

      <div className="log-toolbar">
        <button
          type="button"
          className={`log-filter ${filter === 'events' ? 'log-filter--active' : ''}`}
          onClick={() => setFilter('events')}
        >
          Events
        </button>
        <button
          type="button"
          className={`log-filter ${filter === 'all' ? 'log-filter--active' : ''}`}
          onClick={() => setFilter('all')}
        >
          Stream
        </button>
        <button
          type="button"
          className={`log-filter ${filter === 'samples' ? 'log-filter--active' : ''}`}
          onClick={() => setFilter('samples')}
        >
          Samples
        </button>
      </div>

      <div className="log-scroll" ref={scrollRef}>
        {visibleLogs.length === 0 ? (
          <div className="log-empty">No data yet.</div>
        ) : (
          visibleLogs.map((entry, index) => {
            const { log, isAlert, isTransition } = entry;
            const actionLabel = getActionLabel(entry);
            const mineAction = log.action === 'mine';
            const isCurrent = Math.abs(log.step - currentStep) <= 1;

            return (
              <article
                key={`${log.step}-${index}`}
                className={`log-row ${mineAction ? 'log-row--accent' : ''} ${isAlert ? 'log-row--warn' : ''} ${isCurrent ? 'log-row--active' : ''}`}
              >
                <div className="log-row-main">
                  <div className="log-headline">
                    <span className={`log-tag ${mineAction ? 'log-tag--amber' : isAlert ? 'log-tag--warn' : 'log-tag--cyan'}`}>
                      {actionLabel}
                    </span>
                    <strong className="log-time">{formatTime(6 + log.time_hours)}</strong>
                    <span className="log-coords">{log.is_day ? 'Day' : 'Night'}</span>
                    <span className="log-coords">
                      R{log.position[0]} C{log.position[1]}
                    </span>
                    {isTransition && <span className="log-transition">cycle switch</span>}
                  </div>
                  <p className="log-copy">{getActionCopy(entry)}</p>
                </div>

                <div className="log-meta">
                  <span>Step {log.step}</span>
                  <span>{log.battery.toFixed(0)}% battery</span>
                  <span>{log.speed.toFixed(1)}x speed</span>
                  {onJumpToStep && (
                    <button type="button" className="log-jump-btn" onClick={() => onJumpToStep(log.step)}>
                      Jump
                    </button>
                  )}
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
