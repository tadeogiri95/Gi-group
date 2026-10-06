# Fase 3 — Arquitectura, performance, escalabilidad y costos

> Solo lectura. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> **[HECHO]** = código, build o consultas de producción (Q1–Q11) · **[ESTIMACIÓN]** = cálculo con supuestos explícitos · **[HIPÓTESIS]** = precio o comportamiento de terceros a validar.
> Contexto confirmado: Vercel Hobby + Supabase Free, un solo ambiente, piloto sin uso activo, mercado Argentina. Requisito nuevo del dueño: módulos de stock, compras, órdenes de producción, calidad y mantenimiento, activables por paquete y personalizables por cliente.

## Resumen (5 líneas)

1. Hay **dos índices únicos en producción que no incluyen la empresa** (`fichadas (legajo, fecha)` y `empleados (email)`): con un segundo cliente, el legajo 7 de una empresa no puede fichar si ese mismo día ya fichó el legajo 7 de otra, y una persona no puede ser empleada en dos empresas. **Es el bloqueante técnico número 1 para vender.**
2. El **costo variable lo dominan el polling y la IA:** cada usuario con la app abierta dispara 8 consultas cada 2 minutos más las recargas por Realtime. Estimo entre 0,3 y 1,3 millones de invocaciones de función y entre 3 y 10 GB de egress por mes **por tenant de 30 personas**, más de lo que permite el plan Hobby incluso con un solo cliente.
3. La app del tenant es una SPA 100% cliente (~275 KB gzip de JS inicial). La lógica de negocio y los agregados se calculan en el navegador sobre listas truncadas en silencio (500/1000 filas): **el dashboard mensual ya se trunca con los 31 empleados del piloto**.
4. **La operación no está lista para clientes pagos:** sin backups, sin staging, migraciones manuales con drift confirmado, observabilidad opcional (Sentry sin confirmar), y crons limitados a una ejecución diaria por el plan Hobby (la alerta de “30 min sin actividad” en realidad corre una vez por día).
5. Para sumar stock, compras, OP, calidad y mantenimiento propongo un **núcleo multi-tenant con módulos y permisos en base de datos**, servicios por módulo en lugar del gateway genérico, RLS real como segunda barrera y transacciones en Postgres. El `registro_actividades` (etapa + OT) ya es la semilla del módulo de producción.

---

