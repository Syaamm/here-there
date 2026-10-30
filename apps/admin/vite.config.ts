import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Normally the admin runs inside the phone app's server at http://localhost:8082/admin/ (see apps/mobile/metro.config.js), live,
// with no port of its own. This standalone server (`npm run admin:standalone`, port 5173) is only for working on the admin alone;
// 5173 is whitelisted in the API's default CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  // Served under /admin so it can share port 8082 with the web preview (see apps/mobile/metro.config.js).
  base: '/admin/',
  server: { port: 5173, strictPort: true },
});
