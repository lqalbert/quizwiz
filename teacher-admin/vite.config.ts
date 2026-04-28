import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const fromEnv = String(env.VITE_API_PROXY_TARGET || env.VITE_API_BASE_URL || '').trim()
  const raw = fromEnv.replace(/\/$/, '') || 'http://localhost:3000'
  const apiProxy = {
    '/api': { target: raw, changeOrigin: true },
    '/uploads': { target: raw, changeOrigin: true },
  } as const

  return {
    plugins: [react()],
    server: { proxy: { ...apiProxy } },
    preview: { proxy: { ...apiProxy } },
  }
})
