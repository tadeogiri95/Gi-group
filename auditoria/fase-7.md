# Fase 7 — Plan de acción

> Rama `claude/modest-archimedes-1jy9rm`. Fecha: 2026-10-06. Consolida `fase-0.md` … `fase-6.md` y `backlog-acumulado.md` (≈90 ítems + 19 decisiones D1–D19).
> Las **estimaciones de esfuerzo** son en días-persona de un desarrollador con asistencia de IA [ESTIMACIÓN] y se ajustan con la primera iteración.
> **Recién después de tu aprobación** empiezo a corregir: de a un ítem, en ramas separadas, mostrándote el diff.

## Resumen (5 líneas)

1. Gypi tiene una base funcional sólida (fichaje, actividad por OT, tablero, billing, superadmin), pero **no se puede vender todavía**: hay fallas de seguridad de autorización, dos reglas de base de datos que mezclan empresas y bugs que corrompen datos de negocio.
2. **Horizonte 1, “Arreglar ya” (≈2–3 semanas):** seguridad y datos. Primero una base de staging y migraciones versionadas, para no volver a tocar producción a mano.
3. **Horizonte 2, “Listo para el segundo cliente” (≈6–9 semanas):** experiencia del operario (botón de fichar, QR + PIN, sesión persistente, offline, kiosco, Play Store), onboarding 100% self-service, reglas por empresa, roles por división, cobro real en USD→ARS con Factura C e infraestructura paga.
4. **Horizonte 3, “Listo para vender a escala” (≈3–6 meses):** arquitectura modular (planes y módulos en la base, permisos, plantas, RLS real) y los módulos nuevos en orden: **OP → stock → compras → calidad → mantenimiento**.
5. **No conviene hacer todavía:** construir los 5 módulos en paralelo, la app de iOS, cobrar dentro de Play, white-label ni reescribir el stack.

---

## 1. Supuestos para las preguntas que quedaron abiertas

| Pregunta | Supuesto usado (cambiable) |
|---|---|
| ¿`SENTRY_DSN` configurado en Vercel? | **No**: se configura en H1 |
| ¿Variables de Supabase también en *Preview*? | **Sí** (default de Vercel): los previews pegan contra prod → staging en H1 |
| ¿Multi-planta? | **Sí, desde el modelo** (`planta` en el núcleo de H3), aunque la UI arranque con una sola planta |
| ¿Primer módulo nuevo? | **Órdenes de producción** (evoluciona OT + etapas + actividades) |
| ¿El gerente lee el chat del empleado? | **No**: el chat es privado del empleado; la gerencia ve solo métricas de uso |
| ¿Quién ve las ubicaciones GPS? | **Dueño y administración**; el supervisor solo el resultado “dentro/fuera de zona” de su división |
| ¿La gerencia deja la app abierta todo el día? | **Escenario bajo** de costos (consulta esporádica) |

## 2. Backlog priorizado único

**Criterio:** Prioridad = **Impacto** (1–5: seguridad, datos, bloqueo de venta, valor para el cliente) ÷ **Esfuerzo** (S=1, M=2, L=4), con **dependencias** respetadas. P0 = hacer ya · P1 = antes del 2do cliente · P2 = para escalar · P3 = cuando haya demanda.

### P0 — Horizonte 1 “Arreglar ya”

