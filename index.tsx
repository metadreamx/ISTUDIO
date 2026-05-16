import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  console.error("Error during React mounting:", error);
  if (rootElement) {
    rootElement.innerHTML = `<div style="color: white; padding: 20px; background: #800; font-family: sans-serif;">
      <h1>Application Error</h1>
      <p>Failed to mount the application. Check the console for details.</p>
      <pre style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; overflow: auto;">${error instanceof Error ? error.message : String(error)}</pre>
    </div>`;
  }
}

const shouldRegisterServiceWorker = () => {
  const host = window.location.hostname.toLowerCase();
  const storageOverride = new URLSearchParams(window.location.search).get('storage');
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(host);
  return storageOverride === 'browser' || (window.location.protocol === 'https:' && !isLoopback);
};

if ('serviceWorker' in navigator && shouldRegisterServiceWorker()) {
  window.addEventListener('load', () => {
    const swUrl = `${((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/'}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((error) => {
      console.warn('ISTUDIO service worker registration failed.', error);
    });
  });
}
