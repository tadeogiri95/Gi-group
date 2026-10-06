# Fase 1 — Errores y calidad de código

> Solo lectura sobre el código. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> Herramientas corridas localmente (Node 22.22, npm 10.9): `npm ci`, `npm run lint`, `tsc --noEmit`, `npm test`, `npm run test:coverage`, `npm run build`, `npm audit`, `npm outdated` y Playwright.
> **[HECHO]** = verificado en el código o en la salida de una herramienta · **[A VERIFICAR]** = depende de datos o configuración de producción (ver el anexo SQL).

## Resumen (5 líneas)

1. **El pipeline está verde:** build OK, 663/663 tests, lint con 0 errores (410 warnings), `tsc` 0 errores, CI de `main` en verde. Pero **`tsc` solo revisa 27 de los 163 archivos de `app/`**: el resto es JS sin chequeo de tipos.
2. **La cobertura (86% de líneas) engaña:** se mide solo sobre los archivos que importan los tests. Unas 60 pantallas y hooks (registro de actividad, Inbox, dashboard, sesión) no tienen ni un test.
3. Encontré **bugs funcionales que afectan datos de negocio:** las horas trabajadas probablemente se guardan como `NaN` en cada egreso, el tipo y la causa del tiempo improductivo nunca se guardan, la liquidación se trunca en 1.000 filas y “solicitar hora extra” falla siempre.
4. La **PWA instalada pierde la sesión** cada vez que se cierra (la sesión del cliente vive en `sessionStorage` y el manifest abre la landing), lo cual es inviable para un operario en planta.
5. Hay **2 vulnerabilidades críticas en dependencias**, una en `next` (bypass del middleware/proxy, que es donde vive el CSRF) que se resuelve subiendo una versión menor. Además hay inconsistencia de patrones, código muerto y reglas de negocio hardcodeadas.

---

## Resultados reales de las herramientas

| Herramienta | Resultado | Detalle |
|---|---|---|
| `npm ci` | OK (38 s) | Reporta 33 vulnerabilidades: 2 críticas, 18 altas, 12 moderadas, 1 baja |
| `npm run lint` | **0 errores, 410 warnings** | 251 `security/detect-object-injection` (mayormente ruido) · 36 `no-html-link-for-pages` · 26 `react-hooks/set-state-in-effect` · 26 `no-unescaped-entities` · 19 `unused-imports` (5 en `app/`) · 10 `exhaustive-deps` · 4 `preserve-manual-memoization` · 3 `static-components` · 1 `purity`, 1 `immutability`, 1 `refs`. Las reglas de hooks están bajadas a `warn` a propósito (`eslint.config.mjs:43-55`) |
| `tsc --noEmit` | 0 errores | Solo cubre `.ts/.tsx`: 27 archivos. Los 136 `.js/.jsx` no se chequean (`tsconfig.json`: `allowJs` sin `checkJs`) |
| `npm test` | **663/663 OK** (30 s) | node:test + RTL/jsdom |
| `npm run test:coverage` | 86.4% líneas · 82.1% ramas · 90.3% funciones | Solo sobre archivos importados por tests (ver F1-16) |
| `npm run build` | **OK**, 64 rutas | Warnings: `disableLogger` de Sentry deprecado; “edge runtime disables static generation” (`/api/og`). JS cliente total: 1,78 MB sin comprimir, 492 KB gzip (el análisis por ruta va en la Fase 3) |
| Playwright E2E | **Local: 2/3** · CI `main` (run 24): verde | Falla `smoke.spec.js:91`: el fichaje espera el GPS hasta 15 s (`app/lib/fichar.js:75`) y el `expect` corta a los 10 s. En el sandbox no hay geolocalización, así que es un test frágil (F1-17). También aparece un *hydration mismatch* en consola y el SW no registra porque no puede bajar los scripts de `gstatic` |
| `npm audit` | 2 críticas / 18 altas | Ver F1-05 |
| `npm outdated` | 25 paquetes atrás | Relevantes: `next` 16.2.6→16.3.8, `mercadopago` 3.1→3.6, `resend` 6.12→6.32, `supabase-js` 2.108→2.117, `@sentry/nextjs` 10.57→10.76 (11.x mayor), `firebase-admin` 13→14 (mayor) |

