-- =====================================================================================
-- Consumo de cartón · Módulo HOJAS SINGLE (etapa 3)
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin problema (no borra ni cambia nada de Cartón).
--
-- Crea 2 tablas nuevas, separadas de Cartón:
--   hs_programa  → programación que viene del Excel del ERP («Líneas comp. ped. prod.»), una fila por OP.
--   hs_registros → hojas reales por mueble que Administración pasa del PDF firmado por el operador.
-- Permisos: Administración lee y escribe · Consulta solo lee · Planta no ve nada.
-- =====================================================================================

-- Rol del usuario que hace la consulta (tabla «perfiles» que ya usa la app).
create or replace function public.hs_rol() returns text
  language sql stable security definer set search_path = public
as $$ select rol from public.perfiles where user_id = auth.uid() $$;

-- ---------- Programación (del ERP) ----------
create table if not exists public.hs_programa (
  op          text primary key,                 -- Nº orden producción
  modelo      text not null default '',         -- Cód. procedencia
  area        text not null check (area in ('MUEBLES','LIBREROS')),   -- de «Cód. conexión ruta»
  fecha_venc  date,                             -- Fecha vencimiento = Fecha de programa del PDF
  data        jsonb not null default '{}',      -- kg por mueble, kg esperados, muebles, hojas por mueble, estado ERP…
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists hs_programa_fecha on public.hs_programa (fecha_venc, area);

-- ---------- Registros reales (captura de Administración) ----------
create table if not exists public.hs_registros (
  id          bigint generated always as identity primary key,
  op          text not null,                    -- puede no estar en hs_programa (OP agregada a mano en el PDF)
  ts          bigint not null,                  -- fecha de captura (milisegundos, igual que Cartón)
  data        jsonb not null default '{}',      -- hojas reales por mueble, comentario, copia de lo programado…
  version     integer not null default 1,       -- evita que dos personas se pisen al corregir
  capturado_por text,
  deleted_at  timestamptz                       -- borrado lógico: nunca se pierde un registro
);
create index if not exists hs_registros_op on public.hs_registros (op) where deleted_at is null;

-- ---------- Permisos (RLS) ----------
alter table public.hs_programa  enable row level security;
alter table public.hs_registros enable row level security;

drop policy if exists hs_programa_leer   on public.hs_programa;
drop policy if exists hs_programa_admin  on public.hs_programa;
drop policy if exists hs_registros_leer  on public.hs_registros;
drop policy if exists hs_registros_admin on public.hs_registros;

create policy hs_programa_leer  on public.hs_programa  for select to authenticated using (public.hs_rol() in ('admin','consulta'));
create policy hs_programa_admin on public.hs_programa  for all    to authenticated using (public.hs_rol() = 'admin') with check (public.hs_rol() = 'admin');
create policy hs_registros_leer  on public.hs_registros for select to authenticated using (public.hs_rol() in ('admin','consulta'));
create policy hs_registros_admin on public.hs_registros for all    to authenticated using (public.hs_rol() = 'admin') with check (public.hs_rol() = 'admin');

grant select, insert, update, delete on public.hs_programa, public.hs_registros to authenticated;

-- Listo. Para comprobar, corre:  select count(*) from public.hs_programa;   (debe dar 0 la primera vez)
