import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
                if (id.includes('konva') || id.includes('react-konva')) return 'vendor-canvas';
                if (id.includes('@dnd-kit')) return 'vendor-dnd';
                if (id.includes('@google/genai')) return 'vendor-ai';
                if (id.includes('motion') || id.includes('lucide-react')) return 'vendor-ui';
              }
            },
          },
        },
      },
    };
});
