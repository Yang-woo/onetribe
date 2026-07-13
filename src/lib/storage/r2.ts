import { AwsClient } from 'aws4fetch'
import type { PresignedUpload, StorageAdapter } from './types'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string // e.g. https://media.onetribe.dance
  /** R2 jurisdiction (e.g. "eu"). Jurisdiction-scoped buckets are only reachable
   *  via their jurisdiction endpoint — the default endpoint 404s for them. */
  jurisdiction?: string
}

/**
 * Cloudflare R2 via S3-compatible presigned PUT URLs (aws4fetch — tiny,
 * edge-compatible). content-type and content-length are part of the
 * signature, so the client can only upload what the server approved.
 */
export function createR2Storage(config: R2Config): StorageAdapter {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: 'auto',
    service: 's3',
  })
  const host = config.jurisdiction
    ? `${config.accountId}.${config.jurisdiction}.r2.cloudflarestorage.com`
    : `${config.accountId}.r2.cloudflarestorage.com`
  const endpoint = `https://${host}/${config.bucket}`

  return {
    async presignUpload({ key, contentType, contentLength }): Promise<PresignedUpload> {
      const url = new URL(`${endpoint}/${key}`)
      url.searchParams.set('X-Amz-Expires', '600')
      const signed = await client.sign(
        new Request(url, {
          method: 'PUT',
          headers: {
            'content-type': contentType,
            'content-length': String(contentLength),
          },
        }),
        { aws: { signQuery: true, allHeaders: true } },
      )
      return {
        key,
        uploadUrl: signed.url,
        headers: { 'content-type': contentType, 'content-length': String(contentLength) },
      }
    },
    publicUrl(key) {
      return `${config.publicBaseUrl.replace(/\/$/, '')}/${key}`
    },
  }
}
