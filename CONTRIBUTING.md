# Contribuir a Gypi

Convenciones del proyecto y checklist antes de abrir un PR. El objetivo es que la deuda técnica no se siga acumulando — ver `diagnostico_gypi.html` para el estado general.

## Convenciones de naming y estructura

- **Pantallas** (`app/components/screens/*.jsx`, y las "external screens" en la raíz de `app/`): `PascalCase`, un componente por archivo, mismo nombre que el archivo.
- **Libs / helpers** (`app/lib/*`): `camelCase`. Si una función ya existe en `app/lib/`, importala — no la copies inline en una route. Esto ya causó drift real (`distanciaMetros` duplicada en `fichar/route.js` en vez de usar `app/lib/calc.js`, la ventana de rate-limit de 15min copiada en 3 routes antes de centralizarse en `app/lib/rateLimit.js`).
- **JS vs TS**: el proyecto está en transición. Reglas concretas:
  - Archivos **nuevos**: preferí `.ts`/`.tsx` salvo que el archivo sea un componente React puramente visual sin lógica de negocio compleja.
  - **No migres** un archivo `.js` existente a `.ts` solo por prolijidad — generá un diff enorme sin valor. Migrá solo si de todos modos vas a tocar ese archivo a fondo.
  - Libs de dominio compartido (`app/lib/`) son la prioridad de migración cuando se toquen, porque ahí vive la lógica que más vale tipar.
- **API routes**: usá los helpers de `app/lib/sbHelpers.js` (`sbGet`, `sbPost`, `sbPatch`, `sbPatchOk`, `sbDelete`, `sbRpc`) para hablar con Supabase. No reimplementes `fetch` a `/rest/v1/...` a mano salvo un caso muy específico que los helpers no cubran (y documentá por qué).

## Multi-tenancy — regla no negociable

`empresa_id` se obtiene **siempre** del JWT validado server-side (`validarToken()` en `app/lib/auth.js`), nunca del body/query que manda el cliente. `/api/data` ya inyecta `empresa_id` automáticamente (`inyectarEmpresaEnGet`/`inyectarEmpresaEnBody`) — si agregás un nuevo proxy o ruta que lea/escriba una tabla con `empresa_id`, replicá ese patrón. Un bug acá es un incidente de seguridad cross-tenant, no un bug cualquiera.

## Antes de abrir un PR

- [ ] `npm run lint` sin errores nuevos (hay reglas en `warn` por deuda preexistente — no las subas de severidad en un PR que no las arregla, pero tampoco agregues más warnings del mismo tipo a propósito).
- [ ] `npm test` pasa (HTTP routes, componentes RTL, unitarios).
- [ ] Si tocaste un flujo crítico (login, fichar, billing webhook, `/api/data`), considerá si necesita un test nuevo en `tests/` — son baratos de escribir con los helpers de `tests/helpers/mockFetch.js`.
- [ ] Si tocaste una pantalla con navegación real (login → fichar → historial), corré `npm run test:e2e` localmente si el cambio toca esa zona.
- [ ] `npm run build` sin errores.
- [ ] Si agregaste una tabla o columna nueva en Supabase, escribiste la migración en `supabase/migrations/NNN_descripcion.sql` siguiendo el número secuencial siguiente. Las migraciones de este repo **no se ejecutan automáticamente** — son documentación que se corre a mano en Supabase Studio. Si la migración toca datos existentes (no solo schema), dejá un comentario explicando el riesgo.
- [ ] Si agregaste una tabla nueva con `empresa_id`, agregale RLS con el patrón `service_role` de `004_rls.sql` (o el bloque defensivo de `035_service_role_policies_consistency.sql` si no estás seguro de que la tabla ya exista en producción).

## Dead code

Si borrás un archivo, verificá que nada lo importe (`grep` rápido alcanza). Si agregás un archivo, asegurate de que algo lo importe — un componente o lib que nadie usa es exactamente el tipo de cosa que costó horas encontrar en la auditoría de Etapa 1 y Etapa 10.

## Seguridad — atajos prohibidos

- Nunca devuelvas un access/refresh token en el body JSON de una respuesta — solo en cookies `httpOnly`.
- Nunca loggees ni devuelvas `err.message` crudo en una respuesta 500 al cliente — usá un mensaje genérico y loggeá el detalle server-side (`logger.error`).
- Si agregás un endpoint de auth (login, signup, recuperar password, etc.), agregale rate limiting con `ventana15min()` de `app/lib/rateLimit.js` — no reinventes la ventana de 15 minutos.
