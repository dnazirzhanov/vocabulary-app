import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs separately (backend/, port 8000); both dev and preview servers proxy /api to it.
const proxy = { '/api': 'http://localhost:8000' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
});
