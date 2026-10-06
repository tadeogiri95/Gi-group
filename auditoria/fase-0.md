# Fase 0 — Relevamiento de Gypi

> Auditoría de solo lectura. Rama `claude/modest-archimedes-1jy9rm`, commit base `1c2a869`.
> Fecha: 2026-10-06. No se modificó código, esquema ni configuración.
> Convención: **[HECHO]** = verificado en el código del repo · **[A VERIFICAR]** = depende del estado real de producción (Supabase/Vercel), que no tengo acceso a consultar · **[HIPÓTESIS]** = inferencia no verificable desde el código.

## Resumen (5 líneas)

1. Gypi es un monolito Next.js 16 (App Router, ~25k líneas JS/JSX/TS, mayormente JS) con 58 API routes, 10 crons de Vercel y 63 migraciones SQL **que se aplican a mano** (el propio repo admite drift entre migraciones y producción).
2. El producto real es **RRHH/asistencia + registro de actividad por etapa/OT**: fichaje con GPS, solicitudes, actividad productiva, reportes de obra con IA, documentos del empleado, horarios y facturación SaaS. Ya existen alta self-service, planes, Mercado Pago, superadmin y Factura C de ARCA.
3. **No usa Supabase Auth**: usa JWT propio (jose/bcrypt) y **todo el acceso a datos pasa por la `service_role` key**, a través de un gateway genérico (`/api/data`). La RLS es decorativa: el aislamiento multi-tenant depende 100% del código de las API routes.
4. Señales tempranas graves (se profundizan en la Fase 2): el gateway `/api/data` **no valida rol**, permite *embedding* de PostgREST que puede saltear el filtro de campos sensibles, `/api/chat` es un proxy abierto a Anthropic con `system` prompt definido por el cliente, y ninguna función `SECURITY DEFINER` revoca `EXECUTE` a `anon`.
5. No hay Capacitor en el repo: lo que existe es una **PWA + TWA de Android** (`assetlinks.json`, paquete `com.gypi.app`). Hay que confirmar varios supuestos (abajo) antes de las fases siguientes.

---

## Tabla de hallazgos de la Fase 0

