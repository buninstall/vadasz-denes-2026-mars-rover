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

const LogViewer: React.FC<LogViewerProps> = ({ simulationResult, currentStep }) => {
  const visibleLogs: SimLogEntry[] = useMemo(() => {
    if (!simulationResult?.logs) return [];
    const end = Math.min(currentStep, simulationResult.logs.length - 1);
    // Show recent meaningful entries (mining + regular movement snapshots)
    const filtered: SimLogEntry[] = [];
    for (let i = end; i >= 0 && filtered.length < 24; i--) {
      const l = simulationResult.logs[i];
      if (l.action === 'mine' || l.action === 'start' || i % 6 === 0) {
        filtered.push(l);
      }
    }
    return filtered;
  }, [simulationResult, currentStep]);

  return (
    <div
      style={{
        background: 'rgba(2,6,14,0.68)',
        border: '1px solid #374151',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '7px 12px',
          borderBottom: '1px solid #374151',
          background: 'rgba(3,7,18,0.85)',
        }}
      >
        <span style={{ color: '#f3f4f6', fontWeight: 700, letterSpacing: '0.15em', fontSize: 9, textTransform: 'uppercase' }}>
          Eseménynapló
        </span>
        {simulationResult && (
          <span style={{ color: '#9ca3af', fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f3f4f6', display: 'inline-block' }} />
            LIVE
          </span>
        )}
      </div>

      {/* Log entries */}
      <div style={{ height: 200, overflowY: 'auto', padding: '6px 0' }}>
        {visibleLogs.length === 0 ? (
          <div style={{ color: '#6b7280', padding: '8px 12px', fontStyle: 'italic' }}>
            Nincs telemetriai adat…
          </div>
        ) : (
          visibleLogs.map((log, i) => {
            const isMine = log.action === 'mine';
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '3px 12px',
                  background: isMine ? 'rgba(243,244,246,0.06)' : 'transparent',
                  borderLeft: isMine ? '2px solid #e5e7eb' : '2px solid transparent',
                }}
              >
                <span style={{ color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  [{formatTime(6 + log.time_hours)}]
                </span>
                <span style={{ color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                  {log.position[0]},{log.position[1]}
                </span>
                <span style={{ color: '#f3f4f6', flex: 1 }}>
                  {log.action === 'mine'
                    ? `Bányászat: ${log.minerals_collected.join(', ')}`
                    : log.action === 'start'
                    ? 'Misszió indítva'
                    : 'Mozgás'}
                </span>
                <span
                  style={{
                    color: '#e5e7eb',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {log.battery.toFixed(0)}%
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LogViewer;