| # | Ítem | IDs | Imp. | Esf. | Días | Depende de |
|---|---|---|---|---|---|---|
| 1 | **Staging + línea base del esquema:** proyecto Supabase Free de staging; `supabase db pull` desde prod → `supabase/migrations/000_baseline.sql`; desde acá, toda migración se versiona y se aplica primero en staging | F3-11, F3-09, F0-05 | 5 | M | 1–2 | — |
| 2 | **Subir `next` a 16.3.8** + `npm audit fix` de las transitivas + `npm audit --audit-level=high` en CI | F1-05 | 5 | S | 0,5 | — |
| 3 | **UNIQUE por empresa:** `fichadas (empresa_id, empleado_id, fecha)` y `empleados (empresa_id, lower(email))`; quitar los globales | F3-01, F3-02 | 5 | S | 0,5 | 1 |
| 4 | **Cerrar `/api/data`:** matriz rol × tabla × método (deny-by-default), sin `DELETE` de `empresa`, `suscripciones`/`pagos` solo lectura, whitelist obligatoria para todas las tablas, filtro de lectura por rol (el operario ve lo propio) | F2-01, F2-07 | 5 | M | 2–3 | — |
| 5 | **Controlar `select`/embedding:** columnas permitidas por tabla (incluido lo anidado) + validar que toda FK del body pertenezca a la empresa | F2-02 | 5 | S–M | 1–2 | 4 |
| 6 | **Activación con código de un solo uso** (base del QR): toda alta nace “pendiente”, link `/{slug}/unirse?code=…` con vencimiento; arreglar el link del email; `verificar` no devuelve nombres | F2-03, F4-01, F4-02 | 5 | M | 1,5–2 | 1 |
| 7 | **IA cerrada:** prompts armados en el servidor por tipo de uso, rol y plan, cupo mensual por empresa, acciones con whitelist; prompts de la empresa editables solo por el dueño | F2-05, F2-06, F3-15 | 4 | S | 1 | 4 |
| 8 | **Limpieza post-incidente en la base:** borrar las policies `{public} … true`, `search_path` fijo en las funciones `SECURITY DEFINER`, revisar los logs de la API de Supabase, dropear `DEFAULT 'gigroup2025'` y la columna de Córdoba, forzar el cambio de contraseña de los usuarios reales | F2-00, H13, H14 | 4 | S | 0,5–1 | 1 |
| 9 | **Datos de actividad y horas:** guardar `tipo`/`causa`/`division`; parseo robusto de la hora de ingreso (`HH:MM:SS`); fecha local en actividades; horas extra en turno noche | F1-02, F1-01, F1-10, F1-11 | 4 | S | 1 | — |
| 10 | **Sin truncados silenciosos:** liquidación y dashboard mensual con agregados en SQL (RPC) | F1-04, F3-03 | 4 | S–M | 1,5 | 1 |
| 11 | **Endurecimientos chicos de seguridad:** push solo de gestión + SW abre solo el mismo origen; storage sin SVG ni upsert y con límites por bucket; `/api/geocode` con sesión; rate limit en el recupero; revocar sesiones al cambiar o resetear la contraseña; superadmin (cookie `path:/`, comparación en tiempo constante, auditoría que no falle en silencio) | F2-08, F2-09, F2-16, F2-12, F2-13 | 4 | S | 1,5 | — |
| 12 | **Backups mientras siga en Free:** GitHub Action diaria con `supabase db dump` a un almacenamiento privado (o upgrade a Pro) | F3-10 | 4 | S | 0,5 | — |
| 13 | **Observabilidad mínima:** Sentry con DSN, uptime externo sobre `/api/health`, alertas de cron | F3-12 | 3 | S | 0,5 | — |
| 14 | **Bugs de un toque:** tipo `hora_extra`, botón “volver” en el chat, aprobación de cambio de horario (definir o quitar), unidad del `ts` y transición pendiente→aprobado del webhook de MP | F1-06, F4-03, F1-07, F1-08, F1-09 | 3 | S | 1 | — |

**Total H1 ≈ 14–19 días-persona.**

### P1 — Horizonte 2 “Listo para el segundo cliente”