## 1. Tabla de hallazgos

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación |
|---|---|---|---|---|---|
| F3-01 | **Crítico** | S | Multi-tenancy / datos | **Q11 (prod):** `fichadas_legajo_fecha_unique UNIQUE (legajo, fecha)` sin `empresa_id`. Los legajos son números chicos y se repiten entre empresas (todas tienen el legajo 1 = admin, `rpc_crear_empresa_con_admin`). `fichar/route.js:180` traduce el `23505` en “Ya fichaste ingreso hoy”. Además, la unicidad que el código asume (`empresa_id, empleado_id, fecha`, `SCHEMA_REFERENCIA.sql`) **no existe** en prod | Migración: `DROP` de ese índice y `UNIQUE (empresa_id, empleado_id, fecha)`. Test de dos tenants con el mismo legajo |
| F3-02 | **Alto** | S | Multi-tenancy / datos | **Q11:** `empleados_email_key UNIQUE (email)` global. La misma persona no puede estar en dos empresas (ej. un contador o un supervisor compartido) y el alta de un email ya usado en otro tenant falla. El error, además, revela que ese email existe en otra empresa | `UNIQUE (empresa_id, lower(email))`. El login con Google sin slug ya maneja `multiples_cuentas` (`auth/google/callback`) |
| F3-03 | **Alto** | S | Bug / performance | `/api/data` aplica `limit=500` por defecto (`route.js:189`). `dashboard_gerencia.jsx:321` pide **todas las fichadas del mes sin `limit`** → se cortan en 500. Piloto: 31 empleados × ~22 días ≈ 680 filas → **el ranking, el score y las horas del mes ya salen incompletos**. Lo mismo con `:320` (semana, con más empleados), `:324-325` y `HomeContent.jsx:161` (empleados) | Agregar en SQL (RPC o vistas por empresa y rango) y devolver totales, no filas; nunca truncar sin avisar |
| F3-04 | **Alto** | M | Escalabilidad / costos | `HomeContent.jsx:206-209`: `loadData` = **8 consultas** al montar, **cada 2 min** (polling) y **en cada broadcast** de Realtime (`useRealtimeSync`) de cualquier cambio en `solicitudes`, `notificaciones`, `registro_actividades` o `fichadas` de la empresa. Cada consulta es una invocación de función en Vercel más 1–2 consultas extra de auth (F3-05). Con 30 usuarios activos, un fichaje dispara 30 × 8 = 240 consultas | Cargar por pantalla (no todo el contexto global); Realtime con *payload* (qué fila cambió) o invalidación selectiva; polling solo con la pestaña visible (`visibilitychange`) y a intervalos más largos; un único endpoint agregado por pantalla |
| F3-05 | Medio | S | Performance | `app/lib/auth.js:115-124`: `validarToken` consulta `empresa.email_verificado` **en cada request**, sin caché (la de sesión sí cachea 5 min). Duplica las consultas a Supabase de toda la API. `planEnforcement.js` vuelve a leer el plan en cada POST (caché por instancia) | Meter `email_verificado` y el plan en el JWT o en la misma caché de sesión |
| F3-06 | Medio | M | Arquitectura | La app del tenant es una SPA: `[slug]/page.js` → `AuthProvider` y `HomeContent` (`"use client"`), y todo el dato pasa por `fetch` a `/api/data`. 45 archivos `"use client"`. Las pantallas grandes (`dashboard_gerencia.jsx` 1095 líneas, `geolocalizacion_screen.jsx` 1061, `reportes_screen.jsx` 835) calculan KPIs, scores y liquidaciones **en el navegador**. Las reglas de negocio quedan duplicadas entre cliente y servidor (ej. tardanzas en `calc.js` y `fichar`) | No hace falta pasar todo a Server Components; sí mover el **cálculo** al servidor o a SQL (servicios por dominio) y dejar el cliente como presentación. Es requisito para los módulos nuevos (stock no se puede calcular en el navegador) |
| F3-07 | Medio | S | Escalabilidad | `cron/push-ausencias/route.ts:135`: trae los empleados de **todas** las empresas con `limit=2000` → con unos 70 tenants de 30 personas empieza a ignorar empleados sin avisar. Recorre empresa por empresa en secuencia (1 consulta + 1 envío cada una) dentro de una sola función con límite de duración | Paginar o hacerlo por empresa en SQL (una RPC que devuelva los ausentes por empresa); fan-out con cola |
| F3-08 | Medio | S | Producto / infra | **Vercel Hobby = 1 ejecución por día por cron** (comentario en `SCHEMA_REFERENCIA.sql:475`). `inactividad-produccion` (“30 min sin registrar”) corre **una vez al día a las 14:00 ART** (`vercel.json`), así que la feature funciona como un aviso diario. `push-ausencias` corre una vez a las 12:00 ART, sin considerar el turno de cada planta | Plan pago o un scheduler externo (Supabase `pg_cron` existe incluso en Free) y avisos según el diagrama de cada empleado |
| F3-09 | Medio | M | Datos / drift | **Confirmado en prod:** 9 funciones fuera de migraciones (Q1); columnas sin documentar (`empleados.auth_user_id`, `dni`; `fichadas.geo_ingreso/geo_egreso` con índices GIN); `divisiones.id` es `uuid` y no `bigserial`; **índices duplicados** (`uq_proyectos` = `uq_proyectos_emp_ot`; `empresa_slug_key` y `empresa_slug_unique`; en `fichadas` hay 10 índices, 4 de ellos sobre `legajo`/`fecha`; `registro_actividades` tiene 8) | Tomar el esquema de prod como línea base (`supabase db pull` o `pg_dump --schema-only`), versionar con Supabase CLI, limpiar los duplicados y dejar de editar en el SQL Editor |
| F3-10 | **Alto** | S | Operación | **Sin backups** (Supabase Free no ofrece backups descargables, confirmado por el dueño) y sin *point-in-time recovery*. Un error de migración o un borrado (F2-01 permite borrar la empresa desde la app) es irrecuperable. Además, el proyecto Free **se pausa por inactividad** [HIPÓTESIS: política vigente de Supabase] | Antes de cobrar: Supabase Pro (backups diarios). Mientras tanto: `supabase db dump` periódico (script + GitHub Action programada a un bucket privado) |
| F3-11 | **Alto** | M | Operación | **Un solo ambiente.** Los *preview deployments* de Vercel usan, salvo que se haya configurado lo contrario, las mismas variables, es decir la base de producción [A VERIFICAR en Vercel → Settings → Environment Variables]. Las migraciones se prueban directo en prod | Proyecto Supabase de staging (Free alcanza) + variables por ambiente en Vercel; migraciones aplicadas por CI primero en staging |
| F3-12 | Medio | S | Observabilidad | Sentry es **opcional** y no sé si está configurado en Vercel (`logger.ts:15`: sin DSN no captura nada). En prod, `logger.info/debug` no escribe nada. No hay métricas de negocio operativas (sí `metricas_eventos` para producto). `health-check` corre una vez al día. Sin monitoreo externo de uptime. `logAudit` traga errores (ver F2-13) | Confirmar Sentry (Free alcanza al principio), uptime externo (BetterStack/UptimeRobot Free) contra `/api/health`, logs estructurados con `empresa_id` y *request id*, alertas por cron fallido |
| F3-13 | Medio | M | Consistencia de datos | Operaciones de varios pasos sin transacción, desde el navegador (F1-12) o desde el servidor (webhook: PATCH suscripción → cancelar otras → PATCH empresa, `webhook/route.js:143-183`). Postgres está disponible pero casi no se usa como motor de reglas | Todo cambio de estado multi-tabla dentro de funciones SQL (`security definer`, `search_path` fijo, `REVOKE` a anon) llamadas por el servidor. **Imprescindible para stock y OP** |
| F3-14 | Bajo | S | Performance | Rate limits y cachés **en memoria por instancia** (`rateLimitMemory.js`, `SESSION_CACHE`, caché de plan): en serverless no se comparten y se pierden en cada *cold start* | KV (Upstash/Vercel KV) o tabla en Postgres |
| F3-15 | Bajo | S | IA | Modelo por defecto `claude-haiku-4-5-20251001` (`api/chat/route.js:75`), adecuado para el uso y el costo. Pero el prompt de sistema incluye la **hora actual** y la lista de presentes al principio (`lib/claude.js:23-50`), lo que impide aprovechar el **prompt caching**. `.env.example` sugiere modelos de una generación anterior | Reordenar: instrucciones fijas primero (cacheables) y datos del momento al final; usar el alias `claude-haiku-4-5`; actualizar `.env.example` |
| F3-16 | Bajo | S | Storage / egress | Las fotos de obra se suben en base64 dentro de JSON (`api/upload/route.js`, +33% de tamaño), **sin compresión ni redimensionado**, a un bucket público **sin límite de tamaño ni de tipo** (Q7). El límite de 5 MB está solo en el código | Comprimir en el cliente (≤1600 px, WebP), `multipart`, límites por bucket y bucket privado |
| F3-17 | Bajo | S | Mantenibilidad | Tamaño de los archivos: 6 pantallas de más de 500 líneas mezclando datos, reglas y UI | Separar por feature (`features/<modulo>/{api,services,components}`) en el momento de tocar cada una |

