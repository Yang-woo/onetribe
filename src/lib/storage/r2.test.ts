import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('keyForUrl inverts publicUrl and rejects foreign URLs', () => {
    const storage = createR2Storage(base)
    expect(storage.keyForUrl(storage.publicUrl('m/abc/photo.webp'))).toBe('m/abc/photo.webp')
    expect(storage.keyForUrl('https://evil.example/m/abc/photo.webp')).toBeNull()
  })

  describe('deleteObject', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('sends a signed DELETE to the bucket endpoint', async () => {
      const seen: Request[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (req: Request) => {
          seen.push(req)
          return new Response(null, { status: 204 })
        }),
      )
      const storage = createR2Storage({ ...base, jurisdiction: 'eu' })
      await storage.deleteObject('m/abc/photo.webp')
      expect(seen).toHaveLength(1)
      const url = new URL(seen[0].url)
      expect(seen[0].method).toBe('DELETE')
      expect(url.host).toBe('acct123.eu.r2.cloudflarestorage.com')
      expect(url.pathname).toBe('/onetribe-media/m/abc/photo.webp')
      expect(seen[0].headers.get('authorization')).toContain('AWS4-HMAC-SHA256')
    })

    it('tolerates missing keys but surfaces real failures', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 404 })),
      )
      const storage = createR2Storage(base)
      await expect(storage.deleteObject('gone.webp')).resolves.toBeUndefined()

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 500 })),
      )
      await expect(storage.deleteObject('key.webp')).rejects.toThrow('R2 delete failed')
    })
  })
})