Severidad preliminar; se confirma o ajusta en la fase indicada.

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación (se detalla en fase) |
|---|---|---|---|---|---|
| F0-01 | Crítico | M | Seguridad / authz | `app/api/data/route.js:246-351`: valida sesión (`:252`) pero **en ningún punto mira `sesion.rol`**. Whitelist en `app/lib/schemas.ts`: un `operativo` puede `PATCH empresa` (`:94`, incluye `prompt_ia_chat`, `logo_url`, `onboarding_completado`), `PATCH solicitudes.estado/aprobador` (`:31` → autoaprobarse), `PATCH/DELETE` fichadas, empleados, proyectos, etc. | F2: matriz rol × tabla × método en el gateway (o reemplazar el gateway por endpoints por caso de uso). |
| F0-02 | Crítico (a confirmar) | S | Seguridad / fuga de datos | `filtrarCamposSensibles` (`app/api/data/route.js:61`, `:351`) solo quita campos de primer nivel de la tabla pedida. El `select=` de PostgREST no se restringe, por lo que `fichadas?select=*,empleados(password)` o `empleados?select=*,empresa(admin_password)` **devolverían hashes bcrypt**. | F2: probar en staging; bloquear `(` en `select` o whitelist de columnas. |
| F0-03 | Crítico (a confirmar) | S | Seguridad / BD | 22 funciones `SECURITY DEFINER` (`002`, `011`, `013`, `019`, `027`, `036`, `038`, `040`, `046`, `048`, `052`, `053`, `055`, `060`, `063`) y **cero `REVOKE`/`GRANT`** en todo `supabase/migrations/`. Por defecto Postgres da `EXECUTE` a `PUBLIC`, por lo que con la anon key pública (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) se podría llamar `rpc_superadmin_empresas` (lista todos los tenants), `iniciar_trial_pro(cualquier empresa)`, `rpc_crear_empresa_con_admin`, `vencer_trials_batch`, etc. | F2: query en prod `select proname, has_function_privilege('anon', oid, 'execute') from pg_proc where pronamespace='public'::regnamespace`; luego `REVOKE ... FROM PUBLIC, anon, authenticated`. |
| F0-04 | Alto | S | Seguridad / costos IA | `app/api/chat/route.js:57,77`: el cliente manda `system` y `messages` crudos y el server los reenvía a Anthropic. Cualquier usuario logueado (incluso plan Free y rol operativo) usa la API key como LLM de propósito general. Solo hay un límite de 20 req/min por empresa; no hay tope mensual de tokens por tenant. El system prompt se arma en el browser (`app/lib/claude.js:4`) y el de obra viene de `empresa.prompt_ia_obra` (`app/instalador_screen.jsx:103`). | F2/F3: armar prompts server-side, presupuesto por tenant y plan. |
| F0-05 | Alto | M | Datos / operación | `README.md` § Migraciones y `supabase/migrations/035_…sql:13-18` documentan que las migraciones **no se ejecutan automáticamente** y que hay drift real (ej. `geo_registros` no existía en prod). `004_rls.sql:4` y `002_funciones.sql:4` dicen “NO EJECUTAR. Documentación”. El estado real de RLS, índices y funciones en prod es desconocido. | F3: `supabase db diff`/dump del esquema de prod y migraciones versionadas reales (CLI + CI). |
| F0-06 | Alto | M | Multi-tenancy (diseño) | `004_rls.sql:6-16` y `README.md` § Arquitectura: “El aislamiento real multi-tenant lo garantiza /api/data, NO la RLS”. 45 usos de `SUPABASE_SERVICE_KEY` en el código. Las policies `tenant_isolation_auth_*` (`050`) esperan un claim `eid` de un rol `authenticated` que nunca se usa. | F2/F3: decidir si mover a Supabase Auth + RLS efectiva o endurecer el gateway como única barrera. |
| F0-07 | Medio | S | Seguridad / Storage | `app/api/upload/route.js:20` acepta `image/svg+xml` en bucket **público** `reportes-obra`, con `x-upsert: true` (`:42`) y nombre de archivo elegido por el cliente → sobrescritura de archivos del propio tenant y SVG con script servido desde el dominio de Supabase. | F2. |
| F0-08 | Medio | S | Seguridad / abuso | `app/api/geocode/route.js`: proxy **sin autenticación** a Nominatim. Cualquiera puede usar tu servidor para consultar a OSM, lo que viola la política de uso de Nominatim y puede hacer que bloqueen tu IP. | F2: exigir sesión + rate limit + caché. |
| F0-09 | Medio | S | Seguridad / BD | `rate_limits` y `login_attempts` no tienen `ENABLE ROW LEVEL SECURITY` en ninguna migración (`011`, `013`). Con la anon key podrían leerse o escribirse vía PostgREST, salvo que en prod se hayan revocado los grants. | F2: verificar en prod. |
| F0-10 | Medio | S | Rate limiting | `app/lib/rateLimitMemory.js:1-4`: rate limit en memoria por instancia serverless. En Vercel no es global: el límite de 60 escrituras/min de `/api/data` (`route.js`) es aproximado. | F3. |
| F0-11 | Medio | S | Acoplamiento al piloto | `public/firebase-messaging-sw.js:39-45`: el proyecto Firebase se llama `gi-group-app-676a0`. La config web es pública por diseño (no es un secreto), pero el proyecto FCM es el del piloto. | F2/F6: proyecto Firebase propio de Gypi. |
| F0-12 | Medio | — | Infra / legal | `supabase/SCHEMA_REFERENCIA.sql:475` menciona “límite del plan **Hobby** de Vercel”. El plan Hobby **no permite uso comercial** (términos de Vercel). | Confirmar el plan actual (pregunta 5). |
| F0-13 | Bajo | S | Código muerto | `app/components/DataTable.jsx` y `app/lib/usePlan.js` no los importa ningún archivo de `app/`, `tests/` ni `e2e/`. | F1. |
| F0-14 | Bajo | — | Auditabilidad | El clon es *shallow* (`git rev-parse --is-shallow-repository` = `true`, 50 commits visibles). El escaneo de secretos en el historial solo cubre lo visible. En ese tramo no aparecieron claves reales (solo el placeholder de `.env.example`). | Correr un escaneo de secretos sobre el repo completo en GitHub. |

