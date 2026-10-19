import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Port 8081 is whitelisted in the API's default CORS_ORIGINS.
// host: true also exposes it on the LAN so a phone on the same Wi-Fi can open it.
export default defineConfig({
  plugins: [react()],
  server: { port: 8081, strictPort: true, host: true },
});
