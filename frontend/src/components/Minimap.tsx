import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComparisonRun, MapData, SimulationResult } from '../types';

interface MinimapProps {
  map: MapData;
  simulationResult: SimulationResult | null;
  currentStep: number;
  comparisonRuns?: ComparisonRun[];
  showEnergyHeatmap?: boolean;
  startOverride?: [number, number] | null;
  canEditStart?: boolean;
  onStartOverrideChange?: (start: [number, number] | null) => void;
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

const Minimap: React.FC<MinimapProps> = ({
  map,
  simulationResult,
  currentStep,
  comparisonRuns = [],
  showEnergyHeatmap = false,
  startOverride = null,
  canEditStart = false,
  onStartOverrideChange,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manualX, setManualX] = useState('');
  const [manualY, setManualY] = useState('');
  const [startInputError, setStartInputError] = useState<string | null>(null);

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
  const rowCount = map.grid.length;
  const colCount = map.grid[0]?.length ?? 0;

  const startCell = useMemo<[number, number]>(
    () => simulationResult?.start ?? startOverride ?? map.start,
    [simulationResult, startOverride, map.start],
  );

  useEffect(() => {
    setManualX(String(startCell[1]));
    setManualY(String(startCell[0]));
    setStartInputError(null);
  }, [startCell]);

  const parseCoordinate = useCallback((value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) return null;
    return parsed;
  }, []);

  const applyStartCell = useCallback((row: number, col: number): boolean => {
    if (!canEditStart || !onStartOverrideChange || simulationResult) return false;

    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      setStartInputError('X and Y must be whole numbers.');
      return false;
    }

    if (rowCount === 0 || colCount === 0) {
      setStartInputError('Map data is unavailable.');
      return false;
    }

    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) {
      setStartInputError(`Coordinates out of bounds: x 0-${Math.max(colCount - 1, 0)}, y 0-${Math.max(rowCount - 1, 0)}.`);
      return false;
    }

    if (map.grid[row]?.[col] === '#') {
      setStartInputError('Cannot place start on obstacle (#).');
      return false;
    }

