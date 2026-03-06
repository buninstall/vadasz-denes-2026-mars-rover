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
    // Show last ~20 interesting entries (mines + every 10th step)
    const filtered: SimLogEntry[] = [];
    for (let i = end; i >= 0 && filtered.length < 20; i--) {
      const l = simulationResult.logs[i];
      if (l.action === 'mine' || l.action === 'start' || i % 10 === 0) {
        filtered.push(l);
      }
    }
    return filtered;
  }, [simulationResult, currentStep]);

  return (
    <div
      style={{
        background: 'rgba(10,3,1,0.85)',
        border: '1px solid #5a2008',
        borderRadius: 8,
        overflow: 'hidden',
        fontFamily: 'monospace',
        fontSize: 11,
        boxShadow: '0 4px 24px rgba(200,60,10,0.12)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '7px 12px',
          borderBottom: '1px solid #3a1206',
          background: 'rgba(20,8,2,0.9)',
        }}
      >
        <span style={{ color: '#c4501a', fontWeight: 700, letterSpacing: '0.15em', fontSize: 9, textTransform: 'uppercase' }}>
          Eseménynapló
        </span>
        {simulationResult && (
          <span style={{ color: '#7a3010', fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff7700', display: 'inline-block' }} />
            LIVE
          </span>
        )}
      </div>

      {/* Log entries */}
      <div style={{ height: 200, overflowY: 'auto', padding: '6px 0' }}>
        {visibleLogs.length === 0 ? (
          <div style={{ color: '#3a1206', padding: '8px 12px', fontStyle: 'italic' }}>
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
                  background: isMine ? 'rgba(255,150,20,0.07)' : 'transparent',
                  borderLeft: isMine ? '2px solid #ff8800' : '2px solid transparent',
                }}
              >
                <span style={{ color: '#5a2808', whiteSpace: 'nowrap' }}>
                  [{formatTime(6 + log.time_hours)}]
                </span>
                <span style={{ color: '#444466', whiteSpace: 'nowrap' }}>
                  {log.position[0]},{log.position[1]}
                </span>
                <span style={{ color: isMine ? '#ffaa00' : '#7a5030', flex: 1 }}>
                  {log.action === 'mine'
                    ? `⛏ Bányászat: ${log.minerals_collected.join(', ')}`
                    : log.action === 'start'
                    ? '▶ Misszió indítva'
                    : '→ Mozgás'}
                </span>
                <span
                  style={{
                    color: log.battery < 20 ? '#ff4444' : log.battery < 50 ? '#e8a020' : '#22bb44',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ⚡{log.battery.toFixed(0)}%
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
