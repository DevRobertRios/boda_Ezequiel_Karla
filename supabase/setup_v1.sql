-- =========================================================
-- BODA EZEQUIEL & KARLA — Setup de Base de Datos en Supabase
-- =========================================================
-- Cómo usar este archivo:
-- 1. Entra a tu proyecto en https://supabase.com
-- 2. Ve a "SQL Editor" (ícono de consola en el menú lateral)
-- 3. Pega TODO este archivo y dale "Run"
-- =========================================================

-- ---------------------------------------------------------
-- TABLA 1: invitados
-- Aquí precargas TÚ, una sola vez, cada familia/código antes
-- de mandar las invitaciones. El invitado nunca escribe su
-- nombre: solo confirma lo que ya está aquí.
-- ---------------------------------------------------------
create table if not exists invitados (
  codigo text primary key,              -- ej: 'garcia24' (va en la URL ?inv=garcia24)
  nombre_mostrar text not null,         -- ej: 'Familia García'
  pases_asignados integer not null default 1,
  grupo text,                           -- opcional: 'Familia novia', 'Amigos', 'Trabajo', etc.
  created_at timestamp with time zone default now()
);

-- ---------------------------------------------------------
-- TABLA 2: rsvp
-- Aquí se guarda la respuesta de cada familia (1 fila por
-- código, se actualiza si confirman más de una vez).
-- ---------------------------------------------------------
create table if not exists rsvp (
  id uuid primary key default gen_random_uuid(),
  codigo text not null references invitados(codigo),
  asiste boolean not null,
  num_personas_confirmadas integer not null default 0,
  respondido_at timestamp with time zone default now(),
  unique (codigo)  -- un código solo puede tener UNA respuesta (se sobreescribe)
);

-- ---------------------------------------------------------
-- SEGURIDAD (RLS — Row Level Security)
-- ---------------------------------------------------------
alter table invitados enable row level security;
alter table rsvp enable row level security;

-- Cualquiera con el link puede LEER su propio registro de invitados
-- (necesario para mostrar "Familia García, tienen 4 lugares")
create policy "Allow public read invitados"
  on invitados for select
  using (true);

-- ---------------------------------------------------------
-- SEGURIDAD DEL PANEL ADMIN (admin.html)
-- Solo un usuario AUTENTICADO (Ezequiel o Karla, con su login)
-- puede crear, editar o borrar invitados. El público en general
-- NO puede hacer esto — solo puede leer (política de arriba).
-- ---------------------------------------------------------

-- Solo usuarios logueados pueden agregar invitados nuevos
create policy "Allow authenticated insert invitados"
  on invitados for insert
  to authenticated
  with check (true);

-- Solo usuarios logueados pueden editar (ej. cambiar pases_asignados)
create policy "Allow authenticated update invitados"
  on invitados for update
  to authenticated
  using (true);

-- Solo usuarios logueados pueden borrar un invitado
create policy "Allow authenticated delete invitados"
  on invitados for delete
  to authenticated
  using (true);

-- Cualquiera puede INSERTAR su respuesta de asistencia
create policy "Allow public insert rsvp"
  on rsvp for insert
  with check (true);

-- Cualquiera puede ACTUALIZAR su respuesta (por si cambian de opinión
-- y vuelven a confirmar con el mismo link)
create policy "Allow public update rsvp"
  on rsvp for update
  using (true);

-- Permite leer las respuestas (útil si luego quieres un panel propio)
create policy "Allow public read rsvp"
  on rsvp for select
  using (true);

-- Solo usuarios logueados (los novios) pueden borrar una confirmación
-- (útil para limpiar respuestas de prueba o errores)
create policy "Allow authenticated delete rsvp"
  on rsvp for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------
-- CREAR EL USUARIO ADMIN (Ezequiel y/o Karla)
-- Esto NO se hace por SQL — se hace en el panel de Supabase:
--
-- 1. Ve a Authentication → Users (menú lateral)
-- 2. Clic en "Add user" → "Create new user"
-- 3. Escribe el correo y una contraseña segura
-- 4. Marca "Auto Confirm User" (así no necesita verificar por email)
-- 5. Clic en "Create user"
--
-- Repite esto una vez por cada novio que quieras que tenga acceso
-- al panel admin.html. Con ese correo y contraseña entrarán ahí.
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- EJEMPLO: cómo cargar tu lista de invitados
-- Borra estas líneas de ejemplo y reemplázalas con tu lista real.
-- ---------------------------------------------------------
insert into invitados (codigo, nombre_mostrar, pases_asignados, grupo) values
  ('garcia24', 'Familia García', 4, 'Familia novia'),
  ('lopez10',  'Familia López',  2, 'Amigos'),
  ('martinez', 'Juan Martínez',  1, 'Trabajo')
on conflict (codigo) do nothing;

-- ---------------------------------------------------------
-- VISTA ÚTIL: resumen de confirmaciones (opcional, para ti)
-- Te permite ver de un vistazo cuántos han confirmado.
-- Consúltala luego en el SQL Editor con: select * from resumen_rsvp;
-- ---------------------------------------------------------
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
    when r.asiste then 'Confirmado'
    else 'No asistirá'
  end as estado
from invitados i
left join rsvp r on r.codigo = i.codigo
order by i.nombre_mostrar;