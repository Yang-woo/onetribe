import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// RTL auto-cleanup needs vitest globals; we keep globals off, so register it.
afterEach(cleanup)

// No unit test reaches the network. Components that fetch (the lightbox caption
// translation, upload, report) either take a test seam or stub fetch themselves;
// anything left over rejects here instead of quietly depending on jsdom refusing
// to resolve a relative URL.
globalThis.fetch = (() =>
  Promise.reject(
    new Error('unit tests must not hit the network — pass a test seam or stub fetch'),
  )) as typeof fetch
