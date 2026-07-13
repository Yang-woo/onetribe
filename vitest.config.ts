import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Unit & component tests (jsdom). DB/RLS integration tests live in
// tests/db and run against a real local Supabase — see vitest.db.config.ts.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // next-intl's ESM build imports Next subpaths without extensions.
    alias: {
      'next/navigation': 'next/navigation.js',
      'next/link': 'next/link.js',
      'next/router': 'next/router.js',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    server: {
      // next-intl must go through Vite so the aliases above apply to its
      // extensionless `next/*` imports.
      deps: { inline: ['next-intl', 'use-intl'] },
    },
  },
})