| # | Ítem | IDs / decisiones | Imp. | Esf. | Días |
|---|---|---|---|---|---|
| 15 | **Infraestructura paga antes del primer cobro:** Vercel Pro + Supabase Pro (backups, sin pausa); variables por ambiente; crons de mayor frecuencia (o `pg_cron`) | F0-12, F3-08, F3-10 | 5 | S | 0,5 |
| 16 | **Sesión persistente por dispositivo + PIN** (hash en el servidor, bloqueo por intentos) + `start_url` al tenant / “última empresa” + “Buscá tu empresa” | F1-03, F4-06, F4-17, D7 | 5 | M | 3 |
| 17 | **Inicio del operario con botón grande de fichar** (estado, confirmación, GPS de 5–8 s con feedback) + formulario de solicitudes con rango de fechas | F4-04, F4-12, F1-21, D6 | 5 | M | 2–3 |
| 18 | **QR de activación y QR personal** (imprimibles por el admin) | D7, F4-01 | 4 | S | 1 |
| 19 | **Modo kiosco** `/{slug}/kiosco`: QR personal o legajo + PIN, fichar e iniciar tarea, cierre automático | D7, D11 | 4 | M | 3 |
| 20 | **Escáner de OT** (`camera=(self)` + ZXing) activable por empresa + buscador y recientes | F4-11, D8 | 4 | S–M | 1,5 |
| 21 | **Cola offline** (IndexedDB) para fichar y tareas, sincronización idempotente + SW con caché del shell | F4-05 | 4 | M | 3–4 |
| 22 | **Roles por división:** supervisor limitado a su división (servidor + UI); billing solo para el dueño | D2, F2 §3 | 5 | M | 2–3 |
| 23 | **Política de asistencia por empresa** (tolerancia, bloqueo, límite mensual, acción; default “solo registrar”), tipos de solicitud configurables, textos sin “presentismo”, “Taller” ni “instaladores” | H1–H5, H9, D5, F4-13 | 5 | M | 3 |
| 24 | **Onboarding self-service completo:** planta/ubicación → horario tipo → equipo con QR/PIN → OT → checklist de activación por 14 días | F4-14, D17 | 5 | M | 3–4 |
| 25 | **Cobro real:** planes **Free mínimo / Asistencia / Planta por tramos + add-ons** en la base; **precio en USD convertido a ARS** (tipo de cambio de referencia + actualización del preapproval con aviso); prueba de punta a punta en sandbox; validar suscripción, empresa y monto en el webhook | F6-03, F6-04 (parte), F6-05, F2-11, D16, D18, D19 | 5 | M | 4–5 |
| 26 | **Factura C al CUIT del cliente:** perfil fiscal obligatorio para planes pagos (razón social, CUIT, condición IVA, domicilio); `DocTipo 80`; comprobantes descargables. **Requiere de tu lado:** habilitar el punto de venta para web service y el certificado en ARCA (con tu contador) | F6-02, F6-11, D15 | 4 | M | 2 |
| 27 | **Quitar AdSense** (componente, CSP, consentimiento) | F4-16, F6-08, D19 | 3 | S | 0,5 |
| 28 | **Exportación self-service + baja de cuenta** con retención de 30 días y borrado definitivo (lo que prometen los términos) | F6-01 | 4 | M | 2–3 |
| 29 | **Legal:** términos y privacidad con titular, proveedores (Anthropic, Resend, MP, Google), GPS, retención; DPA estándar. **Requiere** revisión de un abogado | F2-17, F6-07 | 4 | S | 1 (+abogado) |
| 30 | **Rendimiento base:** datos por pantalla (no las 8 consultas globales), polling solo con la pestaña visible, auth sin consulta extra, `push-ausencias` paginado | F3-04, F3-05, F3-07 | 4 | M | 2–3 |
| 31 | **Resumen semanal automático** por email (horas por OT, tiempo muerto por causa, ausencias) | D10 | 4 | S–M | 1,5 |
| 32 | **Inbox mejorada** (nombres, confirmación, deshacer) + **Gestión reorganizada** (operación vs. configuración) | F4-07, F4-08 | 3 | M | 2–3 |
| 33 | **Identidad propia:** proyecto Firebase de Gypi; renombrar el slug del piloto (`gypi` → p. ej. `gi-group`) | F0-11/H6, H15 | 3 | S | 0,5 |
| 34 | **TWA en Google Play** (Bubblewrap, ficha sin precios). **Requiere de tu lado:** las pruebas cerradas que pide Google a las cuentas personales nuevas [HIPÓTESIS] | D12, D14 | 3 | S | 1 (+tiempos de Google) |
| 35 | **Tests de flujos críticos:** actividad, Inbox, liquidación >1.000 filas, egreso con `time`, sesión/PIN, CSRF, roles por división; E2E con permiso de GPS | F1-16, F1-17 | 4 | M | 3 |

