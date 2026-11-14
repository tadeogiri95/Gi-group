-- 191: Agenda única (etapa 1 de la auditoría de Finanzas integrada, 14/11)
--
-- CONTEXTO: una misma persona estaba en cuatro listas (proveedores de
-- Compras, clientes de Finanzas, la hoja PERSONAS y los empleados). La agenda
-- (fin_personas, migración 180) las juntaba al leerla, pero los cambios no
-- viajaban: un CUIT corregido en Compras no llegaba a la agenda, y los
-- empleados no estaban. Tadeo eligió que la agenda sea la lista única, con
-- cada persona y sus roles (cliente, proveedor, empleado).
--
-- Esta migración:
--   1. fin_personas.empleado_id: la persona también puede ser empleado.
--   2. Una persona por proveedor, por cliente y por empleado (índices únicos).
--      Antes, si había dos renglones apuntando al mismo, el más nuevo se suelta.
--   3. Un trigger en proveedores, fin_clientes y empleados: cuando se cambia
--      el nombre, el CUIT, el teléfono, el email, el contacto o las notas, el
--      cambio se copia a su renglón de la agenda. (Lo que se cambia en la
--      agenda ya se copia al proveedor y al cliente desde Gypi.)
--
-- Las personas que todavía no tienen su renglón (proveedores nuevos, clientes,
-- empleados) las crea Gypi la primera vez que el Dueño abre Finanzas →
-- Agenda, con la misma regla de nombres parecidos que ya usaba la agenda.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  alter table public.fin_personas add column if not exists empleado_id uuid references public.empleados(id) on delete set null;

  -- Si dos renglones apuntan al mismo proveedor, cliente o empleado, queda el más viejo
  update public.fin_personas p set proveedor_id = null, updated_at = now()
   where p.proveedor_id is not null
     and exists (select 1 from public.fin_personas x where x.empresa_id = p.empresa_id and x.proveedor_id = p.proveedor_id and x.id < p.id);
  update public.fin_personas p set cliente_id = null, updated_at = now()
   where p.cliente_id is not null
     and exists (select 1 from public.fin_personas x where x.empresa_id = p.empresa_id and x.cliente_id = p.cliente_id and x.id < p.id);
  update public.fin_personas p set empleado_id = null, updated_at = now()
   where p.empleado_id is not null
     and exists (select 1 from public.fin_personas x where x.empresa_id = p.empresa_id and x.empleado_id = p.empleado_id and x.id < p.id);

  create unique index if not exists fin_personas_un_proveedor on public.fin_personas (empresa_id, proveedor_id) where proveedor_id is not null;
  create unique index if not exists fin_personas_un_cliente on public.fin_personas (empresa_id, cliente_id) where cliente_id is not null;
  create unique index if not exists fin_personas_un_empleado on public.fin_personas (empresa_id, empleado_id) where empleado_id is not null;

  -- Copia a la agenda lo que se cambió en el proveedor, el cliente o el empleado.
  -- Corre con permisos propios porque Administración cambia proveedores y no ve la agenda.
  create or replace function public.fin_agenda_copiar() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_col text;
    v_tel text;
    v_viejo_tel text;
    v_contacto text;
    v_viejo_contacto text;
    v_notas text;
    v_viejo_notas text;
    v_cuit text;
    v_viejo_cuit text;
  begin
    if tg_table_name = 'proveedores' then
      v_col := 'proveedor_id';
      v_tel := new.whatsapp; v_viejo_tel := old.whatsapp;
      v_contacto := new.contacto; v_viejo_contacto := old.contacto;
      v_notas := new.notas; v_viejo_notas := old.notas;
      v_cuit := new.cuit; v_viejo_cuit := old.cuit;
    elsif tg_table_name = 'fin_clientes' then
      v_col := 'cliente_id';
      v_tel := new.telefono; v_viejo_tel := old.telefono;
      v_notas := new.notas; v_viejo_notas := old.notas;
      v_cuit := new.cuit; v_viejo_cuit := old.cuit;
    else
      v_col := 'empleado_id';
    end if;

    execute format($q$
      update public.fin_personas set
        nombre   = case when $1 is distinct from $2 and nullif(trim($1), '') is not null and nombre = $2 then left(trim($1), 120) else nombre end,
        cuit     = case when $3 is distinct from $4 and nullif(trim($3), '') is not null then left(trim($3), 20) else cuit end,
        telefono = case when $5 is distinct from $6 and nullif(trim($5), '') is not null then left(trim($5), 60) else telefono end,
        email    = case when $7 is distinct from $8 and nullif(trim($7), '') is not null then left(trim($7), 160) else email end,
        contacto = case when $9 is distinct from $10 and nullif(trim($9), '') is not null then left(trim($9), 200) else contacto end,
        notas    = case when $11 is distinct from $12 and nullif(trim($11), '') is not null then left(trim($11), 500) else notas end,
        updated_at = now()
      where empresa_id = $13 and %I = $14
    $q$, v_col)
    using new.nombre, old.nombre, v_cuit, v_viejo_cuit, v_tel, v_viejo_tel, new.email, old.email,
          v_contacto, v_viejo_contacto, v_notas, v_viejo_notas, new.empresa_id, new.id;
    return new;
  end
  $fn$;

  drop trigger if exists fin_agenda_copiar on public.proveedores;
  create trigger fin_agenda_copiar after update of nombre, cuit, whatsapp, email, contacto, notas on public.proveedores
    for each row execute function public.fin_agenda_copiar();
  drop trigger if exists fin_agenda_copiar on public.fin_clientes;
  create trigger fin_agenda_copiar after update of nombre, cuit, telefono, email, notas on public.fin_clientes
    for each row execute function public.fin_agenda_copiar();
  drop trigger if exists fin_agenda_copiar on public.empleados;
  create trigger fin_agenda_copiar after update of nombre, email on public.empleados
    for each row execute function public.fin_agenda_copiar();
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select column_name from information_schema.columns where table_name = 'fin_personas' and column_name = 'empleado_id';  -- 1 fila
--   select tgname, tgrelid::regclass from pg_trigger where tgname = 'fin_agenda_copiar';  -- 3 filas
