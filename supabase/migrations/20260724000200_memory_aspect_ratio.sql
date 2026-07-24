-- Store each moment's media aspect ratio (width / height) so the wall skeleton
-- reserves the exact box before the image decodes — no masonry reflow when the
-- photo lands (docs/00 D32). Nullable: embeds/clips and any legacy row have no
-- ratio and fall back to a default placeholder. Client-captured, server-clamped
-- to a sane range — never trusted as-is (docs/00 D9 P1).
alter table public.memories add column aspect_ratio real;

-- memories uses a COLUMN-level SELECT grant to keep takedown_token unreadable
-- (init_schema), so a new column is invisible to anon until explicitly granted
-- — mirror the author_link grant in 20260712000500.
grant select (aspect_ratio) on memories to anon, authenticated;

-- Keep the realtime INSERT payload's column list identical to what REST reads
-- (see 20260714000200) so a live-inserted card sizes the same as a fetched one.
alter publication supabase_realtime drop table memories;
alter publication supabase_realtime add table memories (
  id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start,
  clip_length, caption, source_lang, author_name, author_link, author_id,
  origin_country, aspect_ratio, status, created_at
);
