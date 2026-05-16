import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: env.VITE_BASE || '/',
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
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
                if (id.includes('three-gpu-pathtracer') || id.includes('three-mesh-bvh') || id.includes('xatlas-web')) return 'vendor-pathtracer';
                if (id.includes('postprocessing')) return 'vendor-postprocessing';
                if (id.includes('/three/') || id.includes('\\three\\')) return 'vendor-three';
                if (id.includes('@google/genai')) return 'vendor-ai';
                if (id.includes('motion') || id.includes('lucide-react')) return 'vendor-ui';
              }
            },
          },
        },
      },
    };
});
