/**
 * One-off icon generator — searchlight beam mark (docs/12-brand C, docs/00 D24).
 * Renders the fixed beam geometry onto True Warm Black at every icon size the
 * app ships, and writes the outputs that are committed to the repo:
 *
 *   src/app/favicon.ico    16/32/48 (symbol at 75% width — small-size legibility)
 *   src/app/apple-icon.png 180×180  (app-icon spec: symbol 52/88 of the side)
 *   public/icon-192.png    manifest (same composition as apple-icon)
 *   public/icon-512.png    manifest
 *
 * Run from app/: `node scripts/generate-icons.mjs`. Uses the sharp instance
 * Next.js already ships in node_modules (not a declared dependency — this
 * script is dev-only and never runs in CI).
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const out = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url))

// Fixed handoff geometry — viewBox 0 0 96 64, scale via container only.
const BEAMS = `
  <polygon points="44,64 4,0 16,0 52,64" fill="rgba(255,106,0,.35)"/>
  <polygon points="52,64 40,0 52,0 60,64" fill="rgba(255,106,0,.7)"/>
  <polygon points="60,64 80,0 92,0 68,64" fill="#ff6a00"/>`

/** Dark square with the symbol centered at `ratio` of the side width. */
function iconSvg(size, ratio) {
  const w = size * ratio
  const h = (w * 64) / 96
  const x = (size - w) / 2
  const y = (size - h) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0b0908"/>
  <g transform="translate(${x} ${y}) scale(${w / 96})">${BEAMS}</g>
</svg>`
}

const png = (size, ratio) =>
  sharp(Buffer.from(iconSvg(size, ratio)), { density: 288 })
    .resize(size, size)
    .png()
    .toBuffer()

/** Wrap PNG buffers in an ICO container (PNG-encoded entries — valid since Vista). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(([size, buf], i) => {
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16) // width
    dir.writeUInt8(size >= 256 ? 0 : size, i * 16 + 1) // height
    dir.writeUInt16LE(1, i * 16 + 4) // planes
    dir.writeUInt16LE(32, i * 16 + 6) // bpp
    dir.writeUInt32LE(buf.length, i * 16 + 8)
    dir.writeUInt32LE(offset, i * 16 + 12)
    offset += buf.length
  })
  return Buffer.concat([header, dir, ...entries.map(([, buf]) => buf)])
}

const APP_RATIO = 52 / 88 // app-icon spec (88px box → 52px symbol)
const FAVICON_RATIO = 0.75 // optical bump for tiny sizes

const favicons = await Promise.all([16, 32, 48].map(async (s) => [s, await png(s, FAVICON_RATIO)]))
await writeFile(out('src/app/favicon.ico'), ico(favicons))
await writeFile(out('src/app/apple-icon.png'), await png(180, APP_RATIO))
await writeFile(out('public/icon-192.png'), await png(192, APP_RATIO))
await writeFile(out('public/icon-512.png'), await png(512, APP_RATIO))
console.log('icons written: favicon.ico (16/32/48), apple-icon.png, icon-192.png, icon-512.png')
