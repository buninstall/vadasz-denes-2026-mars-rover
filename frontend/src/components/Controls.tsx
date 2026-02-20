import React, { useState } from 'react';

interface ControlsProps {
  onStart: (hours: number) => void;
  isLoading: boolean;
}

const Controls: React.FC<ControlsProps> = ({ onStart, isLoading }) => {
  const [hours, setHours] = useState(24);

  return (
    <div className="flex items-center gap-6 bg-gray-900 p-6 rounded-xl border border-gray-700 shadow-xl">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Mission Duration (H)</label>
        <input 
          type="number" 
          min="24"
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value))}
          className="bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-600 outline-none focus:border-red-500 transition-colors w-32 text-xl"
        />
      </div>
      <button 
        onClick={() => onStart(hours)}
        disabled={isLoading}
        className="flex-1 px-8 py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white font-black rounded-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed uppercase tracking-widest shadow-lg shadow-red-900/20"
      >
        {isLoading ? 'Establishing Uplink...' : 'Confirm Mission Launch'}
      </button>
    </div>
  );
};

export default Controls;
