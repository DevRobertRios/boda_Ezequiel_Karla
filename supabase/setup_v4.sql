-- =========================================================
-- BODA KARLA & EZEQUIEL — Setup completo de Supabase
-- v4 — unificado (invitados + rsvp + media/recuerdos)
-- =========================================================
-- Cómo usar:
-- 1. Entra a https://supabase.com → tu proyecto
-- 2. Ve a "SQL Editor" (menú lateral)
-- 3. Pega TODO este archivo y dale "Run"
-- =========================================================


-- =========================================================
-- TABLA 1: invitados
-- Precargada por los novios antes de mandar las invitaciones.
-- El invitado nunca escribe su nombre, solo confirma.
-- =========================================================
create table if not exists invitados (
  codigo          text primary key,
  nombre_mostrar  text not null,
  pases_asignados integer not null default 1,
  grupo           text,
  created_at      timestamptz default now()
);

-- =========================================================
-- TABLA 2: rsvp
-- Una fila por código. Se sobreescribe si el invitado
-- confirma más de una vez (upsert).
-- =========================================================
create table if not exists rsvp (
  id                      uuid primary key default gen_random_uuid(),
  codigo                  text not null references invitados(codigo),
  asiste                  boolean not null,
  num_personas_confirmadas integer not null default 0,
  respondido_at           timestamptz default now(),
  unique (codigo)
);

-- =========================================================
-- TABLA 3: media (recuerdos)
-- Solo metadatos. Los archivos viven en Cloudinary.
-- Cloudinary: /bodas/EK2026/originales/ y /bodas/EK2026/thumbnails/
-- =========================================================
create table if not exists media (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  text not null default 'EK2026',
  guest_name  text,
  file_name   text not null,
  file_type   text not null check (file_type in ('image', 'video')),
  url         text not null,      -- URL original en Cloudinary (/originales/)
  url_thumb   text,               -- JPEG 400x400 generado en canvas (/thumbnails/)
  public_id   text,               -- public_id de Cloudinary (para borrar desde admin)
  approved    boolean not null default true,
  uploaded_at timestamptz not null default now()
);

-- Índice para que la galería cargue rápido
create index if not exists idx_media_gallery
  on media (wedding_id, approved, uploaded_at desc);


-- =========================================================
-- SEGURIDAD — Row Level Security (RLS)
-- =========================================================

-- Activar RLS en las tres tablas
alter table invitados enable row level security;
alter table rsvp       enable row level security;
alter table media      enable row level security;

-- ---------------------------------------------------------
-- Políticas: invitados
-- ---------------------------------------------------------

-- Cualquiera puede LEER (necesario para mostrar el saludo personalizado)
create policy "Lectura pública invitados"
  on invitados for select
  using (true);

-- Solo los novios (autenticados) pueden CREAR, EDITAR y BORRAR invitados
create policy "Admin crea invitados"
  on invitados for insert
  to authenticated
  with check (true);

create policy "Admin edita invitados"
  on invitados for update
  to authenticated
  using (true);

create policy "Admin borra invitados"
  on invitados for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- Políticas: rsvp
-- ---------------------------------------------------------

-- Cualquiera puede confirmar asistencia
create policy "Subida pública rsvp"
  on rsvp for insert
  with check (true);

-- Cualquiera puede actualizar su respuesta (si cambia de opinión)
create policy "Actualización pública rsvp"
  on rsvp for update
  using (true);

-- Cualquiera puede leer (útil para el panel admin)
create policy "Lectura pública rsvp"
  on rsvp for select
  using (true);

-- Solo los novios pueden borrar confirmaciones
create policy "Admin borra rsvp"
  on rsvp for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- Políticas: media (recuerdos)
-- ---------------------------------------------------------

-- Cualquiera puede SUBIR fotos/videos (sin cuenta)
create policy "Subida pública media"
  on media for insert
  with check (true);

-- Cualquiera puede VER fotos aprobadas (galería pública)
create policy "Lectura pública media aprobada"
  on media for select
  using (approved = true);

-- Los novios ven TODO (incluyendo ocultas)
create policy "Admin lee todo media"
  on media for select
  to authenticated
  using (true);

-- Solo los novios pueden OCULTAR o MOSTRAR (cambiar approved)
create policy "Admin edita media"
  on media for update
  to authenticated
  using (true);

-- Solo los novios pueden BORRAR registros
create policy "Admin borra media"
  on media for delete
  to authenticated
  using (true);


-- =========================================================
-- VISTAS ÚTILES (consultar desde SQL Editor)
-- =========================================================

-- Resumen de confirmaciones de asistencia
create or replace view resumen_rsvp as
select
  i.codigo,
  i.nombre_mostrar,
  i.grupo,
  i.pases_asignados,
  r.asiste,
  r.num_personas_confirmadas,
  r.respondido_at,
  case
    when r.codigo is null then 'Sin responder'
    when r.asiste           then 'Confirmado'
    else 'No asistirá'
  end as estado
from invitados i
left join rsvp r on r.codigo = i.codigo
order by i.nombre_mostrar;

-- Resumen del álbum de recuerdos por invitado
create or replace view resumen_media as
select
  coalesce(guest_name, 'Anónimo') as invitado,
  count(*)                                              as total,
  count(*) filter (where file_type = 'image')           as fotos,
  count(*) filter (where file_type = 'video')           as videos,
  count(*) filter (where not approved)                  as ocultas,
  max(uploaded_at)                                      as ultima_subida
from media
where wedding_id = 'EK2026'
group by guest_name
order by total desc;


-- =========================================================
-- CREAR USUARIO ADMIN (los novios)
-- Esto NO se hace por SQL — se hace en el panel de Supabase:
--
-- 1. Authentication → Users → "Add user" → "Create new user"
-- 2. Correo y contraseña segura
-- 3. Marca "Auto Confirm User"
-- 4. "Create user"
--
-- Repite para cada novio que necesite acceso al dashboard.
-- =========================================================


-- =========================================================
-- DATOS DE EJEMPLO — borra esto y pon tu lista real
-- =========================================================
insert into invitados (codigo, nombre_mostrar, pases_asignados, grupo) values
  ('garcia24',  'Familia García',  4, 'Familia novia'),
  ('lopez10',   'Familia López',   2, 'Amigos'),
  ('martinez1', 'Juan Martínez',   1, 'Trabajo')
on conflict (codigo) do nothing;
