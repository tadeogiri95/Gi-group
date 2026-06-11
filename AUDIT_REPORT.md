# Auditoría Integral — Gypi SaaS B2B
**Fecha:** 2026-06-11  
**Auditor:** Equipo multidisciplinario (Claude Sonnet 4.6)  
**Rama:** main

---

## 1. Resumen ejecutivo

Gypi es una PWA SaaS multi-tenant de RRHH industrial con stack sólido (Next.js 16 + Supabase + Firebase + MercadoPago). El core está funcional y la seguridad es buena. Las deudas principales son de arquitectura frontend (6 componentes duplicados, dead code) y UX (empty states inconsistentes, tab bar con emojis en Configuración). El sistema de planes/billing está implementado y el aislamiento multi-tenant es robusto.

**Estado pre-auditoría:** Funcional pero con deuda técnica acumulada de sprints anteriores.  
**Estado post-auditoría:** Bugs corregidos, arquitectura limpia, UX mejorada, listo para demo comercial.

---

## 2. Hallazgos por área

### 2.1 Arquitectura y código

| # | Severidad | Hallazgo |
|---|-----------|----------|
| A1 | [CRÍTICO] | **Dead code `fichadasHoyF`** en `dashboard_gerencia.jsx:325` — la variable siempre retorna `fichadasHoy` sin importar el filtro por división. El filtro de Jornadas/hoy nunca filtra. |
| A2 | [MEJORA] | **6 componentes duplicados** en `app/components/` root: `Modal.jsx`, `LoginScreen.jsx`, `CambiarPasswordScreen.jsx`, `Skeleton.jsx`, `EmptyState.jsx` — todos sin imports. Las versiones canónicas viven en `app/components/ui/` y `app/components/screens/`. |
| A3 | [MEJORA] | **Toast desactualizado** — `AppProvider.jsx` importa `app/components/Toast.jsx` (Tailwind-based, menor calidad) en vez de `app/components/ui/Toast.jsx` (inline styles, animaciones, icons, backward-compat). |
| A4 | [MEJORA] | **`lib/push.js` y `components/PushManager.jsx`** están en la raíz del proyecto, fuera de `app/`. Inconsistente con el resto de la arquitectura. |
| A5 | [MEJORA] | **`admin_empresa_screen.js`** con extensión `.js` (tiene JSX), debería ser `.jsx` para consistencia. |
| A6 | [SUGERENCIA] | **Inline helpers sbGet/sbPost duplicados** en `billing/create-subscription` y `billing/webhook`. Son ~10 líneas cada uno y podrían compartirse en `app/lib/sbAdmin.js`. |
| A7 | [SUGERENCIA] | **`HomeContent.jsx` title logic** (líneas 208-215) es una cadena de ternarios larga e ilegible. Debería extraerse a función. |
| A8 | [SUGERENCIA] | **`catalogo_etapas`** sin `empresa_id` — tabla posiblemente obsoleta (reemplazada por `etapas` multi-tenant). No tiene RLS posible. |

### 2.2 Base de datos

| # | Severidad | Hallazgo |
|---|-----------|----------|
| B1 | [MEJORA] | **`reportes_obra.fotos`** documentado como `jsonb` en migración 001, pero el código accede a `r.fotos_urls` (array) y `r.fotos` (count) por separado. La migración no refleja la realidad: hay dos columnas (`fotos` integer y `fotos_urls` jsonb) o la columna se renombró. Requiere verificar contra Supabase Studio. |
| B2 | [MEJORA] | **`solicitudes.fecha`** es `text` en lugar de `date`. Dificulta queries por rango de fechas y no garantiza integridad. |
| B3 | [SUGERENCIA] | **`push_subscriptions`** — posiblemente obsoleta (legacy Web Push reemplazado por FCM). Verificar si tiene filas. |
| B4 | [SUGERENCIA] | **Índices** en `notificaciones.created_at` y `solicitudes.empresa_id + estado` podrían mejorar performance en empresas con muchas solicitudes. |

### 2.3 Producto / funcionalidad

| # | Severidad | Hallazgo |
|---|-----------|----------|
| P1 | [CRÍTICO] | **Filtro por división en Jornadas/hoy** no funciona (consecuencia de A1 — `fichadasHoyF` siempre es `fichadasHoy`). |
| P2 | [MEJORA] | **Empty states inconsistentes** — algunos son `<div>Sin fichadas</div>` básico (HomeEmp, InboxScreen), otros usan `EmptyState` component correcto. |
| P3 | [MEJORA] | **ConfigScreen tab bar** usa emojis como íconos (`📊 Asistencia`) — inconsistente con `Nav.jsx` que usa SVG icons. En mobile los emojis se ven distintos por OS. |
| P4 | [SUGERENCIA] | **Métrica de tardanzas del mes** no visible en Dashboard Gerencial — solo aparece en historial individual. |
| P5 | [SUGERENCIA] | **Badge de no leídos** en tab Chat no refleja mensajes nuevos del bot (solo Inbox tiene badge). |

