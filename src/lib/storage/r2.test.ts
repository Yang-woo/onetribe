import { describe, expect, it } from 'vitest'
import { createR2Storage } from './r2'

const base = {
  accountId: 'acct123',
  accessKeyId: 'AKID',
  secretAccessKey: 'SECRET',
  bucket: 'onetribe-media',
  publicBaseUrl: 'https://pub-x.r2.dev/',
}

describe('createR2Storage', () => {
  it('presigns PUT against the default endpoint when no jurisdiction is set', async () => {
    const storage = createR2Storage(base)
    const { uploadUrl, key, headers } = await storage.presignUpload({
      key: 'm/abc/photo.webp',
      contentType: 'image/webp',
      contentLength: 1234,
    })
    const url = new URL(uploadUrl)
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/onetribe-media/m/abc/photo.webp')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(key).toBe('m/abc/photo.webp')
    expect(headers['content-type']).toBe('image/webp')
    expect(headers['content-length']).toBe('1234')
  })

  it('presigns against the jurisdiction endpoint for jurisdiction-scoped buckets (EU)', async () => {
    const storage = createR2Storage({ ...base, jurisdiction: 'eu' })
    const { uploadUrl } = await storage.presignUpload({
      key: 'm/abc/photo.webp',
      contentType: 'image/webp',
      contentLength: 1234,
    })
    expect(new URL(uploadUrl).host).toBe('acct123.eu.r2.cloudflarestorage.com')
  })

  it('builds public URLs from the public base without double slashes', () => {
    const storage = createR2Storage(base)
    expect(storage.publicUrl('m/abc/photo.webp')).toBe('https://pub-x.r2.dev/m/abc/photo.webp')
  })
})
