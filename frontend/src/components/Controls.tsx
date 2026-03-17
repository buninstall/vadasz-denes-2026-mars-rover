import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ReplayEntry } from '../types';

interface ControlsProps {
  onStart: (hours: number) => void;
  onReplay: (replayId: string) => void;
  onDeleteReplay: (replayId: string) => void;
  onClearReplays: () => void;
  replays: ReplayEntry[];
  isLoading: boolean;
  onUploadMap?: (file: File) => void;
}

const formatReplayLabel = (replay: ReplayEntry) => {
  const date = new Date(replay.createdAt);
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  const total = replay.result.total_minerals ?? Object.keys(replay.result.all_minerals ?? {}).length;
  return `${hh}:${mm} • ${replay.result.minerals.length}/${total} • ${replay.result.steps_used} lépés`;
};

const Controls: React.FC<ControlsProps> = ({
  onStart,
  onReplay,
  onDeleteReplay,
  onClearReplays,
  replays,
  isLoading,
  onUploadMap,
}) => {
  const [hours, setHours] = useState(24);
  const [selectedReplayId, setSelectedReplayId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!replays.length) {
      setSelectedReplayId('');
      return;
    }
    setSelectedReplayId(prev => (replays.some(r => r.id === prev) ? prev : replays[0].id));
  }, [replays]);

  const replayOptions = useMemo(
    () => replays.map(replay => ({ value: replay.id, label: formatReplayLabel(replay) })),
    [replays],
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        flexDirection: 'column',
        gap: 10,
        background: 'rgba(2,6,14,0.68)',
        border: '1px solid #374151',
        borderRadius: 8,
        padding: '10px 14px',
        fontFamily: 'monospace',
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'end', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            Minimum időkeret (óra)
          </label>
          <input
            type="number"
            min="24"
            value={hours}
            onChange={(e) => setHours(parseInt(e.target.value) || 24)}
            style={{
              background: 'rgba(3,7,18,0.9)',
              color: '#f3f4f6',
              padding: '5px 10px',
              borderRadius: 5,
              border: '1px solid #4b5563',
              outline: 'none',
              width: 92,
              fontSize: 16,
              fontFamily: 'monospace',
            }}
          />
        </div>
        <button
          onClick={() => onStart(hours)}
          disabled={isLoading}
          style={{
            padding: '9px 18px',
            background: isLoading ? 'rgba(17,24,39,0.7)' : '#f3f4f6',
            color: isLoading ? '#9ca3af' : '#030712',
            border: '1px solid ' + (isLoading ? '#4b5563' : '#f3f4f6'),
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            boxShadow: isLoading ? 'none' : '0 0 12px rgba(243,244,246,0.25)',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {isLoading ? 'Feldolgozás…' : 'Szimuláció indítása'}
        </button>
      </div>

      <div style={{ height: 1, background: '#374151', opacity: 0.7 }} />

      {onUploadMap && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Egyéni pálya
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadMap?.(e.target.files[0]);
                  e.target.value = ''; // Reset input so same file can be uploaded again
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: isLoading ? '#6b7280' : '#d1d5db',
                border: '1px dashed ' + (isLoading ? '#4b5563' : '#6b7280'),
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              Saját pálya feltöltése
            </button>
          </div>
          <div style={{ height: 1, background: '#374151', opacity: 0.7 }} />
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          Replay archivum ({replays.length})
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={selectedReplayId}
            onChange={(e) => setSelectedReplayId(e.target.value)}
            disabled={!replayOptions.length}
            style={{
              flex: 1,
              background: 'rgba(3,7,18,0.9)',
              color: '#f3f4f6',
              padding: '6px 8px',
              borderRadius: 5,
              border: '1px solid #4b5563',
              outline: 'none',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            {replayOptions.length === 0 ? (
              <option value="">Nincs mentett szimuláció</option>
            ) : (
              replayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>

          <button
            onClick={() => selectedReplayId && onReplay(selectedReplayId)}
            disabled={!selectedReplayId}
            style={{
              padding: '6px 10px',
              background: selectedReplayId ? '#f3f4f6' : 'rgba(17,24,39,0.7)',
              color: selectedReplayId ? '#030712' : '#6b7280',
              border: '1px solid ' + (selectedReplayId ? '#f3f4f6' : '#4b5563'),
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: selectedReplayId ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap',
            }}
          >
            Replay
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => selectedReplayId && onDeleteReplay(selectedReplayId)}
            disabled={!selectedReplayId}
            style={{
              padding: '5px 8px',
              background: 'transparent',
              border: '1px solid #4b5563',
              borderRadius: 5,
              color: selectedReplayId ? '#d1d5db' : '#6b7280',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: selectedReplayId ? 'pointer' : 'not-allowed',
            }}
          >
            Törlés
          </button>

          <button
            onClick={onClearReplays}
            disabled={!replays.length}
            style={{
              padding: '5px 8px',
              background: 'transparent',
              border: '1px solid #4b5563',
              borderRadius: 5,
              color: replays.length ? '#d1d5db' : '#6b7280',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'monospace',
              cursor: replays.length ? 'pointer' : 'not-allowed',
            }}
          >
            Összes törlése
          </button>
        </div>
      </div>
    </div>
  );
};

export default Controls;
