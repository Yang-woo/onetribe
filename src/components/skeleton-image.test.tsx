import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { SkeletonImage } from './skeleton-image'

// Spec: docs/15 — skeletons, never spinners. The image is hidden behind a
// shimmer until it decodes, then fades in; a broken image still clears the
// shimmer (no permanent pulse).

/** The shimmer's own box — it is the wrapper's only child besides the image. */
const wrapperOf = (img: HTMLElement) => img.parentElement!

describe('SkeletonImage', () => {
  test('starts hidden behind a shimmer, then reveals on load', () => {
    const { container } = render(<SkeletonImage src="/x.jpg" alt="a moment" fit="width" />)
    const img = screen.getByAltText('a moment')

    // state hook, not a styling class — robust to how the fade is expressed
    expect(img).toHaveAttribute('data-loaded', 'false')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()

    fireEvent.load(img)

    expect(img).toHaveAttribute('data-loaded', 'true')
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test('a broken image still clears the shimmer', () => {
    const { container } = render(<SkeletonImage src="/missing.jpg" alt="broken" fit="width" />)
    fireEvent.error(screen.getByAltText('broken'))
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  test("forwards the caller's own classes to the image for the parent group to drive", () => {
    render(<SkeletonImage src="/x.jpg" alt="a" fit="width" className="group-hover:scale-[1.04]" />)
    expect(screen.getByAltText('a').className).toContain('group-hover:scale-[1.04]')
  })

  test('a known ratio reserves the exact box for the whole lifetime (zero shift)', () => {
    render(<SkeletonImage src="/x.jpg" alt="ratio" fit="width" aspectRatio={1.5} />)
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
    render(<SkeletonImage src="/x.jpg" alt="ph" fit="width" defaultAspectRatio="4 / 5" />)
    const img = screen.getByAltText('ph')
    expect(img.style.aspectRatio).toBe('4 / 5')
    fireEvent.load(img)
    expect(img.style.aspectRatio).toBe('') // released to the image's natural size
  })

  test('the wrapper reserves the box too, so the shimmer has something to fill', () => {
    // A height-fitted <img> with no bytes yet measures 0×0 (a replaced element
    // with no natural size), which collapses a wrapper sized from its content —
    // the shimmer then paints nothing at all. The wrapper must carry the ratio
    // itself. jsdom has no layout, so this pins the mechanism, and
    // e2e/lightbox.spec.ts measures the resulting box in a real browser.
    render(<SkeletonImage src="/x.jpg" alt="res" fit="height" aspectRatio={0.75} />)
    const wrapper = wrapperOf(screen.getByAltText('res'))
    expect(wrapper.style.aspectRatio).toMatch(/0\.75/)
  })

  // classList, never toContain: `'max-h-full'.includes('h-full')` is true, so a
  // substring check cannot tell the definite height that fixes the crop from
  // the max-height that caused it — the exact swap these tests exist to catch.
  const classes = (el: HTMLElement) => [...el.classList]

  test('fit="width" sizes both boxes by width, and caps neither height', () => {
    render(<SkeletonImage src="/x.jpg" alt="w" fit="width" />)
    const img = screen.getByAltText('w')
    expect(classes(img)).toContain('w-full')
    expect(classes(wrapperOf(img))).toContain('w-full')
    // A column-driven image must not cap its own height, or a tall photo is
    // squashed instead of running down the card.
    expect(classes(img)).not.toContain('max-h-full')
  })

  test('fit="height" letterboxes inside a wrapper with a definite height', () => {
    render(<SkeletonImage src="/x.jpg" alt="h" fit="height" />)
    const img = screen.getByAltText('h')
    expect(classes(img)).toContain('max-h-full')
    expect(classes(img)).toContain('object-contain')
    // `h-full`, NOT `max-h-full`: a percentage max-height resolves to `none`
    // against an auto-height box, which is exactly how the modal cropped
    // portrait photos (D48).
    expect(classes(wrapperOf(img))).toContain('h-full')
    expect(classes(wrapperOf(img))).not.toContain('max-h-full')
  })

  test('resets to loading when src changes on a reused instance (lightbox nav)', () => {
    const { rerender } = render(<SkeletonImage src="/a.jpg" alt="nav" fit="width" />)
    const first = screen.getByAltText('nav')
    fireEvent.load(first)
    expect(first).toHaveAttribute('data-loaded', 'true')

    // Same instance, new src (the lightbox swaps src on prev/next without
    // remounting) must go back to loading so the previous photo isn't shown
    // under the new moment's caption until the new bytes arrive (docs/00 D32).
    rerender(<SkeletonImage src="/b.jpg" alt="nav" fit="width" />)
    const after = screen.getByAltText('nav')
    // Pin that it really is the SAME element: a remount would reset `loaded`
    // for free and let the render-phase reset be deleted with this still green.
    expect(after).toBe(first)
    expect(after).toHaveAttribute('data-loaded', 'false')
  })

  test('a broken image keeps its reserved box instead of collapsing the card', () => {
    // `onError` clears the shimmer by setting `loaded`, which also releases the
    // placeholder ratio — but a failed image supplies no natural size to take
    // over, so the box would collapse to a strip and reflow the masonry column.
    // Only a real decode may release it.
    render(<SkeletonImage src="/missing.jpg" alt="gone" fit="width" defaultAspectRatio="4 / 5" />)
    const img = screen.getByAltText('gone')
    fireEvent.error(img)
    expect(wrapperOf(img).style.aspectRatio).toBe('4 / 5')
  })
})