---

## 2. Consultas, índices y paginación

**Patrón general [HECHO]:** no hay N+1 clásico en las API (las consultas por lista usan `in.(…)`), pero sí **N consultas por usuario** (F3-04) y **N consultas por empresa** en crons (F3-07). El problema dominante es el **volumen repetido** y el **truncado silencioso**, no la falta de índices.

| Consulta frecuente | Índice que la cubre (Q11, prod) | Estado |
|---|---|---|
| `fichadas` por empresa y fecha (dashboard, liquidación) | `idx_fichadas_empresa_fecha` | ✅ |
| `fichadas` por empleado y día (fichar) | `idx_fichadas_egreso_pendiente` (parcial), `idx_fichadas_legajo_fecha` | ✅ (por legajo, **sin empresa**: arreglar junto con F3-01) |
| `registro_actividades` abierta por empleado | `idx_actividades_activas` / `idx_actividad_activa_empresa` (parciales) | ✅ (duplicados) |
| `registro_actividades` por empresa y rango (reportes) | `idx_actividad_empresa_fecha` según migraciones | ⚠️ No aparece en Q11 (export cortado): confirmar |
| `sesiones` por `token_hash` / `refresh_jti` (cada request) | `idx_sesiones_token_hash`, `idx_sesiones_refresh_jti` según migraciones | ⚠️ Confirmar en prod (Q11 cortado) |
| `solicitudes` por empresa y fecha de creación | `idx_solicitudes_empresa_estado` | Parcial; falta `(empresa_id, created_at desc)` |

