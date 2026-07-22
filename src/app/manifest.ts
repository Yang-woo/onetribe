import type { MetadataRoute } from 'next'

// Browser-chrome polish (docs/00 D23) — True Warm Black address bar and a
// sane install card. Not a PWA push; just the baseline manifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'one tribe',
    short_name: 'one tribe',
    description:
      'The moments we took home — a multilingual memory wall for the hard-dance community.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0908',
    theme_color: '#0B0908',
    icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }],
  }
}
