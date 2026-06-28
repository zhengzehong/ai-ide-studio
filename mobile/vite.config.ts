import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const isAndroidBuild = process.env.MOBILE_BUILD_TARGET === 'android'

export default defineConfig({
  base: isAndroidBuild ? './' : '/app/',
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