**Paginación [HECHO]:** el gateway limita a 500 por defecto y a 1000 como máximo, PostgREST tiene *Max rows* = 1000 (dueño), y `sbGetAll` pagina hasta 5000 en algunos reportes. Las rutas de servidor (`liquidación`, `push-ausencias`) **no paginan** (F1-04, F3-07). Regla propuesta: *todo listado paginado y todo KPI agregado en SQL*.

## 3. Server/Client components, caché y revalidación

| Zona | Render | Caché | Comentario |
|---|---|---|---|
| Landing, pricing, docs, legales | Estático (`○` en el build) | CDN | ✅ Bien |
| `/[slug]` (la app) | Dinámico + 100% cliente | `no-store` en las API | SPA dentro de Next. Aceptable para una PWA operativa, pero se pierde el beneficio del servidor: el usuario ve un *spinner* hasta bajar el JS, restaurar la sesión y correr 8 consultas |
| `/api/empresa?slug=` | — | `s-maxage=60` | ✅ |
| Resto de `/api/*` | — | `private, no-store` | Correcto por ser datos privados; la optimización real es pedir menos (F3-04) |

No se usan `revalidatePath`/`revalidateTag` ni Server Actions. **Recomendación:** no reescribir a RSC por moda. Las prioridades son (1) servicios de dominio en el servidor, (2) un endpoint por pantalla con datos agregados y (3) una caché cliente con invalidación (por ejemplo, TanStack Query) en lugar del contexto global recargado completo.

## 4. Bundle y Core Web Vitals

**Medido en el build [HECHO]** (gzip, JS de primera carga):

| Ruta | JS de la ruta | Compartido (framework + polyfills) | Total aprox. |
|---|---|---|---|
| `/` (landing) | 26 KB | ~169 KB* | ~195 KB |
| `/[slug]` (app) | 108 KB | ~169 KB* | **~275 KB** |
| `/superadmin`, `/pricing` | 22 KB | ~169 KB* | ~190 KB |

\* Incluye polyfills que los navegadores modernos no descargan; el total real es algo menor. Firebase se carga dinámicamente (`lib/push.js:22`) y las pantallas de gestión con `next/dynamic` (bien). JS cliente total: 492 KB gzip.

**Core Web Vitals [ESTIMACIÓN, sin medición real]:** en un Android de gama media con 4G, la app tendría un LCP de 2,5–4 s (render cliente + 8 consultas + restauración de sesión), y un INP en riesgo en `dashboard_gerencia` (cálculos en el hilo principal sobre cientos de filas) y en el mapa de Leaflet. La landing estática debería andar bien. **Validar** con Vercel Speed Insights (gratis en Hobby con límite) o Lighthouse en un dispositivo real. Para operarios con mala señal, el problema principal no son los KB sino las **8 consultas en serie de latencia** y la falta de un modo offline (Fase 5).

---

## 5. Costos de infraestructura por tenant

### 5.1 Supuestos [ESTIMACIÓN]

