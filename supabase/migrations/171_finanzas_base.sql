-- 171: Finanzas, base (parte F1; diseño en el doc "Finanzas en Gypi: diseño
-- de F1 y F2", 09/11)
--
-- CONTEXTO: la contabilidad interna de la empresa vive en un libro de Google
-- Sheets (plan de cuentas, tipos de operación, cajas y bancos, centros de
-- costo y la hoja T-OPERACIONES). Finanzas lo trae a Gypi, primero
-- alimentando ese libro y después reemplazándolo. Es información sensible:
-- solo la ve el rol Dueño (gerencial). El Supervisor NO entra.
--
-- Esta migración:
--   1. fin_cuentas: plan de cuentas (código, nombre, rubro, naturaleza).
--   2. fin_tipos_operacion: tipos de operación con la cuenta del debe y del
--      haber por defecto y qué piden (proveedor o cliente, OT, centro de costo).
--   3. fin_tesoreria: cajas, bancos, FCI y plazos fijos, con su moneda y su
--      responsable (para "Mi caja", F3).
--   4. fin_centros_costo: centros de costo con su división.
--   5. fin_operaciones: el libro de operaciones (lo usa la parte F1b). Cada
--      operación guarda neto, IVA, otros impuestos, total, moneda y tipo de
--      cambio; el asiento (debe y haber) se arma con eso. Se anula, no se borra.
--   6. Catálogo: el módulo Finanzas (viene con las OT y se apaga aparte).
--   7. RLS: además de la regla por empresa, solo el rol gerencial (como
--      costos_empresa, 102). Sin delete: lo usado se desactiva o se anula.
--
-- No toca ninguna tabla existente.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.fin_cuentas (
    empresa_id   uuid not null references public.empresa(id) on delete cascade,
    codigo       text not null check (char_length(codigo) between 1 and 40),
    nombre       text not null check (char_length(nombre) between 1 and 120),
    rubro        text check (rubro is null or char_length(rubro) <= 60),
    naturaleza   text check (naturaleza is null or naturaleza in ('D', 'H')),
    activa       boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (empresa_id, codigo)
  );

  create table if not exists public.fin_tipos_operacion (
    empresa_id     uuid not null references public.empresa(id) on delete cascade,
    codigo         text not null check (char_length(codigo) between 1 and 80),
    nombre         text check (nombre is null or char_length(nombre) <= 120),
    grupo          text check (grupo is null or char_length(grupo) <= 40),
    base_contable  text check (base_contable is null or char_length(base_contable) <= 20),
    cuenta_debe    text check (cuenta_debe is null or char_length(cuenta_debe) <= 40),
    cuenta_haber   text check (cuenta_haber is null or char_length(cuenta_haber) <= 40),
    pide_entidad   boolean not null default false,
    pide_ot        boolean not null default false,
    pide_cc        boolean not null default false,
    descripcion    text check (descripcion is null or char_length(descripcion) <= 500),
    activo         boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    primary key (empresa_id, codigo)
  );

  create table if not exists public.fin_tesoreria (
    empresa_id       uuid not null references public.empresa(id) on delete cascade,
    cuenta           text not null check (char_length(cuenta) between 1 and 40),
    nombre           text not null check (char_length(nombre) between 1 and 120),
    tipo             text not null default 'caja' check (tipo in ('caja', 'banco', 'fci', 'plazo_fijo', 'otro')),
    moneda           text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    responsable_id   uuid references public.empleados(id) on delete set null,
    activa           boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    primary key (empresa_id, cuenta)
  );

  create table if not exists public.fin_centros_costo (
    empresa_id   uuid not null references public.empresa(id) on delete cascade,
    codigo       text not null check (char_length(codigo) between 1 and 60),
    nombre       text check (nombre is null or char_length(nombre) <= 120),
    division     text check (division is null or char_length(division) <= 60),
    tipo         text check (tipo is null or char_length(tipo) <= 40),
    activo       boolean not null default true,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (empresa_id, codigo)
  );

  create table if not exists public.fin_operaciones (
    id                  bigserial primary key,
    empresa_id          uuid not null references public.empresa(id) on delete cascade,
    fecha               date not null,
    tipo                text not null check (char_length(tipo) between 1 and 80),
    proveedor_id        bigint references public.proveedores(id) on delete set null,
    entidad             text check (entidad is null or char_length(entidad) <= 120),
    proyecto_id         bigint references public.proyectos(id) on delete set null,
    centro_costo        text check (centro_costo is null or char_length(centro_costo) <= 60),
    neto                numeric(16, 2) not null default 0,
    iva                 numeric(16, 2) not null default 0,
    otros_impuestos     numeric(16, 2) not null default 0,
    total               numeric(16, 2) not null,
    moneda              text not null default 'ARS' check (moneda in ('ARS', 'USD')),
    tipo_cambio         numeric(14, 4) check (tipo_cambio is null or tipo_cambio > 0),
    total_ars           numeric(16, 2) not null,
    cuenta_debe         text not null check (char_length(cuenta_debe) between 1 and 40),
    cuenta_haber        text not null check (char_length(cuenta_haber) between 1 and 40),
    descripcion         text check (descripcion is null or char_length(descripcion) <= 500),
    referencia          text check (referencia is null or char_length(referencia) <= 120),
    origen              text not null default 'manual' check (char_length(origen) between 1 and 30),
    origen_id           text check (origen_id is null or char_length(origen_id) <= 60),
    estado              text not null default 'confirmada' check (estado in ('confirmada', 'para_revisar')),
    cargada_por_nombre  text check (cargada_por_nombre is null or char_length(cargada_por_nombre) <= 120),
    anulada_at          timestamptz,
    anulada_por_nombre  text check (anulada_por_nombre is null or char_length(anulada_por_nombre) <= 120),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
  );
  create index if not exists fin_operaciones_fecha on public.fin_operaciones (empresa_id, fecha desc);
  create index if not exists fin_operaciones_proveedor on public.fin_operaciones (empresa_id, proveedor_id) where proveedor_id is not null;
  create index if not exists fin_operaciones_origen on public.fin_operaciones (empresa_id, origen, origen_id) where origen_id is not null;

  insert into public.modulos (id, nombre, descripcion, disponible, orden) values
    ('finanzas', 'Finanzas', 'Cajas, bancos, cheques, cuentas corrientes y el libro de operaciones. Solo para el dueño.', true, 70)
  on conflict (id) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion,
        disponible = excluded.disponible, orden = excluded.orden;

  -- RLS: por empresa y solo el rol gerencial (el dueño)
  alter table public.fin_cuentas enable row level security;
  drop policy if exists tenant_isolation_auth_fin_cuentas on public.fin_cuentas;
  create policy tenant_isolation_auth_fin_cuentas on public.fin_cuentas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_cuentas to authenticated;

  alter table public.fin_tipos_operacion enable row level security;
  drop policy if exists tenant_isolation_auth_fin_tipos_operacion on public.fin_tipos_operacion;
  create policy tenant_isolation_auth_fin_tipos_operacion on public.fin_tipos_operacion for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_tipos_operacion to authenticated;

  alter table public.fin_tesoreria enable row level security;
  drop policy if exists tenant_isolation_auth_fin_tesoreria on public.fin_tesoreria;
  create policy tenant_isolation_auth_fin_tesoreria on public.fin_tesoreria for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_tesoreria to authenticated;

  alter table public.fin_centros_costo enable row level security;
  drop policy if exists tenant_isolation_auth_fin_centros_costo on public.fin_centros_costo;
  create policy tenant_isolation_auth_fin_centros_costo on public.fin_centros_costo for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  grant select, insert, update on public.fin_centros_costo to authenticated;

  alter table public.fin_operaciones enable row level security;
  drop policy if exists tenant_isolation_auth_fin_operaciones on public.fin_operaciones;
  create policy tenant_isolation_auth_fin_operaciones on public.fin_operaciones for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial')
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid
           and (current_setting('request.jwt.claims', true)::json->>'rol') = 'gerencial');
  -- Sin delete: una operación mal cargada se anula
  grant select, insert, update on public.fin_operaciones to authenticated;
  grant usage, select on sequence public.fin_operaciones_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('fin_cuentas', 'fin_tipos_operacion', 'fin_tesoreria', 'fin_centros_costo', 'fin_operaciones');  -- todas t
--   select disponible from public.modulos where id = 'finanzas';  -- t
