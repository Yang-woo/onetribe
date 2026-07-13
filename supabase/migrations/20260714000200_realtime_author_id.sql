-- The 000500 publication rebuild added author_link but dropped author_id, so
-- realtime INSERT payloads lost the column that REST reads (Moment.author_id).
-- Re-add it to keep the wall's fetched vs live rows identical. takedown_token
-- stays off the list. (Code review 2026-07-14.)

alter publication supabase_realtime drop table memories;
alter publication supabase_realtime add table memories (
  id, event_id, media_url, thumb_url, media_kind, embed_url, clip_start,
  clip_length, caption, source_lang, author_name, author_link, author_id,
  origin_country, status, created_at
);
