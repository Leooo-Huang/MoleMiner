import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../../dist/web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api/search/stream': {
        target: 'http://localhost:3456',
        // SSE requires no response buffering
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, _req, res) => {
            // Disable response buffering for SSE
            (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
          });
        },
      },
      '/api': 'http://localhost:3456',
    },
  },
});