---

## Tabla de hallazgos

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación |
|---|---|---|---|---|---|
| F1-01 | **Crítico** (a verificar) | S | Bug / datos | `app/api/fichar/route.js:293`: `new Date(\`${fichada.fecha}T${fichada.ingreso}:00\`)`. La columna `fichadas.ingreso` es `time` (`SCHEMA_REFERENCIA.sql`) y PostgREST la devuelve como `"08:00:00"`; el propio test lo mockea así (`tests/api-fichar.test.js:39`). El resultado es `"…T08:00:00:00"` → `Invalid Date` → `horasTrab = NaN` → se guarda `horas_trabajadas = "NaN"` (Postgres `numeric` acepta `NaN`). Reproducido en Node: `Invalid Date NaN`. Los tests del egreso mockean `"08:00"` (`:196,258,292`) y por eso no lo detectan. Impacto: dashboard, score y liquidación ven 0 horas | Parsear la hora con `slice(0,5)` o calcular en SQL. Test con `"08:00:00"`. Consulta Q5 del anexo para medir el daño |
| F1-02 | **Alto** | S | Bug / datos | `app/hooks/useActividad.js:119-122` envía `tipo`, `causa` y `division`, pero la whitelist de `/api/data` (`app/lib/schemas.ts:46`) no los incluye y los descarta en silencio. `gerencia_actividad_screen.jsx:340,389-397` muestra tipo y causa que nunca se guardan: **todo el tiempo improductivo queda sin causa y todo registro como “Normal”** | Agregar los campos a la whitelist (validados) o mover a un endpoint propio. Consulta Q6 |
| F1-03 | **Alto** | S–M | Bug / PWA / sesión | `app/context/AuthContext.jsx` guarda la sesión en `sessionStorage` (`gi-session`), que se borra al cerrar la pestaña o la PWA aunque la cookie de refresh dure 30 días. `public/manifest.json` tiene `start_url: "/"` (la landing) y `app/page.js:147` busca `gi-session` en **`localStorage`**, donde nunca se escribe, así que nunca redirige al tenant. El `logout` manda a `/` y no a `/<slug>` | Restaurar la sesión desde la cookie (endpoint `/api/me`), `start_url` por tenant o recordar el último slug, y unificar el storage |
| F1-04 | **Alto** | S | Bug / reportes | `app/api/reportes/liquidacion/route.js:74`: `fichadas` del rango sin `limit` ni paginación. PostgREST de Supabase corta en *max rows* (1.000 por defecto) **sin error**: 50 empleados × 22 días = 1.100 filas → la liquidación sale incompleta. El cliente ya conoce este problema (`app/lib/supabase.js:171`) pero el endpoint no | Paginar con `Range` o agregar en SQL (RPC con `SUM … GROUP BY`) |
| F1-05 | **Alto** | S | Dependencias / seguridad | `npm audit`: **`next` 16.2.6 crítica** (GHSA-6gpp-xcg3-4w24, bypass de Middleware/Proxy con Turbopack; el CSRF y los headers de seguridad viven en `proxy.ts`), `websocket-driver` crítica, 18 altas (`undici`, `axios` vía Afip SDK, `protobufjs`/`@grpc/grpc-js` vía `firebase-admin`, `sharp`, `postcss`, etc.) | Subir `next` a 16.3.8 (dentro del rango `^`), `npm audit fix` para las transitivas y evaluar `firebase-admin` 14. Agregar `npm audit --audit-level=high` al CI |
| F1-06 | Medio | S | Bug | `app/components/screens/ChatScreen.jsx:148` crea una solicitud `tipo: "hora_extra"`, pero `app/api/data/route.js:138` no la acepta (`tiposValidos` no incluye `hora_extra`) → 400. **“Solicitar hora extra” falla siempre** y el usuario ve “Error al enviar la solicitud” | Agregar el tipo y, al aprobar, impactar `fichadas.horas_extra` |
| F1-07 | Medio | S | Código muerto / bug | `app/components/screens/InboxScreen.jsx:68-75`: aprobar un cambio de horario depende de `sol.datos_horario`, columna que no existe en el esquema ni en la whitelist, y hace `PATCH empleados.horas_semanales`, que tampoco está permitido. **Aprobar un cambio de horario no cambia nada** | Definir el flujo (guardar la propuesta, aplicarla server-side) o quitarlo |
| F1-08 | Medio | S | Bug / billing | `app/api/billing/webhook/route.js:244-264`: la idempotencia corta si el `gateway_payment_id` ya existe, **sin mirar si cambió el estado**. Un pago que llega `pending` y luego `approved` queda “pendiente” para siempre: no se emite la factura ARCA ni el email de confirmación (sí se repara el plan) | Idempotencia por `(payment_id, status)`; actualizar el estado en la transición |
| F1-09 | Medio (a verificar) | S | Billing | `webhook/route.js:85` trata el `ts` de `x-signature` como **milisegundos**, y los tests firman con `Date.now()` (`tests/api-billing-webhook.test.js:24`). Si Mercado Pago lo envía en segundos (sus ejemplos públicos muestran 10 dígitos), **todo webhook real se rechazaría como replay (403)**. No hay cobros reales, así que nunca se probó en vivo | Probar en sandbox y aceptar ambos formatos (`ts < 1e12 ⇒ ×1000`) |
| F1-10 | Medio | S | Bug / zona horaria | `app/hooks/useActividad.js:116`: `fecha: ahora.slice(0,10)` usa la fecha **UTC**; el historial filtra por `hoyArg()` (hora argentina, `:28,62`). Las tareas iniciadas después de las 21:00 (ART) quedan con fecha de mañana y no aparecen en el día (turno noche, horas extra) | Fecha local del tenant (`empresa.timezone`), idealmente calculada en el servidor |
| F1-11 | Medio | S | Bug / turno noche | `app/api/fichar/route.js:312-326`: el cálculo de horas extra usa el día de la semana **del egreso** y resta minutos sin cruzar la medianoche → en el turno nocturno `jornadaReal` sale negativa y la hora extra se pierde. Las horas totales sí consideran la medianoche (`:293-295`, salvo F1-01) | Calcular la jornada sobre timestamps completos y el día del ingreso |
| F1-12 | Medio | M | Race conditions / atomicidad | Escrituras de varios pasos desde el navegador, sin transacción: cambio de tarea = cerrar N abiertas y abrir otra (`useActividad.js:104-124`); aprobar un permiso de ingreso = PATCH de la solicitud, GET y POST de la fichada, POST de la notificación (`InboxScreen.jsx:53-67`). Un corte de red a mitad o dos dispositivos a la vez dejan estados inconsistentes (dos tareas abiertas, solicitud aprobada sin fichada) | Endpoints de servidor por caso de uso o RPC transaccionales |
| F1-13 | Medio | S | Sesión | `app/api/refresh-token/route.js:39-98`: rotación estricta del refresh sin período de gracia. Si dos pestañas, o la PWA y el navegador, refrescan a la vez, la segunda recibe 401 y desloguea (el *dedupe* de `lib/supabase.js:52` es por pestaña). La sesión en BD vence a los 30 días desde el login aunque haya actividad (`login-empresa/route.js:63`), y `expires_at` = 7 días no se usa | Ventana de gracia para el refresh_jti anterior y vencimiento deslizante |
| F1-14 | Medio | M | Reglas de negocio hardcodeadas | Tolerancia de 5 min, bloqueo con más de 30 min y bloqueo a la 3ra llegada tarde del mes (`app/lib/calc.js` `calcularTardanza`, `fichar/route.js:143-161`). “Premio por presentismo” en los mensajes (`ChatScreen.jsx:166-168`, `calc.js:150`). Pesos del score fijos (`calc.js:162`). 41 h semanales por defecto. **Son políticas de la fábrica piloto**: otro cliente necesita otras | Parámetros por tenant en `config_sistema` (se detalla en la Fase 2) |
| F1-15 | Medio | M–L | Tipado | `tsconfig.json`: `allowJs` sin `checkJs` → `tsc` = 0 errores sobre 27 archivos. 136 archivos JS/JSX sin tipos, incluidos todo `/api/data`, `fichar`, `webhook` y `useActividad` | Activar `// @ts-check` en las rutas críticas y migrar `app/lib` y las API a TS de a poco |
| F1-16 | Medio | M | Tests | La cobertura del 86% excluye los archivos que ningún test importa: `dashboard_gerencia.jsx`, `actividad_screen.jsx`, `useActividad.js`, `InboxScreen.jsx`, `ChatScreen.jsx`, `HomeContent.jsx`, `reportes_screen.jsx`, `gestion_personal_screen.jsx`, `lib/claude.js`, `lib/push.js`, `lib/csrf.js` (≈60 en total). `AuthContext.jsx` 63%, `lib/supabase.js` 54%, `planEnforcement.js` 46%. Los E2E (3) usan APIs mockeadas | Tests para: actividad (iniciar, cambiar, cerrar, causa), aprobación en Inbox, liquidación con más de 1.000 filas, egreso con `time` real, sesión PWA, CSRF |
| F1-17 | Bajo | S | Tests / UX | `app/lib/fichar.js:75`: GPS `timeout: 15000`; el E2E espera 10 s → falla sin GPS. **Para el operario: sin señal GPS, “Pensando…” durante 15 s** antes de fichar | Timeout más corto con feedback (“buscando ubicación…”) y `grantPermissions` en el E2E |
| F1-18 | Bajo | M | Consistencia de patrones | 40 archivos hacen `fetch` crudo a `/rest/v1` pese a la regla de `CONTRIBUTING.md` (`sbHelpers`); `/api/data` tiene su propio `sbFetch`. Validación zod en solo 9 de 60 rutas. 55 `fetch('/api…')` directos en componentes contra 13 `apiFetch`. `getLocalTime` (`fichar/route.js:27`) duplica `app/lib/dates.js`. Estilos mezclados: inline `style={{}}` (`ChatScreen.jsx:258`) y Tailwind. Pantallas en la raíz de `app/` en snake_case (`*_screen.jsx`) contra `components/screens/` en PascalCase | Converger en un cliente de datos, zod en toda ruta con body y una carpeta de features |
| F1-19 | Bajo | S | Manejo de errores | 49 `catch {}` o `.catch(() => {})` vacíos. `HomeContent.jsx:160`: un `Promise.all` de 8 consultas, si falla una cae toda la pantalla. 19 `console.*` en `api/` y `lib/` fuera del logger (ej. `api/geocode/route.js`). Errores de IA y actividad solo van a `console.error` sin feedback (`useActividad.js:35,46,76`) | `Promise.allSettled` y estados de error por bloque; usar siempre `logger` |
| F1-20 | Bajo | S | Código muerto | `app/components/DataTable.jsx`, `app/lib/usePlan.js` (sin importadores); la rama del prompt gerencial de `app/lib/claude.js:79-121` (bot gerencial removido, `HomeContent.jsx:367`); F1-07; migración `021` ausente | Borrar o reconectar |
| F1-21 | Bajo | S | Modelo de datos | `solicitudes` solo tiene `fecha` + `desde`/`hasta` como **horas** → no hay vacaciones de varios días. La liquidación cuenta 1 día por solicitud (`liquidacion/route.js:102-106`) | Rango de fechas real (`fecha_desde`/`fecha_hasta`) |
| F1-22 | Bajo | S | Mantenimiento | Sentry `disableLogger` deprecado (warning en el build). `firebase-messaging-sw.js` usa Firebase compat 10.12 por CDN contra el SDK 12.13 del cliente. Hydration mismatch en dev | Actualizar y alinear versiones |

