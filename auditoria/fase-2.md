# Fase 2 — Seguridad y multi-tenancy

> Solo lectura. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> **[HECHO]** = verificado leyendo el código · **[A VERIFICAR]** = depende del estado de la base de producción (consultas Q1–Q11 de `fase-1.md`, pendientes).
> Los hallazgos describen impacto, evidencia y corrección. No incluyo instrucciones de explotación.

## Resumen (5 líneas)

1. **El aislamiento entre empresas se apoya en una sola capa (las API routes con la clave `service_role`) y esa capa tiene huecos.** La RLS existe pero no protege nada, porque nada la usa.
2. **La autorización por rol prácticamente no existe en el gateway genérico `/api/data`.** Cualquier usuario logueado, incluido un operario, puede leer y modificar casi cualquier tabla de su empresa, incluso borrar la empresa entera.
3. Hay **riesgos de toma de cuenta y de exposición de datos personales:** la activación de empleados pre-cargados se autentica solo con slug y legajo, los datos de ubicación y los chats de todos los compañeros son legibles por cualquiera, y cualquier usuario puede mandar push con links arbitrarios a toda la empresa.
4. **La IA (Anthropic) funciona como un proxy abierto,** sin presupuesto por empresa ni control del prompt de sistema, y le envía datos personales de terceros sin que la política de privacidad lo declare.
5. **Para un segundo cliente** hay que parametrizar las reglas de asistencia de la fábrica piloto, separar el rol de supervisor del de dueño, y sacar el proyecto Firebase y los textos del caso “instalador/obra”.

---

## 1. Modelo de aislamiento multi-tenant

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿Todas las tablas de negocio tienen `empresa_id`? | **Sí** (NOT NULL + FK con `ON DELETE CASCADE`), salvo `push_tokens.empresa_id`, que es nullable y tiene UNIQUE `(legajo, token)` sin empresa | `SCHEMA_REFERENCIA.sql` |
| ¿La RLS fuerza el aislamiento? | **No en la práctica.** Todo el acceso usa `service_role`, que se saltea la RLS. Las policies `tenant_isolation_auth_*` esperan un JWT de Supabase con el claim `eid`, que la app nunca emite | `004_rls.sql:6-16`, `050_…sql`, 45 usos de `SUPABASE_SERVICE_KEY` |
| ¿Dónde se aplica el aislamiento real? | En cada API route: `empresa_id` sale del JWT propio (`validarToken`). En `/api/data` se inyecta el filtro (`inyectarEmpresaEnGet`/`Body`) | `app/api/data/route.js:153-166,215-222` |
| ¿Hay tests de aislamiento? | Sí, de la inyección del filtro (`tests/tenant-isolation.test.js`). **No** de rol, de *embedding* ni de FK cruzadas | — |

**Conclusión:** el diseño “gateway con service_role + filtro inyectado” puede ser válido, pero hoy tiene tres agujeros estructurales: falta de rol (F2-01), *embedding* sin control de columnas ni de FK (F2-02) y funciones o tablas que el rol anónimo podría alcanzar directo en la base (F2-04). Para vender a terceros, recomiendo pasar a **defensa en profundidad real**: la API route valida rol y caso de uso, y la base aplica la RLS con un JWT firmado para Supabase (ver la Fase 3).

---

