# Cómo armar el ambiente de pruebas (staging) — gratis, sin SQL

**Para qué:** hoy las vistas previas de cada PR (los links de Vercel) usan la **base de producción**: cualquier prueba ahí toca datos reales. Con staging, las vistas previas usan una base aparte, con la misma estructura y sin datos reales.

Son ~20 minutos. **No me pases ninguna clave:** todo se carga directo en Supabase, GitHub y Vercel.

## Parte 1 — Crear el proyecto de staging en Supabase
1. Entrá a <https://supabase.com/dashboard> → **New project**.
2. Nombre: `gypi-staging` · misma región que producción · plan **Free** (Supabase permite 2 proyectos gratis).
3. Inventá una contraseña de base **solo con letras y números** y guardala.
4. Esperá unos minutos a que el proyecto quede listo.

## Parte 2 — Cargar la dirección de staging en GitHub
1. En el proyecto **gypi-staging**: botón **Connect** → **Session pooler** → copiá la dirección (empieza con `postgresql://`) y reemplazá `[YOUR-PASSWORD]` por la contraseña del paso 1.3. Igual que con el backup: sin `DATABASE_URL=` adelante ni comillas.
2. GitHub → repositorio → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `STAGING_DB_URL`
   - Secret: la dirección de staging
3. **Actions → "Preparar base de staging" → Run workflow**. En ~2 minutos tiene que quedar en verde ("Staging listo").

> El proceso se niega a correr si la dirección es la de producción o si la base ya tiene tablas: no puede romper nada.

## Parte 3 — Que las vistas previas de Vercel usen staging
1. En Supabase, proyecto **gypi-staging** → **Project Settings → API**. Vas a copiar 3 datos: **Project URL**, la clave **anon public** y la clave **service_role**.
2. En Vercel → proyecto → **Settings → Environment Variables**. Para cada una de estas variables, editala y dejá **dos versiones**: la actual solo para **Production**, y una nueva con el valor de staging solo para **Preview**:
   - `NEXT_PUBLIC_SUPABASE_URL` → Project URL de staging
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → anon public de staging
   - `SUPABASE_SERVICE_KEY` → service_role de staging
3. Avisame y lo verifico abriendo una vista previa.

## Después
- En staging no hay empresas: en una vista previa podés registrar una empresa de prueba desde la pantalla de alta, sin miedo.
- Las migraciones nuevas se prueban primero en staging.
