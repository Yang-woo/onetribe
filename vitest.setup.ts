import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL auto-cleanup needs vitest globals; we keep globals off, so register it.
afterEach(cleanup)
