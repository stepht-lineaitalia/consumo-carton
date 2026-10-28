-- =====================================================================================
-- Consumo de cartón · Planta puede EDITAR sus registros del día
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run (si sale el aviso, «Run query»).
-- Se puede correr más de una vez. Solo AGREGA un permiso; no quita ni cambia los que ya existen.
--
-- Permite al rol «planta» modificar registros de cartón capturados HOY (hora de México) que no estén borrados.
-- No permite borrar ni tocar registros de días anteriores. La app además limita a los registros del propio operador.
-- =====================================================================================
create or replace function public.hs_rol() returns text
  language sql stable security definer set search_path = public
as $$ select rol from public.perfiles where user_id = auth.uid() $$;

drop policy if exists reportes_planta_edita_hoy on public.reportes;
create policy reportes_planta_edita_hoy on public.reportes for update to authenticated
  using (
    public.hs_rol() = 'planta' and deleted_at is null
    and ts >= extract(epoch from (date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')) * 1000
  )
  with check (public.hs_rol() = 'planta' and deleted_at is null);

grant update on public.reportes to authenticated;
