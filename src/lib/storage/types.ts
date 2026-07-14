export interface PresignedUpload {
  key: string
  uploadUrl: string
  /** Headers the client must send with the PUT (they are part of the signature). */
  headers: Record<string, string>
}

/**
 * Storage boundary — R2 in production, a local driver for dev/E2E, and a
 * fake in unit tests. Server code never trusts client-provided URLs: it
 * derives public URLs from keys through this adapter (docs/17 T2.1).
 */
export interface StorageAdapter {
  presignUpload(opts: {
    key: string
    contentType: string
    contentLength: number
  }): Promise<PresignedUpload>
  publicUrl(key: string): string
  /** Inverse of publicUrl — null when the URL wasn't minted by this adapter. */
  keyForUrl(url: string): string | null
  /** Remove an object. Idempotent — deleting a missing key is not an error. */
  deleteObject(key: string): Promise<void>
}
