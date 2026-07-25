-- translations.target_lang was char(2), which truncates/rejects multi-part
-- locale codes like zh-Hant (docs/00 D20, 7 chars). Every zh-Hant cache upsert
-- silently failed with 22001 and every read missed, so that locale re-hit DeepL
-- on every view — breaking the "cache hit costs nothing" model (docs/16) and
-- burning the free quota in proportion to traffic. Widen to text so the MT cache
-- stores and hits for every supported locale. Existing 2-char values are
-- unaffected (char(2) held exactly-2-char codes: en, ko, zh, …).
alter table translations alter column target_lang type text;