    onStartOverrideChange([row, col]);
    setManualX(String(col));
    setManualY(String(row));
    setStartInputError(null);
    return true;
  }, [canEditStart, onStartOverrideChange, simulationResult, rowCount, colCount, map]);

  const handleApplyManualStart = useCallback(() => {
    const x = parseCoordinate(manualX);
    const y = parseCoordinate(manualY);

    if (x === null || y === null) {
      setStartInputError('X and Y must be whole numbers.');
      return;
    }

    applyStartCell(y, x);
  }, [parseCoordinate, manualX, manualY, applyStartCell]);

  const handleResetManualStart = useCallback(() => {
    if (!canEditStart || !onStartOverrideChange || simulationResult) return;

    onStartOverrideChange(null);
    setManualX(String(map.start[1]));
    setManualY(String(map.start[0]));
    setStartInputError(null);
  }, [canEditStart, onStartOverrideChange, simulationResult, map.start]);

  const handleCoordinateKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleApplyManualStart();
      }
    },
    [handleApplyManualStart],
  );

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEditStart || !onStartOverrideChange || simulationResult) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pixelX = (event.clientX - rect.left) * scaleX;
    const pixelY = (event.clientY - rect.top) * scaleY;

    if (rowCount === 0 || colCount === 0) return;

    const col = Math.max(0, Math.min(colCount - 1, Math.floor(pixelX / CELL)));
    const row = Math.max(0, Math.min(rowCount - 1, Math.floor(pixelY / CELL)));

    applyStartCell(row, col);
  }, [canEditStart, onStartOverrideChange, simulationResult, rowCount, colCount, applyStartCell]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(staticCanvas, 0, 0);

    if (showEnergyHeatmap) {
      const [startRow, startCol] = startCell;
      const maxDist = Math.sqrt(map.grid.length * map.grid.length + (map.grid[0]?.length ?? map.grid.length) ** 2) / 2;

      for (let y = 0; y < map.grid.length; y++) {
        for (let x = 0; x < map.grid[y].length; x++) {
          if (map.grid[y][x] === '#') continue;

          const dRow = y - startRow;
          const dCol = x - startCol;
          const distanceRisk = Math.min(Math.sqrt(dRow * dRow + dCol * dCol) / Math.max(maxDist, 1), 1);

          let obstaclePenalty = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              if (oy === 0 && ox === 0) continue;
              const ny = y + oy;
              const nx = x + ox;
              if (ny < 0 || nx < 0 || ny >= map.grid.length || nx >= map.grid[0].length) continue;
              if (map.grid[ny][nx] === '#') obstaclePenalty += 0.04;
            }
          }

          const risk = Math.min(distanceRisk + obstaclePenalty, 1);
          const red = Math.round(255 * risk);
          const green = Math.round(200 * (1 - risk));
          ctx.fillStyle = `rgba(${red}, ${green}, 75, 0.26)`;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }

    if (comparisonRuns.length) {
      const ghostPalette = [
        'rgba(180, 180, 255, 0.28)',
        'rgba(140, 230, 255, 0.24)',
        'rgba(214, 178, 255, 0.24)',
      ];

      comparisonRuns
        .filter((run) => run.path.length > 1)
        .slice(0, 3)
        .forEach((run, index) => {
          ctx.beginPath();
          ctx.strokeStyle = ghostPalette[index % ghostPalette.length];
          ctx.lineWidth = 1;

          run.path.forEach(([row, col], pointIndex) => {
            const px = col * CELL + CELL / 2;
            const py = row * CELL + CELL / 2;
            if (pointIndex === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });

          ctx.stroke();
        });
    }

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
        for (let i = 1; i < traversed.length; i++) {
          const [prevRow, prevCol] = traversed[i - 1];
          const [row, col] = traversed[i];
          const speed = simulationResult?.logs?.[Math.min(i, simulationResult.logs.length - 1)]?.speed ?? 1;

          const segmentColor = speed >= 2.5
            ? 'rgba(110, 232, 130, 0.92)'
            : speed >= 1.5
              ? 'rgba(247, 171, 74, 0.92)'
              : 'rgba(117, 231, 255, 0.92)';

          ctx.beginPath();
          ctx.strokeStyle = segmentColor;
          ctx.lineWidth = 1.5;
          ctx.moveTo(prevCol * CELL + CELL / 2, prevRow * CELL + CELL / 2);
          ctx.lineTo(col * CELL + CELL / 2, row * CELL + CELL / 2);
          ctx.stroke();
        }
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
      const [row, col] = startCell;
      ctx.beginPath();
      ctx.arc(col * CELL + CELL / 2, row * CELL + CELL / 2, CELL - 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ecfbff';
      ctx.fill();
    }
  }, [
    staticCanvas,
    plannedPath,
    currentStep,
    simulationResult,
    map,
    comparisonRuns,
    showEnergyHeatmap,
    startCell,
  ]);

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
    : startCell;

  return (
    <div className="minimap-shell">
      <section className={`panel minimap-panel ${isCollapsed ? 'pb-2' : ''}`}>
        <div className="panel-header minimap-header">
          <div className="flex items-center gap-2">
            <div>
              <p className="panel-kicker">Map</p>
              <h2 className="panel-title m-0">Overview</h2>
            </div>
            <button onClick={() => setIsCollapsed(!isCollapsed)} className="cursor-pointer hover:opacity-80 p-1 bg-transparent border-none mt-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   className={`text-gray-500 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <>
            <div className="minimap-frame">
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                className="minimap-canvas"
                onPointerDown={handleCanvasPointerDown}
                style={{ cursor: canEditStart && !simulationResult ? 'crosshair' : 'default' }}
              />
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

          {canEditStart && !simulationResult && (
            <div className="minimap-start-editor">
              <div className="minimap-progress-row">
                <span className="field-label">Start point</span>
                <span className="field-note">{startOverride ? 'Custom override' : 'Map default'}</span>
              </div>

              <div className="minimap-start-grid">
                <label className="field-stack field-stack--tight" htmlFor="start-input-x">
                  <span className="control-mini-label">X</span>
                  <input
                    id="start-input-x"
                    type="number"
                    min={0}
                    max={Math.max(colCount - 1, 0)}
                    step={1}
                    className="control-input"
                    value={manualX}
                    onChange={(event) => {
                      setManualX(event.target.value);
                      setStartInputError(null);
                    }}
                    onKeyDown={handleCoordinateKeyDown}
                  />
                </label>

                <label className="field-stack field-stack--tight" htmlFor="start-input-y">
                  <span className="control-mini-label">Y</span>
                  <input
                    id="start-input-y"
                    type="number"
                    min={0}
                    max={Math.max(rowCount - 1, 0)}
                    step={1}
                    className="control-input"
                    value={manualY}
                    onChange={(event) => {
                      setManualY(event.target.value);
                      setStartInputError(null);
                    }}
                    onKeyDown={handleCoordinateKeyDown}
                  />
                </label>
              </div>

              <div className="minimap-start-actions">
                <button
                  type="button"
                  className="command-button command-button--primary"
                  onClick={handleApplyManualStart}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="command-button command-button--ghost"
                  onClick={handleResetManualStart}
                  disabled={!startOverride}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          <div className="legend-row legend-row--compact">
          {[
            ['legend-swatch legend-swatch--rover', 'Rover'],
            ['legend-swatch legend-swatch--path', 'Path'],
            ['legend-swatch legend-swatch--ghost', 'Ghost'],
            ['legend-swatch legend-swatch--blue', 'B'],
            ['legend-swatch legend-swatch--amber', 'Y'],
            ['legend-swatch legend-swatch--green', 'G'],
            [showEnergyHeatmap ? 'legend-swatch legend-swatch--heat' : 'legend-swatch legend-swatch--path', showEnergyHeatmap ? 'Heat' : ''],
          ].map(([className, label]) => (
            <div key={label} className="legend-item" style={{ display: label ? 'flex' : 'none' }}>
              <span className={className} />
              <span>{label}</span>
            </div>
          ))}
          </div>
        </div>
        </>
        )}
      </section>
    </div>
  );
};

export default Minimap;
