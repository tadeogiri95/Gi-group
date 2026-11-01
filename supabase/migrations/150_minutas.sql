-- 150: minuta de la reunión de Buenos Días (Minuta, parte M1; diseño en
-- notes/diseno-minuta-buenos-dias.md)
--
-- CONTEXTO: todas las mañanas (8:45 a 9:05) gerencia hace la reunión de
-- Buenos Días y la anota en una minuta (formato v2): asistencia, foco del día,
-- producción, instalación, diseño y técnica, feedback, compras y logística,
-- estacionamiento y notas. En Gypi se completa eligiendo las OT, los
-- artículos, los proveedores y las personas que ya están cargados, y cada
-- renglón queda guardado como dato para el seguimiento y los reportes.
--
-- Esta migración:
--   1. minutas: una por día y por empresa, con inicio, cierre, modera,
--      registra, asistencia y notas. Se cierra (estado = 'cerrada') al
--      terminar la reunión.
--   2. minuta_items: un renglón por ítem, con su sección, la OT y sus datos
--      (copiados al cargarlos: la minuta no cambia si la OT cambia después),
--      semáforo, texto, responsable, fecha objetivo, área, tipo, a qué
--      renglón de un día anterior continúa (viene_de) y cuándo se resolvió.
--      El id lo genera la app (uuid) para que el renglón conserve su id al
--      guardarse varias veces.
--   3. Catálogo: el módulo Minutas (viene con las OT y se apaga aparte).
--   4. RLS: misma regla por empresa que el resto (089). La app lee y escribe
--      solo por /api/minutas, que es solo para gerencia.
--
-- No toca ninguna tabla existente: las planillas, la planificación, el Gantt
-- y el stock solo se leen.
--
-- ORDEN: correr ANTES de unir el PR que la usa. Es idempotente. Va en un
-- solo bloque (do $mig$ ... $mig$) por el editor SQL de Supabase.

do $mig$
begin
  create table if not exists public.minutas (
    id                bigserial primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    fecha             date not null,
    inicio            time,
    cierre            time,
    modera            text check (modera is null or char_length(modera) <= 80),
    registra          text check (registra is null or char_length(registra) <= 80),
    -- Los presentes: ["Zacarías", "Luciano", ...]
    asistentes        jsonb not null default '[]'::jsonb check (jsonb_typeof(asistentes) = 'array' and jsonb_array_length(asistentes) <= 40),
    notas             text check (notas is null or char_length(notas) <= 4000),
    estado            text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
    cerrada_at        timestamptz,
    creado_por        uuid references public.empleados(id) on delete set null,
    actualizado_por   uuid references public.empleados(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  create unique index if not exists minutas_empresa_fecha on public.minutas (empresa_id, fecha);

  create table if not exists public.minuta_items (
    id                uuid primary key,
    empresa_id        uuid not null references public.empresa(id) on delete cascade,
    minuta_id         bigint not null references public.minutas(id) on delete cascade,
    seccion           text not null check (seccion in (
                        'foco', 'prod_terminada', 'prod_en_curso', 'prod_a_iniciar',
                        'inst_terminada', 'inst_en_curso', 'inst_pendiente', 'postventa',
                        'dyt', 'feedback', 'compra', 'movimiento', 'estacionamiento')),
    orden             integer not null default 0,
    ot                text check (ot is null or char_length(ot) <= 40),
    division          text check (division is null or char_length(division) <= 60),
    proyecto          text check (proyecto is null or char_length(proyecto) <= 200),
    cliente           text check (cliente is null or char_length(cliente) <= 200),
    semaforo          text check (semaforo is null or semaforo in ('verde', 'amarillo', 'rojo')),
    texto             text check (texto is null or char_length(texto) <= 1000),
    responsable       text check (responsable is null or char_length(responsable) <= 120),
    fecha_objetivo    date,
    -- Diseño y técnica: el área (presupuestos, relevamiento, diseno, tecnica);
    -- feedback: para qué área es
    area              text check (area is null or char_length(area) <= 40),
    -- Diseño y técnica: terminado, en_curso o a_hacer; feedback: el tipo;
    -- compras: la urgencia
    tipo              text check (tipo is null or char_length(tipo) <= 40),
    -- Lo propio de cada sección: proveedor, artículo, desde, hasta, vehículo,
    -- dónde, ¿planilla y material?
    datos             jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object'),
    -- El renglón de un día anterior que este continúa (seguimiento, parte M3)
    viene_de          uuid,
    resuelto_at       timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  create index if not exists minuta_items_minuta on public.minuta_items (empresa_id, minuta_id, seccion, orden);
  create index if not exists minuta_items_ot on public.minuta_items (empresa_id, ot) where ot is not null;

  insert into public.modulos (id, nombre, descripcion, disponible, orden) values
    ('minutas', 'Minutas', 'Minuta de la reunión diaria, seguimiento de lo que se pide y reportes.', true, 69)
  on conflict (id) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion,
        disponible = excluded.disponible, orden = excluded.orden;

  alter table public.minutas enable row level security;
  drop policy if exists tenant_isolation_auth_minutas on public.minutas;
  create policy tenant_isolation_auth_minutas on public.minutas for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Sin delete: una minuta queda en el historial
  grant select, insert, update on public.minutas to authenticated;
  grant usage, select on sequence public.minutas_id_seq to authenticated;

  alter table public.minuta_items enable row level security;
  drop policy if exists tenant_isolation_auth_minuta_items on public.minuta_items;
  create policy tenant_isolation_auth_minuta_items on public.minuta_items for all to authenticated
    using (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid)
    with check (empresa_id = (current_setting('request.jwt.claims', true)::json->>'eid')::uuid);
  -- Un renglón que se saca de la minuta abierta se borra
  grant select, insert, update, delete on public.minuta_items to authenticated;
end
$mig$;

-- ─── VERIFICACIÓN (solo lectura) ────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class where relname in ('minutas', 'minuta_items');  -- t, t
--   select disponible from public.modulos where id = 'minutas';  -- t
