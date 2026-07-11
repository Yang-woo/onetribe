import type { PresignedUpload, StorageAdapter } from './types'

/**
 * Local storage driver — dev and E2E only (no R2 account needed, docs/17 D).
 * Bytes live in process memory behind /api/local-storage/[...key]; the
 * route rejects everything unless this driver is active.
 */

declare global {
  var __onetribeLocalStorage:
    Map<string, { contentType: string; bytes: Uint8Array<ArrayBuffer> }> | undefined
}

export function localStorageStore() {
  globalThis.__onetribeLocalStorage ??= new Map()
  return globalThis.__onetribeLocalStorage
}

export function createLocalStorage(siteUrl: string): StorageAdapter {
  const base = siteUrl.replace(/\/$/, '')
  return {
    async presignUpload({ key, contentType }): Promise<PresignedUpload> {
      return {
        key,
        uploadUrl: `${base}/api/local-storage/${key}`,
        headers: { 'content-type': contentType },
      }
    },
    publicUrl(key) {
      return `${base}/api/local-storage/${key}`
    },
  }
}

export function isLocalStorageDriver(): boolean {
  if (process.env.STORAGE_DRIVER === 'local') return true
  return !process.env.STORAGE_DRIVER && !process.env.R2_ACCOUNT_ID
}
