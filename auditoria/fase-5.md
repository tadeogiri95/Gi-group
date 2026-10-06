# Fase 5 — Formato de distribución (alternativas a la PWA)

> Solo lectura. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> **[HECHO]** = código actual · **[HIPÓTESIS]** = políticas, precios o capacidades de terceros (navegadores, stores) que deben validarse antes de decidir, ya que cambian seguido.
> Requisitos tomados de las fases anteriores y de las respuestas del dueño: **botón grande de fichar**, **QR + PIN** para el acceso de operarios, **escaneo de código de barras o QR de las OT (opcional por empresa)**, **supervisor limitado a su división**, **resumen semanal automático**, operación en planta con **mala señal**, mercado **pymes de Argentina** (mayoría de Android en planta [HIPÓTESIS]).

## Resumen (5 líneas)

1. **Hoy el producto es una web app Next.js con PWA mínima:** un manifest que abre la landing, un service worker que solo muestra una página offline, push web por FCM, y una TWA de Android preparada (`com.gypi.app`) pero nunca publicada. No hay código nativo.
2. **Ningún formato resuelve solo los problemas reales:** la sesión que se pierde, la falta de offline, el link de activación roto y la cámara bloqueada por `Permissions-Policy: camera=()` son de la app web y hay que corregirlos en **todas** las opciones.
3. Para las necesidades actuales (fichar, QR/PIN, escanear OT, GPS en el momento, push, cola offline) **la web alcanza en Android**. En iOS hay límites (push solo con la app instalada, sin sincronización en segundo plano, más fricción para instalar), aceptables porque el operario argentino de planta usa mayoritariamente Android [HIPÓTESIS].
4. **Recomendación (opción E): una sola base web multi-tenant distribuida de tres formas:** navegador para gestión y dueño, **PWA/TWA en Google Play** para operarios y **modo kiosco** en una tablet de planta con QR + PIN. iOS nativo (Capacitor) solo cuando un cliente lo exija.
5. Con esa estrategia no hay comisiones de las stores (la suscripción se cobra afuera, por Mercado Pago), las actualizaciones son instantáneas y el esfuerzo es **M**, frente a **L** de una app nativa completa en dos stores.

---

## 1. Punto de partida [HECHO]

| Componente | Estado | Evidencia |
|---|---|---|
| Manifest | `start_url: "/"` (landing de marketing, no la app del tenant), `display: standalone`, solo `portrait`, sin `shortcuts` | `public/manifest.json:5-7` |
| Service worker | Un solo SW (`firebase-messaging-sw.js`): caché solo de `offline.html` + push FCM (SDK compat 10.12 por CDN) | `public/firebase-messaging-sw.js:8-32` |
| Offline | No hay caché de la app ni de datos, ni cola de escrituras | — |
| Push | FCM web: el token se guarda en `push_tokens` y el envío es server-side | `app/lib/push.js`, `api/send-push` |
| Cámara | Solo `<input type="file" accept="image/*">` (fotos de obra, documentos). **`Permissions-Policy: camera=()` bloquea `getUserMedia`**, así que hoy no se puede escanear en vivo | `proxy.ts:68`, `instalador_screen.jsx:185` |
| GPS | `navigator.geolocation` en el momento de fichar | `app/lib/fichar.js:56-75` |
| Sesión | `sessionStorage`: se pierde al cerrar la app (F1-03) | `app/context/AuthContext.jsx` |
| Android | `assetlinks.json` para la TWA `com.gypi.app` (con *fingerprint*); no hay proyecto de Bubblewrap ni Capacitor en el repo; nunca se publicó | `public/.well-known/assetlinks.json` |
| iOS | Nada específico | — |

## 2. Requisitos y qué los soporta

