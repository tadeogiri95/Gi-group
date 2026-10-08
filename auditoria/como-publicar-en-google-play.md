# Cómo publicar Gypi en Google Play (ítem 34, D12/D14)

La app de Play es la misma web de Gypi "envuelta" (lo que Google llama *Trusted Web Activity*): no hay que mantener otro código. Cada cambio que se publica en la web aparece solo en la app.

> **Adentro de la app de Play no se muestran precios ni se cobra.** Las reglas de Google obligan a usar su sistema de pagos (con comisión) para vender dentro de una app. Por eso, en la app, "Suscripción" le dice al dueño que la gestione desde gypi.app, y la ficha de la tienda no menciona precios. Esto ya está hecho en el código.

## Lo que necesitás

- La cuenta de desarrollador de Google Play (pago único de USD 25) a nombre tuyo.
- **Cuentas personales nuevas:** Google pide una **prueba cerrada con al menos 12 personas durante 14 días seguidos** antes de dejar publicar para todos. Sirven empleados del piloto o conocidos con Android. Revisá el requisito vigente en la Play Console cuando crees la app: Google lo cambia cada tanto.

## 1. Generar el paquete de la app (sin instalar nada)

1. Entrá a <https://www.pwabuilder.com/> y pegá la dirección de Gypi (`https://gypi.app`, o el dominio que uses) → **Start**.
2. **Package For Stores → Android → Generate Package**. En las opciones:
   - **Package ID:** `app.gypi.twa` (no se puede cambiar después)
   - **App name:** `Gypi` · **Launcher name:** `Gypi`
   - **Start URL:** `/?source=twa` ← importante: así la app sabe que es la de Play
   - **Signing key:** *Create new* (PWABuilder te genera la llave de firma)
3. Descargá el `.zip`. Adentro hay:
   - el archivo `.aab` (lo que se sube a Play),
   - la **llave de firma** (`signing.keystore` + `signing-key-info.txt`): **guardala en un lugar seguro y con copia**. Si se pierde, no se puede actualizar la app nunca más.
   - un `assetlinks.json` de ejemplo con la **huella SHA-256**.

## 2. Vincular la app con el dominio

Sin este paso la app abre con la barra del navegador arriba.

1. En Vercel → **Settings → Environment Variables → Add** (Production y Preview):
   - `ANDROID_PACKAGE_NAME` = `app.gypi.twa`
   - `ANDROID_SHA256_FINGERPRINTS` = la huella SHA-256 del `assetlinks.json` del zip (formato `AB:CD:...`, 32 pares)
2. **Redeploy** y abrí `https://TU-DOMINIO/.well-known/assetlinks.json`: tiene que mostrar el paquete y la huella.
3. Cuando subas la app a Play, Google la vuelve a firmar con **su** llave: en la Play Console, **Configuración → Integridad de la app → Firma de apps**, copiá la **huella SHA-256 del certificado de firma de apps** y agregala a `ANDROID_SHA256_FINGERPRINTS` separada por coma (quedan las dos). Redeploy.

## 3. Crear la app en la Play Console

1. **Crear app** → nombre `Gypi`, idioma español (Argentina), **App**, **Gratis**.
2. **Ficha de la tienda** (sin precios):
   - *Descripción breve:* `Fichaje, horarios y producción para pymes industriales.`
   - *Descripción completa:* `Gypi es la app de tu empresa para fichar entrada y salida con GPS, QR o PIN, pedir permisos y vacaciones, y registrar las tareas del día sobre cada orden de trabajo. Necesitás que tu empresa use Gypi: pedile el código a tu supervisor.`
   - Íconos y capturas: el ícono de 512×512 está en `public/icons/icon-512.png`; las capturas sacalas del celular.
3. **Contenido de la app:** política de privacidad → `https://TU-DOMINIO/privacy`; acceso a la app → "Se necesitan credenciales" y dejá un usuario de prueba de una empresa demo; anuncios → **No**; seguridad de los datos: ubicación precisa (fichaje), nombre y email (cuenta), datos cifrados en tránsito, el usuario puede pedir borrarlos.
4. **Prueba cerrada:** creá una pista, agregá los emails de los testers, subí el `.aab` y mandales el link de suscripción. Esperá los 14 días con al menos 12 testers activos.
5. Después: **Producción → Crear versión** con el mismo `.aab` (o uno nuevo) → enviar a revisión.

## Actualizar la app

Casi nunca hace falta: los cambios de la web aparecen solos. Solo se sube un `.aab` nuevo si cambia el nombre, el ícono o la dirección de inicio (se genera igual en PWABuilder **con la misma llave de firma**).
