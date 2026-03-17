import React, { useState } from 'react';

interface ControlsProps {
  onStart: (hours: number) => void;
  isLoading: boolean;
}

const MIN_HOURS = 24;

const Controls: React.FC<ControlsProps> = ({ onStart, isLoading }) => {
  const [hours, setHours] = useState(MIN_HOURS);

  const normalizeHours = (value: number) => {
    if (!Number.isFinite(value)) return MIN_HOURS;
    return Math.max(MIN_HOURS, Math.floor(value));
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ color: '#9ca3af', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          Minimum időkeret (óra)
        </label>
        <input
          type="number"
          min={MIN_HOURS}
          value={hours}
          onChange={(e) => setHours(normalizeHours(Number(e.target.value)))}
          style={{
            background: 'rgba(3,7,18,0.9)',
            color: '#f3f4f6',
            padding: '5px 10px',
            borderRadius: 5,
            border: '1px solid #4b5563',
            outline: 'none',
            width: 72,
            fontSize: 16,
            fontFamily: 'monospace',
          }}
        />
      </div>
      <button
        onClick={() => onStart(normalizeHours(hours))}
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
  );
};

export default Controls;