| Requisito | Web en navegador | PWA instalada (Android) | PWA instalada (iOS) | App nativa (Capacitor) |
|---|---|---|---|---|
| Botón de fichar + GPS en el momento | ✅ | ✅ | ✅ | ✅ |
| Sesión persistente + **PIN** local | ✅ (cookie + PIN en servidor) | ✅ | ✅ (con ITP: datos locales que pueden borrarse si no se usa [HIPÓTESIS]) | ✅ (keystore/keychain) |
| **QR de activación** (enlace con código) | ✅ (abre la URL) | ✅ | ✅ | ✅ (*deep link*) |
| **Escanear código de barras o QR de la OT** con la cámara | ✅ con `getUserMedia` + librería JS (ZXing/`html5-qrcode`); `BarcodeDetector` nativo solo en Chromium [HIPÓTESIS] | ✅ | ✅ con librería JS (Safari sin `BarcodeDetector` [HIPÓTESIS]) | ✅ ML Kit/Vision: más rápido con poca luz |
| Push | ✅ Android/desktop; ❌ Safari sin instalar | ✅ | ⚠️ Solo con la app instalada en la pantalla de inicio (iOS ≥ 16.4) [HIPÓTESIS] | ✅ FCM/APNs nativos, más confiables |
| **Offline** (cola de fichajes y tareas) | ⚠️ SW + IndexedDB; se sincroniza al volver a abrir | ✅ SW + IndexedDB + Background Sync (Chromium) | ⚠️ Sin Background Sync: sincroniza solo con la app abierta [HIPÓTESIS] | ✅ SQLite + reintentos nativos |
| GPS en segundo plano (no requerido hoy) | ❌ | ❌ | ❌ | ✅ (con revisión estricta de las stores) |
| **Modo kiosco** (tablet compartida, QR + PIN) | ✅ con Chrome en kiosco / “fijar pantalla” de Android | ✅ | ⚠️ Acceso guiado de iOS (manual) | ✅ con MDM o *lock task mode* |
| Resumen semanal | Server-side (email/WhatsApp): independiente del formato | | | |
| Actualizaciones | Instantáneas | Instantáneas | Instantáneas | Web instantánea; *shell* nativo por store |

**Conclusión técnica:** todos los requisitos actuales se pueden cubrir con la web en Android, el escenario dominante en planta. Lo nativo suma confiabilidad de push y offline en iOS, y escaneo más rápido, pero no habilita nada imprescindible hoy.

## 3. Alternativas

### A. Web app SaaS pura (navegador, sin instalación)

| | |
|---|---|
| **Ventajas** | Cero instalación; un link por empresa; actualizaciones instantáneas; ideal para el dueño y la gestión en PC; nada que revisar en stores; sin comisiones |
| **Desventajas** | El operario tiene que abrir el navegador y la URL; sin push en iOS; offline débil; percepción de “página web” |
| **Esfuerzo desde hoy** | **S–M**: arreglar sesión, `start_url`, PIN, cámara, offline básico |
| **Push** | Android/desktop sí; iOS no |
| **Offline** | Parcial (SW + IndexedDB) |
| **Cámara/escáner** | Sí (librería JS + quitar `camera=()`) |
| **Actualizaciones** | Instantáneas |
| **Costos/comisiones** | USD 0 de stores |
| **Percepción B2B** | Correcta para gestión; floja para operarios (“¿dónde está la app?”) |
| **Soporte** | Bajo: una sola superficie |

### B. App nativa en las stores vía Capacitor (Android + iOS)

| | |
|---|---|
| **Ventajas** | “Está en la store” (confianza); push, escáner y offline nativos y confiables; keychain para el PIN; preparada para funciones futuras (NFC, Bluetooth para balanzas o lectoras, GPS en segundo plano) |
| **Desventajas** | La app usa **API routes de Next** (`app/api/*`), así que **no se puede exportar estática**: Capacitor tendría que cargar la URL remota (un *web wrapper*) o reescribir el cliente como SPA separada. Apple suele rechazar los *wrappers* sin funcionalidad nativa (guía 4.2 [HIPÓTESIS]). Dos ciclos de revisión, cuentas de desarrollador, firma, versiones mínimas y dos superficies para dar soporte |
| **Esfuerzo desde hoy** | **L**: proyecto Capacitor, plugins (push nativo, escáner ML Kit, geolocalización, almacenamiento seguro), cola offline nativa o compartida, separación cliente/servidor, CI de builds, publicación y mantenimiento de dos stores |
| **Push** | Nativo (FCM + APNs) |
| **Offline** | El mejor |
| **Cámara/escáner** | El mejor (ML Kit / Vision) |
| **Actualizaciones** | La web, instantánea; el *shell*, con revisión (días en iOS [HIPÓTESIS]) |
| **Costos/comisiones** | Apple Developer ~USD 99/año, Google Play USD 25 único [HIPÓTESIS]. **Comisión del 15–30% solo si se vende la suscripción dentro de la app**; un SaaS B2B que se contrata afuera y solo hace login está, en general, exento (Apple 3.1.3(a)/(c)–(f) y Google para B2B, [HIPÓTESIS: validar las políticas vigentes]). Regla práctica: **no vender ni mostrar precios dentro de la app nativa** |
| **Percepción B2B** | La mejor para operarios |
| **Soporte** | Alto: versiones viejas instaladas, permisos por sistema operativo, revisiones |

### C. Híbrido: web para gestión + app nativa (Capacitor) para operarios

