import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The same path aliases as tsconfig.json, so tests can import code that uses them.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
