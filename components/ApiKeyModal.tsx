
import React from 'react';

export const ApiKeyModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (key: string) => void }> = ({ isOpen, onClose, onSave }) => {
  const [key, setKey] = React.useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="premium-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <h2 className="mb-2 text-xl font-semibold text-[var(--color-text)]">Connect Gemini</h2>
        <p className="mb-5 text-sm leading-6 text-[var(--color-text-muted)]">
          Add your Gemini API key to enable reference analysis and image generation. The key is stored locally in this browser.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste API key"
          className="mb-5 w-full px-4 py-3 text-sm"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary px-4 py-2.5 text-sm">Cancel</button>
          <button 
            onClick={() => { onSave(key); onClose(); }}
            className="primary-cta px-5 py-2.5 text-sm"
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  );
};
