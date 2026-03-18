import React, { useEffect, useMemo, useRef } from 'react';
import { MapData, SimulationResult } from '../types';

interface MinimapProps {
  map: MapData;
  simulationResult: SimulationResult | null;
  currentStep: number;
}

const CELL = 3;
const W = 50 * CELL;
const H = 50 * CELL;

const CELL_COLORS: Record<string, string> = {
  '#': '#59606c',
  B: '#5b8fe7',
  Y: '#d7a64a',
  G: '#5cb086',
  S: '#e8f6ff',
  '.': '#121b22',
};

const Minimap: React.FC<MinimapProps> = ({ map, simulationResult, currentStep }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const staticCanvas = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#081018';
    ctx.fillRect(0, 0, W, H);

    map.grid.forEach((row, y) =>
      row.forEach((cell, x) => {
        ctx.fillStyle = CELL_COLORS[cell] ?? '#240f0a';
        ctx.globalAlpha = cell === '.' ? 0.28 : 0.9;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }),
    );

    ctx.globalAlpha = 1;
    return canvas;
  }, [map]);

  const plannedPath = useMemo(() => simulationResult?.path ?? null, [simulationResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(staticCanvas, 0, 0);

    if (plannedPath && plannedPath.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(117, 231, 255, 0.22)';
      ctx.lineWidth = 1;
      plannedPath.forEach(([row, col], index) => {
        const px = col * CELL + CELL / 2;
        const py = row * CELL + CELL / 2;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      const traversed = plannedPath.slice(0, Math.min(currentStep + 1, plannedPath.length));
      if (traversed.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(247, 171, 74, 0.92)';
        ctx.lineWidth = 1.5;
        traversed.forEach(([row, col], index) => {
          const px = col * CELL + CELL / 2;
          const py = row * CELL + CELL / 2;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    }

    if (simulationResult) {
      const collectedKeys = new Set(
        simulationResult.minerals.filter((mineral) => mineral.step <= currentStep).map((mineral) => `${mineral.pos[0]}_${mineral.pos[1]}`),
      );

      map.grid.forEach((row, y) =>
        row.forEach((cell, x) => {
          if ((cell === 'B' || cell === 'Y' || cell === 'G') && !collectedKeys.has(`${y}_${x}`)) {
            ctx.fillStyle = CELL_COLORS[cell];
            ctx.beginPath();
            ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }),
      );
    }

    if (plannedPath && plannedPath.length > 0) {
      const index = Math.min(currentStep, plannedPath.length - 1);
      const [row, col] = plannedPath[index];
      const rx = col * CELL + CELL / 2;
      const ry = row * CELL + CELL / 2;

      ctx.beginPath();
      ctx.arc(rx, ry, CELL + 1.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(117, 231, 255, 0.3)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(rx, ry, CELL - 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ecfbff';
      ctx.fill();
    } else {
      for (let y = 0; y < map.grid.length; y++) {
        for (let x = 0; x < map.grid[y].length; x++) {
          if (map.grid[y][x] === 'S') {
            ctx.beginPath();
            ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL - 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#ecfbff';
            ctx.fill();
          }
        }
      }
    }
  }, [staticCanvas, plannedPath, currentStep, simulationResult, map]);

  const collectedCount = useMemo(() => {
    if (!simulationResult) return 0;
    return simulationResult.minerals.filter((mineral) => mineral.step <= currentStep).length;
  }, [simulationResult, currentStep]);

  const totalMinerals = simulationResult
    ? simulationResult.total_minerals ?? Object.keys(simulationResult.all_minerals ?? {}).length
    : 0;
  const progressPct = simulationResult
    ? Math.round(
        (Math.min(currentStep, simulationResult.path.length - 1) / Math.max(simulationResult.path.length - 1, 1)) * 100,
      )
    : 0;
  const currentPosition = plannedPath?.length
    ? plannedPath[Math.min(currentStep, plannedPath.length - 1)]
    : map.grid.flatMap((row, rowIndex) =>
        row.map((cell, colIndex) => (cell === 'S' ? ([rowIndex, colIndex] as [number, number]) : null)),
      ).find(Boolean) ?? [0, 0];

  return (
    <div className="minimap-shell">
      <section className="panel minimap-panel">
        <div className="panel-header minimap-header">
          <div>
            <p className="panel-kicker">Map</p>
            <h2 className="panel-title">Overview</h2>
          </div>
          <div className="minimap-summary">
            <span className="minimap-summary-item">
              R{currentPosition[0]} C{currentPosition[1]}
            </span>
            <span className="minimap-summary-item">
              {simulationResult ? `${collectedCount}/${totalMinerals}` : 'Idle'}
            </span>
          </div>
        </div>

        <div className="minimap-frame">
          <canvas ref={canvasRef} width={W} height={H} className="minimap-canvas" />
        </div>

        <div className="minimap-footer">
          {simulationResult && (
            <div className="minimap-progress-row">
              <span className="field-label">Progress</span>
              <span className="field-note">{progressPct}%</span>
            </div>
          )}
          {simulationResult && (
            <div className="mini-progress minimap-progress">
              <div className="mini-progress-fill mini-progress-fill--cyan" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          <div className="legend-row legend-row--compact">
          {[
            ['legend-swatch legend-swatch--rover', 'Rover'],
            ['legend-swatch legend-swatch--path', 'Path'],
            ['legend-swatch legend-swatch--blue', 'B'],
            ['legend-swatch legend-swatch--amber', 'Y'],
            ['legend-swatch legend-swatch--green', 'G'],
          ].map(([className, label]) => (
            <div key={label} className="legend-item">
              <span className={className} />
              <span>{label}</span>
            </div>
          ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Minimap;
