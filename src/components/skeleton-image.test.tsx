import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { SkeletonImage } from './skeleton-image'

// Spec: docs/15 — skeletons, never spinners. The image is hidden behind a
// shimmer until it decodes, then fades in; a broken image still clears the
// shimmer (no permanent pulse).

describe('SkeletonImage', () => {
  test('starts hidden behind a shimmer, then reveals on load', () => {
    const { container } = render(<SkeletonImage src="/x.jpg" alt="a moment" />)
    const img = screen.getByAltText('a moment')

    // state hook, not a styling class — robust to how the fade is expressed
    expect(img).toHaveAttribute('data-loaded', 'false')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    fireEvent.load(img)

    expect(img).toHaveAttribute('data-loaded', 'true')
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test('a broken image still clears the shimmer', () => {
    const { container } = render(<SkeletonImage src="/missing.jpg" alt="broken" />)
    fireEvent.error(screen.getByAltText('broken'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test('forwards width/fit classes to the image for the parent group to drive', () => {
    render(<SkeletonImage src="/x.jpg" alt="a" className="w-full object-contain" />)
    expect(screen.getByAltText('a').className).toContain('object-contain')
  })

  test('a known ratio reserves the exact box for the whole lifetime (zero shift)', () => {
    render(<SkeletonImage src="/x.jpg" alt="ratio" aspectRatio={1.5} />)
    const img = screen.getByAltText('ratio')
    // jsdom normalizes `aspect-ratio: 1.5` → "1.5 / 1"; assert on the value, not
    // the exact serialization
    const reserved = img.style.aspectRatio
    expect(reserved).toMatch(/1\.5/)
    // the reserved box must survive load — otherwise the masonry reflows (D32)
    fireEvent.load(img)
    expect(img.style.aspectRatio).toBe(reserved)
  })

  test('an unknown ratio uses the placeholder only until load', () => {
    render(<SkeletonImage src="/x.jpg" alt="ph" defaultAspectRatio="4 / 5" />)
    const img = screen.getByAltText('ph')
    expect(img.style.aspectRatio).toBe('4 / 5')
    fireEvent.load(img)
    expect(img.style.aspectRatio).toBe('') // released to the image's natural size
  })
})
