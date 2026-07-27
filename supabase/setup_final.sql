-- =========================================================
-- BODA KARLA & EZEQUIEL — Setup completo de Supabase
-- v6 — invitados por familia + miembros individuales + media
--      + mesas y asientos (plano de mesas)
-- =========================================================
-- Cómo usar:
-- 1. Entra a https://supabase.com → tu proyecto
-- 2. Ve a "SQL Editor" (menú lateral)
-- 3. Pega TODO este archivo y dale "Run"
--
-- ⚠️ Este script BORRA las tablas anteriores (invitados, rsvp,
-- media, mesas, asientos) y las vuelve a crear desde cero.
-- Úsalo solo si tus datos actuales son de prueba y no te
-- importa perderlos.
-- =========================================================


-- =========================================================
-- LIMPIEZA — borra todo lo anterior
-- (orden importa por las foreign keys)
-- =========================================================
drop view if exists resumen_rsvp;
drop view if exists resumen_media;
drop view if exists resumen_mesas;

drop table if exists asientos;
drop table if exists mesas;
drop table if exists miembros;
drop table if exists rsvp;
drop table if exists media;
drop table if exists invitados;


-- =========================================================
-- TABLA 1: invitados
-- Representa a la FAMILIA/GRUPO (ej. "Familia Godínez"),
-- no a una persona. Una sola invitación por familia.
-- =========================================================
create table invitados (
  codigo          text primary key,
  nombre_mostrar  text not null,        -- alias de la familia, ej. "Familia Godínez"
  grupo           text,                 -- Familia novia, Amigos, Trabajo...
  respondido_at   timestamptz,          -- se llena cuando confirman por primera vez
  created_at      timestamptz default now()
);

-- =========================================================
-- TABLA 2: miembros
-- Una fila por cada persona real dentro de una familia/código.
-- Aquí vive la confirmación individual de asistencia.
-- =========================================================
create table miembros (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null references invitados(codigo) on delete cascade,
  nombre     text not null,             -- nombre real, ej. "Mario Godínez"
  asiste     boolean,                   -- null = sin responder, true/false = confirmó
  orden      integer not null default 0,
  created_at timestamptz default now()
);

create index idx_miembros_codigo on miembros (codigo);

