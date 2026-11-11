-- 180: Finanzas, agenda de personas (parte 4 del plan del 11/11)
--
-- CONTEXTO: los desplegables de "Proveedor o cliente" solo traían lo cargado
-- en Gypi. La hoja PERSONAS del Plan de trabajo tiene ~1.450 clientes,
-- proveedores y contactos (sin CUIT y con repetidos como "GIRI EZEQUIEL" y
-- "EZEQUIEL GIRI"). Tadeo pidió una sola lista sin repetidos, donde se puedan
-- completar los datos que faltan y queden guardados. Alguien puede ser
-- cliente y proveedor a la vez: la persona apunta a los dos.
--
-- Esta migración:
--   1. fin_personas: nombre, otros nombres (alias), CUIT, teléfono, email,
--      dirección, contacto, notas, el ID de la hoja PERSONAS, y a qué
--      proveedor (Compras) y a qué cliente (Finanzas) corresponde. Al unir
--      dos repetidas, la que se suma queda inactiva con unido_a.
--   2. RLS: por empresa y solo el rol gerencial, como el resto de Finanzas.
--      Sin delete: una persona que no se usa se desactiva.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_personas (
    id            bigserial primary key,
    empresa_id    uuid not null references public.empresa(id) on delete cascade,
    nombre        text not null check (char_length(nombre) between 1 and 120),
    alias         text[] not null default '{}' check (cardinality(alias) <= 30),
    cuit          text check (cuit is null or char_length(cuit) <= 20),
    telefono      text check (telefono is null or char_length(telefono) <= 60),
    email         text check (email is null or char_length(email) <= 160),
    direccion     text check (direccion is null or char_length(direccion) <= 200),
    contacto      text check (contacto is null or char_length(contacto) <= 200),
    notas         text check (notas is null or char_length(notas) <= 500),
    id_planilla   text check (id_planilla is null or char_length(id_planilla) <= 20),
    proveedor_id  bigint references public.proveedores(id) on delete set null,
    cliente_id    bigint references public.fin_clientes(id) on delete set null,
    activo        boolean not null default true,
    unido_a       bigint references public.fin_personas(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );
  create index if not exists fin_personas_empresa on public.fin_personas (empresa_id, activo);

  alter table public.fin_personas enable row level security;
  drop policy if exists tenant_isolation_auth_fin_personas on public.fin_personas;
  create policy tenant_isolation_auth_fin_personas on public.fin_personas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_personas to authenticated;
  grant usage, select on sequence public.fin_personas_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'fin_personas';  -- t
--   select count(*) from public.fin_personas;  -- 0 hasta pegar la hoja PERSONAS