**Total H2 ≈ 45–55 días-persona.**

### P2 — Horizonte 3 “Listo para vender a escala”

| # | Ítem | IDs / decisiones | Esf. | Días |
|---|---|---|---|---|
| 36 | **Núcleo modular:** tablas `planes/modulos/plan_modulos/empresa_modulos`, `roles/permisos/rol_permisos`, **`planta`**, catálogos y campos personalizados; `requireModulo` y `requirePermiso` en el servidor; navegación según módulos | D1, F6-04, F3 §7 | L | 10–15 |
| 37 | **Reemplazar el gateway `/api/data`** por servicios por dominio (asistencia, producción) + **RLS real** con JWT firmado para Supabase (`service_role` solo en crons y webhooks) | F3-06, F0-06, F2-14 | L | 10–15 |
| 38 | **Transacciones en Postgres** para todo cambio multi-tabla (tareas, aprobaciones, billing) | F1-12, F3-13 | M | 3–5 |
| 39 | **Módulo Órdenes de Producción** (OT → OP, rutas/etapas, partes de trabajo, avance, costeo de mano de obra) | D1 | L | 15–20 |
| 40 | **Módulo Stock** (artículos, depósitos, movimientos como ledger, saldos) | D1 | L | 15–20 |
| 41 | **Módulo Compras** (proveedores, OC, recepción → stock) | D1 | L | 10–15 |
| 42 | **Módulo Calidad** (inspecciones, no conformidades) | D1 | M–L | 8–12 |
| 43 | **Módulo Mantenimiento** (activos, preventivo y correctivo, paradas) | D1 | M–L | 8–12 |
| 44 | **Módulo opcional “Trabajo en campo”** (reporte de obra con IA, fotos comprimidas en bucket privado) | D9, F3-16 | M | 3 |
| 45 | **Medición de uso + superadmin ampliado** (módulos, add-ons, pagos manuales, consumo de IA y storage) + 2FA del superadmin | F6-06, F6-09, F2-13 | M | 4–6 |
| 46 | **Escala y robustez:** Realtime privado o invalidación selectiva, rate limit en KV, índices depurados | F2-10, F2-15, F3-14, F3-09 | M | 3–4 |
| 47 | **Calidad de código:** `checkJs`/TS en `lib` y `api`, zod en toda ruta, sistema de diseño único, accesibilidad (48 px / 12 px), limpieza de código muerto, migración del SW a Firebase modular | F1-15, F1-18, F4-09, F4-10, F1-20, F1-22 | L | continuo |
| 48 | **Soporte:** WhatsApp Business, base de conocimiento, página de estado | F6-10 | S | 1 |
| 49 | **CSP estricta** (nonces) y exenciones de CSRF mínimas | F2-18, F2-19 | S | 1 |

**H3 ≈ 3–6 meses** según cuántos módulos se encaren (cada módulo grande ≈ 2–4 semanas).

### P3 — A demanda

| Ítem | Disparador |
|---|---|
| App nativa con Capacitor (iOS/Android): push, escáner y offline nativos | Un cliente lo exige, mayoría de iPhone, o funciones nativas (NFC, balanzas, GPS en segundo plano) |
| White-label / reventa | Un canal (cámara industrial o consultora) lo pide con volumen |
| Integraciones (ERP, liquidación de sueldos, contables) | Clientes medianos |
| Factura E / clientes del exterior | Expansión regional |

## 3. Roadmap en 3 horizontes