-- =========================================================
-- TABLA 3: media (recuerdos)
-- Solo metadatos. Los archivos viven en Cloudinary.
-- Cloudinary: /bodas/EK2026/originales/ y /bodas/EK2026/thumbnails/
-- =========================================================
create table media (
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

create index idx_media_gallery
  on media (wedding_id, approved, uploaded_at desc);

-- =========================================================
-- TABLA 4: mesas
-- Cada mesa del salón, con su capacidad de asientos.
-- =========================================================
create table mesas (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  text not null default 'EK2026',
  nombre      text not null,        -- "Mesa 1", "Mesa de honor"...
  forma       text not null default 'redonda'
              check (forma in ('redonda', 'cuadrada', 'rectangular', 'imperial')),
  capacidad   integer not null check (capacidad > 0),
  created_at  timestamptz default now()
);

create index idx_mesas_wedding on mesas (wedding_id);

-- =========================================================
-- TABLA 5: asientos
-- Un asiento por número dentro de una mesa. miembro_id queda
-- null mientras el lugar esté vacío. El estado de confirmación
-- (verde/rojo/gris) SIEMPRE se lee de miembros.asiste — no se
-- duplica aquí, así nunca se desincroniza.
-- =========================================================
create table asientos (
  id          uuid primary key default gen_random_uuid(),
  mesa_id     uuid not null references mesas(id) on delete cascade,
  numero      integer not null,     -- posición dentro de la mesa (1..capacidad)
  miembro_id  uuid references miembros(id) on delete set null,
  unique (mesa_id, numero),
  unique (miembro_id)               -- un miembro solo puede estar en un asiento
);

create index idx_asientos_mesa on asientos (mesa_id);
create index idx_asientos_miembro on asientos (miembro_id);


-- =========================================================
-- SEGURIDAD — Row Level Security (RLS)
-- =========================================================

alter table invitados enable row level security;
alter table miembros  enable row level security;
alter table media     enable row level security;
alter table mesas     enable row level security;
alter table asientos  enable row level security;

-- ---------------------------------------------------------
-- Políticas: invitados
-- ---------------------------------------------------------
create policy "Lectura pública invitados"
  on invitados for select
  using (true);

-- Necesario para que el RSVP marque respondido_at al confirmar
create policy "Actualización pública invitados"
  on invitados for update
  using (true);

create policy "Admin crea invitados"
  on invitados for insert
  to authenticated
  with check (true);

create policy "Admin borra invitados"
  on invitados for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- Políticas: miembros
-- ---------------------------------------------------------
create policy "Lectura pública miembros"
  on miembros for select
  using (true);

-- Necesario para que cada quien marque su propio "asiste" en el RSVP
create policy "Actualización pública miembros"
  on miembros for update
  using (true);

-- Solo los novios crean/borran integrantes desde el admin
create policy "Admin crea miembros"
  on miembros for insert
  to authenticated
  with check (true);

create policy "Admin borra miembros"
  on miembros for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- Políticas: media (recuerdos)
-- ---------------------------------------------------------
create policy "Subida pública media"
  on media for insert
  with check (true);

create policy "Lectura pública media aprobada"
  on media for select
  using (approved = true);

create policy "Admin lee todo media"
  on media for select
  to authenticated
  using (true);

create policy "Admin edita media"
  on media for update
  to authenticated
  using (true);

create policy "Admin borra media"
  on media for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- Políticas: mesas y asientos
-- El plano de mesas es privado: solo los novios (autenticados)
-- lo ven y lo editan desde el admin. No hay lectura pública.
-- ---------------------------------------------------------
create policy "Admin todo mesas"
  on mesas for all
  to authenticated
  using (true)
  with check (true);

create policy "Admin todo asientos"
  on asientos for all
  to authenticated
  using (true)
  with check (true);


-- =========================================================
-- VISTAS ÚTILES (consultar desde SQL Editor)
-- =========================================================

-- Resumen de confirmaciones por familia, contando a sus miembros
create or replace view resumen_rsvp as
select
  i.codigo,
  i.nombre_mostrar,
  i.grupo,
  i.respondido_at,
  count(m.id)                                        as total_integrantes,
  count(m.id) filter (where m.asiste = true)          as confirmados,
  count(m.id) filter (where m.asiste = false)         as declinados,
  count(m.id) filter (where m.asiste is null)         as sin_responder,
  case
    when i.respondido_at is null                         then 'Sin responder'
    when count(m.id) filter (where m.asiste is null) > 0 then 'Parcial'
    when count(m.id) filter (where m.asiste = true) > 0   then 'Confirmado'
    else 'No asistirá'
  end as estado
from invitados i
left join miembros m on m.codigo = i.codigo
group by i.codigo, i.nombre_mostrar, i.grupo, i.respondido_at
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

-- Plano de mesas: cada asiento con su mesa, su miembro (si tiene)
-- y el estado de confirmación tomado directo de miembros.asiste
create or replace view resumen_mesas as
select
  mesa.id            as mesa_id,
  mesa.nombre        as mesa_nombre,
  mesa.forma         as mesa_forma,
  mesa.capacidad,
  a.id               as asiento_id,
  a.numero,
  mi.id              as miembro_id,
  mi.nombre          as miembro_nombre,
  inv.nombre_mostrar as familia,
  mi.asiste,
  case
    when mi.id is null      then 'vacio'
    when mi.asiste is true  then 'confirmado'
    when mi.asiste is false then 'no-asiste'
    else 'pendiente'
  end as estado_asiento
from mesas mesa
left join asientos a  on a.mesa_id = mesa.id
left join miembros mi on mi.id = a.miembro_id
left join invitados inv on inv.codigo = mi.codigo
order by mesa.nombre, a.numero;


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
-- (Si ya los habías creado antes, siguen ahí — Auth no se borró)
-- =========================================================


-- =========================================================
-- DATOS DE EJEMPLO — borra esto y captura tu lista real
-- desde el panel de admin cuando esté listo
-- =========================================================
insert into invitados (codigo, nombre_mostrar, grupo) values
  ('EK-GODINEZ-A1B', 'Familia Godínez', 'Familia novia'),
  ('EK-LOPEZ-C2D',   'Familia López',   'Amigos'),
  ('EK-MARTINEZ-E3F','Juan Martínez',   'Trabajo');

insert into miembros (codigo, nombre, orden) values
  ('EK-GODINEZ-A1B', 'Mario Godínez',  1),
  ('EK-GODINEZ-A1B', 'Julia Godínez',  2),
  ('EK-GODINEZ-A1B', 'Mateo Godínez',  3),
  ('EK-LOPEZ-C2D',   'Ana López',      1),
  ('EK-LOPEZ-C2D',   'Carlos López',   2),
  ('EK-MARTINEZ-E3F','Juan Martínez',  1);

-- Mesas de ejemplo — bórralas y crea las tuyas desde el admin
insert into mesas (nombre, forma, capacidad) values
  ('Mesa 1', 'redonda', 8),
  ('Mesa 2', 'redonda', 8),
  ('Mesa de honor', 'imperial', 6);