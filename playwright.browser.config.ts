import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests that need a browser but not the app — code that only a real
 * decoder, canvas or codec can exercise (docs/00 D56).
 *
 * Separate from playwright.config.ts because of where each one runs: the e2e
 * journeys need Supabase and a build, so they are a `push` job, while these
 * need neither and belong in the job that gates pull requests. Keeping them
 * under the e2e umbrella is what left the only coverage of `looksIntact`'s body
 * outside PR CI — green until a merge, and a merge is a deploy.
 */
export default defineConfig({
  testDir: './e2e-browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