**Cruces con la Fase 2** (son de seguridad, se detallan allá): la whitelist permite a un operario crear una solicitud con `estado: "aprobado"` (`schemas.ts:30`) y aprobarse (`:31`); `loadData` le trae a cualquier operario todos los empleados con email y diagrama, y todas las solicitudes de la empresa (`HomeContent.jsx:161-165`).

### Notas positivas (hechos)

- Hay CI real con lint, tests, coverage, build y E2E, y verde en `main`.
- Las rutas críticas tienen tests HTTP con mocks de `fetch` (fichar, login, refresh, webhook, data, tenant-isolation): son baratos de extender.
- Los errores 500 no filtran `err.message` en producción (`safeErrorMessage`).
- El egreso es idempotente ante doble toque (`fichar/route.js:354`).
- El login es *fail-closed* ante una caída de BD.
- Según el commit `1c2a869`, se migraron a bcrypt las 51 contraseñas en texto plano (lo verifica Q9).

---

## Preguntas abiertas

1. **Datos del piloto:** dado que no hay usuarios activos, ¿los datos actuales de `fichadas` y `registro_actividades` son de prueba? Si Q5/Q6 confirman `NaN` y causas vacías, ¿se pueden descartar o hay que recalcularlos?
2. **Reglas de asistencia:** la tolerancia de 5 min, el bloqueo con más de 30 min o a la 3ra tardanza y el “premio por presentismo”, ¿son políticas de la fábrica de muebles o querés que sean el default del producto? (Define si se parametrizan por cliente.)
3. **Bot de chat para fichar:** el operario ficha desde un chat (“Ya llegué”). ¿Es una decisión de producto que querés mantener, o preferís un botón grande de fichar como acción principal? (Lo retomo en la Fase 4.)

