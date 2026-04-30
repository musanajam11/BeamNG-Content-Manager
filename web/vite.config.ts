import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname),
  base: './', // relative paths so GitHub Pages works in a sub-path
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, '../src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, '../dist-web'),
    emptyOutDir: true,
    sourcemap: false
  },
  // Dev-only proxies so the web demo can talk to real BeamMP / BMR backends
  // without CORS errors while developing locally. Production (GitHub Pages)
  // can't use these — the mocks fall back to bundled demo data instead.
  server: {
    proxy: {
      '/__proxy/bmr': {
        target: 'https://bmr.musanet.xyz',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/__proxy\/bmr/, '')
      },
      '/__proxy/beammp': {
        target: 'https://backend.beammp.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/__proxy\/beammp/, '')
      }
    }
  }
})