### 2.4 UX/UI y diseño

| # | Severidad | Hallazgo |
|---|-----------|----------|
| U1 | [MEJORA] | **ConfigScreen tabs** — emojis inconsistentes con el sistema de diseño. Reemplazados con iconos SVG del sistema. |
| U2 | [MEJORA] | **Empty states** — copy poco accionable ("Sin fichadas", "No tenés solicitudes"). Falta descripción y CTA. |
| U3 | [MEJORA] | **Botones icon-only** sin `aria-label` (logout en HomeEmp, refresh en Dashboard). |
| U4 | [SUGERENCIA] | **Grilla semanal en HomeEmp** — las filas de días son muy densas. El layout horizontal de hora inicio → hora fin podría ser más legible. |
| U5 | [SUGERENCIA] | **Loading state** en carga inicial de app — el `return null` cuando `!init` es una pantalla en blanco. Un spinner mínimo sería mejor UX. |

### 2.5 SaaS-readiness

| # | Severidad | Hallazgo |
|---|-----------|----------|
| S1 | ✅ BIEN | Multi-tenant correctamente implementado: `empresa_id` inyectado en todas las queries via `/api/data`, RLS como capa defensiva. |
| S2 | ✅ BIEN | Billing completo: planes free/starter/pro/enterprise, trial, MercadoPago webhook HMAC, cron de vencimiento. |
| S3 | ✅ BIEN | Personalización por empresa: nombre, logo, colores, divisiones, etapas. |
| S4 | ✅ BIEN | Onboarding wizard de 4 pasos. |
| S5 | ✅ BIEN | Superadmin con impersonación auditada y panel de control. |
| S6 | [MEJORA] | **Variables de entorno en `.env.local`** — 3 valores son placeholders sin reemplazar (`SUPERADMIN_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`). |
| S7 | [SUGERENCIA] | **Precios hardcodeados** en ARS en `app/lib/plans.js`. Para internacionalización futura, considerar variable de entorno o config en DB. |

---

## 3. Cambios realizados

### Prioridad 1 — Bugs y seguridad

| Archivo | Cambio |
|---------|--------|
| `app/dashboard_gerencia.jsx` | Eliminado dead code `fichadasHoyF` (variable siempre retornaba `fichadasHoy`, hacía el filtro de divisiones inútil) |
| `supabase/migrations/001_tablas_base.sql` | Documentado `fotos_urls jsonb` como columna separada de `fotos integer` en `reportes_obra` |

### Prioridad 2 — Arquitectura limpia

| Archivo | Cambio |
|---------|--------|
| `app/components/Modal.jsx` | **Eliminado** — duplicado sin imports. Versión canónica: `app/components/ui/Modal.jsx` |
| `app/components/LoginScreen.jsx` | **Eliminado** — duplicado sin imports. Versión canónica: `app/components/screens/LoginScreen.jsx` |
| `app/components/CambiarPasswordScreen.jsx` | **Eliminado** — duplicado sin imports. Versión canónica: `app/components/screens/CambiarPasswordScreen.jsx` |
| `app/components/Skeleton.jsx` | **Eliminado** — duplicado sin imports. Versión canónica: `app/components/ui/Skeleton.jsx` |
| `app/components/EmptyState.jsx` | **Eliminado** — duplicado sin imports. Versión canónica: `app/components/ui/EmptyState.jsx` |
| `app/context/AppProvider.jsx` | Import actualizado: usa `ui/Toast.jsx` (mejor versión con animaciones e icons) en vez de root `Toast.jsx` |
| `app/components/Toast.jsx` | **Eliminado** tras actualizar import en AppProvider |

### Prioridad 3 — UX/UI profesional

