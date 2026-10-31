import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The API server reads API_PORT from the root .env. The proxy reads the same value.
// The API server also serves the Lightning Addresses under /.well-known (server/lnurl.ts).
// changeOrigin: false keeps the Host header of the page, for example localhost:5173.
// The LNURL service makes its callback URL and the Lightning Address from this header.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, `${import.meta.dirname}/..`, 'API_')
  const apiServer = { target: `http://localhost:${env.API_PORT ?? 3001}`, changeOrigin: false }
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiServer,
        '/.well-known': apiServer,
      },
    },
  }
})
