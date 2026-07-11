import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// DB/RLS integration tests — run against the real local Supabase stack
// (`yarn supabase start` first). RLS assertions must use the anon-key
// client; the service-role client is for fixtures only (docs/00 D8).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One shared database — run files sequentially to keep tests isolated.
    fileParallelism: false,
  },
})
