import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

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
