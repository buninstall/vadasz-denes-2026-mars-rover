import React from 'react';
import { LogEntry } from '../types';

interface LogViewerProps {
  logs: LogEntry[];
}

const LogViewer: React.FC<LogViewerProps> = ({ logs }) => {
  return (
    <div className="bg-black text-green-500 font-mono text-sm p-6 rounded-xl h-[250px] overflow-y-auto border border-gray-800 shadow-inner">
      <div className="sticky top-0 bg-black border-b border-gray-800 pb-3 mb-4 text-xs font-black uppercase tracking-widest text-gray-500 flex justify-between items-center">
        <span>Deep Space Network Log</span>
        <span className="text-red-600 flex items-center gap-1">
           <span className="w-2 h-2 bg-red-600 rounded-full animate-ping"></span> LIVE
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {logs.length === 0 ? (
          <div className="text-gray-700 italic">No telemetry data available...</div>
        ) : (
          [...logs].reverse().map((log, i) => (
            <div key={i} className="flex gap-4 opacity-90 hover:opacity-100 transition-opacity">
              <span className="text-green-800 whitespace-nowrap">[{log.timestamp}]</span>
              <span className="text-blue-700 whitespace-nowrap">POS:{log.position.x},{log.position.y}</span>
              <span className="text-gray-300 flex-1">{log.event}</span>
              <span className={log.battery < 20 ? 'text-red-500' : 'text-green-600'}>⚡{log.battery.toFixed(0)}%</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogViewer;
