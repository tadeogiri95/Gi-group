# Gypi — Gestión de Personas

PWA de gestión de RRHH para PyMEs argentinas. Fichaje con geolocalización, gestión de empleados, proyectos, reportes y facturación SaaS con MercadoPago.

> Antes de contribuir, leé `CONTRIBUTING.md` (convenciones, checklist de PR, reglas de seguridad no negociables).

## Stack

- **Next.js 16** (App Router, React 19)
- **Supabase** (PostgreSQL + Storage + Realtime)
- **Firebase** (FCM push notifications)
- **MercadoPago** (suscripciones, webhook HMAC)
- **Tailwind v4** + CSS variables
- **jose** (JWT HS256, httpOnly cookies)

---

## Requisitos previos

- Node.js 20+
- Cuenta Supabase con proyecto creado
- Cuenta Firebase con app web
- Cuenta MercadoPago con aplicación creada
- Cuenta Resend (emails transaccionales)

---

## Variables de entorno

Copiar `.env.example` a `.env.local` y completar:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_KEY=<service-role-key>      # solo en servidor, bypasa RLS

# JWT — generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<min-32-chars>

# Firebase Admin SDK
FIREBASE_PROJECT_ID=<project-id>
FIREBASE_CLIENT_EMAIL=<client-email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# MercadoPago
MERCADOPAGO_ACCESS_TOKEN=<access-token>
MERCADOPAGO_WEBHOOK_SECRET=<webhook-secret>  # OBLIGATORIO — sin esto el webhook retorna 500

# Resend
RESEND_API_KEY=re_<key>
RESEND_FROM=noreply@tudominio.com

# App
NEXT_PUBLIC_APP_URL=https://tudominio.com
CRON_SECRET=<token-aleatorio>               # valida peticiones de los cron jobs de Vercel
```

> `MERCADOPAGO_WEBHOOK_SECRET` es obligatorio aunque no uses pagos aún — el endpoint `/api/billing/webhook` falla con 500 si está ausente (comportamiento intencional, evita bypass de validación HMAC).

---

## Migraciones de base de datos

Las migraciones en `supabase/migrations/` **no se ejecutan automáticamente** — son documentación del schema esperado que se corre a mano (SQL Editor de Supabase) en orden numérico, de menor a mayor. Antes de correr una migración que toque datos existentes (no solo `CREATE TABLE`/`ALTER TABLE`), leé el comentario de cabecera del archivo — varias incluyen notas de riesgo o alcance reducido a propósito (ver `034_solicitudes_fecha_date.sql` como ejemplo).

---

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:3000
```

Acceder a `http://localhost:3000/<slug-empresa>` donde `slug` es el campo `slug` de la tabla `empresa`.

---

## Tests

```bash
npm test           # unitarios + HTTP de rutas críticas + componentes RTL
npm run test:e2e   # smoke test E2E con Playwright (login → fichar → historial)
npm run lint       # ESLint (eslint-config-next + unused-imports + no-restricted-imports)
```

Los unitarios y de integración HTTP usan el runner nativo de Node.js (`node:test`), sin jest ni vitest. Los componentes usan `@testing-library/react` sobre `jsdom`. El E2E usa Playwright contra el dev server local con las rutas de API mockeadas (no requiere Supabase real). Ver `CONTRIBUTING.md` para el detalle de qué correr antes de un PR.

---

## Deploy en Vercel

1. Conectar el repositorio en Vercel.
2. Agregar todas las variables de entorno del `.env.example`.
3. Dominio personalizado recomendado para que HSTS funcione correctamente.

### Cron jobs

Definidos en `vercel.json`:

| Ruta | Schedule (UTC) | Propósito |
|------|----------|-----------|
| `/api/cron/auto-fichaje` | `0 3 * * *` | Cierra fichadas abiertas y limpia sesiones expiradas |
| `/api/cron/limpiar-tokens` | `0 5 * * 0` | Purga push tokens, login_attempts, rate_limits y sesiones expiradas (domingo) |
| `/api/cron/trial-reminder` | `0 12 * * *` | Email recordatorio antes de fin de trial |
| `/api/cron/vencer-trials` | `0 4 * * *` | Pasa a Free los trials vencidos (RPC batch, ver `036_vencer_trials_batch.sql`) |
| `/api/cron/push-ausencias` | `0 15 * * 1-5` | Push a gerencia por empleados sin fichar entrada (días hábiles) |
| `/api/cron/inactividad-produccion` | `0 17 * * 1-5` | Push a operarios sin registro de actividad en 30min |

Todos los cron jobs validan el header `Authorization: Bearer $CRON_SECRET`.

---

## Arquitectura multi-tenant

Cada empresa tiene un `slug` único. El flujo de acceso:

```
/:slug → page.js (AuthProvider) → HomeContent → useAuth()
```

- El `empresa_id` se inyecta desde el JWT en cada API route — nunca se confía en el body del cliente.
- Todas las queries a Supabase pasan por `/api/data` con `SUPABASE_SERVICE_KEY` y filtro `empresa_id`.
- RLS está configurado como defensa en profundidad pero el gateway es la capa primaria.

---

## Planes SaaS

| Plan | Empleados | Precio ARS/mes |
|------|-----------|----------------|
| Free | 5 | $0 |
| Starter | 15 | $15.000 |
| Pro | 50 | $35.000 |
| Enterprise | ilimitado | a convenir |

Las restricciones se aplican con `planPermite()`, `planTieneModulo()` y `planLimite()` de `app/lib/plans.js`.

---

## Seguridad

- JWT HS256 con access token (30min) + refresh token (30d) en cookies httpOnly — nunca en el body de la respuesta
- Webhook MercadoPago con validación HMAC-SHA256 obligatoria
- Headers HTTP en todas las rutas (definidos en `proxy.ts`, única fuente de verdad): HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Audit log en tabla `audit_log` para cambios sensibles
- Rate limiting (`app/lib/rateLimit.js`) en login, registro y superadmin auth

Ver `CONTRIBUTING.md` para los atajos de seguridad que están explícitamente prohibidos en este repo.
