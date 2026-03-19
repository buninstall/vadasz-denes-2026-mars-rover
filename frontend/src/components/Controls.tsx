import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReplayEntry } from '../types';

interface ControlsProps {
  onStart: (hours: number) => void;
  onReplay: (replayId: string) => void;
  onDeleteReplay: (replayId: string) => void;
  onClearReplays: () => void;
  replays: ReplayEntry[];
  isLoading: boolean;
  onUploadMap?: (file: File) => void;
  mapFilename?: string;
  mapSize?: string;
}

const formatReplayLabel = (replay: ReplayEntry) => {
  const date = new Date(replay.createdAt);
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  const total = replay.result.total_minerals ?? Object.keys(replay.result.all_minerals ?? {}).length;
  return `${hh}:${mm} • ${replay.result.minerals.length}/${total} • ${replay.result.steps_used} steps`;
};

const Controls: React.FC<ControlsProps> = ({
  onStart,
  onReplay,
  onDeleteReplay,
  onClearReplays,
  replays,
  isLoading,
  onUploadMap,
  mapFilename,
  mapSize,
}) => {
  const [hoursInput, setHoursInput] = useState('24');
  const [selectedReplayId, setSelectedReplayId] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!replays.length) {
      setSelectedReplayId('');
      return;
    }
    setSelectedReplayId((prev) => (replays.some((replay) => replay.id === prev) ? prev : replays[0].id));
  }, [replays]);

  const replayOptions = useMemo(
    () => replays.map((replay) => ({ value: replay.id, label: formatReplayLabel(replay) })),
    [replays],
  );

  return (
    <section className="panel controls-panel controls-panel--compact">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <div>
            <p className="panel-kicker">Controls</p>
            <h2 className="panel-title m-0">Run</h2>
          </div>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="cursor-pointer hover:opacity-80 p-1 bg-transparent border-none mt-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className={`text-gray-500 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`}>
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        {!isCollapsed && <span className="panel-code">Run</span>}
      </div>

      {!isCollapsed && (
        <div className="controls-body">
        <p className="controls-inline-meta">
          {mapFilename ?? 'Unknown map'} • {mapSize ?? 'N/A'}
        </p>

        <div className="control-section control-section--card">
          <div className="section-heading">
            <span className="field-label">Time limit</span>
            <span className="field-note">min 24h</span>
          </div>
          <div className="launch-row">
            <label className="field-stack field-stack--tight" htmlFor="mission-hours">
              <span className="control-mini-label">Hours</span>
              <input
                id="mission-hours"
                className="control-input"
                type="number"
                min="24"
                value={hoursInput}
                onChange={(event) => setHoursInput(event.target.value)}
              />
            </label>

            <div className="field-stack field-stack--action">
              <span className="control-mini-label">Start</span>
              <button
                className="command-button command-button--primary command-button--launch"
                onClick={() => {
                  const val = parseInt(hoursInput, 10);
                  onStart(isNaN(val) ? 24 : val);
                }}
                disabled={isLoading}
              >
                {isLoading ? 'Loading' : 'Start'}
              </button>
            </div>
          </div>
        </div>

        {onUploadMap && (
          <div className="control-section control-section--card">
            <div className="section-heading">
              <span className="field-label">Map upload</span>
              <span className="field-note">CSV</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  onUploadMap(event.target.files[0]);
                  event.target.value = '';
                }
              }}
            />

            <button
              className="command-button command-button--ghost command-button--full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              Upload map
            </button>
          </div>
        )}

        <div className="control-section control-section--card">
          <div className="section-heading">
            <div className="section-heading-copy">
              <span className="field-label">Replays</span>
              <span className="field-note">Saved runs</span>
            </div>
            <span className="control-count">{replays.length}</span>
          </div>

          <select
            value={selectedReplayId}
            onChange={(event) => setSelectedReplayId(event.target.value)}
            disabled={!replayOptions.length}
            className="control-input control-select"
          >
            {replayOptions.length === 0 ? (
              <option value="">No saved runs</option>
            ) : (
              replayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>

          <div className="button-row">
            <button
              className="command-button command-button--secondary"
              onClick={() => selectedReplayId && onReplay(selectedReplayId)}
              disabled={!selectedReplayId}
            >
              Load
            </button>
            <button
              className="command-button command-button--ghost"
              onClick={() => selectedReplayId && onDeleteReplay(selectedReplayId)}
              disabled={!selectedReplayId}
            >
              Delete
            </button>
            <button
              className="command-button command-button--ghost"
              onClick={onClearReplays}
              disabled={!replays.length}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
      )}
    </section>
  );
};

export default Controls;