---

## 1. Mapa del repo

```
/                     Next.js 16 + React 19, "type": "module", sin monorepo
├─ proxy.ts           Middleware Next 16: CSRF (double-submit + Origin) + CSP/HSTS/etc.
├─ instrumentation.ts / sentry.*.config.ts   Sentry (opcional por env)
├─ vercel.json        10 crons
├─ app/
│  ├─ page.js         Landing pública (609 líneas)
│  ├─ pricing/ docs/ terms/ privacy/ nosotros/ contacto/   Marketing/legal (SSR)
│  ├─ [slug]/         App del tenant: page.js → AuthProvider → HomeContent.jsx (router por ?screen=)
│  │  └─ unirse/      Activación de empleado pre-cargado (legajo + contraseña)
│  ├─ superadmin/     Panel superadmin (login por SUPERADMIN_SECRET)
│  ├─ *_screen.jsx    "Pantallas externas" grandes (dashboard_gerencia 1095 l., geolocalizacion 1061 l., reportes 835 l.…)
│  ├─ components/     screens/, ui/, nav/, cards/, Billing, Paywall, AdSlot, PushManager…
│  ├─ context/AuthContext.jsx   Sesión cliente, empresa, divisiones, etapas
│  ├─ hooks/          useActividad, useRealtimeSync
│  ├─ lib/            auth, jwt, sbHelpers, schemas (zod + whitelist), plans, planEnforcement,
│  │                  claude, push, email (Resend), mercadopago, afip, calc, csv, dates, theme…
│  └─ api/            58 route handlers (ver §2)
├─ supabase/          migrations 001–063 (sin 021 en el directorio), SCHEMA_REFERENCIA.sql, seed.sql, PARTICIONAMIENTO.sql
├─ tests/             78 archivos node:test (+ RTL/jsdom) — unit, HTTP de rutas, componentes, tenant-isolation
├─ e2e/               3 specs Playwright con APIs mockeadas
├─ public/            manifest.json, firebase-messaging-sw.js (SW único: offline mínimo + FCM), offline.html,
│                     .well-known/assetlinks.json (TWA Android com.gypi.app)
└─ .github/workflows/ci.yml   lint + test + coverage + build + e2e
```

**No hay**: server actions (0 `"use server"`), edge functions de Supabase, Capacitor, colas/jobs fuera de los crons de Vercel ni un ORM. Los datos se leen y escriben con `fetch` a PostgREST usando la service key.

**Supuesto técnico observado**: la migración `021` no está en el directorio, aunque `SCHEMA_REFERENCIA.sql` la referencia (columnas `ot`, `cliente`, etc. de `proyectos`). [HECHO]

## 2. API routes (58)

Auth: **JWT** = `validarToken()` (`app/lib/auth.js:48`), cookie httpOnly `gypi_token` o header Bearer, más un chequeo de revocación en `sesiones` con caché de 5 min. **Rol** = la ruta chequea `sesion.rol` en el servidor.

