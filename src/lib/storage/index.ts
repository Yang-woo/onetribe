import { siteUrl } from '@/lib/site-url'
import { createLocalStorage, isLocalStorageDriver } from './local'
import { createR2Storage } from './r2'
import type { StorageAdapter } from './types'

export type { PresignedUpload, StorageAdapter } from './types'

/** Server-side driver selection: R2 when configured, local otherwise. */
export function createStorage(): StorageAdapter {
  if (isLocalStorageDriver()) {
    return createLocalStorage(siteUrl())
  }
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_PUBLIC_BASE_URL',
  ] as const
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} is required for the R2 storage driver`)
  }
  // Interpolated into the presign host (and CSP in next.config.ts) — reject
  // anything that isn't a plain jurisdiction label like "eu" or "fedramp".
  const jurisdiction = process.env.R2_JURISDICTION || undefined
  if (jurisdiction && !/^[a-z0-9-]+$/.test(jurisdiction)) {
    throw new Error('R2_JURISDICTION must be a lowercase label (e.g. "eu")')
  }
  return createR2Storage({
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL!,
    jurisdiction,
  })
}
