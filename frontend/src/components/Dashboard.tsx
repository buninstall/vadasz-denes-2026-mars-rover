import React, { useMemo } from 'react';
import { SimulationResult, SimLogEntry } from '../types';

interface DashboardProps {
  simulationResult: SimulationResult | null;
  currentStep: number;
  isPlaying: boolean;
}

const DAY_STEPS = 32;
const CYCLE = 48;

const formatTime = (hours: number) => {
  const total = Math.floor(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const StatBox = ({
  label,
  value,
  unit,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: string;
  sub?: string;
}) => (
  <div
    style={{
      background: 'rgba(16,6,2,0.88)',
      border: '1px solid #5a2008',
      borderRadius: 6,
      padding: '10px 14px',
      minWidth: 90,
    }}
  >
    <div style={{ color: '#7a3a18', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
      <span style={{ color: accent ?? '#e86030', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</span>
      {unit && <span style={{ color: '#7a3a18', fontSize: 10 }}>{unit}</span>}
    </div>
    {sub && <div style={{ color: '#5a2008', fontSize: 9, marginTop: 3 }}>{sub}</div>}
  </div>
);

const BatteryBar = ({ level }: { level: number }) => {
  const color = level > 50 ? '#22bb44' : level > 20 ? '#e8a020' : '#ff3030';
  return (
    <div
      style={{
        background: 'rgba(16,6,2,0.88)',
        border: '1px solid #5a2008',
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 120,
      }}
    >
      <div style={{ color: '#7a3a18', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
        Akkumulátor
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 8, background: '#200c04', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${level}%`,
              background: `linear-gradient(90deg, ${color}88, ${color})`,
              borderRadius: 4,
              transition: 'width 0.4s, background 0.4s',
            }}
          />
        </div>
        <span style={{ color, fontSize: 14, fontWeight: 700, minWidth: 38 }}>{level.toFixed(0)}%</span>
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
  const totalMinerals = simulationResult?.minerals.length ?? 0;
  const collectedTotal = mineralsCollected.B + mineralsCollected.Y + mineralsCollected.G;

  return (
    <div
      style={{
        background: 'rgba(10,3,1,0.78)',
        border: '1px solid #7a3010',
        borderRadius: 10,
        padding: '12px 16px',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 32px rgba(200,60,10,0.14)',
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
            background: isPlaying ? '#ff7700' : '#5a2008',
            boxShadow: isPlaying ? '0 0 8px #ff7700' : 'none',
            animation: isPlaying ? 'pulse 1.2s infinite' : 'none',
          }}
        />
        <span style={{ color: '#c4501a', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Mars Rover — Telepítési Adatok
        </span>
        <span
          style={{
            marginLeft: 'auto',
            background: isDay ? 'rgba(255,160,40,0.15)' : 'rgba(80,80,180,0.15)',
            border: `1px solid ${isDay ? '#c4801a' : '#4444aa'}`,
            color: isDay ? '#e8a020' : '#8888cc',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
          }}
        >
          {isDay ? '☀ Nappal' : '☽ Éjszaka'}
        </span>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <BatteryBar level={battery} />
        <StatBox label="Szimulációs Idő" value={simTime} sub={`Lépés: ${stepNum}`} />
        <StatBox
          label="Ásványok"
          value={`${collectedTotal}/${totalMinerals}`}
          accent="#e8a020"
          sub={`B:${mineralsCollected.B} Y:${mineralsCollected.Y} G:${mineralsCollected.G}`}
        />
        <StatBox label="Megtett Táv" value={dist} unit="km" accent="#6699ff" />
        <StatBox
          label="Állapot"
          value={
            !simulationResult
              ? '—'
              : isPlaying
              ? log?.action === 'mine'
                ? '⛏ Bányász'
                : '→ Mozog'
              : simulationResult.success
              ? '✓ Siker'
              : '✗ Befejezve'
          }
          accent={
            isPlaying
              ? log?.action === 'mine'
                ? '#ffaa00'
                : '#22bb44'
              : simulationResult?.success
              ? '#22bb44'
              : '#ff4444'
          }
        />
      </div>
    </div>
  );
};

export default Dashboard;
