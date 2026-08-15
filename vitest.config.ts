import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Client tests opt into jsdom per-file with `// @vitest-environment jsdom`.
  },
})
