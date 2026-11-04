import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    // Bind IPv4 explicitly: on Node ≥17 "localhost" resolves to ::1 first,
    // so the default binding refuses 127.0.0.1 probes (hermes verify, curl).
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
