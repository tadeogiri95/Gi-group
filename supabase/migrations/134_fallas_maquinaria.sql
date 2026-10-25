-- 134: fallas y arreglos de la maquinaria (Mantenimiento, parte 35; ítem 43;
-- diseño en notes/diseno-menu-y-mantenimiento.md)
--
-- CONTEXTO: cualquier operario avisa que una máquina tiene un problema, desde
-- su Inicio o escaneando el QR pegado en la máquina, con foto y si quedó
-- parada. Cada ❌ Mal de una tarea del plan también deja una falla. Le llega
-- al responsable de mantenimiento (133). Al arreglarla se carga qué se hizo,
-- si fue interno o servicio externo, repuestos (como texto: no descuentan del
-- Stock), costo y factura. Mientras haya una falla que la dejó parada, la
-- máquina está 🔴 parada; al arreglarse vuelve a servicio. Con eso salen los
-- indicadores: horas paradas, tiempo medio entre fallas, tiempo medio de
-- arreglo y costo por mes.
--
-- Esta migración:
--   1. maquina_fallas: la falla (de dónde salió, descripción, foto, si dejó la
--      máquina parada y desde cuándo, responsable) y cómo terminó (arreglada
--      con su detalle, costo y factura, o descartada con el motivo).
--   2. RLS: misma regla por empresa que el resto (089); la app escribe solo
--      por /api/maquinaria. Sin delete: una falla cargada por error se descarta.
--
-- ORDEN: correr ANTES de unir el PR que la usa (después de la 132 y la 133).
-- Es idempotente. Va en un solo bloque (do $mig$ ... $mig$) por el editor SQL
-- de Supabase.

do $mig$
begin
  create table if not exists public.maquina_fallas (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    maquina_id        bigint not null references public.maquinas(id) on delete cascade,
    origen            text not null default 'aviso' check (origen in ('aviso', 'tarea')),
    registro_id       bigint references public.maquina_registros(id) on delete set null,
    punto_nombre      text check (punto_nombre is null or char_length(punto_nombre) <= 120),
    descripcion       text not null check (char_length(descripcion) between 1 and 300),
    foto              text check (foto is null or char_length(foto) <= 500),
    parada            boolean not null default false,
    parada_desde      timestamptz,
    responsable_id    uuid references public.empleados(id) on delete set null,
    estado            text not null default 'pendiente' check (estado in ('pendiente', 'resuelta', 'descartada')),
    creado_por        uuid references public.empleados(id) on delete set null,
    creado_nombre     text check (creado_nombre is null or char_length(creado_nombre) <= 120),
    created_at        timestamptz not null default now(),
    -- Cómo terminó
    detalle           text check (detalle is null or char_length(detalle) <= 1000),
    donde             text check (donde is null or donde in ('interno', 'externo')),
    repuestos         text check (repuestos is null or char_length(repuestos) <= 1000),
    costo             numeric(14, 2) check (costo is null or costo >= 0),
    factura_url       text check (factura_url is null or char_length(factura_url) <= 500),
    fotos             jsonb not null default '[]'::jsonb check (jsonb_typeof(fotos) = 'array' and jsonb_array_length(fotos) <= 4),
    motivo            text check (motivo is null or char_length(motivo) <= 300),
    cerrado_por       uuid references public.empleados(id) on delete set null,
    cerrado_nombre    text check (cerrado_nombre is null or char_length(cerrado_nombre) <= 120),
    cerrado_at        timestamptz
  );
  create index if not exists maquina_fallas_maquina on public.maquina_fallas (empresa_id, maquina_id, estado);
  create index if not exists maquina_fallas_fecha on public.maquina_fallas (empresa_id, created_at desc);

  alter table public.maquina_fallas enable row level security;
  drop policy if exists tenant_isolation_auth_maquina_fallas on public.maquina_fallas;
  create policy tenant_isolation_auth_maquina_fallas on public.maquina_fallas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  grant select, insert, update on public.maquina_fallas to authenticated;
  grant usage, select on sequence public.maquina_fallas_id_seq to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname = 'maquina_fallas';  -- t
