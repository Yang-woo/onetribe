# One Tribe

A place where hardstyle fans around the world keep the moments they took home from the dancefloor — in their own language.

> ⚠️ **Unofficial fan project — not affiliated with, endorsed by, or connected to Q-dance / Defqon.1 / ID&T.** No official logos, trademarks, or assets are used.

🌐 **[onetribe.world](https://onetribe.world)** — live · [![CI](https://github.com/Yang-woo/onetribe/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-woo/onetribe/actions/workflows/ci.yml)

## What it is

A multilingual, real-time memory wall for the global hard-dance community. Fans upload the photos they captured at festivals; everyone can browse, relive, and share them — with captions translated into their own language. Built to carry the weekend into the week.

Starting with **Defqon.1**, designed to grow across the wider hardstyle scene.

The site is live and feature-complete; it has not been publicly announced yet, so the wall is still being seeded.

## Features

- 🌍 **Memory wall in 17 languages** — real-time, with captions machine-translated and cached, and the original always one tap away
- 📤 **Upload without an account** — a moment goes live immediately; moderation happens after the fact, backed by community reports and self-serve takedown
- 🖼️ **Photos and GIFs** — JPEG, PNG, WebP and GIF, compressed in the browser, up to 5 per moment. Video is linked, never re-hosted
- 🔗 **Moment pages** — every memory gets a shareable URL and a generated OG card
- 🎫 **Festival Passport** — log the editions you attended and collect "my Nth Defqon" stamps. Anonymous by default; connect an email or Google account only if you want it to survive a lost device
- ♿ **Accessible** — Lighthouse accessibility 100 on the wall and the upload flow

## Tech stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS v4**, deployed on **Vercel**
- **Supabase** — Postgres, Auth, Realtime, Row-Level Security. Every write goes through a route handler; the browser never holds an insert policy
- **Cloudflare R2** — media storage (zero egress), with a static WebP thumbnail generated per upload
- **next-intl** + **DeepL** behind an adapter, with a permanent translation cache
- **Cloudflare Turnstile** on write paths, **Cloudflare Web Analytics** for cookieless page counts

## Getting started

Requires **Node 22** (`nvm use`) and **Docker** for the local Supabase stack.

```bash
yarn install
cp .env.example .env.local   # fill in your own keys
yarn supabase start          # local Postgres + Auth, prints the anon key
yarn dev
```

Set `STORAGE_DRIVER=local` in `.env.local` to run the whole upload pipeline without a Cloudflare account — files land on disk instead of R2. Translation falls back to the original caption when `DEEPL_API_KEY` is unset, so the app runs fine without it.

## Tests

```bash
yarn test        # unit + component (Vitest)
yarn test:db     # RLS and policy behaviour against local Supabase
yarn test:e2e    # user journeys (Playwright, mobile + desktop)
```

`test:db` runs against a real local Supabase using the anon key rather than mocks, because the access rules are the thing most worth proving. Tests are written to fail when the behaviour breaks — a test that only exists to make a suite green is treated as a bug. CI runs all three on every push.

## Non-commercial

No ads, no merchandise, no paid features, no perks. Donations, if any, cover the server bill and buy the donor nothing — that is the whole arrangement, and it is not going to change.

## Reporting a problem

- **Content** — every moment carries a report link, and anyone who appears in a photo can request removal at [onetribe.world/en/takedown](https://onetribe.world/en/takedown)
- **Security** — please email <privacy@onetribe.world> rather than opening a public issue

## Contributing

Issues and pull requests are welcome. The product direction is set by a small non-commercial scope, so it helps to open an issue before building something large.

## License

[MIT](./LICENSE) — for the code. The "One Tribe" name, logo, and brand assets are not covered by this license. `public/kofi-cup.png` is Ko-fi's mark, used unmodified under their brand-asset terms.

## Disclaimer

Fan-made and non-commercial. Not affiliated with Q-dance, Defqon.1, ID&T, or any festival or artist. All uploaded content belongs to the fans who created it.
