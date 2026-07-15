-- Fill the 2025 and 2026 Defqon.1 anthem titles now that they're verified.
-- docs/11-event-data.md closeout: seeded NULL ("do not guess") until confirmed.
--   2025 "Where Legends Rise" (Vertile) — held 26-29 Jun 2025
--   2026 "Sacred Oath" (D-Sturb) — canceled mid-event (heat Code Red); the
--         edition stays canceled=true but now carries its anthem title.
-- Both confirmed against Wikipedia (Defqon.1 Festival) + Hardstyle Mag.
-- Kept as a follow-up migration so the applied seed stays immutable.

update events set edition = 'Where Legends Rise'
  where festival = 'Defqon.1' and country = 'NL' and year = 2025;

update events set edition = 'Sacred Oath'
  where festival = 'Defqon.1' and country = 'NL' and year = 2026;
