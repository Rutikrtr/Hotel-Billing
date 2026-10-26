-- Optional table layout per hotel: areas (Hall 1, Hall 2, Garden...) with a grid (2x2, 3x3...) and tables placed
-- in its cells. Stored with the hotel's settings, so phones get it with the settings they already download.
-- Shape: { "on": true, "areas": [ { "id": "hall", "name": "Hall", "cols": 4, "rows": 3, "cells": [tableId | null, ...] } ] }
-- null or "on": false = the simple grid of all tables.
alter table public.restaurants add column if not exists table_layout jsonb;
grant update (table_layout) on public.restaurants to authenticated;

-- Table names are unique within a hotel (so a layout or a bill never mixes up two tables).
create unique index if not exists dining_tables_unique_name on public.dining_tables (restaurant_id, lower(trim(name)));
