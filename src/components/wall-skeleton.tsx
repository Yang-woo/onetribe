/**
 * Wall placeholder shown while the (dynamic) moments stream in — docs/15
 * uses skeletons, never spinners. Mirrors the masonry so the layout doesn't
 * jump when the real cards arrive.
 */
const TILE_HEIGHTS = [180, 240, 150, 210, 190, 260, 170, 220]

export function WallSkeleton() {
  return (
    <section className="px-4" aria-hidden="true">
      <div className="columns-2 gap-3 md:columns-3 lg:columns-4">
        {TILE_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="mb-3 animate-pulse break-inside-avoid rounded-lg bg-surface motion-reduce:animate-none"
            style={{ height: h }}
          />
        ))}
      </div>
    </section>
  )
}