- **Tenant tipo:** 30 personas (25 operarios + 5 de gestión), 22 días hábiles, jornada de 9 h.
- **Uso de la app:** **escenario bajo** = la app abierta en primer plano unas 2 h por día por usuario (los celulares pausan los timers en segundo plano); **escenario alto** = abierta 8 h (tablet o PC de gestión fija).
- **Payload por recarga de `loadData`:** ~60 KB (empleados con diagrama, fichadas del día, solicitudes, etc.). Dashboard de gerencia: ~150 KB adicionales.
- **Actividades:** 10 por operario por día. **Fotos de obra:** 50 por mes de ~1 MB (sin comprimir). **Documentos:** ~5 por empleado, una sola vez.
- **IA:** con el **botón de fichar** (decisión del dueño), el chat queda para consultas. Bajo = 2 mensajes por operario por día; alto = 10. Cada mensaje ≈ 3.000 tokens de entrada y 150 de salida con Haiku 4.5.

### 5.2 Consumo por tenant y por mes (estado actual del código)

| Recurso | Bajo | Alto | Cómo se calcula |
|---|---|---|---|
| Invocaciones de función en Vercel | ~0,3 M | ~1,3 M | 30 usuarios × recargas/día (60–240) × 8 consultas × 22 días |
| Egress de Supabase (pasa por Vercel) | ~2,5 GB | ~10 GB | Recargas × 60 KB (+ dashboard) |
| Ancho de banda de Vercel hacia el cliente | ≈ igual al egress | ≈ igual | Mismas respuestas JSON |
| Crecimiento de la base | ~10 MB | ~20 MB | Fichadas + actividades + `audit_log` + `metricas_eventos` + índices (la base es chica; el riesgo es el egress, no el tamaño) |
| Storage | ~50 MB/mes + ~150 MB iniciales | — | Fotos de obra + documentos |
| FCM | USD 0 | USD 0 | Gratis [HIPÓTESIS: política vigente de Firebase] |
| Anthropic (Haiku 4.5: USD 1 / 5 por millón de tokens de entrada / salida) | **~USD 4** | **~USD 20** | 1.100–5.500 mensajes × (3.000 × 1 + 150 × 5)/1 M ≈ USD 0,0038 por mensaje |
| Anthropic con abuso (F2-05 sin corregir) | — | **sin techo** | 20 req/min × 1.440 min ≈ 28.800 req/día → ~USD 100+/día por tenant |

Precio de Anthropic tomado de la tabla vigente (2026-09-25) de la documentación de la API: Haiku 4.5 = USD 1 / 5; Sonnet 5.5 = USD 2 / 10 (cache read USD 0,20). Si en el futuro se usa Sonnet para análisis gerencial, multiplicar ×2 el costo de esos mensajes.

### 5.3 Costo mensual total [ESTIMACIÓN + HIPÓTESIS de precios de Vercel y Supabase, a validar en sus páginas de pricing]

| Escenario | Supabase | Vercel | Anthropic | Otros (Resend, Sentry, uptime) | **Total/mes** | **Por tenant** |
|---|---|---|---|---|---|---|
| **1 cliente, planes Free (hoy)** | USD 0 | USD 0 | USD 4–20 | USD 0 | **USD 4–20** | — | 
| ↳ *pero* | sin backups, se pausa | **Hobby no permite uso comercial** y 1 M de invocaciones/mes se excede en el escenario alto | | | No apto para un cliente pago | |
| **1 cliente, mínimo profesional** | Pro ~USD 25 | Pro ~USD 20 (1 usuario) | USD 4–20 | USD 0 (planes free) | **~USD 50–65** | USD 50–65 |
| **10 clientes** (código actual) | Pro USD 25 + egress 25–100 GB (incluido) + compute chico ~USD 0–15 | Pro USD 20 + invocaciones 3–13 M (~USD 2–8 de excedente) + CPU activa ~USD 10–40 | USD 40–200 | Resend Pro ~USD 20 si se superan los 3.000 emails | **~USD 120–330** | **USD 12–33** |
| **100 clientes** (código actual) | Pro + compute mediano/grande ~USD 60–110 + egress 250 GB–1 TB (excedente ~USD 0–70) | Pro USD 20–40 + 30–130 M invocaciones + CPU ~USD 100–300 | USD 400–2.000 | ~USD 50–100 | **~USD 700–2.600** | **USD 7–26** |
| **100 clientes** (tras F3-03/04/05: datos agregados, sin polling de todo, auth sin consultas extra) | ~USD 60–80 | ~USD 40–80 | USD 400–2.000 (con tope por plan) | ~USD 50–100 | **~USD 550–2.200** | **USD 5–22** |

