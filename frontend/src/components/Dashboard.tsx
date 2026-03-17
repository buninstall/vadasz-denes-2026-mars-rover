import React, { useMemo } from 'react';
import { SimulationResult, SimLogEntry } from '../types';

interface DashboardProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
  isPlaying: boolean;
}

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const StatBox = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) => (
  <div
    style={{
      background: 'rgba(3,7,18,0.65)',
      border: '1px solid #374151',
      borderRadius: 6,
      padding: '10px 14px',
      minWidth: 90,
    }}
  >
    <div style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ color: '#f3f4f6', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ color: '#9ca3af', fontSize: 9, marginTop: 3 }}>{sub}</div>}
  </div>
);

const BatteryBar = ({ level }: { level: number }) => {
  return (
    <div
      style={{
        background: 'rgba(3,7,18,0.65)',
        border: '1px solid #374151',
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 120,
      }}
    >
      <div style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
        Akkumulátor
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 8, background: '#111827', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${level}%`,
              background: '#f3f4f6',
              borderRadius: 4,
              transition: 'width 0.35s',
            }}
          />
        </div>
        <span style={{ color: '#f9fafb', fontSize: 14, fontWeight: 700, minWidth: 38 }}>{level.toFixed(0)}%</span>
      </div>
    </div>
  );
};

const Dashboard: React.FC<DashboardProps> = ({ simulationResult, currentStep, isPlaying }) => {
  const log: SimLogEntry | null = useMemo(() => {
    if (!simulationResult?.logs?.length) return null;
    return simulationResult.logs[Math.min(currentStep, simulationResult.logs.length - 1)];
  }, [simulationResult, currentStep]);

  const mineralsCollected = useMemo(() => {
    if (!simulationResult) return { B: 0, Y: 0, G: 0 };
    const acc = { B: 0, Y: 0, G: 0 };
    simulationResult.minerals.forEach(m => {
      if (m.step <= currentStep) acc[m.type as 'B' | 'Y' | 'G']++;
    });
    return acc;
  }, [simulationResult, currentStep]);

  const battery = log?.battery ?? 100;
  const isDay = log?.is_day ?? true;
  const simTime = log ? formatTime(6 + log.time_hours) : '06:00';
  const stepNum = log?.step ?? 0;
  const dist = log?.distance_traveled?.toFixed(1) ?? '0.0';
  const totalMinerals = simulationResult
    ? simulationResult.total_minerals ?? Object.keys(simulationResult.all_minerals ?? {}).length
    : 0;
  const collectedTotal = mineralsCollected.B + mineralsCollected.Y + mineralsCollected.G;
  const stateText = !simulationResult
    ? '—'
    : isPlaying
    ? (log?.action === 'mine' ? 'Bányászat' : 'Mozgás')
    : (simulationResult.success ? 'Kész' : 'Leállt');

  return (
    <div
      style={{
        background: 'rgba(2,6,14,0.68)',
        border: '1px solid #374151',
        borderRadius: 10,
        padding: '12px 16px',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
        fontFamily: 'monospace',
      }}
    >
      {/* Title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isPlaying ? '#f3f4f6' : '#6b7280',
            boxShadow: isPlaying ? '0 0 8px rgba(243,244,246,0.7)' : 'none',
            animation: isPlaying ? 'pulse 1.2s infinite' : 'none',
          }}
        />
        <span style={{ color: '#f3f4f6', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Mars Rover Telemetria
        </span>
        <span
          style={{
            marginLeft: 'auto',
            background: 'rgba(3,7,18,0.8)',
            border: '1px solid #4b5563',
            color: '#d1d5db',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
          }}
        >
          {isDay ? 'Nappal' : 'Éjszaka'}
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <BatteryBar level={battery} />
        <StatBox label="Szimulációs Idő" value={simTime} sub={`Lépés: ${stepNum}`} />
        <StatBox label="Eltelt Idő" value={`${log?.time_hours?.toFixed(1) ?? '0.0'} h`} />
        <StatBox
          label="Ásványok"
          value={`${collectedTotal}/${totalMinerals}`}
          sub={`B:${mineralsCollected.B} Y:${mineralsCollected.Y} G:${mineralsCollected.G}`}
        />
        <StatBox label="Megtett Táv" value={dist} sub="blokk" />
        <StatBox label="Állapot" value={stateText} />
      </div>
    </div>
  );
};

export default Dashboard;
