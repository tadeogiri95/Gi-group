# Gypi — Gestión de Personas

PWA de gestión de RRHH para PyMEs argentinas. Fichaje con geolocalización, gestión de empleados, proyectos, reportes y facturación SaaS con MercadoPago.

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

Ejecutar en orden desde el SQL Editor de Supabase o con la CLI:

```bash
# Con Supabase CLI
supabase db push

# O manualmente: ejecutar cada archivo en orden
supabase/migrations/001_schema.sql
supabase/migrations/002_funciones.sql
supabase/migrations/003_storage.sql
supabase/migrations/004_rls.sql
supabase/migrations/005_planes.sql
supabase/migrations/006_billing.sql
supabase/migrations/007_fix_theme_preset_constraint.sql
supabase/migrations/008_audit_log.sql
supabase/migrations/009_timezone_auto_fichaje.sql
supabase/migrations/010_sesiones_jti_columns.sql
```

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
npm test           # 84 tests — calc, auth, jwt, plans
```

Usa el runner nativo de Node.js (`node:test`). Sin jest, sin vitest.

---

## Deploy en Vercel

1. Conectar el repositorio en Vercel.
2. Agregar todas las variables de entorno del `.env.example`.
3. Dominio personalizado recomendado para que HSTS funcione correctamente.

### Cron jobs

Definidos en `vercel.json`. Requieren **Vercel Pro** para el schedule de cada 30 minutos:

| Ruta | Schedule | Propósito |
|------|----------|-----------|
| `/api/cron/auto-fichaje` | `*/30 * * * *` | Cierra fichadas abiertas 15+ min después del egreso programado |
| `/api/cron/limpiar-tokens` | `0 5 * * 0` | Purga sesiones JWT expiradas (domingo 5am UTC) |
| `/api/cron/trial-reminder` | `0 12 * * *` | Email recordatorio antes de fin de trial (12pm UTC) |

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

- JWT HS256 con access token (7d) + refresh token (30d) en cookies httpOnly
- Webhook MercadoPago con validación HMAC-SHA256 obligatoria
- Headers HTTP en todas las rutas: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Audit log en tabla `audit_log` para cambios sensibles
