-- A presign upload session isn't single-use — verifyUploadSession checks only
-- HMAC + TTL, no nonce (docs/17 T2.1). A valid session could therefore be
-- replayed against /api/memories to mint unlimited duplicate live rows: the
-- file-flow commit records no rate event (that's counted once at presign), so
-- overRateLimit never trips. This breaks the D9 P4 gate invariant "1 Turnstile
-- solve = 1 upload batch".
--
-- media_url is a server-minted UUID key (m/{year}/{uuid}.ext), unique per upload
-- and never client-supplied, so a UNIQUE rejects the replay at the DB while
-- normal uploads pass untouched. Partial (media_url is not null) so embed rows —
-- which carry no media_url — are exempt (multiple would collide on NULL under a
-- plain UNIQUE otherwise, though Postgres allows NULLs; partial is explicit).
create unique index memories_media_url_key on memories (media_url)
  where media_url is not null;
