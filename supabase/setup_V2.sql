-- =========================================================
-- BODA EZEQUIEL & KARLA — Setup de "Recuerdos" en Supabase
-- =========================================================
-- Este archivo es ADICIONAL a tu setup.sql original (el de
-- invitados y rsvp). Aquí solo se crea lo necesario para que
-- recuerdos.js funcione: la tabla "media" + el bucket de
-- almacenamiento para fotos/videos.
--
-- Cómo usar este archivo:
-- 1. Entra a tu proyecto en https://supabase.com
-- 2. Ve a "SQL Editor" y pega TODO este archivo, dale "Run"
-- 3. Luego ve a "Storage" (menú lateral) y crea el bucket
--    manualmente — ver instrucciones al final de este archivo
-- =========================================================

-- ---------------------------------------------------------
-- TABLA: media
-- Guarda los metadatos de cada foto/video subido por los
-- invitados (la URL pública viene de Supabase Storage).
-- ---------------------------------------------------------
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  wedding_id text not null default 'EK2025',  -- igual a WEDDING_ID en recuerdos.js
  guest_name text,                            -- nombre del invitado (opcional)
  file_name text not null,
  file_type text not null check (file_type in ('image', 'video')),
  url text not null,
  approved boolean not null default true,     -- pon false si quieres moderar antes de mostrar
  uploaded_at timestamp with time zone default now()
);

-- Índice para que la galería cargue rápido (ordena por fecha,
-- filtra por boda y por aprobado — exactamente lo que pide recuerdos.js)
create index if not exists idx_media_wedding_approved
  on media (wedding_id, approved, uploaded_at desc);

-- ---------------------------------------------------------
-- SEGURIDAD (RLS — Row Level Security)
-- ---------------------------------------------------------
alter table media enable row level security;

-- Cualquiera con el link puede SUBIR (insertar) un recuerdo —
-- es la idea de esta página: que los invitados compartan fotos
-- sin necesitar cuenta ni login.
create policy "Allow public insert media"
  on media for insert
  with check (true);

-- Cualquiera puede LEER los recuerdos aprobados — así carga
-- la galería pública en recuerdos.html
create policy "Allow public read approved media"
  on media for select
  using (approved = true);

-- Solo tú (autenticado, mismo login que usas en admin.html)
-- puedes ver TODOS los registros, incluso los no aprobados —
-- útil si más adelante activas moderación (approved = false
-- por default) y quieres revisar antes de publicar.
create policy "Allow authenticated read all media"
  on media for select
  to authenticated
  using (true);

-- Solo tú puedes editar un registro (ej. aprobar/rechazar una foto,
-- o corregir el nombre de quien la subió)
create policy "Allow authenticated update media"
  on media for update
  to authenticated
  using (true);

-- Solo tú puedes borrar un recuerdo (ej. una foto subida por error
-- o que no quieras en el álbum)
create policy "Allow authenticated delete media"
  on media for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- BUCKET DE STORAGE — "recuerdos"
-- Esto NO se hace por SQL, se hace en el panel de Supabase:
--
-- 1. Ve a "Storage" (menú lateral) → "Create a new bucket"
-- 2. Nombre del bucket: recuerdos   (debe coincidir exacto con
--    BUCKET_NAME en recuerdos.js)
-- 3. Marca "Public bucket" ✓  (así las fotos se pueden ver con
--    su URL pública sin necesitar login)
-- 4. Clic en "Create bucket"
--
-- Con el bucket marcado como público, NO necesitas políticas
-- adicionales de Storage para que las fotos se vean — pero si
-- quieres restringir quién puede SUBIR archivos al bucket
-- (no solo leer), puedes opcionalmente correr esto:
-- ---------------------------------------------------------

create policy "Allow public uploads to recuerdos bucket"
  on storage.objects for insert
  to public
  with check (bucket_id = 'recuerdos');

create policy "Allow public read recuerdos bucket"
  on storage.objects for select
  to public
  using (bucket_id = 'recuerdos');

-- ---------------------------------------------------------
-- VISTA ÚTIL (opcional): conteo de recuerdos por invitado
-- Consúltala en el SQL Editor con: select * from resumen_media;
-- ---------------------------------------------------------
create or replace view resumen_media as
select
  coalesce(guest_name, 'Anónimo') as invitado,
  count(*) as total_archivos,
  count(*) filter (where file_type = 'image') as fotos,
  count(*) filter (where file_type = 'video') as videos,
  max(uploaded_at) as ultima_subida
from media
where wedding_id = 'EK2025'
group by guest_name
order by total_archivos desc;