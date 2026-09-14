import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const isAndroidBuild = process.env.MOBILE_BUILD_TARGET === 'android'

export default defineConfig({
  base: isAndroidBuild ? './' : '/app/',
  plugins: [react()],
  // Shared team clients must use the mobile connection and its selected server.
  define: {
    'import.meta.env.VITE_QUERY_TRANSPORT': JSON.stringify('ws'),
    'import.meta.env.VITE_COMMAND_TRANSPORT': JSON.stringify('ws'),
    // 移动端回合重放单页放宽(往返数 7-13 → 2-3);PC 构建不定义 → 保持默认预算。
    'import.meta.env.VITE_TEAM_TURN_PAGE_PROFILE': JSON.stringify('mobile'),
  },
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
