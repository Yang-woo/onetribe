import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LogoMark } from './logo'

// Spec: docs/12 §C (D24 handoff) — the searchlight-beam geometry is FIXED:
// viewBox 0 0 96 64 and the three polygon point lists never change; scaling
// happens via width/height only. These tests pin the geometry and the four
// color variants so an accidental edit can't silently ship a different logo.

const POINTS = ['44,64 4,0 16,0 52,64', '52,64 40,0 52,0 60,64', '60,64 80,0 92,0 68,64']

const beams = (container: HTMLElement) => [...container.querySelectorAll('polygon')]

describe('LogoMark', () => {
  test('renders the fixed handoff geometry — viewBox and three beam polygons', () => {
    const { container } = render(<LogoMark />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 96 64')
    expect(beams(container).map((p) => p.getAttribute('points'))).toEqual(POINTS)
  })

  test('primary = orange 3-step transparency (35/70/100), the default variant', () => {
    const { container } = render(<LogoMark />)
    expect(beams(container).map((p) => p.getAttribute('fill'))).toEqual([
      'rgba(255,106,0,.35)',
      'rgba(255,106,0,.7)',
      '#ff6a00',
    ])
  })

  test('secondary = red mix for emphasis contexts', () => {
    const { container } = render(<LogoMark variant="secondary" />)
    expect(beams(container).map((p) => p.getAttribute('fill'))).toEqual([
      '#e3241d',
      '#ff6a00',
      '#ff9a4d',
    ])
  })

  test('mono variants are single-color ramps (light on dark / black on light)', () => {
    const light = render(<LogoMark variant="mono-light" />)
    expect(beams(light.container).map((p) => p.getAttribute('fill'))).toEqual([
      'rgba(242,237,230,.35)',
      'rgba(242,237,230,.7)',
      '#f2ede6',
    ])
    const black = render(<LogoMark variant="mono-black" />)
    expect(beams(black.container).map((p) => p.getAttribute('fill'))).toEqual([
      'rgba(11,9,8,.35)',
      'rgba(11,9,8,.7)',
      '#0b0908',
    ])
  })

  test('is decorative — hidden from the accessibility tree (label lives in the lockup text)', () => {
    const { container } = render(<LogoMark />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