| Grupo | Rutas | Auth | Chequeo de rol server-side |
|---|---|---|---|
| Gateway genérico | `POST /api/data` (proxy CRUD a 26 tablas/vistas) | JWT | **No** (F0-01) |
| Fichaje | `/api/fichar` | JWT | propio usuario |
| Empleados | `/api/empleados` (GET/POST/PATCH/DELETE), `/api/empleados/import-csv`, `/api/admin/borrar-empleado` | JWT | Sí |
| Empresa/config | `/api/empresa`, `/api/config-empresa` (etapas/divisiones), `/api/upload-logo` | JWT | Sí, salvo `upload-logo`, que no chequea rol (`grep rol` = 0 coincidencias) |
| Documentos | `/api/documentos/{upload,sign-url,asignar,mis-documentos}` | JWT | Sí |
| Proyectos | `/api/proyectos/{import-csv,sync-csv}` | JWT | Sí |
| Reportes | `/api/reportes/liquidacion` | JWT | Sí |
| IA | `/api/chat` (proxy Anthropic), `/api/chat/query` (consultas predefinidas) | JWT | `chat`: no · `chat/query`: sí |
| Push | `/api/send-push` | JWT | Sí |
| Archivos | `/api/upload` (fotos de obra) | JWT | No |
| Auth | `/api/login-empresa`, `/api/refresh-token`, `/api/logout`, `/api/recuperar-password`, `/api/resetear-password`, `/api/verificar-email`, `/api/auth/google/{start,callback,exchange}` | pública / token específico | — |
| Alta | `/api/registro-empresa`, `/api/unirse` | pública + rate limit | — |
| Billing | `/api/billing/{create-subscription,info,iniciar-trial,portal}` | JWT | Sí |
| Webhooks | `/api/billing/webhook` (MP, HMAC), `/api/email/webhook` (Resend/Svix) | firma | — |
| Superadmin | `/api/superadmin/{auth,empresas,cambiar-plan,impersonate,impersonate-exchange,audit-log,historial-planes,metricas}` | JWT admin (`sub=superadmin`) | — |
| Crons (10) | `auto-fichaje`, `limpiar-tokens`, `trial-reminder`, `vencer-trials`, `push-ausencias`, `inactividad-produccion`, `health-check`, `refresh-scores`, `reengagement-onboarding`, `reconciliacion-mp` | `Bearer CRON_SECRET` | — |
| Públicas varias | `/api/health`, `/api/og`, `/api/geocode` (F0-08), `/api/contacto`, `/api/contacto-enterprise`, `/api/analytics/event` | — / honeypot | — |

## 3. Integraciones externas

| Servicio | Uso | Dónde |
|---|---|---|
| Supabase Postgres (PostgREST) | Todo el CRUD, con service key | `app/lib/sbHelpers.js`, `app/api/data/route.js`, 45 refs |
| Supabase Storage | Buckets `logos` (público), `reportes-obra` (público), `documentos-empleado` (privado, URLs firmadas) | `upload`, `upload-logo`, `documentos/*`, `059_…sql` |
| Supabase Realtime | Broadcast `realtime:empresa_<id>` → “refrescá tabla X” | `app/lib/broadcast.ts`, `app/lib/realtime.js` (anon key) |
| Firebase FCM | Push web (SW) y admin SDK en servidor | `app/lib/push.js`, `public/firebase-messaging-sw.js`, crons |
| Mercado Pago | Preapproval (suscripción), webhook HMAC, reconciliación diaria | `app/lib/mercadopago.js`, `billing/*`, `cron/reconciliacion-mp` |
| ARCA (vía Afip SDK) | Factura C a consumidor final, apagada si falta `AFIP_ACCESS_TOKEN` | `app/lib/afip.js` (doc tipo 99 = consumidor final) |
| Anthropic | Chat del operario, parseo de reportes de obra | `app/api/chat/route.js`, `app/lib/claude.js`, `app/instalador_screen.jsx` |
| Resend | Emails transaccionales y de lifecycle, webhook de eventos | `app/lib/email.js`, `email/webhook` |
| Google OAuth | Login/registro con Google | `app/api/auth/google/*` |
| Google AdSense | Anuncios en plan Free (dashboard gerencial) | `app/components/AdSlot.jsx`, CSP en `proxy.ts` |
| OSM / Nominatim / Leaflet | Mapa y geocoding de zonas | `geolocalizacion_screen.jsx`, `api/geocode` |
| Sentry | Errores (opcional) | `sentry.*.config.ts`, `app/lib/logger.ts` |

## 4. Esquema de base (según migraciones, no verificado contra prod)

**30 tablas vivas** (más `catalogo_etapas` y `push_subscriptions`, eliminadas en `033`). Todas las de negocio tienen `empresa_id uuid NOT NULL REFERENCES empresa ON DELETE CASCADE`, salvo las excepciones de abajo.

