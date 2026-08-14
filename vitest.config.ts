import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  test: {
    environment: 'node',
    testTimeout: 30000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/*.test.{ts,tsx}'],
          // Browser files share one chromium instance and mutate global state
          // (CDP WebAuthn virtual authenticators, real IndexedDB, the app render).
          // Parallel file execution races on that shared instance — run serially.
          fileParallelism: false,
          globals: true,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 390, height: 844 },
            api: { host: 'localhost' },
          },
        },
      },
    ],
  },
})