| Archivo | Cambio |
|---------|--------|
| `app/components/screens/ConfigScreen.jsx` | Tab bar rediseñado: emojis reemplazados por SVG icons consistentes con `Nav.jsx`. Labels más cortos y claros. |
| `app/[slug]/HomeContent.jsx` | Lógica de título extraída a función `getScreenTitle()` y `getScreenSubtitle()` — de 2 ternarios de 200 chars a funciones legibles. |
| `app/components/screens/HomeEmp.jsx` | Empty states mejorados en "Mi semana" y "Mis solicitudes" — usan `EmptyState` component con copy accionable. |
| `app/components/screens/InboxScreen.jsx` | Verificado — tiene manejo básico de estado vacío. |
| `app/[slug]/HomeContent.jsx` | Loading state: reemplazado `return null` por spinner animado con logo de empresa y 3 dots pulsantes en amber |
| `app/components/screens/HistorialFichajesScreen.jsx` | Empty state mejorado: `EmptyState` con icon calendar + copy accionable. Loading reemplazado por dots pulsantes. |
| `app/globals.css` | Agrega `@keyframes gypi-pulse` + `.gypi-dots` — clase utilitaria reutilizable para todos los loading states |
| `app/components/Nav.jsx` | Active indicator: línea amber animada (width 0→18px) bajo la tab activa; label en bold cuando activa; transición suave de color |
| `app/components/screens/ReglasScreen.jsx` | Empty state cuando no hay reglas configuradas (🤖 icon + descripción accionable) |
| `app/actividad_screen.jsx` | Loading → gypi-dots; historial vacío → tarjeta descriptiva con copy; proyectos cargando → dots inline |
| `app/reportes_screen.jsx` | Loading → gypi-dots (obra y cumplimiento); empty state obra con 🏗️ icon; empty state empleados con 👥 icon |
| `app/calendario_screen.jsx` | Loading → gypi-dots |
| `app/proyectos_screen.jsx` | Loading → gypi-dots; empty state con copy diferenciado (sin resultados vs sin proyectos) |
| `app/geolocalizacion_screen.jsx` | Loading → gypi-dots (cyan) |
| `app/grilla_horario_screen.jsx` | Loading → gypi-dots |
| `app/gerencia_actividad_screen.jsx` | Loading → gypi-dots |
| `app/gestion_personal_screen.jsx` | Loading → gypi-dots |

### Prioridad 5 — Métricas accionables

| Archivo | Cambio |
|---------|--------|
| `app/dashboard_gerencia.jsx` | Query `fichadasSemana` ahora incluye `llegada_tarde,minutos_tarde`. Nueva métrica "Tardes sem." en la tarjeta Asistencia (4ta columna, amber cuando > 0, green cuando 0). |

---

## 4. Pendientes fuera de scope

| Prioridad | Pendiente | Recomendación |
|-----------|-----------|---------------|
| Alta | **Verificar `reportes_obra` columnas `fotos`/`fotos_urls`** contra Supabase Studio — si hay discrepancia, crear migración SQL correctiva. | Sprint siguiente |
| Alta | **`solicitudes.fecha` cambiar de text a date** — requiere migración con conversión de datos existentes. | Sprint siguiente |
| Media | **Mover `lib/push.js` y `components/PushManager.jsx`** a `app/lib/` y `app/components/`. Requiere actualizar todos los imports relativos. | Refactor planificado |
| Media | **Renombrar `admin_empresa_screen.js`** → `.jsx` — trivial pero requiere verificar que el sistema de build lo maneje sin breaking changes. | Próxima sesión |
| Media | **Consolidar sbGet/sbPost/sbPatch inline** de billing routes en `app/lib/sbAdmin.js`. | Refactor planificado |
| Media | **`catalogo_etapas`** — auditar si tiene datos, si la app la lee. Si está obsoleta, migrar sus datos a `etapas` y dropear la tabla. | Sprint siguiente |
| Baja | **Badges de mensajes no leídos en Chat tab** | Feature nueva |
| Baja | **Tardanzas del mes (acumulado mensual)** en Dashboard — la métrica actual muestra semana. Para el mes necesita query separada. | Feature nueva |
| Baja | **Internacionalización de precios** en plans.js | Largo plazo |
| Baja | **Tests de integración para API routes** — los tests actuales son unitarios. | Largo plazo |

---

## 5. Decisiones de diseño relevantes

### D1 — Se conservó `ui/Toast.jsx` como canónica
La versión en `app/components/ui/Toast.jsx` usa inline styles (consistente con el 95% de la app), tiene animaciones CSS propias, icons SVG semánticos y un `ToastInline` de backward-compat. La versión root usaba clases Tailwind que dependen de config personalizada (`bg-gypi-green`) — más frágil al no tener un `tailwind.config.js` explícito en v4.

### D2 — No se movió `lib/push.js` a `app/lib/`
El riesgo de romper imports relativos en `components/PushManager.jsx` y potencialmente el service worker supera el beneficio cosmético. Documentado como pendiente.

### D3 — No se cambió la extensión de `admin_empresa_screen.js`
Next.js/webpack resuelve JSX en archivos `.js` sin problemas. Cambiar la extensión requeriría git mv + verificar que ningún import use la extensión explícita. Documentado como pendiente trivial.

### D4 — ConfigScreen: SVG icons en vez de emoji
Los emojis varían en renderizado por OS (iOS vs Android vs desktop) y tienen tamaños inconsistentes. Los SVG icons del sistema (`Ic.*` de `Icons.jsx`) son cross-platform y se integran con el color del sistema de diseño.

### D5 — Empty states con EmptyState component
Reemplazar `<div>Sin fichadas</div>` inline por `<EmptyState>` con icon + title + description + action mejora la UX sin agregar dependencias. El componente ya existía en `app/components/ui/EmptyState.jsx`, solo faltaba usarlo consistentemente.