| Dominio | Tablas |
|---|---|
| Tenant | `empresa` (branding, plan, `admin_password`, prompts IA, timezone), `config_sistema`, `divisiones`, `etapas` |
| Personas / acceso | `empleados` (legajo, rol, `password` bcrypt, `diagrama` jsonb, `geo_config`), `sesiones`, `invitaciones_empresa` |
| Asistencia | `fichadas` (UNIQUE empresa+empleado+fecha), `solicitudes`, `turnos_planificados`, `geo_zonas`, `geo_registros` |
| Producción | `registro_actividades` (etapa, OT, duración, tipo/causa de improductivo), `proyectos` (OT, cliente, obra), `reportes_obra` |
| Comunicación | `notificaciones`, `mensajes_chat`, `reglas_bot`, `notas_calendario`, `push_tokens` |
| Documentos | `tipos_documento_requerido`, `documentos_exigidos_empleado`, `documentos_empleado` |
| Billing | `suscripciones`, `pagos` (`gateway_payment_id` UNIQUE = idempotencia) |
| Plataforma | `audit_log`, `metricas_eventos`, `email_eventos`, `rate_limits`, `login_attempts` |

**Excepciones de tenant**: `push_tokens.empresa_id` es *nullable* y su UNIQUE es `(legajo, token)` sin empresa. Como el legajo se repite entre empresas, esto puede chocar. `login_attempts` no tiene tenant (por IP, es correcto). `metricas_eventos` y `email_eventos` tienen `empresa_id` nullable (es correcto: son de plataforma).

**Vistas**: `v_resumen_diario` (view) y `v_scores_empleados` (materialized view, refresh por cron diario).

**Funciones**: 22 RPC `SECURITY DEFINER` (listadas en `SCHEMA_REFERENCIA.sql`). Incluyen el alta atómica de empresa, el auto-cierre de fichadas, el vencimiento de trials, las métricas SaaS del superadmin y el rate limiting. No hay `REVOKE` (F0-03).

**RLS**: según migraciones, todas las tablas de negocio tienen RLS habilitada con tres familias de policies: `service_role_all_*` (redundante), `tenant_isolation_auth_*` (claim `eid`, rol `authenticated` sin usar) y `empresa_publica()` como única vía pública. Sin RLS: `rate_limits`, `login_attempts` (F0-09). **Storage**: no hay policies en `storage.objects`; el control está en las rutas (`059_…sql:5-10`).

**Índices**: definidos en `005`, `011`, `039`, `045` y otras. Se revisan contra las queries reales en la Fase 3.

**Triggers**: no encontré triggers vivos (`057` dropea uno huérfano). [HECHO según migraciones]

## 5. Inventario de módulos funcionales

Grado de terminación según el código. Se valida funcionalmente en las Fases 1 y 4.