## 2. Tabla de hallazgos

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación |
|---|---|---|---|---|---|
| F2-01 | **Crítico** | M | Authz / integridad | `app/api/data/route.js:246-351` nunca evalúa `sesion.rol`. Con eso, cualquier usuario logueado puede: **borrar la fila `empresa` propia** (la tabla está en `TABLAS_PERMITIDAS:39`, `DELETE` no está bloqueado y el `ON DELETE CASCADE` arrastra *todos* los datos del tenant); desactivar o borrar empleados, gerentes incluidos; aprobarse sus propias solicitudes (`schemas.ts:30-31` permite `estado` y `aprobador`); editar el branding y los prompts de IA de la empresa (`schemas.ts:94`); editar fichadas y horas. `suscripciones` y `pagos` no tienen whitelist, así que `stripUnallowedFields` devuelve el body **sin filtrar** (`app/lib/validate.ts:27-28`) | Matriz rol × tabla × método en el gateway (deny-by-default); quitar `empresa`, `suscripciones` y `pagos` del gateway (solo lectura o endpoints propios); prohibir `DELETE` salvo whitelists explícitas. A mediano plazo, reemplazar el gateway genérico por endpoints por caso de uso |
| F2-02 | **Crítico** (a verificar) | S–M | Fuga de datos / cross-tenant | El parámetro `select` de PostgREST pasa sin control: permite traer recursos relacionados (*embedding*) y `filtrarCamposSensibles` (`route.js:61`) solo limpia el primer nivel, así que columnas como `empleados.password` o `empresa.admin_password` podrían viajar anidadas. Además, varias whitelists aceptan FK que el server **no valida contra la empresa** (`empleado_id`, `tipo_documento_id` en `documentos_exigidos_empleado`, `notas_calendario`, `turnos_planificados`, `geo_registros`, `mensajes_chat`, `registro_actividades`). Una fila del tenant A podría apuntar a un registro del tenant B, y el *embedding* lo expondría. La app usa *embedding* legítimo (`fichadas … empleados(nombre,division)` en `HomeContent.jsx:164`, `dashboard_gerencia.jsx:320`) | Whitelist de columnas por tabla en `select` (incluido lo anidado); validar en el server que cada FK pertenezca a `sesion.empresa_id`; agregar FK compuestas `(empresa_id, id)` en la base para que sea imposible apuntar a otro tenant |
| F2-03 | **Alto** | S | Toma de cuenta | `app/api/unirse/route.js`: la activación de un empleado pre-cargado (o invitado por email) se autoriza solo con **slug + legajo**, ambos fáciles de conocer (los legajos son enteros secuenciales y el slug es público). La acción `verificar` además devuelve el nombre del empleado. El rate limit es en memoria (20/min por IP). Si el pre-cargado es un gerente, el impacto es la toma de la empresa | Activación solo con **token de un solo uso** enviado por email o generado por el admin (link o código), con vencimiento; nunca devolver nombres antes de autenticar |
| F2-04 | **Crítico** (a verificar con Q1/Q2/Q4) | S | Base de datos | 22 funciones `SECURITY DEFINER` sin `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. Entre ellas hay listado de todas las empresas (`rpc_superadmin_empresas`), alta de empresas, inicio de trials, métricas de ingresos y cierre masivo de fichadas. `rate_limits` y `login_attempts` no tienen RLS. La anon key es pública (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Migración que haga `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` y `GRANT … TO service_role`; `ENABLE RLS` en todas las tablas; `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon` (la app no lo necesita). Usar `SET search_path = public` en cada función `SECURITY DEFINER` (hoy ninguna lo fija) |
| F2-05 | **Alto** | S | Costos / abuso de IA | `app/api/chat/route.js:57,77`: el cliente define `system` y `messages`; no hay control de plan ni de rol (cualquier usuario, plan Free incluido) ni presupuesto mensual por empresa. Solo existe un rate limit de 20 req/min por empresa, que permite unas 28.800 llamadas por día y por tenant | Armar el prompt **en el servidor** a partir de un `tipo` de uso (`chat_operario`, `reporte_obra`); límite de tokens por mes y por plan registrado en `audit_log` (ya se guardan `tokens_input/output`); `max_tokens` por tipo; modelo fijo por tipo |
| F2-06 | **Alto** | S | Prompt injection / alcance de la IA | Las acciones que propone el modelo (`app/lib/claude.js` `parseAction`) se ejecutan en el navegador con la sesión del usuario. Hoy el radio de impacto es “lo que el usuario puede hacer”, que por F2-01 es casi todo en su empresa. `prompt_ia_obra` y `prompt_ia_chat` son editables por cualquier rol (F2-01) y terminan como prompt de sistema de otros usuarios | Al corregir F2-01 el radio baja solo; además, whitelist de acciones permitidas por rol en el cliente **y** confirmación del usuario para acciones con efecto; prompts de empresa editables solo por el dueño |
| F2-07 | **Alto** | S | Privacidad / datos personales | Sin control de rol en las lecturas: cualquier operario puede leer `geo_registros` (ubicaciones GPS de compañeros), `mensajes_chat` (conversaciones de otros con el bot), `documentos_empleado` (metadatos), `empleados` (email, diagrama), `solicitudes` de todos (motivos médicos o personales) y `pagos`/`suscripciones`. `HomeContent.jsx:161-165` ya carga a cualquier operario todos los empleados y todas las solicitudes de la empresa. El gerente lee el chat privado de cada empleado (`HistorialFichajesScreen.jsx:36`) sin que la política lo informe | Lecturas filtradas por rol (el operario solo ve lo propio y lo operativo, como la lista de OT); declarar en la política de privacidad qué ve el empleador |
| F2-08 | **Medio** | S | Push / phishing interno | `app/api/send-push/route.js` + `schemas.ts` (`sendPushBody`): cualquier usuario manda push a cualquier legajo o rol de su empresa, con título, cuerpo y `data` libres. El service worker abre `data.url` al tocar la notificación sin validar el origen (`public/firebase-messaging-sw.js` `notificationclick`) | Solo los roles de gestión envían push libre; los avisos automáticos se generan en el servidor; el SW debe abrir solo URLs del mismo origen |
| F2-09 | **Medio** | S | Storage | `app/api/upload/route.js:20` y `upload-logo/route.js` aceptan **SVG** en buckets **públicos** (`reportes-obra`, `logos`); `x-upsert: true` con un nombre de archivo elegido por el cliente permite pisar archivos del propio tenant; `upload-logo` no exige rol. `documentos/upload` valida bien la pertenencia, pero confía en el `file.type` del cliente, sin verificar *magic bytes*. No hay policies en `storage.objects`: todo el control está en el código | Prohibir SVG (o sanearlo); nombres generados en el servidor y sin upsert; verificar *magic bytes*; rol de gestión para el logo. Reportes de obra en bucket privado con URL firmada (son fotos de clientes y obras) |
| F2-10 | **Medio** | S | Realtime | `app/hooks/useRealtimeSync.js:17` usa un canal *broadcast* público `empresa_<id>` con la anon key; el `empresa_id` es público (`/api/empresa?slug=`). Con canales públicos, un tercero podría emitir eventos `refresh` que fuercen a cada cliente a recargar 8 consultas (amplificación de carga), o escuchar qué tablas cambian | Activar **canales privados** de Realtime con autorización, o hacer *polling* con ETag |
| F2-11 | **Medio** | S | Webhooks | Mercado Pago: la firma HMAC es obligatoria y se compara en tiempo constante (bien) y hay idempotencia por `gateway_payment_id`, pero (a) la unidad del `ts` no está verificada contra MP (F1-09), (b) la idempotencia ignora el cambio de estado (F1-08) y (c) el `external_reference` define la empresa y la suscripción sin verificar que esa suscripción pertenezca a esa empresa ni que el monto coincida con el plan. Resend: verificación Svix correcta | Al procesar, cruzar el `preapproval_id` contra `suscripciones.gateway_subscription_id`, validar monto y moneda contra el plan, y registrar cada evento en una tabla `webhook_eventos` (id único) para idempotencia y auditoría |
| F2-12 | **Medio** | S | Recuperación y sesiones | `recuperar-password/route.js`: **sin rate limit** (y exento de CSRF), `empresa_id` sin validar como UUID antes de interpolarlo en la URL de PostgREST. `resetear-password` y `cambiar_password` (`login-empresa/route.js:90-117`) **no revocan las sesiones abiertas** y el cambio no pide la contraseña actual | Rate limit por IP y por email; `isUUID`; revocar todas las `sesiones` del empleado al cambiar o resetear; pedir la contraseña actual |
| F2-13 | **Medio** | S | Superadmin | Acceso con **una sola clave compartida** (`SUPERADMIN_SECRET`), comparada con `!==` (no en tiempo constante), sin segundo factor, con sesión de 8 h. La impersonación no notifica a la empresa, el token de impersonación (1 h) no es revocable y viaja en el body (`impersonate-exchange/route.ts`). El registro de auditoría de `impersonate` usa `actor_id: "superadmin"` en una columna `uuid`, lo que hace fallar el insert **en silencio** (`lib/audit.ts` traga el error). **Probable bug:** la cookie `gypi_superadmin` tiene `path: "/superadmin"` y no se envía a `/api/superadmin/*`, así que el panel no podría llamar a sus propias APIs desde el navegador (a verificar en uso real) | Login del superadmin con usuario propio + 2FA (o Google Workspace + allowlist), sesiones cortas, auditoría que no falle en silencio, aviso a la empresa cuando se la impersona, cookie con `path: "/"` y `SameSite=Strict` |
| F2-14 | **Medio** | M | Secretos | Un único `JWT_SECRET` firma 8 tipos de token (acceso, refresh, reset, OAuth state, OAuth exchange, código de impersonación, impersonación y superadmin), diferenciados solo por claims. Un error de validación en un endpoint permitiría aceptar un tipo por otro (hoy `validarToken` rechaza `refresh` y `code`, pero no `typ: oauth_exchange` ni `type: password_reset`; esos tienen `sub`/`eid` y vencen en 60 s o 1 h) | Agregar `aud` distinto por tipo y validarlo; a mediano plazo, claves separadas para superadmin |
| F2-15 | **Medio** | S | Rate limiting | Los límites en memoria (`rateLimitMemory.js`) no son globales en Vercel (`/api/data` escrituras, `/api/fichar`, `/api/unirse`). Login, registro y superadmin usan la base (bien) | Mover todo a la RPC de la base o a un KV (Upstash/Vercel KV) |
| F2-16 | **Medio** | S | Endpoints públicos | `/api/geocode`: proxy sin autenticación ni rate limit a Nominatim, cuya política exige identificarse y prohíbe el uso masivo. `/api/og`: público (bajo riesgo) | Exigir sesión, cachear, rate limit |
| F2-17 | **Medio** | M | Legal / privacidad (a validar con un abogado) | La política de privacidad (`app/privacy/page.js:36`) enumera como proveedores solo a Supabase, Vercel y Firebase: **omite Anthropic** (recibe nombres, horarios, presencia de compañeros y reglas de la empresa: `lib/claude.js`), Resend, Mercado Pago y Google OAuth. Dice que la ubicación es “con tu consentimiento”, pero el fichaje **exige** GPS cuando hay zonas (`fichar/route.js:86`). Hay publicidad de terceros dentro de un producto B2B con datos laborales. Ley 25.326: registro de bases ante la AAIP, transferencia internacional (servidores en EE. UU.), contrato de encargado de tratamiento con cada empresa cliente | Actualizar la política y los términos, armar un DPA con los clientes y validar con un asesor legal |
| F2-18 | **Bajo** | S | CSRF | Exentos de CSRF: `login-empresa`, `logout`, `refresh-token`, `recuperar-password`, `resetear-password`, `verificar-email`, `registro-empresa`, `unirse` y todo `/api/superadmin/` (`app/lib/csrf.js:17-30`). La mitigación hoy depende de `SameSite=Lax` en las cookies. Además, con `next` 16.2.6 hay un bypass conocido del middleware (F1-05) | Subir `next`; reducir exenciones (superadmin no debería estar exento); chequear `Origin` en todo POST |
| F2-19 | **Bajo** | S | Headers | CSP con `'unsafe-inline'` y `'unsafe-eval'` en `script-src` y dominios de AdSense (`proxy.ts:23-60`). `img-src https:` abierto | Nonces de Next para scripts; sacar AdSense del producto (decisión de las Fases 4 y 6) |
| F2-20 | **Bajo** | S | Registro de sesiones | `x-forwarded-for` se usa como IP sin tomar solo el primer valor en algunos lugares (`fichar`, `login` en `ip` del audit) → la IP del audit puede contener datos inyectados por el cliente | Usar `request.ip` o el header de Vercel `x-real-ip` |

### Hallazgos funcionales encontrados en esta fase (se suman a la Fase 1)

| ID | Sev. | Esf. | Evidencia | Recomendación |
|---|---|---|---|---|
| F2-21 | Alto (a verificar con Q8) | S | `app/api/config-empresa/route.js:191` y `schemas.ts` (`configPatchBody.id: uuid`) exigen que el `id` de etapa o división sea UUID, pero `etapas.id` y `divisiones.id` son `bigserial` (enteros) según el esquema → **editar o desactivar etapas y divisiones siempre devuelve 400** | Validar como entero o migrar a UUID, con test |

---

## 3. Autenticación, roles y permisos

**Cómo funciona hoy [HECHO]:** login propio (bcrypt + JWT HS256 en cookie httpOnly, 30 min + refresh de 30 días con rotación y revocación vía tabla `sesiones`), OAuth de Google (valida `iss`, `aud`, `email_verified` y el nonce de `state`: bien implementado) y tres roles: `operativo`, `administrativo` y `gerencial`.

**Dónde se valida el rol en el servidor:** `/api/empleados`, `/api/config-empresa`, `/api/empresa` (PATCH), `/api/billing/*`, `/api/documentos/*`, `/api/reportes/liquidacion`, `/api/chat/query` (por consulta) y `/api/admin/borrar-empleado`. **No se valida en:** `/api/data` (la mayor parte del producto), `/api/send-push`, `/api/upload`, `/api/upload-logo` y `/api/chat`. La UI esconde pantallas por rol (`BottomNav.jsx`, `HomeContent.jsx`), pero eso no es control de acceso.

**Contra tu modelo de roles** (Operativo = operario, Administrativo = supervisor y admin, Gerencial = dueño):
- Hoy `administrativo` puede **gestionar la facturación** (`billing/*`, `["gerencial","administrativo"]`) y editar todo lo de la empresa. Si “administrativo” incluye a supervisores, un supervisor puede cambiar el plan o cancelar la suscripción.
- No hay roles por división ni por planta: un supervisor ve a toda la empresa.
- **Propuesta (a validar en la Fase 4):** roles `operario`, `supervisor` (limitado a sus divisiones o plantas), `admin` (configuración y personal) y `dueño` (billing, datos sensibles, borrado), con permisos por capacidad (ej. `aprobar_solicitudes`, `ver_liquidacion`, `gestionar_billing`) en una tabla, en vez de listas de roles repetidas en cada ruta. Esto además prepara el terreno para los módulos nuevos (stock, compras, OP, calidad, mantenimiento), donde los permisos crecen rápido.

## 4. Validación de inputs y subida de archivos

- **Zod** en 9 de 60 rutas; el resto valida a mano o no valida (F1-18). Las rutas que interpolan parámetros en URLs de PostgREST sin `isUUID` ni `encodeURIComponent` (ej. `recuperar-password`, varios `?id=eq.${…}` en crons y superadmin) dependen de que el valor venga del JWT. Hay que revisar ruta por ruta en la Fase 7.
- `/api/data` bloquea `; ' " \ --` en el path, que es una defensa parcial; la protección real debe ser la whitelist de columnas y operadores (F2-02).
- Archivos: ver F2-09. El bucket privado `documentos-empleado` con URL firmada de 60 s y control de pertenencia está **bien resuelto** y sirve de modelo para el resto.

## 5. Webhooks de Mercado Pago

- [HECHO] HMAC-SHA256 obligatorio, `timingSafeEqual`, rechazo si falta el secreto, ventana de 5 min, idempotencia por `gateway_payment_id` UNIQUE (`017_…sql`), reconciliación diaria (`cron/reconciliacion-mp`, que solo reporta y no corrige).
- [A VERIFICAR] unidad de `ts` (F1-09). [BUG] transición pendiente → aprobado (F1-08). [MEJORA] validar suscripción, empresa y monto (F2-11).
- Nunca se probó con cobros reales (dato del piloto): antes de cobrar al primer cliente hace falta una prueba de punta a punta en sandbox, con alta, pago, rechazo, cancelación y reintento.

## 6. Anthropic API

| Pregunta | Respuesta |
|---|---|
| ¿La clave está expuesta? | **No.** Solo en el servidor (`app/api/chat/route.js`); ningún archivo `"use client"` la referencia |
| ¿Prompt injection? | Sí, es posible por diseño: el prompt de sistema lo arma y lo manda el cliente, las reglas y los prompts de la empresa son editables sin control de rol, y las acciones del modelo se ejecutan con la sesión del usuario (F2-05, F2-06) |
| ¿Límite de gasto por tenant? | **No.** Solo 20 req/min por empresa; los tokens se registran en `audit_log` pero no se suman ni se cortan |
| ¿Fuga entre clientes? | **No encontré mezcla entre tenants**: el contexto se arma con datos de la propia empresa y `chat/query` filtra por `empresa_id` de la sesión. Sí hay **fuga dentro de la empresa**: el prompt del operario incluye a todos los compañeros presentes, y un operario puede pedirle al modelo cualquier cosa con el prompt que él mismo construye |
| ¿Retención y datos personales? | Se envían datos personales de empleados a un proveedor en EE. UU. sin declararlo (F2-17) |

## 7. Lo hardcodeado para la empresa piloto (bloquea a un segundo cliente)

Confirmado con vos: **las reglas de asistencia son de la fábrica y no deben ser el default del producto.**

| # | Qué | Dónde | Bloquea a otro cliente porque… | Cómo resolverlo |
|---|---|---|---|---|
| H1 | Tolerancia de 5 min, bloqueo con más de 30 min tarde y bloqueo a la 3ra llegada tarde del mes | `app/lib/calc.js` (`calcularTardanza`), `app/api/fichar/route.js:143-161` | Otra empresa puede no bloquear nunca, o usar otros umbrales | **Política de asistencia por tenant** (`config_sistema` o tabla `politicas_asistencia`): tolerancia, umbral de bloqueo, límite mensual y acción (bloquear, avisar o solo registrar). Default del producto: **solo registrar** |
| H2 | “Premio por presentismo” | `ChatScreen.jsx:166-168`, `calc.js:150` (`pierdePresentismo`) | Es un beneficio del convenio o de la política de la fábrica | Mensajes derivados de la política configurada; sin mención por defecto |
| H3 | Pesos del score del empleado (asistencia 34, puntualidad 21…) | `app/lib/calc.js:162` | Criterio de evaluación propio de la fábrica | Configurable, o score opcional |
| H4 | 41 h semanales por defecto | `SCHEMA_REFERENCIA.sql` (`horas_semanales DEFAULT 41`), `lib/claude.js` | Varía según convenio | Default por tenant |
| H5 | Concepto “instalador / reporte de obra / instalación” | `instalador_screen.jsx`, `dashboard_gerencia.jsx:524-764`, `reportes_screen.jsx`, títulos “Taller” (`HomeContent.jsx`) | Es el caso de uso de muebles a medida con instalación en cliente | Módulo opcional “Trabajo en campo / Obra” activable por tenant; textos configurables |
| H6 | Proyecto Firebase `gi-group-app-676a0` | `public/firebase-messaging-sw.js:39-45` | Es el proyecto del piloto, no de Gypi | Proyecto Firebase propio de Gypi y config inyectada por env |
| H7 | Zona horaria de Argentina fija | `app/lib/dates.js:16` (17 archivos la usan), `cron/inactividad-produccion` | Aceptable para Argentina; ignora `empresa.timezone`, que ya existe | Usar `empresa.timezone` (Bajo, para cuando salgan de Argentina) |
| H8 | Horarios de los crons fijos en UTC (avisos de ausencia a las 12:00 ART, inactividad a las 14:00 ART, umbral de 30 min) | `vercel.json`, `cron/inactividad-produccion/route.ts:18` | Cada planta tiene otros turnos | Avisos según el diagrama o turno de cada empleado y umbrales por tenant |
| H9 | Tipos de solicitud fijos | `app/api/data/route.js:138`, `schemas.ts` | Cada empresa tiene sus licencias (estudio, examen, donación de sangre…) | Catálogo por tenant |
| H10 | Roles fijos (3) | `schemas.ts:17` | Tu propio mapeo ya pide 4 | Ver §3 |
| H11 | Planes y precios en código | `app/lib/plans.js` | Cambiar un precio o crear un plan a medida requiere deploy | Tabla `planes`/`features` (Fase 6) |
| H12 | Etapas y divisiones | **Configurables por tenant** (tablas + plantillas por rubro en `onboarding_wizard.jsx:24-47`) | — | Bien resuelto (salvo el bug F2-21) |

---

## Preguntas abiertas

1. **Roles:** ¿te sirve la propuesta `operario / supervisor / admin / dueño` con permisos por capacidad? ¿El supervisor debe ver solo su división o planta?
2. **Facturación:** ¿solo el dueño debería poder cambiar el plan o cancelar? (Hoy también puede “administrativo”.)
3. **Privacidad:** ¿el gerente debe poder leer el chat del empleado con el bot? ¿Las ubicaciones GPS las ve solo el dueño o también el supervisor?
4. **Publicidad:** ¿mantener AdSense en el plan Free? Para un B2B con datos laborales lo desaconsejo (riesgo legal y de percepción). Lo retomo en la Fase 6.
5. **Consultas SQL:** las Q1–Q11 de `fase-1.md` confirman F2-02, F2-04 y F2-21. Cuando las tengas, actualizo esta fase.

---

## 8. Resultados de producción (consultas Q1–Q11, 2026-10-06)

> Fuente: CSV exportados por el dueño desde el SQL Editor de Supabase. Q3, Q8 y Q11 llegaron **cortados en 100 filas** (límite de la UI del editor); lo que no aparece se marca como pendiente.

### 8.1 🚨 Hallazgo nuevo — F2-00 · **Crítico · confirmado en producción · Esf. S**

**La base de producción está abierta al rol anónimo.** La anon key es pública por diseño (va dentro del JS del navegador, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), así que todo lo que `anon` pueda hacer lo puede hacer cualquier persona en internet, **sin pasar por la app**.

| Evidencia | Qué muestra |
|---|---|
| **Q4** | `anon` y `authenticated` tienen `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` sobre **todas** las tablas y vistas de `public` (32 objetos), incluidas `empleados`, `empresa`, `sesiones`, `pagos` y `documentos_empleado`. `TRUNCATE` **no está sujeto a RLS** |
| **Q3** | La RLS está activa (Q2), pero coexisten policies permisivas para el rol `public` con `true` que **anulan** a las de aislamiento (las policies se combinan con OR): `empleados_select`/`empleados_update`/`service_key_full_empleados` (ALL), `empresa_read`/`empresa_update`, `fichadas_*` y `service_key_full_fichadas` (ALL), `mensajes_chat` (lectura y escritura), `notificaciones` (ALL), `notas_calendario` (`notas_anon_all`), `push_tokens` (incluye DELETE), `registro_actividades` (ALL), `etapas` (“Permitir todo”), `config_sistema` (“Escribir”), `invitaciones_empresa`, `proyectos` (ALL) |
| **Q2** | `v_resumen_diario` y `v_scores_empleados` no tienen RLS y `anon` puede leerlas; una vista materializada no respeta la RLS de las tablas base |
| **Q1** | Las 27 funciones de `public` son ejecutables por `anon`, entre ellas las `SECURITY DEFINER` del superadmin (`rpc_superadmin_empresas`, `rpc_superadmin_stats`, `rpc_mrr_trending`…), `rpc_crear_empresa_con_admin`, `iniciar_trial_pro`, `vencer_trials_batch` y `auto_fichar_egresos`. Hay además 9 funciones que **no están en las migraciones** (`fichar_ingreso`, `fichar_egreso`, `fichadas_hoy`, `fichadas_semana`, `fn_calcular_duracion`, `fn_cerrar_tarea_previa`, `set_updated_at`, `trg_susc_updated`, `vencer_trials_expirados`), lo que confirma el drift (F0-05) |

**Impacto:** lectura de datos de **todas las empresas** (nombres, emails, hashes de contraseña, ubicaciones, chats, solicitudes, pagos), modificación o borrado de cualquier fila y vaciado completo de tablas. Esto reemplaza y supera a F0-02/F0-03/F0-09/F2-04: ya no es “a verificar”.

**Por qué es seguro cerrarlo ya:** la app nunca usa `anon` ni `authenticated` contra tablas o RPC. Todo el acceso a datos va por API routes con `service_role` (verificado: el único uso de la anon key en el cliente es Realtime broadcast, `app/lib/realtime.js`, que no necesita permisos sobre tablas).

#### Contención recomendada (la corre el dueño; yo no tengo acceso a la base)

Antes de ejecutar: hacer un backup (Database → Backups, o `pg_dump`). Correr en el SQL Editor **de una vez**:

```sql
begin;

-- 1) Sacar todo permiso de tablas, vistas y secuencias a los roles públicos
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 2) Funciones: nadie salvo service_role
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;

-- 3) Que los objetos nuevos no vuelvan a nacer abiertos
alter default privileges in schema public revoke all     on tables    from anon, authenticated;
alter default privileges in schema public revoke all     on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
```

**Verificación posterior:** volver a correr **Q1** (todo `anon_exec`/`auth_exec` = false) y **Q4** (sin filas). Después, probar la app: login, fichar, ver el dashboard y el panel de superadmin. Si algo falla, hay que mirar ese caso puntual. No espero fallas, porque todo usa `service_role`.

**Después de contener (no urgente, lo detallo en la Fase 7):**
- Borrar las policies permisivas `{public} … true` y dejar solo las de aislamiento, por limpieza y para la futura migración a RLS real.
- Revisar en **Supabase → Logs → API** si hubo requests con la anon key a `/rest/v1/` o `/rest/v1/rpc/` de origen desconocido.
- Como los hashes de contraseña estuvieron expuestos, evaluar forzar el cambio de contraseña de los usuarios reales (bcrypt resiste, pero las contraseñas iniciales previsibles no).
- Correr el **Security Advisor** de Supabase (Database → Advisors), que detecta exactamente esta clase de problemas.

### 8.2 Re-clasificación de hallazgos con datos reales

| ID | Antes | Ahora | Evidencia |
|---|---|---|---|
| F0-02, F0-03, F2-04 | Crítico (a verificar) | **Confirmado y ampliado → F2-00** | Q1, Q3, Q4 |
| F0-09 (`rate_limits`/`login_attempts` sin RLS) | Medio | **Corregido parcialmente:** en prod sí tienen RLS (Q2), pero `anon` tiene permisos completos (Q4) → cubierto por F2-00 | Q2, Q4 |
| F0-05 (drift de esquema) | Alto | **Confirmado.** 9 funciones fuera de migraciones; `divisiones.id` es `uuid` en prod (el esquema documentado dice `bigserial`); `empleados` tiene `auth_user_id` y `dni`, que no figuran; los defaults de `empleados` difieren (ver H13 y H14) | Q1, Q8 |
| F2-21 (config-empresa exige UUID) | Alto | **Descartado en prod** para `divisiones` (es `uuid`). Falta confirmar `etapas.id` (Q8 vino cortado) | Q8 |
| F1-01 (horas `NaN`) | Crítico (a verificar) | **No observado en los datos:** 0 filas `NaN` sobre 240 egresos (rango 2026-05-21 → 06-15), pero los datos son anteriores al código actual. Pendiente: tipo real de `fichadas.ingreso` (primera parte de Q5) y una prueba de egreso con el código actual | Q5 |
| F1-02 (tipo/causa descartados) | Alto | **Se mantiene:** hay registros con `tipo` E/R y `causa` O, pero son de mayo y junio; la whitelist que los descarta entró después (commit ≤ 2026-06-23). Validar con un registro nuevo | Q6 |
| F1-04 (liquidación truncada) | Alto | **Confirmado:** *Max rows* = 1000 | Dueño |
| F2-09 (Storage) | Medio | **Agravado:** `reportes-obra` y `logos` son públicos **sin límite de tamaño ni de tipo MIME** a nivel bucket | Q7 |
| Q9 contraseñas en texto plano | — | **OK:** 0 en `empleados` y en `empresa` | Q9 |

### 8.3 Nuevos “hardcodeos del piloto” en la base

| # | Qué | Evidencia | Riesgo |
|---|---|---|---|
| H13 | `empleados.password` tiene **DEFAULT `'gigroup2025'`** (contraseña en texto plano y conocida) | Q8 | Cualquier alta que no setee la contraseña queda con ella. Hoy el login rechaza el texto plano (post 2026-09-01), pero es un default inseguro y del piloto. Quitar el default (`DROP DEFAULT`) |
| H14 | `empleados._deprecated_ubicacion_fichaje` DEFAULT con coordenadas y nombre **“Planta GI — Córdoba”** | Q8 | Dato del piloto en el esquema; dropear la columna |
| H15 | Slug `gypi` = empresa piloto en plan **enterprise** con 31 empleados activos; `demo-metalurgica` concentra 245 de las 261 fichadas | Q10 | El tenant del piloto usa el nombre del producto: renombrarlo (ej. `gi-group`) antes de vender, para que `gypi.app/gypi` no sea “la fábrica” |

### 8.4 Consultas pendientes (re-correr, porque el editor corta en 100 filas)

```sql
-- Q5a: tipo real de las columnas de fichadas
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='fichadas' order by ordinal_position;

-- Q8b: tipos de id y columnas de las tablas que faltaron
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name in ('etapas','solicitudes','registro_actividades','sesiones','suscripciones','pagos','reportes_obra','turnos_planificados')
order by table_name, ordinal_position;

-- Q3b: resto de policies (desde reglas_bot en adelante, incluido storage)
select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies
where (schemaname='public' and tablename >= 'reglas_bot') or schemaname='storage'
order by 1,2,3;
```

Q11 (índices) también vino cortado, pero alcanza para la Fase 3. Si querés, exportalo con “Download CSV” desde el resultado completo.
