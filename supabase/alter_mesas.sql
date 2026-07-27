-- =========================================================
-- MIGRACIÓN — posiciones libres del plano de mesas
-- Corre esto UNA sola vez en el SQL Editor de Supabase.
-- No borra nada, solo agrega dos columnas nuevas.
-- =========================================================

alter table mesas add column if not exists pos_x integer;
alter table mesas add column if not exists pos_y integer;