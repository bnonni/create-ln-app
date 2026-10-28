import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The API server reads API_PORT from the root .env. The proxy reads the same value.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, `${import.meta.dirname}/..`, 'API_')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': `http://localhost:${env.API_PORT ?? 3001}`,
      },
    },
  }
})
