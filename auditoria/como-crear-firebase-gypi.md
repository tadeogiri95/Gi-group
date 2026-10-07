# Cómo pasar las notificaciones al proyecto Firebase de Gypi (ítem 33)

Hoy las notificaciones push salen del proyecto Firebase del piloto (`gi-group-app-676a0`). Para que Gypi tenga el suyo, ~20 minutos. **No me pases ninguna clave:** todo se pega directo en Vercel.

> Al cambiar de proyecto, cada persona tiene que volver a tocar **"Activar notificaciones"** una vez (los permisos del proyecto viejo no sirven en el nuevo). Conviene hacerlo un día tranquilo y avisarle al equipo.

## 1. Crear el proyecto

1. Entrá a <https://console.firebase.google.com/> con la cuenta de Google de Gypi → **Agregar proyecto** → nombre `gypi` → podés desactivar Google Analytics → **Crear**.
2. En el proyecto: ícono **</>** (Web) → apodo `gypi-web` → **Registrar app** (no hace falta Hosting).
3. Firebase muestra un bloque `firebaseConfig` con 6 valores. Dejá esa pestaña abierta.

## 2. Clave para notificaciones web (VAPID)

1. **⚙️ Configuración del proyecto → Cloud Messaging**.
2. En **Configuración web → Certificados de push web** → **Generar par de claves**. Copiá la clave que aparece.

## 3. Credencial del servidor

1. **⚙️ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada** → se descarga un archivo `.json`.
2. Abrilo con el Bloc de notas y copiá **todo** el contenido.

## 4. Cargar todo en Vercel

Proyecto **gi-group-app → Settings → Environment Variables**. Para cada una: **Edit** si ya existe, si no **Add**, ambientes **Production** y **Preview**:

| Variable | Valor (del paso 1, 2 o 3) |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | la clave del paso 2 |
| `FIREBASE_SERVICE_ACCOUNT` | el contenido completo del `.json` del paso 3 |

Si ya existía `FIREBASE_SERVICE_ACCOUNT_B64`, borrala (si están las dos, se usa la de JSON).

## 5. Publicar y probar

1. **Deployments →** último deploy de producción → **⋯ → Redeploy**.
2. Entrá a la app con tu usuario, tocá **"Activar notificaciones"** y aceptá.
3. Desde otro usuario mandá una solicitud: te tiene que llegar la notificación.
4. Para confirmar que ya usa el proyecto nuevo, abrí `https://TU-DOMINIO/firebase-config.js`: tiene que decir `"projectId":"gypi"` (o el id que te dio Firebase).

Los permisos viejos (del proyecto del piloto) se borran solos la primera vez que se intenta mandarles una notificación.