| Módulo | Rol | Archivos principales | Estado | Nota |
|---|---|---|---|---|
| Fichaje con GPS | operativo | `api/fichar`, `HomeEmp.jsx`, `lib/fichar.js`, `geo_zonas` | Completo | Con tests (`api-fichar.test.js`) y auto-cierre por cron |
| Historial de fichajes | ambos | `HistorialFichajesScreen.jsx` | Completo | |
| Solicitudes (permiso, tardanza, ausencia) e Inbox | ambos | `InboxScreen.jsx`, `SolCard`, `/api/data` | Completo, con falla de authz | F0-01: un operario puede aprobar |
| Actividad productiva por etapa/OT | operativo / gerencia | `actividad_screen.jsx`, `useActividad.js`, `gerencia_actividad_screen.jsx` | Completo | Núcleo “industrial” del producto |
| Reporte de obra/instalación con IA | operativo | `instalador_screen.jsx`, `/api/chat`, `/api/upload` | Parcial | Fotos: la UI contempla el caso “indicó N fotos pero no se subieron” (`dashboard_gerencia.jsx:240`) |
| Dashboard gerencial | gerencia | `dashboard_gerencia.jsx` (1095 l.) | Completo | Muy acoplado al caso “instaladores” |
| Gestión de personal | gerencia | `gestion_personal_screen.jsx`, `/api/empleados`, import CSV | Completo | |
| Proyectos/OT | gerencia | `proyectos_screen.jsx`, import/sync CSV | Completo | |
| Horarios (grilla, turnos) | gerencia | `grilla_horario_screen.jsx`, `turnos_planificados` | Completo (a verificar) | |
| Calendario | gerencia | `calendario_screen.jsx` | Completo (a verificar) | Solo en plan Pro |
| Ubicaciones/geocercas | gerencia | `geolocalizacion_screen.jsx`, Leaflet | Completo | |
| Reportes + liquidación | gerencia | `reportes_screen.jsx`, `/api/reportes/liquidacion` | Completo (a verificar) | |
| Documentación del empleado | ambos | `documentos_*`, bucket privado | Completo | El más reciente (058/059) |
| Chat IA del operario | operativo | `ChatScreen.jsx`, `lib/claude.js` | Completo, inseguro | F0-04. El bot gerencial fue removido de la UI (`HomeContent.jsx:367`), pero su prompt sigue en `claude.js` |
| Reglas IA | gerencia | `ReglasScreen.jsx`, `reglas_bot` | Completo | |
| Onboarding wizard | gerencia | `onboarding_wizard.jsx` (plantillas por rubro) | Completo | Etapas y divisiones por rubro |
| Config de empresa / branding | gerencia | `admin_empresa_screen.js`, `/api/config-empresa` | Completo | |
| Billing / planes / paywall | gerencia | `BillingScreen`, `Paywall`, `billing/*`, `plans.js` | Completo | 5 planes. Límites aplicados solo en `POST` de algunas tablas |
| Facturación ARCA | plataforma | `lib/afip.js` | Parcial | Solo Factura C a consumidor final. Apagada sin token |
| Superadmin | plataforma | `app/superadmin/*`, 8 rutas | Completo | Métricas, impersonación con código de un solo uso |
| Push / alertas | ambos | `PushManager`, `lib/push.js`, crons | Completo | Proyecto FCM del piloto (F0-11) |
| Offline | operativo | `firebase-messaging-sw.js` | Stub | Solo muestra `offline.html` en navegación. Sin cola de fichajes offline |
| Publicidad AdSense | plan Free | `AdSlot.jsx` | Completo | Decisión de producto discutible en B2B (F4/F6) |
| Landing / SEO / legales | público | `page.js`, `pricing`, `terms`, `privacy`… | Completo | |
| `DataTable.jsx`, `usePlan.js` | — | — | Muerto | F0-13 |

**Lo hardcodeado para el piloto (primer barrido; la lista completa va en la Fase 2):** las etapas y divisiones son configurables por tenant (tablas `etapas`/`divisiones` y plantillas por rubro en `onboarding_wizard.jsx:24-47`), lo cual es buena señal. Quedan acoplados el concepto “instalador/obra” (`dashboard_gerencia.jsx:524-764`, `instalador_screen.jsx`), el proyecto Firebase `gi-group-app-*`, las 41 h semanales por defecto (`claude.js`, esquema), la zona horaria de Argentina en `lib/dates.js` y `cron/inactividad-produccion` (`api/fichar` sí respeta `empresa.timezone`), y los roles fijos `operativo | gerencial | administrativo` (`schemas.ts:17`).

## 6. Variables de entorno y secretos