**Lectura:** la infraestructura fija es barata (USD 45–50/mes para empezar profesionalmente). Lo que escala mal es (a) **el polling de 8 consultas**, que se puede reducir 5–10 veces, y (b) **la IA**, que necesita un **tope por plan** y prompt caching. La IA domina el costo a escala si el chat se usa mucho: conviene que sea un **diferencial de los planes pagos** con cupo mensual, no un costo abierto. Los precios de los planes se tratan en la Fase 6 (en Argentina, contrastar con el tipo de cambio y las comisiones de Mercado Pago).

---

## 6. Observabilidad y operación

| Aspecto | Estado [HECHO] | Brecha | Recomendación mínima |
|---|---|---|---|
| Errores | Sentry integrado pero opcional; `logger.error` va a la consola y a Sentry si hay DSN | ¿DSN configurado en Vercel? (pregunta) | Sentry Free con alertas por email |
| Logs | Logs de Vercel (Hobby: retención corta [HIPÓTESIS]); `info`/`debug` apagados en prod | Sin `request_id` ni `empresa_id` estructurado | Logger JSON con `empresa_id`, ruta, latencia y status |
| Uptime | `/api/health` + cron diario | Sin chequeo externo | UptimeRobot o BetterStack Free cada 5 min |
| Auditoría | `audit_log` (fire-and-forget, falla en silencio, F2-13) | No hay alertas de acciones sensibles | Insert con verificación + vista en superadmin |
| Métricas de producto | `metricas_eventos` + RPC de MRR, churn y funnel | Bien encaminado | — |
| Backups | **Ninguno** (Free) | Crítico para clientes pagos | Supabase Pro, o dump diario automatizado mientras tanto |
| Migraciones | Manuales en el SQL Editor, drift confirmado | Sin reproducibilidad | Supabase CLI + línea base + CI |
| Ambientes | Uno solo (prod) | Previews y pruebas contra prod | Staging (Supabase Free + Vercel Preview con sus propias variables) |
| CI | Lint, tests, build, E2E con mocks | No aplica migraciones ni corre contra una base real | Tests de integración contra Supabase local (`supabase start`) en CI |
| Secretos | En Vercel; el escaneo del repo no encontró filtraciones | Rotación no documentada | Runbook de rotación (JWT, service key, MP, Anthropic) |

---

## 7. Arquitectura objetivo (para módulos por paquete y personalización por cliente)

> Requisito del dueño: stock, compras, órdenes de producción, calidad y mantenimiento **según el paquete pagado** y **personalizables por cliente**. Esta es la propuesta de arquitectura; la priorización va en la Fase 7.

### 7.1 Principios

1. **Núcleo multi-tenant común:** empresa, plantas, usuarios, roles y permisos, catálogos, archivos, auditoría, notificaciones, facturación.
2. **Módulos como unidades activables:** cada módulo declara sus tablas, permisos, pantallas, endpoints y límites. Se activa por plan (*entitlements*) y se configura por empresa.
3. **Reglas en el servidor y transacciones en Postgres:** el navegador no calcula stock, horas ni scores.
4. **Doble barrera de aislamiento:** el servicio valida empresa, rol y módulo; la base aplica RLS con un JWT firmado para Supabase (claims `eid`, `rol`, `permisos`). `service_role` queda solo para crons y webhooks.
5. **Personalización por configuración, no por código:** catálogos, estados, campos extra y políticas por tenant. Nada de `if (empresa === …)`.

### 7.2 Modelo de datos propuesto (alto nivel)

