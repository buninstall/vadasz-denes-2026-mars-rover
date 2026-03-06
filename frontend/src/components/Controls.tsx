import React, { useState } from 'react';

interface ControlsProps {
  onStart: (hours: number) => void;
  isLoading: boolean;
}

const Controls: React.FC<ControlsProps> = ({ onStart, isLoading }) => {
  const [hours, setHours] = useState(24);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(10,3,1,0.88)',
        border: '1px solid #7a3010',
        borderRadius: 8,
        padding: '10px 14px',
        fontFamily: 'monospace',
        boxShadow: '0 4px 24px rgba(200,60,10,0.12)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label style={{ color: '#7a3a18', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          Időkeret (óra)
        </label>
        <input
          type="number"
          min="24"
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value) || 24)}
          style={{
            background: 'rgba(20,8,2,0.95)',
            color: '#e86030',
            padding: '5px 10px',
            borderRadius: 5,
            border: '1px solid #5a2008',
            outline: 'none',
            width: 72,
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
          background: isLoading
            ? 'rgba(90,32,8,0.5)'
            : 'linear-gradient(135deg, #a83010, #c4501a)',
          color: isLoading ? '#5a3020' : '#fff',
          border: '1px solid #7a3010',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontFamily: 'monospace',
          boxShadow: isLoading ? 'none' : '0 0 12px rgba(200,80,20,0.3)',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        {isLoading ? '⏳ Feldolgozás…' : '▶ Szimuláció Indítása'}
      </button>
    </div>
  );
};

export default Controls;
