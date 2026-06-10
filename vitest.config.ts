import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@desktop': resolve(__dirname, 'ui/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
  },
})