```
Semana:  1   2   3 | 4   5   6   7   8   9  10  11  12 | 13 ……………………………………… 36
H1 ███████████████
   staging+baseline · next · UNIQUE · /api/data · select/FK · activación · IA · limpieza BD
   datos actividad/horas · agregados SQL · endurecimientos · backups · Sentry · bugs
H2                   ███████████████████████████████████████████
                     infra paga · sesión+PIN · botón fichar · QR · kiosco · escáner · offline
                     roles por división · política asistencia · onboarding · cobro USD→ARS
                     Factura C · sin AdSense · export/baja · legal · rendimiento · resumen semanal
                     Inbox/Gestión · Firebase propio · Play Store · tests
H3                                                       ████████████████████████████████
                                                         núcleo modular · servicios + RLS · transacciones
                                                         OP → Stock → Compras → Calidad → Mantenimiento
                                                         campo · uso/superadmin · escala · calidad de código
```

**Hitos:**
- **Fin de H1:** la plataforma es segura para alojar a más de una empresa y los datos de horas y actividad son confiables.
- **Fin de H2:** **un segundo cliente puede registrarse, configurar, dar acceso a sus operarios por QR + PIN, usarla en planta (Android/kiosco) y pagar en Mercado Pago con Factura C**, sin intervención tuya.
- **Fin de H3:** catálogo de módulos vendibles por paquete, personalizable por cliente, con aislamiento a nivel de base de datos.

## 4. Quick wins (menos de 1 día cada uno)

| # | Quick win | IDs | Tiempo |
|---|---|---|---|
| 1 | `next` 16.3.8 + `npm audit fix` | F1-05 | 2 h |
| 2 | Migración de los UNIQUE por empresa (fichadas, email) | F3-01, F3-02 | 3 h |
| 3 | Bloquear en `/api/data` el `DELETE`/`POST` de `empresa` y la escritura de `suscripciones`/`pagos` (parche previo al ítem 4) | F2-01 (parcial) | 2 h |
| 4 | Agregar `tipo`, `causa` y `division` a la whitelist de `registro_actividades` | F1-02 | 1 h |
| 5 | Parseo `HH:MM:SS` en el egreso + test con el formato real | F1-01 | 1 h |
| 6 | Agregar el tipo `hora_extra` | F1-06 | 30 min |
| 7 | Botón “← Volver” en el chat | F4-03 | 1 h |
| 8 | Arreglar el link del email de invitación | F4-02 | 30 min |
| 9 | `/api/geocode` con sesión + caché | F2-16 | 1 h |
| 10 | Prohibir SVG en uploads y quitar el upsert | F2-09 (parcial) | 1 h |
| 11 | El SW abre solo URLs del mismo origen | F2-08 (parcial) | 30 min |
| 12 | Cookie del superadmin con `path:/` + comparación en tiempo constante | F2-13 (parcial) | 1 h |
| 13 | Rate limit en `recuperar-password` + `isUUID(empresa_id)` | F2-12 (parcial) | 1 h |
| 14 | Quitar AdSense | F4-16, D19 | 2 h |
| 15 | Dropear el default `'gigroup2025'` y la columna de Córdoba (SQL para que corras vos) | H13, H14 | 30 min |
| 16 | Configurar Sentry y el uptime externo (cuenta tuya + variables) | F3-12 | 1 h |
| 17 | GitHub Action de backup diario (`supabase db dump`) | F3-10 | 2 h |