| Variable | Expuesta al cliente | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sí (por diseño) | Realtime en el cliente. **La anon key es pública**, así que todo lo que `anon` pueda hacer en la BD es superficie de ataque (F0-03, F0-09) |
| `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Sí (por diseño) | FCM web. Además, la config está **hardcodeada** en `public/firebase-messaging-sw.js:39` |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_ADSENSE_*` | Sí (por diseño) | — |
| `SUPABASE_SERVICE_KEY` | No | 45 usos, todos en rutas o libs de servidor |
| `JWT_SECRET` | No | Firma de **todos** los tokens (acceso, refresh, reset, OAuth state, impersonación, superadmin): un único secreto para todo |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | No | `/api/chat` |
| `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | No | Billing |
| `FIREBASE_SERVICE_ACCOUNT(_B64)` | No | Push en servidor |
| `RESEND_*`, `GOOGLE_CLIENT_*`, `SUPERADMIN_SECRET`, `ADMIN_TOKEN_VERSION`, `CRON_SECRET`, `AFIP_*`, `SENTRY_*`, `ENTERPRISE_CONTACT_EMAIL` | No | — |

Verifiqué que ningún archivo `"use client"` referencia variables secretas. [HECHO] `ADMIN_TOKEN_VERSION` se usa en `jwt.ts`, pero no figura en `.env.example`. [HECHO]

---

## Supuestos a confirmar y preguntas abiertas

1. **Alcance del producto.** El README lo define como “RRHH para PyMEs” y el manifest como “gestión y productividad industrial”. En el código el núcleo es asistencia + actividad por etapa/OT. **No hay** stock, compras, órdenes de producción con materiales, calidad ni mantenimiento. ¿Esto es lo que querés vender, o esperabas encontrar módulos industriales que no están?
2. **Roles.** El código tiene 3 roles: `operativo`, `gerencial` y `administrativo`. Vos mencionaste operario, supervisor, admin y dueño. ¿Cómo mapean? ¿Necesitás un rol “supervisor” (gerencia de una división) y uno “dueño” (billing) distintos?
3. **Capacitor.** No hay Capacitor en el repo. Sí hay una TWA de Android (`assetlinks.json`, `com.gypi.app`). ¿Existe un proyecto Capacitor/Bubblewrap en otro repo? ¿La app está publicada en Play Store?
4. **Acceso a producción.** ¿Me podés dar acceso de solo lectura al esquema real de Supabase (o correr 3–4 queries que te paso y pegarme el resultado)? Sin eso, los hallazgos F0-02, F0-03, F0-05 y F0-09 quedan como “a verificar”.
5. **Infra actual.** ¿En qué planes están Vercel (Hobby/Pro) y Supabase (Free/Pro)? ¿Hay un solo proyecto o separás dev/staging/prod?
6. **Piloto.** ¿Cuál es el slug de la empresa piloto y cuántos usuarios activos tiene? ¿El piloto paga, o la facturación con Mercado Pago está sin uso real?
7. **Fases 1–6.** Las fases son de solo lectura, pero en la Fase 1 necesito correr `npm ci`, lint, typecheck, test y build localmente (no toca el repo). ¿OK? También: ¿commiteo y pusheo cada `auditoria/fase-N.md` a esta rama al cerrar cada fase?

---

## Respuestas del dueño del producto (2026-10-06)

1. **Alcance:** se quiere sumar stock, compras, órdenes de producción, calidad y mantenimiento como módulos que se habilitan según el paquete contratado, personalizables por cliente. → Hay que diseñar la estructura (módulos por plan + configuración por tenant). Se trata en las Fases 3, 6 y 7.
2. **Roles:** Operativo = operario · Administrativo = supervisor y admin · Gerencial = dueño. → Hoy supervisor y admin comparten rol; se evalúa en las Fases 2 y 4 si conviene separarlos.
3. **Capacitor / stores:** no existe proyecto nativo y la app no está en Play Store. El `assetlinks.json` (`com.gypi.app`) es preparación de una TWA que nunca se publicó.
4. **Producción:** el dueño corre las consultas SQL que se le pasen (ver anexo de `fase-1.md`).
5. **Infra:** Vercel y Supabase en plan **gratuito**. No se sabe si hay ambientes separados. → **Se asume un único ambiente (prod = dev)** hasta verificarlo. F0-12 queda confirmado: el plan Hobby de Vercel no permite uso comercial.
6. **Piloto:** sin usuarios activos hoy y sin cobros. Se usa una versión completa gratis. → Hay margen para cambios que rompan compatibilidad (migraciones, auth) sin afectar operación real.
7. Se autoriza correr herramientas locales y commitear y pushear los entregables.
