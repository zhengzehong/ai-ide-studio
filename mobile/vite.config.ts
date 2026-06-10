import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      '@desktop': resolve(__dirname, '../ui/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:18800',
      '/health': 'http://localhost:18800',
    },
  },
})
