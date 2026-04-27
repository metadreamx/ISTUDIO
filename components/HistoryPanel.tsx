import React from 'react';
import type { HistoryItem } from '../types';
import { CloseIcon, HistoryIcon } from './icons';

interface HistoryPanelProps {
  isOpen: boolean;
  history: HistoryItem[];
  onClose: () => void;
  // onSelect is handled inside StyleTransferView now
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ isOpen, history, onClose }) => {
  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-[var(--color-bg)]/60 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-sm bg-[var(--color-bg-panel)] backdrop-blur-xl border-l border-[var(--color-border)] z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-panel-title"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
            <h2 id="history-panel-title" className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-3">
              <HistoryIcon className="w-6 h-6 text-[var(--color-accent)]" />
              Generation History
            </h2>
            <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-panel)] rounded-lg transition-[background-color,color]" aria-label="Close history panel">
              <CloseIcon className="w-6 h-6" />
            </button>
          </div>

          {/* History List */}
          <div className="flex-grow overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-center">
                <HistoryIcon className="w-16 h-16 mb-4 opacity-20" />
                <p className="font-medium">No history yet.</p>
                <p className="text-sm">Your generated images will appear here.</p>
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="w-full flex flex-col gap-3 p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-2xl hover:border-[var(--color-accent)] transition-[border-color,background-color]"
                  aria-label={`Generation from ${new Date(item.id).toLocaleString()}`}
                >
                  <img 
                    src={item.generated} 
                    alt="Generated image" 
                    className="w-full aspect-square object-cover rounded-xl border border-[var(--color-border)]" 
                    loading="lazy" 
                  />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-bold text-[var(--color-text)]">
                      Generation {new Date(item.id).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {new Date(item.id).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
};