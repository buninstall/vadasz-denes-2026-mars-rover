import React, { useRef, useEffect, useMemo } from 'react';
import { MapData, SimulationResult } from '../types';

interface MinimapProps {
  map: MapData;
  simulationResult: SimulationResult | null;
  currentStep: number;
}

const CELL = 3; // px per grid cell
const W = 50 * CELL;
const H = 50 * CELL;

const CELL_COLORS: Record<string, string> = {
  '#': '#59606c',
  B: '#4f6ea0',
  Y: '#99865f',
  G: '#5f8a69',
  S: '#f3f4f6',
  '.': '#111827',
};

const Minimap: React.FC<MinimapProps> = ({ map, simulationResult, currentStep }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Pre-render the static map layer once (obstacles + terrain + minerals initial state)
  const staticCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);
    map.grid.forEach((row, y) =>
      row.forEach((cell, x) => {
        ctx.fillStyle = CELL_COLORS[cell] ?? '#1a0a04';
        ctx.globalAlpha = cell === '.' ? 0.25 : 0.85;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      })
    );
    ctx.globalAlpha = 1;
    return c;
  }, [map]);

  // Full planned path (precomputed from simulationResult)
  const plannedPath = useMemo(() => {
    if (!simulationResult) return null;
    return simulationResult.path; // [row, col][]
  }, [simulationResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Draw static layer
    ctx.drawImage(staticCanvas, 0, 0);

    if (plannedPath && plannedPath.length > 1) {
      // Draw full planned path (dim orange line)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(203,213,225,0.2)';
      ctx.lineWidth = 1;
      plannedPath.forEach(([row, col], i) => {
        const px = col * CELL + CELL / 2;
        const py = row * CELL + CELL / 2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Draw traversed path up to currentStep (bright orange)
      const traversed = plannedPath.slice(0, Math.min(currentStep + 1, plannedPath.length));
      if (traversed.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(243,244,246,0.85)';
        ctx.lineWidth = 1.5;
        traversed.forEach(([row, col], i) => {
          const px = col * CELL + CELL / 2;
          const py = row * CELL + CELL / 2;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    }

    // Draw minerals that haven't been collected yet
    if (simulationResult) {
      const collectedKeys = new Set(
        simulationResult.minerals
          .filter(m => m.step <= currentStep)
          .map(m => `${m.pos[0]}_${m.pos[1]}`)
      );
      map.grid.forEach((row, y) =>
        row.forEach((cell, x) => {
          if ((cell === 'B' || cell === 'Y' || cell === 'G') && !collectedKeys.has(`${y}_${x}`)) {
            ctx.fillStyle = CELL_COLORS[cell];
            ctx.beginPath();
            ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        })
      );
    }

    // Draw rover
    if (plannedPath && plannedPath.length > 0) {
      const idx = Math.min(currentStep, plannedPath.length - 1);
      const [rRow, rCol] = plannedPath[idx];
      const rx = rCol * CELL + CELL / 2;
      const ry = rRow * CELL + CELL / 2;

      // Outer glow
      ctx.beginPath();
      ctx.arc(rx, ry, CELL + 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(243,244,246,0.35)';
      ctx.fill();

      // Rover dot
      ctx.beginPath();
      ctx.arc(rx, ry, CELL - 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f3f4f6';
      ctx.fill();
    } else {
      // Show start position from map
      for (let y = 0; y < map.grid.length; y++) {
        for (let x = 0; x < map.grid[y].length; x++) {
          if (map.grid[y][x] === 'S') {
            ctx.beginPath();
            ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL - 0.5, 0, Math.PI * 2);
            ctx.fillStyle = '#f3f4f6';
            ctx.fill();
          }
        }
      }
    }
  }, [staticCanvas, plannedPath, currentStep, simulationResult, map]);

  const collectedCount = useMemo(() => {
    if (!simulationResult) return 0;
    return simulationResult.minerals.filter(m => m.step <= currentStep).length;
  }, [simulationResult, currentStep]);

  const totalMinerals = simulationResult
    ? simulationResult.total_minerals ?? Object.keys(simulationResult.all_minerals ?? {}).length
    : 0;
  const progressPct = simulationResult ? Math.round((Math.min(currentStep, simulationResult.path.length - 1) / Math.max(simulationResult.path.length - 1, 1)) * 100) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 select-none" style={{ fontFamily: 'monospace' }}>
      <div
        style={{
          background: 'rgba(2,6,14,0.75)',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: '8px 10px 10px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: '#f3f4f6', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Térkép
          </span>
          <span style={{ color: '#9ca3af', fontSize: 9 }}>
            {simulationResult ? `${collectedCount}/${totalMinerals} ásvány` : 'Nincs szimuláció'}
          </span>
        </div>

        {/* Map canvas */}
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: 'block', borderRadius: 4, border: '1px solid #374151' }}
        />

        {/* Progress bar */}
        {simulationResult && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#9ca3af', fontSize: 9 }}>Haladás</span>
              <span style={{ color: '#f3f4f6', fontSize: 9 }}>{progressPct}%</span>
            </div>
            <div style={{ background: '#111827', borderRadius: 2, height: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: '#f3f4f6',
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, marginTop: 7 }}>
          {[['#f3f4f6', 'Rover'], ['#cbd5e1', 'Útvonal'], ['#4f6ea0', 'B'], ['#99865f', 'Y'], ['#5f8a69', 'G']].map(
            ([color, label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                <span style={{ color: '#9ca3af', fontSize: 8 }}>{label}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default Minimap;