| | |
|---|---|
| **Ventajas** | Cada público en su mejor formato; la app nativa queda acotada a la experiencia del operario (fichar, tareas, escanear, solicitudes), que es más chica y fácil de aprobar |
| **Desventajas** | Mismo costo de stores y de pipeline nativo que B, aunque con menos pantallas; hay que mantener dos clientes de UI para el operario si además se quiere ofrecer la web |
| **Esfuerzo desde hoy** | **M–L**: separar la UI del operario y armar el proyecto nativo para esas pantallas |
| **Push / offline / escáner** | Nativos para el operario |
| **Actualizaciones** | La web, instantánea; la app del operario, por store |
| **Costos/comisiones** | Igual que B |
| **Percepción B2B** | Muy buena |
| **Soporte** | Medio-alto |

### D. Mantener la PWA tal como está (línea de base)

| | |
|---|---|
| **Ventajas** | Cero esfuerzo |
| **Desventajas** | Abre la landing, pierde la sesión, no tiene offline, la cámara está bloqueada para escanear, el chat queda sin salida (F4-03). **No es apta para vender en este estado** |
| **Esfuerzo** | 0 |
| **Percepción B2B** | Baja |

### E. Recomendada: “web primero” con tres canales sobre una sola base de código

1. **Navegador (desktop/tablet)** para dueño, administración y supervisores: dashboard, configuración, reportes, billing.
2. **PWA instalable + TWA en Google Play** para operarios en Android: la misma web empaquetada con Bubblewrap (ya existe `assetlinks.json`). Da presencia en la store, ícono e instalación de un toque, y se actualiza al instante porque carga la web. Push web FCM; offline con SW + IndexedDB + Background Sync.
3. **Modo kiosco en una tablet de planta** (Android en “fijar pantalla” o kiosco de Chrome): el operario escanea su **QR personal** o ingresa **legajo + PIN** y ficha. Resuelve a quienes no tienen celular, no quieren usar el propio o no tienen datos móviles, y reduce el soporte (un dispositivo por planta).
4. **iOS:** PWA instalada para quien la necesite, sin app de App Store al inicio. **Capacitor (C) como fase 2** solo si un cliente lo exige o si se necesitan funciones nativas (balanzas, NFC, GPS en segundo plano).

| | |
|---|---|
| **Ventajas** | Una sola base de código y un solo deploy; cubre el 100% de los requisitos actuales en Android; store sin comisión ni revisiones de UI (la TWA solo se revisa cuando cambia el *shell*); el kiosco evita depender del celular del operario; deja abierta la puerta al nativo |
| **Desventajas** | Experiencia en iOS inferior (push solo con la app instalada, sincronización solo con la app abierta); la TWA requiere Chrome actualizado en el dispositivo [HIPÓTESIS]; menos “nativa” que B/C |
| **Esfuerzo desde hoy** | **M** (detalle en §5) |
| **Push** | FCM web (Android, desktop, iOS instalada) |
| **Offline** | Cola de fichajes y tareas en IndexedDB + sincronización con marca de hora del dispositivo y del servidor |
| **Cámara/escáner** | `getUserMedia` + ZXing (o `BarcodeDetector` cuando exista), activable por empresa; carga manual siempre disponible |
| **Actualizaciones** | Instantáneas en todos los canales |
| **Costos/comisiones** | Google Play USD 25 único [HIPÓTESIS]; sin comisiones (suscripción por Mercado Pago, fuera de la app). Tablet de planta: costo del cliente o equipo en comodato (modelo de negocio, Fase 6) |
| **Percepción B2B** | Buena: “bajala de Play Store” + “panel web” + “tablet de planta”, que es como se presentan los productos del rubro [HIPÓTESIS] |
| **Soporte** | Bajo-medio |

## 4. Matriz comparativa

Puntaje de 1 (peor) a 5 (mejor) para el contexto de Gypi (pymes industriales argentinas, operarios mayormente en Android, un desarrollador).

| Criterio (peso) | A. Web pura | B. Nativa (2 stores) | C. Híbrido web + nativa | D. PWA actual | **E. Web + TWA + kiosco** |
|---|---|---|---|---|---|
| Esfuerzo desde hoy (20%) | 4 | 1 | 2 | 5 | **3** |
| Experiencia del operario en planta (20%) | 2 | 5 | 5 | 1 | **4** |
| Push (10%) | 2 | 5 | 5 | 2 | **4** |
| Offline (10%) | 2 | 5 | 5 | 1 | **4** |
| Escáner de OT / QR (10%) | 3 | 5 | 5 | 1 | **4** |
| Actualizaciones y velocidad de iteración (10%) | 5 | 2 | 3 | 5 | **5** |
| Costos y comisiones (5%) | 5 | 3 | 3 | 5 | **5** |
| Percepción B2B (10%) | 2 | 5 | 5 | 1 | **4** |
| Soporte y mantenimiento (5%) | 5 | 2 | 2 | 4 | **4** |
| **Total ponderado** | **3,10** | **3,65** | **3,95** | **2,65** | **3,95** |

