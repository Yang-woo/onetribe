# One Tribe

A place where hardstyle fans around the world keep the moments they took home from the dancefloor — in their own language.

> ⚠️ **Unofficial fan project — not affiliated with, endorsed by, or connected to Q-dance / Defqon.1.** No official logos, trademarks, or assets are used.

🌐 [onetribe.dance](https://onetribe.dance) · 🚧 **Work in progress**

## What it is

A multilingual, real-time memory wall for the global hard-dance community. Fans upload the photos and clips they captured at festivals; everyone can browse, relive, and share them — auto-translated into their own language. Built to carry the weekend into the week.

Starting with **Defqon.1**, designed to grow across the wider hardstyle scene.

## Tech stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS**
- **Supabase** — Postgres, Auth, Realtime, Row-Level Security
- **Cloudflare R2** — media storage (zero egress)
- **next-intl** + a translation cache — full i18n with per-memory localized pages

## Features (MVP)

- 🌍 **Multilingual memory wall** — real-time, captions auto-translated & cached
- 📤 **No-login upload, instantly live** — with community reports and fast takedown
- 🔗 **Moment Cards** — every memory gets its own shareable page with an OG image
- 🎫 **Festival Passport** — log the editions you attended, earn "my Nth Defqon" badges

## Getting started

> Code scaffolding in progress. Once available:

```bash
yarn install
cp .env.example .env.local   # fill in your own keys
yarn dev
```

## Contributing

This is a community project. Issues and PRs welcome. Please keep uploads to content you captured yourself and hold the rights to.

## License

[MIT](./LICENSE) — for the code. The "One Tribe" name and any brand assets are not covered by this license.

## Disclaimer

Fan-made and non-commercial. Not affiliated with Q-dance, Defqon.1, or any festival or artist. All uploaded content belongs to the fans who created it.