## 5. Riesgos principales

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| **Que la exposición de la base (F2-00) haya sido aprovechada** antes de la contención | Baja–media (desconocida) | Alto (datos de empleados, hashes) | Revisar los logs de la API de Supabase; forzar el cambio de contraseñas; avisar a la fábrica piloto si hay indicios |
| **Cambiar la base sin red** (sin staging ni backups) | Alta mientras siga así | Alto | Ítems 1 y 12 primero; toda migración pasa por staging |
| **Abrir los 5 módulos nuevos antes de estabilizar el núcleo** | Media | Alto (deuda que se multiplica ×5) | No arrancar H3 hasta cerrar H1 y lo esencial de H2 |
| **Un solo desarrollador** (bus factor, velocidad) | Alta | Medio-alto | Ítems chicos con tests, documentación en `auditoria/`, CI fuerte |
| **Tope del monotributo** al crecer la facturación | Media (con 10+ clientes) | Medio (cambio a RI → Factura A/B + IVA) | Seguimiento mensual con el contador; el perfil fiscal ya preparado para A/B |
| **Precios en USD poco aceptados** o cambios bruscos del tipo de cambio | Media | Medio | Validar con 5–10 pymes; tramos simples; aviso de 30 días |
| **Requisitos de Google Play** para cuentas personales (pruebas cerradas, verificación) | Media | Bajo-medio (demora) | Empezar las pruebas cerradas temprano (con la fábrica piloto como testers); la PWA funciona igual mientras tanto |
| **Costos de IA sin techo** hasta cerrar F2-05 | Media | Medio | Ítem 7 en H1 |
| **Datos personales (Ley 25.326)** sin DPA ni inscripción | Media | Medio | Ítem 29 + abogado |
| **Truncados y cálculos en el cliente** que dan números erróneos al dueño | Alta hoy | Medio (pérdida de confianza) | Ítem 10 en H1 |

## 6. Qué NO conviene hacer todavía

1. **Construir stock, compras, OP, calidad y mantenimiento en paralelo:** primero el núcleo modular y después **un módulo a la vez** (OP primero).
2. **App de iOS / App Store:** el 100% de los operarios usa Android y nadie la pidió.
3. **Cobrar dentro de Google Play:** comisión y doble gestión de precios; cobrar por fuera.
4. **White-label, integraciones con ERP o expansión fuera de Argentina:** distraen del foco.
5. **Reescribir el stack** (otro framework, microservicios, todo a Server Components): el problema no es la tecnología sino la autorización, el modelo de datos y la lógica en el cliente.
6. **Agregar más IA** (análisis gerencial, predicciones) antes de tener cupos por plan y datos confiables.
7. **Vender con los planes gratuitos de Vercel y Supabase:** prohibido en Hobby y sin backups en Free.
8. **Seguir editando el esquema en el SQL Editor de producción:** todo por migración versionada.

## 7. Cómo vamos a implementar (después de tu aprobación)

1. **Un ítem por vez**, en orden de la tabla P0 (empezando por los quick wins que no dependen de staging).
2. **Una rama por ítem** desde `main`, con nombre `fix/<ID>-<descripcion>` o `feat/<ID>-<descripcion>`. Por ejemplo: `fix/F1-05-next-cve`, `fix/F3-01-unique-por-empresa`, `fix/F2-01-roles-api-data`.
3. En cada ítem: cambio mínimo + tests nuevos o ajustados + `lint`/`tsc`/`test`/`build` en verde → **te muestro el diff** y el resultado de las verificaciones → con tu OK, lo pusheo y abro el PR (si querés PRs).
4. **Cambios de base de datos:** la migración versionada en `supabase/migrations/`, probada en staging. Para producción te paso el SQL exacto para correr (yo no tengo acceso de escritura), con el script de verificación y el de reversión.
5. Actualizo `backlog-acumulado.md` (estado de cada ítem) en cada entrega.

**Lo que necesito de vos para H1:**
- Crear el proyecto Supabase de staging (Free alcanza).
- Opcional: el acceso de solo lectura de `fase-2.md` para correr consultas yo.
- Una cuenta de Sentry y una de uptime (gratis).
- Decidir si pasar ya a Supabase Pro (backups) o usar el dump diario.

**Primer ítem propuesto:** quick win #1 (`next` 16.3.8 + `npm audit fix`). No toca la base, cierra el CVE crítico y sirve para validar el flujo rama → diff → OK → push.

---

## Preguntas para cerrar el plan

1. ¿Aprobás el plan y el orden de los horizontes (H1 → H2 → H3)?
2. ¿Querés que cada ítem termine en un **Pull Request** en GitHub o alcanza con la rama + el diff acá?
3. ¿Creás el proyecto de staging en Supabase ahora o arrancamos por los quick wins que no tocan la base (#1, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13, #14)?
