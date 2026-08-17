// ci: test change detection
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('react-router'))
              return 'react'
            if (id.includes('@tanstack/react-query')) return 'query'
            if (id.includes('@radix-ui')) return 'ui'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
      '/health': { target: process.env.VITE_API_URL ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
