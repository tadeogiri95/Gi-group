# Cómo aprobar cada cambio (guía simple)

## Qué es un Pull Request (PR)

Es una **propuesta de cambio** en GitHub. Yo preparo el cambio en una copia aparte del código (una "rama") y abro el PR. **Nada llega a producción hasta que vos lo aprobás.** El PR te muestra:

- **Conversation:** qué cambia y por qué, explicado en simple.
- **Checks:** si las pruebas automáticas pasaron (✓ verde = OK, ✗ rojo = algo falló y lo corrijo yo).
- **Files changed:** las líneas exactas que cambian (rojo = se quita, verde = se agrega). No hace falta que las entiendas todas.

## Lo que hacés vos (2 minutos por cambio)

1. Te paso el link del PR (por ejemplo `https://github.com/tadeogiri95/Gi-group/pull/1`).
2. Leés el resumen y esperás que el check de CI esté en **verde**.
3. Apretás **"Merge pull request"** y después **"Confirm merge"**.
4. Vercel publica el cambio solo, en unos minutos. Probás lo que te indico en el PR (por ejemplo: entrar y fichar).
5. Me avisás "listo" y paso al siguiente ítem.

Si algo no te convence, escribí un comentario en el PR o decímelo acá, y lo ajusto antes de que lo apruebes.

## Si algo sale mal después de aprobar

En el PR ya aprobado aparece el botón **"Revert"**: crea un PR que deshace el cambio. Lo aprobás igual que el original y la app vuelve a como estaba.

## Cambios en la base de datos

Algunos ítems cambian la base. En esos casos el PR trae el archivo SQL y te paso:

1. El SQL para correr en el **SQL Editor** de Supabase (primero en el ambiente de pruebas, cuando exista).
2. Una consulta para **verificar** que quedó bien.
3. Un SQL para **revertir**, si hiciera falta.

## Cuidado mientras no haya ambiente de pruebas

Vercel crea una "vista previa" de cada PR. Hasta que separemos los ambientes (ítem 1 del plan), esas vistas previas **usan la base de producción**: no cargues datos de prueba en ellas.