| Capa | Tablas | Notas |
|---|---|---|
| Tenant | `empresa`, **`planta`** (nueva), `config_sistema` | `planta_id` como dimensión en operación; habilita el cobro “por planta” (Fase 6) |
| Identidad y permisos | `empleados` (→ `usuarios`), **`roles`**, **`permisos`**, **`rol_permisos`**, **`usuario_plantas`/`divisiones`** | Roles por tenant (operario, supervisor, admin, dueño + personalizados); permisos por capacidad (`stock.ajustar`, `op.liberar`, `billing.gestionar`) |
| Planes y módulos | **`planes`**, **`modulos`**, **`plan_modulos`** (límites), **`empresa_modulos`** (activo, config jsonb, trial) | Reemplaza `plans.js` en código; permite planes a medida y add-ons |
| Personalización | **`campos_personalizados`** (entidad, clave, tipo, opciones) + `atributos jsonb` en las entidades; **`catalogos`** (tipos de solicitud, causas de parada, defectos, motivos de scrap); **`politicas`** (asistencia: tolerancias, bloqueos) | Cubre H1–H3 y H9 de la Fase 2 |
| Producción (evoluciona lo actual) | `proyectos` (OT) → **`ordenes_produccion`**, **`rutas`/`etapas`** (ya existe), `registro_actividades` (ya existe = partes de trabajo), **`consumos`** | La base actual (etapa + OT + tiempo + causa) ya es el 30% de un módulo de OP |
| Stock | **`articulos`**, **`unidades`**, **`depositos`**, **`movimientos_stock`** (*ledger* inmutable), **`saldos`** (vista materializada o tabla mantenida por función) | Movimientos solo vía funciones SQL transaccionales |
| Compras | **`proveedores`**, **`ordenes_compra`** + ítems, **`recepciones`** (generan movimientos) | |
| Calidad | **`planes_inspeccion`**, **`inspecciones`**, **`no_conformidades`** (vinculadas a OP/etapa/artículo/proveedor) | |
| Mantenimiento | **`activos`** (máquinas), **`planes_preventivos`**, **`ordenes_mantenimiento`**, paradas vinculadas a causas de `registro_actividades` | |

### 7.3 Código

```
app/
  (marketing)/…            landing, pricing, legales (estático)
  [slug]/(app)/…           shell + navegación según módulos y permisos
  api/<modulo>/…           endpoints por caso de uso (sin gateway genérico)
modules/
  core/      tenant, auth, permisos, auditoría, archivos, notificaciones
  asistencia/  fichaje, solicitudes, horarios, liquidación
  produccion/  OT/OP, etapas, partes de trabajo
  stock/ compras/ calidad/ mantenimiento/
    ├─ schema.ts    (zod: inputs/outputs)
    ├─ service.ts   (reglas; llama RPC transaccionales)
    ├─ permisos.ts  (capacidades del módulo)
    └─ ui/          pantallas del módulo
supabase/migrations/       versionadas con CLI, aplicadas por CI (staging → prod)
```

Un `requireModulo(empresa, 'stock')` y un `requirePermiso(sesion, 'stock.ajustar')` en cada endpoint, más la RLS en la base. La navegación se arma desde `empresa_modulos` y los permisos del usuario, no desde listas fijas por rol (`BottomNav.jsx`).

### 7.4 Qué conservar del código actual

- El flujo de autenticación propio con JWT y rotación (bien hecho) → solo hay que firmar además el JWT de Supabase para la RLS.
- Los tests HTTP con mocks (`tests/helpers/mockFetch.js`) → se extienden a cada módulo.
- Etapas, divisiones, onboarding por rubro, documentos privados con URL firmada y las métricas SaaS del superadmin.

---

## Preguntas abiertas

1. **Sentry:** ¿está configurado el DSN en Vercel? (Si no sabés: Vercel → Project → Settings → Environment Variables → buscar `SENTRY_DSN`.)
2. **Previews de Vercel:** en esa misma pantalla, ¿las variables de Supabase están marcadas para *Production*, *Preview* y *Development*, o solo para *Production*? Define si los previews escriben en la base real.
3. **Plantas:** ¿un mismo cliente puede tener más de una planta o depósito? Define si `planta` entra en el núcleo desde el día 1 (lo recomiendo).
4. **Prioridad de módulos:** de stock, compras, OP, calidad y mantenimiento, ¿cuál querés primero? Mi sugerencia por cercanía con lo existente: **órdenes de producción** (evoluciona OT + etapas + actividades) → **stock** → compras → calidad → mantenimiento.
5. **Uso real esperado:** ¿la gerencia deja la app abierta todo el día en una PC (escenario alto) o la consulta de vez en cuando? Ajusta la estimación de costos.
