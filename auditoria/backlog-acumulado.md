# Backlog acumulado de la auditoría

> Documento vivo: se actualiza al cerrar cada fase. Es la **entrada de la Fase 7** (priorización, roadmap y plan de implementación).
> Última actualización: Fase 7 (2026-10-06). La priorización final está en `fase-7.md`.
> Severidad: Crítico / Alto / Medio / Bajo · Esfuerzo: S (≤1 día) / M (días) / L (semanas).
> Estado: **Pendiente** · **Contenido** (mitigado sin cambiar código) · **Descartado**.

## 1. Decisiones del dueño (insumo de diseño)

| # | Decisión | Fase |
|---|---|---|
| D1 | Sumar **stock, compras, órdenes de producción, calidad y mantenimiento** como módulos activables por paquete y personalizables por cliente | 0 |
| D2 | Roles: **operario** (`operativo`), **supervisor y admin** (`administrativo`), **dueño** (`gerencial`); el supervisor ve **solo su división**; gerencia y administración ven todo | 0, 4 |
| D3 | Sin usuarios activos ni cobros en el piloto: se aceptan cambios que rompan compatibilidad | 0 |
| D4 | Datos de fichadas y actividades actuales = **de prueba** (se pueden descartar o recalcular) | 1 |
| D5 | Tolerancia, bloqueo a la 3ra tardanza y presentismo = **reglas de la fábrica**, no defaults del producto | 1 |
| D6 | **Botón grande de fichar** en lugar del chat | 1 |
| D7 | Acceso de operarios con **QR + PIN** | 4 |
| D8 | **Escaneo de OT** (código de barras/QR) opcional por empresa | 4 |
| D9 | **Reporte de obra/instalación** = módulo opcional | 4 |
| D10 | **Resumen semanal automático** para el dueño | 4 |
| D11 | 100% de los operarios con **Android**, wifi en planta; la **tablet de kiosco la pone el cliente** | 5 |
| D12 | Cuenta de **Google Play personal** (por ahora); la app se ve como canal | 5 |
| D13 | Infra hoy: **Vercel Hobby + Supabase Free**, sin backups ni staging | 2, 3 |
| D14 | Formato recomendado (pendiente de confirmar en la Fase 7): **web + PWA/TWA en Google Play + modo kiosco**; nativo a demanda | 5 |
| D15 | Gypi es **monotributista**, sin punto de venta electrónico → Factura C al CUIT del cliente | 6 |
| D16 | Cobro por **tramos de operarios + módulos** | 6 |
| D17 | **100% self-service** (sin implementación paga) | 6 |
| D18 | Precios en **USD cobrados en ARS** | 6 |
| D19 | ~~Plan Free mínimo sin publicidad~~ → **reemplazada por D20** | 6 |
| D20 | **Solo versión paga, con trial de 30 días.** Los planes suben de precio a medida que incluyen más módulos. No hay plan Free (reemplaza D19; afecta el ítem 25 "Cobro real" de la Fase 7 y la publicidad/AdSense, que deja de tener sentido) | Post-H1 (2026-10-06) |
| D21 | **Reglas de asistencia por empresa**: tolerancia, bloqueo por minutos de tardanza (la fábrica piloto usa 15 min) y bloqueo por N-ésima tardanza del mes; por defecto no se bloquea a nadie (concreta D5) | Post-H1 (2026-10-06) |
| D22 | **Permiso de salida anticipada** (regla por empresa): para fichar salida antes del fin de la grilla hace falta permiso aprobado; el empleado lo pide desde el chat y, aprobado, ficha él mismo su salida | Post-H1 (2026-10-06) |

## 2. Hallazgos por área

