-- Defqon.1 editions seed — reference data from docs/11-event-data.md.
-- edition = the year's official anthem title (scene convention).
-- NULL editions are pending verification (2025 theme, 2026/2027) — do not
-- guess; docs/11 D tracks the confirmation checklist.
-- 2026 is seeded canceled=true on purpose: it anchors the launch hook
-- ("the weekend that never happened").

insert into events (festival, edition, year, city, country, canceled) values
  -- Netherlands mainline (Almere Strand through 2010, Biddinghuizen from 2011)
  ('Defqon.1', '30 Minutes',                      2003, 'Almere',        'NL', false),
  ('Defqon.1', 'Demolition',                      2004, 'Almere',        'NL', false),
  ('Defqon.1', 'Emergency Call',                  2005, 'Almere',        'NL', false),
  ('Defqon.1', 'The Colour of the Harder Styles', 2006, 'Almere',        'NL', false),
  ('Defqon.1', 'Get Wasted',                      2007, 'Almere',        'NL', false),
  ('Defqon.1', 'Biological Insanity',             2008, 'Almere',        'NL', false),
  ('Defqon.1', 'Scrap Attack',                    2009, 'Almere',        'NL', false),
  ('Defqon.1', 'No Time To Waste',                2010, 'Almere',        'NL', false),
  ('Defqon.1', 'Unite',                           2011, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'World of Madness',                2012, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Weekend Warriors',                2013, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Survival of the Fittest',         2014, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'No Guts No Glory',                2015, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Dragonblood',                     2016, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Victory Forever',                 2017, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Maximum Force',                   2018, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'One Tribe',                       2019, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', null,                              2020, 'Biddinghuizen', 'NL', true),  -- COVID
  ('Defqon.1', null,                              2021, 'Biddinghuizen', 'NL', true),  -- COVID
  ('Defqon.1', 'Primal Energy',                   2022, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Path of the Warrior',             2023, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', 'Power of the Tribe',              2024, 'Biddinghuizen', 'NL', false),
  ('Defqon.1', null,                              2025, 'Biddinghuizen', 'NL', false), -- theme TBC (docs/11 D)
  ('Defqon.1', null,                              2026, 'Biddinghuizen', 'NL', true),  -- heat Code Red — launch hook
  ('Defqon.1', null,                              2027, 'Biddinghuizen', 'NL', false), -- upcoming (Jun 24-27)

  -- International editions (docs/11 B — seeded, UI exposure optional)
  ('Defqon.1 Australia', null, 2009, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2010, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2011, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2012, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2013, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2014, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2015, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2016, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2017, 'Sydney', 'AU', false),
  ('Defqon.1 Australia', null, 2018, 'Sydney', 'AU', false),
  ('Defqon.1 Chile',     null, 2014, 'Santiago', 'CL', false),
  ('Defqon.1 Chile',     null, 2015, 'Santiago', 'CL', false),
  ('Defqon.1 Chile',     null, 2016, 'Santiago', 'CL', false);
