-- Fix: Defqon.1 Chile never had a 2014 edition.
-- Verified 2026-07-20 (Puntoticket + Wikipedia, primary sources): Chile ran only
-- in 2015 and 2016 (×2) at Centro de Eventos Munich, Peñaflor near Santiago.
-- The 2014 row seeded in 20260712000400_seed_events.sql was a factual error.
-- Applied migrations are immutable, so this corrective delete runs after it;
-- a fresh `db reset` replays both and lands on the correct 2-edition state.
-- See docs/11-event-data.md (B표).
delete from events
where festival = 'Defqon.1 Chile' and year = 2014;
