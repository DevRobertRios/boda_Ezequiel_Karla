-- =========================================================
-- RECUERDOS v3 — Setup Supabase
-- Cloudinary guarda los archivos. Supabase solo guarda metadatos.
-- Cambio vs v2: se agrega columna "url_thumb" (thumbnail de Cloudinary)
--               y se elimina "storage_path" (ya no usamos Supabase Storage)
-- =========================================================

-- Si ya corriste el SQL anterior, usa esto para migrar:
-- alter table media add column if not exists url_thumb text;
-- alter table media drop column if exists storage_path;

-- Si es instalación nueva, crea la tabla desde cero:
create table if not exists media (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  text not null default 'EK2025',
  guest_name  text,
  file_name   text not null,
  file_type   text not null check (file_type in ('image', 'video')),
  url         text not null,        -- URL original en Cloudinary
  url_thumb   text,                 -- URL del thumbnail (generada por Cloudinary)
  public_id   text,                 -- public_id de Cloudinary (para borrar desde admin)
  approved    boolean not null default true,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_media_gallery
  on media (wedding_id, approved, uploaded_at desc);

-- RLS
alter table media enable row level security;

create policy "Subida pública"
  on media for insert with check (true);

create policy "Lectura pública aprobados"
  on media for select using (approved = true);

create policy "Admin lee todo"
  on media for select to authenticated using (true);

create policy "Admin edita"
  on media for update to authenticated using (true);

create policy "Admin borra"
  on media for delete to authenticated using (true);

-- Vista útil para ver resumen desde el SQL Editor
create or replace view resumen_media as
select
  coalesce(guest_name, 'Anónimo') as invitado,
  count(*) as total,
  count(*) filter (where file_type = 'image') as fotos,
  count(*) filter (where file_type = 'video') as videos,
  max(uploaded_at) as ultima_subida
from media
where wedding_id = 'EK2025'
group by guest_name
order by total desc;
