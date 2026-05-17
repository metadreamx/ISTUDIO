
import React from 'react';
import { getGeminiRelayDiagnostic, testGeminiConnection } from '../services/geminiService';

export const ApiKeyModal: React.FC<{ isOpen: boolean; onClose: () => void; onSave: (key: string) => void }> = ({ isOpen, onClose, onSave }) => {
  const [key, setKey] = React.useState('');
  const [isTesting, setIsTesting] = React.useState(false);
  const [testMessage, setTestMessage] = React.useState<string | null>(null);
  const [testStatus, setTestStatus] = React.useState<'idle' | 'success' | 'error'>('idle');

  if (!isOpen) return null;

  const trimmedKey = key.trim();
  const relayDiagnostic = getGeminiRelayDiagnostic();
  const relayTone = relayDiagnostic.status === 'ready' || relayDiagnostic.status === 'local'
    ? 'border-lime-300/25 bg-lime-300/10 text-lime-100'
    : relayDiagnostic.status === 'missing'
      ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
      : 'border-white/10 bg-white/[0.03] text-[var(--color-text-muted)]';

  const handleTest = async () => {
    if (!trimmedKey) {
      setTestStatus('error');
      setTestMessage('Paste your Gemini API key before testing.');
      return;
    }
    setIsTesting(true);
    setTestStatus('idle');
    setTestMessage(null);
    try {
      const result = await testGeminiConnection(trimmedKey);
      setTestStatus('success');
      setTestMessage(`AI connection ready. High-quality reference editing is available on this device.`);
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : 'Gemini connection test failed.');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="premium-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <h2 className="mb-2 text-xl font-semibold text-[var(--color-text)]">Connect Gemini</h2>
        <p className="mb-5 text-sm leading-6 text-[var(--color-text-muted)]">
          Add your Gemini API key to enable reference analysis and image generation. The key is saved on this device and used only when ISTUDIO creates an edit.
        </p>
        <p className="mb-4 text-xs leading-5 text-[var(--color-text-muted)]">
          Use a Google Gemini API key with image generation access enabled.
        </p>
        <div className={`mb-4 rounded-xl border px-4 py-3 text-xs leading-5 ${relayTone}`}>
          <div className="font-semibold">{relayDiagnostic.label}</div>
          <div className="mt-1 opacity-85">{relayDiagnostic.message}</div>
        </div>
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setTestStatus('idle');
            setTestMessage(null);
          }}
          placeholder="Paste API key"
          className="mb-5 w-full px-4 py-3 text-sm"
        />
        {testMessage && (
          <div className={`mb-5 rounded-xl border px-4 py-3 text-sm leading-5 ${
            testStatus === 'success'
              ? 'border-lime-300/30 bg-lime-300/10 text-lime-100'
              : 'border-red-300/30 bg-red-400/10 text-red-100'
          }`}>
            {testMessage}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button onClick={onClose} className="btn-secondary px-4 py-2.5 text-sm">Cancel</button>
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="btn-secondary px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTesting ? 'Checking...' : 'Test AI'}
          </button>
          <button 
            onClick={() => { onSave(trimmedKey); onClose(); }}
            disabled={!trimmedKey}
            className="primary-cta px-5 py-2.5 text-sm"
          >
            Save key
          </button>
        </div>
      </div>
    </div>
  );
};