**C y E empatan en puntaje (3,95).** El desempate es el **esfuerzo y el riesgo** para un equipo chico: E cuesta **M** frente a **M–L** de C, no requiere stores con revisión ni pipeline nativo, y **evoluciona hacia C** sin descartar trabajo (la UI del operario, el escáner, el PIN y la cola offline se reutilizan dentro de Capacitor). Si el peso de la experiencia del operario en iOS fuera mayor (clientes con mayoría de iPhone), C pasaría adelante.

(D tiene buen puntaje en esfuerzo solo porque no hace nada; con los bloqueantes actuales no es una opción real.)

## 5. Recomendación y plan de migración (alto nivel; la priorización fina va en la Fase 7)

**Opción E: una sola web multi-tenant, distribuida como panel web + PWA/TWA en Google Play + modo kiosco en tablet; nativo iOS solo a demanda.**

**Por qué:** cubre todos los requisitos actuales con una sola base de código, que es lo único sostenible con un equipo chico. Evita las comisiones y las revisiones de Apple mientras el producto todavía cambia mucho, y suma la percepción de “app de store” en Android, la plataforma dominante en planta [HIPÓTESIS]. El kiosco resuelve el problema humano más común en planta (operarios sin celular adecuado o sin datos). Y deja a C como evolución natural: la UI del operario se diseña como módulo separado desde el principio.

**Trabajo necesario, en orden:**

| # | Tarea | Esf. | Vinculado a |
|---|---|---|---|
| 1 | Sesión persistente por dispositivo + **PIN** (hash en el servidor, bloqueo por intentos) + `start_url` del tenant (manifest dinámico por slug o “última empresa usada”) | M | F1-03, F4-06 |
| 2 | **Activación por QR/código** (un solo uso, con vencimiento) generada por el admin, impresa o enviada por WhatsApp | S | F2-03, F4-01/02 |
| 3 | Inicio del operario con **botón grande de fichar** + estado actual + GPS con feedback (5–8 s) | S | F4-04 |
| 4 | Quitar `camera=()` → `camera=(self)` y sumar el **escáner** (ZXing) en “Iniciar tarea” y “Fichar con QR” (kiosco); flag por empresa | S–M | F4-11 |
| 5 | **Cola offline** (IndexedDB) para fichar, iniciar/cerrar tarea y pausa con causa; sincronización idempotente (id generado en el cliente) | M | F4-05 |
| 6 | SW real (caché del *shell* de la app + estrategia de actualización con “nueva versión disponible”) | S | — |
| 7 | **Modo kiosco** (`/{slug}/kiosco`): pantalla fija, QR personal o legajo + PIN, fichar o iniciar tarea, cierre automático de sesión a los 10 s | M | Respuestas de la Fase 4 |
| 8 | **TWA con Bubblewrap** → ficha en Google Play (sin precios ni compra dentro de la app) | S | `assetlinks.json` existente |
| 9 | (Fase 2, a demanda) Capacitor para iOS y Android con push, escáner y almacenamiento nativos, reutilizando las pantallas del operario | L | — |

**Lo que NO conviene hacer ahora:** publicar en App Store (revisión de *wrappers*, costo de mantenimiento, poco uso de iOS en planta [HIPÓTESIS]); vender la suscripción dentro de cualquier app de store (comisión del 15–30%); reescribir a nativo antes de estabilizar la seguridad (Fase 2) y el modelo de datos (Fase 3).

---

## Preguntas abiertas

1. **Dispositivos:** en la fábrica piloto, ¿qué proporción de operarios tiene celular Android, iPhone o ninguno apto? ¿Hay wifi en planta?
2. **Tablet de kiosco:** ¿la pondría el cliente o la ofrecerías vos (venta o comodato, parte del plan)?
3. **Cuenta de Google Play:** ¿la querés a nombre de una empresa (requiere datos fiscales y, para cuentas nuevas de organización, verificación D-U-N-S [HIPÓTESIS]) o personal al principio?
4. **iOS:** ¿algún cliente potencial te pidió explícitamente una app de App Store?

---

## Respuestas del dueño del producto (2026-10-06)

1. **Dispositivos:** 100% de los operarios con **Android**; hay **wifi en planta** → refuerza la opción E (TWA + kiosco); el offline queda como respaldo ante cortes.
2. **Tablet de kiosco:** la pone **el cliente**.
3. **Google Play:** cuenta **personal** por ahora (ver requisitos de cuentas personales nuevas en `fase-6.md` §5.13).
4. **App Store / Play:** nadie la pidió; el dueño la ve como una forma de monetizar → aclarado en `fase-6.md` §6: Play sirve como **distribución y confianza**; el cobro conviene hacerlo por fuera.
5. Pidió **acumular todos los cambios** para un plan de implementación al final → `auditoria/backlog-acumulado.md`.