---

## Anexo — Consultas SQL para correr en Supabase (SQL Editor)

Son **todas de solo lectura** y sirven para cerrar los “a verificar” de las Fases 0, 1 y 2. Pegame el resultado de cada una (alcanza con captura o CSV).

```sql
-- Q1. ¿Qué funciones puede ejecutar el rol anónimo? (F0-03)
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       p.prosecdef as security_definer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by 1;

-- Q2. RLS habilitada por tabla (F0-05, F0-09)
select c.relname as tabla, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','m','v')
order by 1;

-- Q3. Policies existentes (public + storage)
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public','storage')
order by 1, 2, 3;

-- Q4. Permisos de anon/authenticated sobre tablas y vistas
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by 1, 2
order by 2, 1;

-- Q5. Bug de horas NaN (F1-01)
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='fichadas'
  and column_name in ('ingreso','egreso','horas_trabajadas','horas_extra');

select count(*)                                                    as total,
       count(*) filter (where egreso is not null)                  as con_egreso,
       count(*) filter (where horas_trabajadas = 'NaN'::numeric)   as horas_nan,
       count(*) filter (where egreso is not null and horas_trabajadas is null) as egreso_sin_horas,
       min(fecha), max(fecha)
from fichadas;

-- Q6. ¿Se guardan tipo/causa/división de actividades? (F1-02)
select tipo, causa, (division is null) as division_null, count(*)
from registro_actividades
group by 1, 2, 3
order by 4 desc;

-- Q7. Buckets de Storage (F0-07)
select id, public, file_size_limit, allowed_mime_types from storage.buckets;

-- Q8. Esquema real (para medir drift contra las migraciones) — exportar como CSV
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- Q9. Contraseñas que no son bcrypt (debería dar 0)
select 'empleados' as tabla, count(*) from empleados where password is not null and password not like '$2%'
union all
select 'empresa', count(*) from empresa where admin_password is not null and admin_password not like '$2%';

-- Q10. Volumen por empresa (dimensiona el piloto y los costos de la Fase 3)
select e.slug, e.plan_activo, e.created_at::date,
       (select count(*) from empleados x where x.empresa_id = e.id and x.activo)  as empleados_activos,
       (select count(*) from fichadas x where x.empresa_id = e.id)                as fichadas,
       (select count(*) from registro_actividades x where x.empresa_id = e.id)    as actividades
from empresa e
order by e.created_at;

-- Q11. Índices reales
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by 1, 2;
```

Fuera de SQL: en **Supabase → Project Settings → API → “Max rows”**, ¿qué valor tiene? (F1-04)
