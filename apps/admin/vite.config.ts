import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Port 5173 is whitelisted in the API's default CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