### 2.1 Seguridad y multi-tenancy

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F2-00 | Base de producción abierta al rol anónimo (grants + policies permisivas + RPC) | Crítico | S | **Contenido** (REVOKE ejecutado y verificado). **Cerrado**: limpieza aplicada y verificada (#8, migración 066: policies, RLS, `search_path`, sesiones y contraseñas); #9 arregló la pantalla de cambio de contraseña. Logs: el plan Free guarda 1 día, no se puede revisar el período expuesto |
| F2-01 | `/api/data` sin control de rol (borrar empresa, autoaprobarse, escribir pagos) | Crítico | M | **Hecho** (tadeogiri95/Gi-group#3, fusionado) |
| F2-02 | Embedding/`select` sin control + FK cruzadas entre tenants | Crítico | S–M | **Hecho** (tadeogiri95/Gi-group#5, fusionado); FK compuestas en la base quedan para H3 |
| F2-03 | Activación de cuenta solo con slug + legajo (toma de cuenta) | Alto | S | **Hecho** (tadeogiri95/Gi-group#6 fusionado + migración 065): código de un solo uso, hash, 14 días |
| F2-05 | `/api/chat`: proxy abierto, sin presupuesto por tenant | Alto | S | **Hecho** (tadeogiri95/Gi-group#7, fusionado): prompt en el servidor, módulo por plan, cupo mensual |
| F2-06 | Acciones de la IA con permisos amplios; prompts de empresa editables por cualquiera | Alto | S | **Hecho** (#3 prompts solo dueño; #7 lista blanca + confirmación) |
| F2-07 | Datos personales de compañeros legibles por cualquier rol (GPS, chats, solicitudes) | Alto | S | **Hecho** (tadeogiri95/Gi-group#3, fusionado) |
| F2-08 | Push libre con links arbitrarios (phishing interno) | Medio | S | **Hecho** (tadeogiri95/Gi-group#16, fusionado): push libre solo gestión; el operario solo avisa a gestión, sin links; el SW abre solo el mismo origen. Queda: armar en el servidor los avisos automáticos del operario |
| F2-09 | Storage: SVG en buckets públicos, upsert, sin límites por bucket | Medio | S | **Hecho** (tadeogiri95/Gi-group#16, fusionado) + migración 070: sin SVG, nombres del servidor sin upsert, *magic bytes*, logo solo gestión, límites por bucket. Queda: `reportes-obra` a bucket privado con URL firmada |
| F2-10 | Canal Realtime público | Medio | S | Pendiente |
| F2-11 | Webhook de MP: validar suscripción, empresa y monto; tabla de eventos | Medio | S | Pendiente |
| F2-12 | Recupero de contraseña sin rate limit; las sesiones no se revocan al cambiar la contraseña | Medio | S | **Hecho** (tadeogiri95/Gi-group#16, fusionado): rate limit por IP y email, `isUUID`, revocación de sesiones al cambiar/resetear (y el refresh no renueva revocadas). Queda: pedir la contraseña actual al cambiarla |
| F2-13 | Superadmin con clave única sin 2FA; auditoría que falla en silencio; cookie con path incorrecto | Medio | S | **Hecho** (tadeogiri95/Gi-group#16, fusionado): cookie `path:/` + `SameSite=Strict`, comparación en tiempo constante, auditoría que loguea fallas (la impersonación no procede sin registro). Queda: usuario propio + 2FA (ítem 45) |
| F2-14 | Un único `JWT_SECRET` para 8 tipos de token, sin `aud` | Medio | M | Pendiente |
| F2-15 | Rate limits en memoria | Medio | S | Pendiente |
| F2-16 | `/api/geocode` público | Medio | S | **Hecho** (tadeogiri95/Gi-group#16, fusionado): exige sesión, caché de 24 h y límite por empresa |
| F2-17 | Privacidad: proveedores omitidos, GPS “opcional”, Ley 25.326/DPA | Medio | M | Pendiente (legal) |
| F2-18 | Exenciones de CSRF amplias | Bajo | S | **Hecho** (tadeogiri95/Gi-group#22, fusionado): solo quedan exentos los webhooks firmados, crons y health (se agregó el de Resend, que se bloqueaba) |
| F2-19 | CSP con `unsafe-inline`/`unsafe-eval` + AdSense | Bajo | S | Pendiente |
| F2-20 | IP de `x-forwarded-for` sin normalizar | Bajo | S | **Hecho** (tadeogiri95/Gi-group#22, fusionado): `ipCliente()` (x-real-ip de Vercel, validada) en todas las rutas |
| F1-05 | `next` 16.2.6 con CVE crítico + 18 dependencias vulnerables | Alto | S | **Hecho** (tadeogiri95/Gi-group#1, fusionado): next 16.3.8, 0 críticas; quedan 9 altas de firebase/eslint |
| F0-11 / H6 | Proyecto Firebase del piloto (`gi-group-app-*`) | Medio | S | Pendiente |
| H13 | `empleados.password` DEFAULT `'gigroup2025'` | Medio | S | **Hecho** (#8, migración 066 aplicada) |
| H14 | Columna `_deprecated_ubicacion_fichaje` con datos del piloto (Córdoba) | Bajo | S | **Hecho** (#8, migración 066 aplicada) |

### 2.2 Bugs funcionales y de datos

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F3-01 | UNIQUE `fichadas (legajo, fecha)` sin empresa (bloquea al 2do cliente) | Crítico | S | **Hecho** (tadeogiri95/Gi-group#2 fusionado + migración 064 aplicada y verificada) |
| F3-02 | UNIQUE `empleados (email)` global | Alto | S | **Hecho** (tadeogiri95/Gi-group#2 fusionado + migración 064 aplicada y verificada) |
| F1-01 | Horas `NaN` en el egreso si `ingreso` viene con segundos | Crítico→a verificar | S | **Hecho** (#10 fusionado): `calcularJornada` con parseo `HH:MM:SS` + migración 067 opcional para recalcular |
| F1-02 | Tipo, causa y división de actividades descartados por la whitelist | Alto | S | **Hecho** (#10 fusionado) (whitelist + validación de catálogo) |
| F1-03 | Sesión en `sessionStorage` + `start_url` = landing | Alto | S–M | Hecho (PR #30): al abrir la app la sesión se restaura desde las cookies (`/api/me`), la app instalada abre en la última empresa y el logout vuelve al ingreso de la empresa |
| F1-04 | Liquidación truncada a 1.000 filas | Alto | S | **Hecho** (tadeogiri95/Gi-group#15, fusionado): paginación server-side + aviso `truncado`; agregados en SQL quedan para H2 |
| F3-03 | Dashboard mensual truncado a 500 filas (ya afecta al piloto) | Alto | S | **Hecho** (tadeogiri95/Gi-group#15, fusionado): todas las páginas + aviso en pantalla |
| F4-01 | Empleados sin email no pueden activarse nunca | Alto | S | **Hecho** (#6: botón “Código de acceso”) |
| F4-02 | Link del email de invitación roto (`?screen=unirse`) | Alto | S | **Hecho** (#6) |
| F1-06 | “Solicitar hora extra” siempre falla (tipo no permitido) | Medio | S | **Hecho** (tadeogiri95/Gi-group#17, fusionado) + migración 071 (la regla `solicitudes_tipo_check` de prod solo aceptaba 5 tipos): tipos `hora_extra` y `salida_anticipada` permitidos; al aprobar, la hora extra se carga en la fichada |
| F1-07 | Aprobar un cambio de horario no hace nada | Medio | S | **Hecho** (tadeogiri95/Gi-group#17, fusionado): se quitó el código muerto; aprobar avisa al empleado y la grilla se ajusta en Gestión de personal. Queda: flujo con propuesta de grilla, si hace falta |
| F1-08 | Webhook: pago pendiente → aprobado se pierde | Medio | S | **Hecho** (tadeogiri95/Gi-group#17, fusionado): idempotencia por (pago, estado) con PATCH condicionado |
| F1-09 | Webhook: unidad del `ts` de la firma sin verificar | Medio | S | **Hecho** (tadeogiri95/Gi-group#17, fusionado): acepta segundos y milisegundos. Queda: prueba punta a punta en el sandbox de MP (F6-03) |
| F1-10 | Fecha de actividad en UTC (después de las 21 h) | Medio | S | **Hecho** (#10 fusionado) |
| F1-11 | Horas extra en turno noche | Medio | S | **Hecho** (#10 fusionado) |
| F1-12 | Escrituras de varios pasos sin transacción | Medio | M | Pendiente |
| F1-13 | Rotación del refresh sin gracia (varias pestañas) | Medio | S | Pendiente |
| F1-21 | Vacaciones de un solo día (modelo sin rango) | Bajo | S | En PR #38 (migración 076): formulario "Nueva solicitud" con rango de fechas; la liquidación cuenta todos los días del rango dentro del período |
| F2-21 | config-empresa exige UUID | — | — | **Descartado** para divisiones (en prod son `uuid`); confirmar etapas |

### 2.3 Producto, UX y operación en planta

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F4-03 | Chat sin botón “volver” (PWA en iOS atrapada) | Alto | S | **Hecho** (tadeogiri95/Gi-group#17, fusionado): encabezado con “← Volver” |
| F4-04 | Botón grande de fichar + GPS con feedback (D6) | Alto | S | Hecho (PR #26): botón en el inicio con confirmación, GPS de 8 s con contador, permisos/tarea activa/hora extra resueltos ahí y turno noche. Formulario de solicitudes con rango en PR #38 |
| F4-05 | Cola offline de fichajes y tareas | Alto | M | Pendiente |
| F4-06 | Sesión persistente por dispositivo + PIN (D7) | Alto | S–M | Hecho: sesión persistente (PR #30) y PIN (PR #31, migración 073: solo operarios, hash bcrypt, bloqueo de 15 min cada 5 fallos y PIN borrado a los 15). QR imprimibles (PR #32) y kiosco (PR #33) |
| F4-07 | Inbox: nombres, confirmación, deshacer | Medio | S | Hecho (PR #29): nombre e inicial del empleado, confirmación con comentario o motivo opcional (se guarda y se le avisa al empleado) y 5 s para deshacer antes de enviar |
| F4-08 | Reorganizar “Gestión” (operación vs. configuración) | Medio | M | Pendiente |
| F4-09 | Accesibilidad: objetivos táctiles ≥48 px, texto ≥12 px | Medio | M | Pendiente |
| F4-10 | Unificar el sistema de diseño | Medio | M | Pendiente |
| F4-11 | Buscador + escáner de OT (D8) | Medio | S–M | Hecho (PR #34) (migración 074): escáner de QR/código de barras al iniciar una tarea, activable por empresa en Configuración → Proyectos, OTs recientes por empleado y etiquetas QR imprimibles |
| F4-12 | Formulario de solicitudes con rango de fechas | Medio | S | En PR #38 (migración 076): formulario "Nueva solicitud" con rango de fechas; la liquidación cuenta todos los días del rango dentro del período |
| F4-13 / H1–H5, H9 | Reglas y textos de la fábrica → configuración por tenant (D5) | Medio | M | Reglas por empresa: hechas (068/069). Hecho (PR #36): el historial marca tardanzas según las reglas de cada empresa (antes "más de 30 min o la 3ra" fijo) y sin "presentismo", "Taller" ni "instaladores" en la UI. Tipos de solicitud por empresa (H9) en PR #38. Queda: pesos del score (H3) y horas semanales por defecto (H4) |
| F4-14 | Onboarding extendido + checklist de activación | Medio | M | Pendiente |
| F4-15 | Formato de hora unificado | Bajo | S | Pendiente |
| F4-16 / F6-08 | Quitar AdSense; trial en lugar de Free con publicidad | Bajo/Medio | S | **Hecho** (tadeogiri95/Gi-group#21, fusionado): sin AdSense, sin banner de cookies (solo quedan las necesarias), CSP sin dominios de anuncios y `frame-src 'none'`, privacidad actualizada. El plan "free" de la base queda como estado interno (D20) |
| F4-17 | “Empresa no encontrada” sin salida | Bajo | S | Hecho (PR #27): volver a la última empresa del dispositivo, buscar por código y link a la landing |
| F1-17 | GPS de 15 s; E2E frágil | Bajo | S | Hecho (ítem 35): el chat espera el GPS hasta 8 s como el botón grande, y Playwright corre con el permiso de ubicación dado (los 4 E2E pasan también fuera de CI) |
| — | **Roles por división** (D2, ítem 22): supervisor limitado a su división; facturación solo del dueño | Nuevo | M | Hecho (PR #35) (migración 075): `empleados.solo_su_division` (lo marca el dueño); `/api/data`, `/api/empleados`, documentos, activación y push filtrados por división; liquidación, consultas de IA, importar/borrar empleados y configuración bloqueadas para el supervisor; cambiar plan o cancelar solo el dueño. Queda: filtrar por división la liquidación y las consultas de IA en vez de bloquearlas |
| — | **Resumen semanal automático** (D10) | Nuevo | S–M | Pendiente |
| — | **QR de activación y QR personal** imprimibles (D7, ítem 18) | Nuevo | S | Hecho (PR #32): tarjetas para imprimir desde Gestión de personal (QR personal → ingreso con PIN y legajo cargado) y desde los códigos de acceso (QR → link de activación) |
| — | **Modo kiosco** con QR + PIN (D7, D11) | Nuevo | M | Hecho (PR #33): `/{slug}/kiosco` activado por gestión en el dispositivo (cookie propia guardada como sesión revocable); el operario escanea su QR o escribe el legajo + PIN y el servidor decide entrada o salida (turno noche incluido) con la misma lógica que el celular; vuelve solo al inicio. Queda: iniciar tareas desde el kiosco |
| — | **TWA en Google Play** (D12, D14) | Nuevo | S | Pendiente |
| F5-camera | `Permissions-Policy: camera=()` bloquea el escáner | Medio | S | Hecho (PR #33): `camera=(self)` (escaneo del QR en el kiosco; sirve también para el escáner de OT) |

### 2.4 Arquitectura, performance y escalabilidad

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F3-04 | Polling de 8 consultas cada 2 min + recargas por Realtime | Alto | M | Hecho (PR #28): polling solo con la pestaña a la vista (inicio, tablero y actividad), recarga al volver si los datos quedaron viejos, avisos de Realtime agrupados y sin recargas en paralelo. Queda: datos por pantalla en vez de las 8 consultas globales |
| F3-05 | `validarToken` consulta la empresa en cada request | Medio | S | Hecho (PR #24): caché de 5 min por empresa (el plan sigue con su caché por instancia) |
| F3-06 | Lógica de negocio en el navegador → servicios por dominio | Medio | M–L | Pendiente |
| F3-07 | `push-ausencias` con `limit=2000` global | Medio | S | Hecho (PR #24): paginado completo (empleados y fichadas). Queda: RPC por empresa si crece mucho |
| F3-08 | Crons diarios por el plan Hobby (inactividad de 30 min = diaria) | Medio | S | Pendiente |
| F3-13 | Transacciones en Postgres (imprescindible para stock/OP) | Medio | M | Pendiente |
| F3-14 | Rate limit y cachés en memoria | Bajo | S | Pendiente |
| F3-15 | Prompt caching y alias de modelo de IA | Bajo | S | **Hecho** (#7: alias `claude-haiku-4-5`, parte fija primero) |
| F3-16 | Fotos sin comprimir, base64 | Bajo | S | Pendiente |
| F3-17 | Pantallas gigantes → carpetas por feature | Bajo | M | Pendiente |
| D1 | **Arquitectura modular** (núcleo + planta + roles/permisos + módulos + personalización) | Nuevo | L | Pendiente |

### 2.5 Operación, datos e infraestructura

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F3-10 | Sin backups (Supabase Free) | Alto | S | **Hecho** (tadeogiri95/Gi-group#19, fusionado; primera copia OK el 2026-10-07): backup diario encriptado y verificado (GitHub Actions, 30 días; falta cargar los 2 secretos: `como-restaurar-backup.md`). Queda: archivos de Storage y Supabase Pro antes de cobrar |
| F3-11 | Un solo ambiente (previews posiblemente contra prod) | Alto | M | **Hecho** (#23 y #25 fusionados; staging preparado el 2026-10-07, variables de Preview cargadas): workflow "Preparar base de staging" + guía `como-armar-staging.md` (falta crear el proyecto y cargar variables de Preview en Vercel) |
| F0-12 | Vercel Hobby prohíbe el uso comercial | Alto | S | Pendiente (pasar a Pro antes de cobrar) |
| F3-09 / F0-05 | Drift de esquema, índices duplicados, migraciones manuales | Medio | M | En PR #20 (fusionado) + #23: exportación del esquema real y línea base `supabase/baseline/esquema-base.sql` (hasta la 072). Queda: índices duplicados de `proyectos` y completar la 070 en `logos`/`reportes-obra` |
| F3-12 | Observabilidad (Sentry, uptime, logs estructurados) | Medio | S | **Hecho** (tadeogiri95/Gi-group#18, fusionado) + migración 072: monitoreo de crons en `/api/health`, Sentry ajustado al plan gratis (falta cargar el DSN y crear el monitor de UptimeRobot: `como-configurar-monitoreo.md`). Queda: logs con *request id* |
| H15 | Tenant del piloto con slug `gypi` | Bajo | S | Pendiente |

### 2.6 Calidad de código y tests

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F1-15 | `tsc` no chequea JS (27 de 163 archivos) | Medio | M–L | Pendiente |
| F1-16 | Cobertura engañosa; flujos críticos sin test | Medio | M | Hecho (ítem 35): tests de chat, tablero de gerencia y tareas del operario, más un E2E de fichar con GPS; los demás flujos de la lista ya tenían test (Inbox, liquidación >1.000 filas, egreso con `time`, sesión/PIN, CSRF, roles por división) |
| F1-18 | Patrones inconsistentes (fetch crudo, zod en 9 de 60 rutas) | Bajo | M | Pendiente |
| F1-19 | Errores tragados; `Promise.all` frágil | Bajo | S | Pendiente |
| F1-20 / F0-13 | Código muerto (`DataTable`, `usePlan`, prompt gerencial, cambio de horario) | Bajo | S | Pendiente |
| F1-22 | Deprecaciones (Sentry, SDK compat de Firebase) | Bajo | S | Pendiente |

### 2.7 SaaS-readiness y monetización

| ID | Título | Sev. | Esf. | Estado |
|---|---|---|---|---|
| F6-01 | Exportación y baja de datos prometidas y no implementadas | Alto | M | Pendiente |
| F6-02 | Perfil fiscal del cliente + factura al CUIT | Alto | M | Pendiente (validar con el contador) |
| F6-03 | Prueba de cobro de punta a punta (sandbox MP) | Alto | M | Pendiente |
| F6-04 | Planes y módulos en la base + entitlements en el servidor | Alto | M | Pendiente |
| F6-05 | Indexación de precios | Medio | S | Pendiente |
| F6-06 | Medición de uso (operarios activos, IA, storage) | Medio | M | Pendiente |
| F6-07 | Términos, privacidad, DPA y SLA (abogado) | Medio | S | Pendiente (legal) |
| F6-09 | Superadmin: módulos, add-ons, pagos manuales, consumo | Medio | M | Pendiente |
| F6-10 | Canal de soporte y página de estado | Bajo | S | Pendiente |
| F6-11 | Comprobantes descargables | Bajo | S | Pendiente |

## 3. Preguntas abiertas que condicionan el plan

| Fase | Pregunta |
|---|---|
| 3 | ¿`SENTRY_DSN` configurado? ¿Las variables de Supabase aplican también a *Preview* en Vercel? ¿Multi-planta? ¿Primer módulo nuevo (sugerido: OP)? ¿Uso real de la gerencia (PC todo el día o esporádico)? |
| 6 | ~~Respondidas~~ → D15–D19 |
| 2 | ¿El gerente puede leer el chat del empleado? ¿Quién ve las ubicaciones GPS? |
