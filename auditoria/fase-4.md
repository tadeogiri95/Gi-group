# Fase 4 — Producto y UX

> Solo lectura. Rama `claude/modest-archimedes-1jy9rm`, base `1c2a869`. Fecha: 2026-10-06.
> Método: lectura de las pantallas y los flujos en el código, más un **recorrido real en modo demo** (`/demo?demo=true`) con Chromium a 390×844 px (celular), con capturas (`auditoria/capturas-fase4/`) y métricas automáticas de accesibilidad (botones menores a 44 px, textos sin etiqueta, tamaño mínimo de fuente). El modo demo no ejercita las API reales: lo que depende de datos se infiere del código.
> Roles (según el dueño): **operario = `operativo`**, **supervisor y admin = `administrativo`**, **dueño = `gerencial`**. Decisión del dueño: **botón grande de fichar** en lugar del chat como acción principal.

## Resumen (5 líneas)

1. **El operario no puede arrancar ni quedarse en la app sin ayuda:** la app instalada abre la landing y pierde la sesión al cerrarse (F1-03); el chat, por donde hoy se ficha, **no tiene botón para volver** y oculta la navegación; y fichar sin GPS espera 15 s.
2. **El onboarding deja empleados que no pueden entrar:** los que se cargan en el asistente inicial o por CSV **sin email** quedan con una contraseña aleatoria que nadie conoce y sin camino de activación, y el link de invitación por email lleva a una pantalla que no existe. Hoy una empresa nueva **depende del dueño de Gypi** para arrancar.
3. La **gestión** es potente pero densa: “Gestión” tiene 3 pestañas con 11 sub-pestañas en scroll horizontal (Horarios, Proyectos, Ubicaciones, Calendario, Personal, Documentación, Asistencia, Reglas IA, Empresa, Privacidad…). La Inbox muestra legajos en lugar de nombres y aprueba con un toque, sin confirmar.
4. **Uso en planta:** las acciones principales del operario (Actividad, cambiar o pausar tarea) están bien resueltas, con botones grandes y timer. Pero no hay modo offline, hay muchos controles chicos (13 a 20 de menos de 44 px por pantalla de gestión) y textos de 8–9 px.
5. **Núcleo de valor:** fichaje confiable + registro de actividad por OT/etapa + tablero en vivo de la planta. El chat IA, el score, la publicidad y el calendario son accesorios. El producto debería venderse como **“productividad de planta”** (lo que lo diferencia de un reloj de fichaje) y dejar RRHH como base.

---

## 1. Recorrido por rol

### 1.1 Operario (`operativo`) — celular, en planta

| Paso | Qué pasa hoy [HECHO] | Fricción | Sev. |
|---|---|---|---|
| Primer ingreso | Recibe un email con un link a `/{slug}?screen=unirse` (`lib/email.js:322`), pero `unirse` **no está en `VALID_SCREENS`** (`HomeContent.jsx:49-53`): ve el login normal sin contraseña. La activación real está en otra ruta (`/{slug}/unirse`), que solo se comparte si el admin copia el link desde Equipo (`gestion_personal_screen.jsx:429`) | **El link de invitación no funciona** | Alto |
| Empleado sin email | Alta manual o por CSV/onboarding → `estado_activacion = 'activo'` (default en prod, Q8) + contraseña aleatoria nunca mostrada (`lib/passwords.js`, `import-csv/route.js:122`). No puede usar “Olvidé mi contraseña” (no tiene email) ni `/unirse` (no está “pendiente”). Solo funciona si el admin tildó “pre-cargado” (`gestion_personal_screen.jsx:116`) | **Empleado bloqueado sin salida** | Alto |
| Abrir la app al día siguiente | La PWA abre `/` (landing de marketing) y la sesión vive en `sessionStorage`: se pierde al cerrar (F1-03). Tiene que recordar la URL `/{slug}` y su contraseña | Login diario, URL difícil | Alto |
| Fichar | Inicio → tarjeta “Tocame para fichar ingreso, salida, pedir permisos o dar avisos” → abre el **chat** → “Ya llegué”. Pide GPS con `timeout` de 15 s y `enableHighAccuracy` (`lib/fichar.js:75`), con “Pensando…” sin explicar que está buscando ubicación | 2 toques + espera; mensajes de bot | Alto (decisión: botón grande) |
| Salir del chat | `isChat` oculta la barra inferior y el encabezado (`HomeContent.jsx:297,317,364`), y `ChatScreen.jsx` no tiene botón de volver. En una PWA en iOS (sin botón “atrás”) **el operario queda atrapado** en el chat | Sin salida | Alto |
| Tareas (Actividad) | Tarjeta grande con timer, “Cambiar tarea”, pausa (botón solo con ícono), “Finalizar jornada” e historial. Elige etapa y OT de listas | Bien resuelto. La pausa es solo ícono; la lista de hasta 1.000 OT activas sin buscador (`useActividad.js:43`) es difícil de usar con guantes | Medio |
| Pausa / tiempo muerto | Pide causa (material, herramienta, indicación, otro), pero **la causa no se guarda** (F1-02) | El dato más valioso se pierde | Alto (ya en F1) |
| Solicitudes | “Necesito un permiso” en el chat (conversacional) o por la lista “Solicitudes” | Sin formulario directo; depende de la IA | Medio |
| Mensajes de tardanza | “¡PERDISTE EL PREMIO POR PRESENTISMO este mes!” (`ChatScreen.jsx:166-168`) | Tono y regla de la fábrica (H2) | Medio |
| Formato de hora | Mezcla “07:02” y “07:00 a. m.” en la misma pantalla (inicio del operario) | Inconsistente | Bajo |

### 1.2 Supervisor y admin (`administrativo`) — celular o PC

| Área | Hoy | Fricción | Sev. |
|---|---|---|---|
| Inicio | “Panel de control”: alertas (ausentes, en espera, solicitudes, bloqueados), solicitudes pendientes y KPIs | Útil y claro. Los datos del mes se truncan (F3-03) | — |
| Inbox | Tarjetas con Aprobar/Rechazar contiguos; muestra **“Legajo 100004”** y no el nombre; aprobación **sin confirmación** ni comentario | Con guantes o con prisa, un toque equivocado aprueba vacaciones; hay que memorizar legajos | Medio |
| Equipo | Alta, edición y baja vía `/api/empleados` (bien). El link de activación aparece en un modal | Ver los bloqueos de activación arriba | Alto |
| Gestión | 3 pestañas (Parámetros / Reportes / Configuración) × 11 sub-pestañas, algunas fuera de pantalla en scroll horizontal | Poca descubribilidad; mezcla configuración rara (Empresa, Privacidad) con uso diario (Horarios, Asistencia) | Medio |
| Ver producción | “Taller” (`ger-actividad`): quién está en qué etapa/OT ahora | Valioso. El nombre “Taller” es del piloto | Bajo |
| Separación supervisor/admin | Mismo rol: un supervisor ve **toda** la empresa y puede tocar facturación (F2) | Falta segmentar por división o planta | Medio |

### 1.3 Dueño (`gerencial`)

Mismo shell que el administrativo, más facturación (`BillingScreen`), configuración de la empresa y **publicidad de AdSense en el plan Free** (`HomeContent.jsx:317-321`, solo roles de gestión). Lo que un dueño de pyme quiere ver en 30 segundos (*¿cuánto produjimos?, ¿cuánto tiempo perdimos y por qué?, ¿quién faltó?, ¿qué OT están atrasadas?*) está repartido entre Inicio, Taller y Reportes, y parte de esos datos hoy está truncada o vacía (F3-03, F1-02). No hay resumen semanal por email ni exportación ejecutiva (PDF).

---

## 2. Uso en planta (celular, guantes, mala señal, poco tiempo)

| Criterio | Estado [HECHO] | Recomendación |
|---|---|---|
| **Acción principal en 1 toque** | Fichar = 2 toques + chat + espera de GPS | **Botón grande “Fichar entrada / salida”** en el inicio del operario (estado actual visible: “Adentro desde 07:02”), con confirmación háptica y visual |
| Tamaño de los controles (≥ 44–48 px; con guantes ≥ 56 px) | Medido: inicio del operario 3/10 controles < 44 px; Actividad 2/9; **Inbox 20/25; Gestión 17/21; Equipo 14/22** | Mínimo 48 px en todo y 64 px en las acciones de planta; separar Aprobar/Rechazar |
| Tipografía | Mínimos medidos: **8–9 px** en inicio de gestión, Inbox y Actividad; 109 usos de `text-[9px]/[10px]/fontSize 9` | Mínimo 12 px, y 16 px en los inputs (evita el zoom de iOS) |
| Mala conectividad | El SW solo muestra `offline.html` en navegación (`firebase-messaging-sw.js:29-32`); no hay cola de fichajes ni de actividades; los errores de red se ven como “Error al fichar” | **Cola offline** (IndexedDB) para fichar e iniciar/cerrar tarea, con hora del dispositivo + hora de servidor al sincronizar y un indicador “pendiente de enviar” (ver la Fase 5 para el formato de app) |
| GPS | 15 s de timeout con alta precisión, sin feedback | 5–8 s, mensaje “buscando ubicación…”, reintentar o fichar “sin ubicación” (marcado para revisión) según la política del tenant |
| Identificación rápida | Login con legajo + contraseña (8 caracteres con mayúscula y número) cada vez que se pierde la sesión | Sesión persistente por dispositivo; opcional **PIN de 4–6 dígitos** o **QR / tablet compartida de planta** (modo kiosco) |
| Luz y suciedad de pantalla | Tema claro con grises suaves; estados por color (verde/naranja) con poco contraste en chips | Contraste AA, estados con ícono + texto |
| Idioma | Español rioplatense consistente | — |

## 3. Accesibilidad básica y sistema de diseño

| Aspecto | Hallazgo | Evidencia |
|---|---|---|
| Etiquetas | Bien: casi todos los botones tienen texto o `aria-label` (1 sin etiqueta en la landing); los inputs tienen placeholder o label; 18 `role="alert"`/`aria-live` | Métricas del recorrido; `scripts/wcag-audit.js` existe |
| Objetivos táctiles | Mal en gestión (ver tabla) | Recorrido |
| Tamaño de texto | 8–9 px en varias pantallas | Recorrido |
| Navegación por teclado y foco | No verificado en profundidad; hay link “Saltar al contenido” | Recorrido (snapshot) |
| Sistema de diseño | **Tres estilos conviviendo:** Tailwind con tokens (`bg-gypi-*`, `g-btn`, `g-input`), estilos inline con constantes JS (`ChatScreen.jsx:248-264`, `components/ui.jsx`) y emojis como íconos (parcialmente migrados a `Icon.jsx`, según el commit `1c2a869`). `components/ui/` (Modal, Toast, ConfirmDialog, EmptyState) existe, pero la Inbox no usa `ConfirmDialog` | Código |
| Temas por empresa | 9 presets + colores propios (`theme.js`): buen diferencial de marca blanca, pero con riesgo de contraste en colores elegidos por el cliente | `SCHEMA_REFERENCIA.sql` (`theme_preset`) |
| Estados vacío, carga y error | `EmptyState` se usa en 6 lugares; la carga general es un *spinner* de puntos; el error global es un banner “Tocá para reintentar”. Gestión en demo muestra “0 empleados activos” sin guía | Recorrido + código |

## 4. Onboarding: ¿una empresa nueva arranca sola?

**Hoy: no del todo [HECHO].**

| Paso | Estado | Problema |
|---|---|---|
| 1. Registro | `/` → registro con email o Google → crea la empresa en plan **Free** (`063_…sql`), verificación de email no bloqueante | ✅ Self-service |
| 2. Asistente (4 pasos) | Rubro (plantillas de divisiones y etapas: metalúrgica, carpintería, construcción…) → Personalización (logo, colores) → Empleados (manual o CSV) → Resumen | ✅ Buen diseño |
| 3. Dar acceso a los operarios | **No forma parte del asistente.** Los empleados cargados quedan sin forma de entrar (§1.1). No hay paso “compartí este link/QR con tu equipo” ni impresión de credenciales | ❌ **Bloqueante** |
| 4. Configurar lo que hace funcionar el fichaje | Ubicaciones (GPS), horarios (diagrama) y OT/proyectos están en Gestión, fuera del asistente. Sin horarios no hay tardanzas; sin OT no hay actividad útil | ⚠️ Pasos invisibles |
| 5. Primer valor | No hay checklist de activación (“primer fichaje”, “primera OT”, “primer reporte”). Existen `metricas_eventos` y el cron `reengagement-onboarding` (email), base para hacerlo | ⚠️ |
| 6. Ayuda | `/docs` estático; contacto por formulario; sin ayuda contextual ni video | ⚠️ |

**Propuesta de onboarding self-service (en orden):**
1. Registro (igual que hoy).
2. Rubro y plantilla (igual que hoy).
3. **Primera planta y ubicación** (mapa, radio) — opcional.
4. **Horario tipo** (un diagrama base aplicado a todos, editable después).
5. **Carga de equipo** (manual o CSV) **con su forma de acceso:** QR o link de activación por persona, impresión de credenciales temporales o envío por WhatsApp (para gente sin email).
6. **Primeras OT** (manual o CSV) — si se usa el módulo de producción.
7. **Checklist de activación** visible en el inicio del dueño durante 14 días.

## 5. Núcleo de valor vs. accesorios

| Módulo | Clasificación | Por qué |
|---|---|---|
| Fichaje (con GPS opcional) + historial | **Núcleo (base)** | Es lo que habilita todo lo demás y lo que el operario usa todos los días. Por sí solo es un commodity (muchos relojes y apps lo resuelven) |
| **Registro de actividad por OT/etapa + tiempo improductivo con causa** | **Núcleo (diferencial)** | Lo que lo hace “industrial”: horas reales por OT, etapa y división, cuello de botella, causas de parada. Es la semilla de las Órdenes de Producción (Fase 3 §7) |
| **Tablero en vivo (“Taller”) + alertas** | **Núcleo (diferencial)** | Lo que el dueño mira: quién está en qué, ausentes, bloqueados, espera |
| Reportes por OT/etapa + liquidación | Núcleo (monetizable) | Valor directo: costeo de mano de obra por OT y pre-liquidación de sueldos |
| Solicitudes e Inbox | Núcleo de soporte | Necesario para la asistencia; conviene formulario y no chat |
| Horarios/turnos, ubicaciones, documentos del empleado | Soporte | Configuración de la base |
| Reporte de obra/instalación con IA | **Accesorio vertical** (módulo opcional “trabajo en campo”) | Muy específico de muebles a medida con instalación |
| Chat IA del operario | **Accesorio** | Con botón de fichar y formularios, el chat pasa a “asistente opcional” (plan pago y con tope, F2-05/F3) |
| Reglas IA | Accesorio | Depende del chat |
| Score del empleado | Accesorio / delicado | Pesos de la fábrica (H3); sensible ante los empleados |
| Calendario y notas | Accesorio | Poco diferencial |
| Publicidad AdSense | **Quitar** | Resta percepción B2B y suma riesgo legal (Fase 2, Fase 6) |
| Superadmin y métricas SaaS | Interno | Bien encaminado |

---

## 6. Tabla de hallazgos

| ID | Sev. | Esf. | Categoría | Evidencia | Recomendación |
|---|---|---|---|---|---|
| F4-01 | **Alto** | S | Onboarding / bug | Los empleados sin email (alta manual sin “pre-cargado”, CSV y asistente inicial) quedan `activo` con una contraseña aleatoria desconocida: **no pueden entrar** (`import-csv/route.js:122-137`, `api/empleados/route.js`, Q8 `estado_activacion` default `'activo'`) | Toda alta nace “pendiente de activación” con un código o QR de un solo uso (también resuelve F2-03) |
| F4-02 | **Alto** | S | Onboarding / bug | El email de invitación apunta a `/{slug}?screen=unirse`, pantalla inexistente (`lib/email.js:322`, `HomeContent.jsx:49-53`) | Apuntar a `/{slug}/unirse?code=…` |
| F4-03 | **Alto** | S | UX operario | El chat oculta la navegación y no tiene botón “volver” (`HomeContent.jsx:364`, `ChatScreen.jsx`): en una PWA en iOS el usuario queda atrapado | Encabezado con “← Volver” |
| F4-04 | **Alto** | S | UX operario | Fichar depende del chat (2 toques + GPS de hasta 15 s) | **Botón grande de fichar** en el inicio (decisión del dueño), con estado, confirmación y un GPS más corto con feedback |
| F4-05 | **Alto** | M | Planta / offline | Sin cola offline de fichajes y actividades | Cola IndexedDB + sincronización (Fase 5) |
| F4-06 | **Alto** | S–M | Acceso diario | Se pierde la sesión y la app instalada abre la landing (F1-03) | Sesión persistente por dispositivo, `start_url` al tenant, PIN opcional / modo kiosco |
| F4-07 | Medio | S | UX gestión | Inbox: legajo en lugar de nombre; Aprobar/Rechazar contiguos sin confirmación ni comentario (`InboxScreen.jsx:53`) | Nombre + foto/inicial, confirmación con motivo opcional, deshacer por 5 s |
| F4-08 | Medio | M | Arquitectura de información | “Gestión” con 3 × 11 sub-pestañas en scroll horizontal (`ConfigScreen.jsx:14-62`) | Separar **Operación diaria** (Asistencia, Horarios, OT) de **Configuración** (Empresa, Ubicaciones, Reglas, Privacidad); menú lateral en desktop |
| F4-09 | Medio | M | Accesibilidad | 13–20 controles < 44 px por pantalla de gestión; textos de 8–9 px; 109 usos de tamaños ≤ 10 px | Tokens de tamaño mínimo (12 px de texto, 48 px de control) y auditoría con `scripts/wcag-audit.js` en CI |
| F4-10 | Medio | M | Sistema de diseño | Tres estilos (Tailwind con tokens, inline con constantes, emojis) | Converger en `components/ui` + tokens; prohibir estilos inline nuevos (regla de lint) |
| F4-11 | Medio | S | Producto | Lista de OT de hasta 1.000 ítems sin buscador al iniciar una tarea | Buscador + “recientes” + escaneo de QR/código de barras de la OT (cámara) |
| F4-12 | Medio | S | Producto | Solicitudes solo por chat o lista; no hay formulario directo; las vacaciones son de un solo día (F1-21) | Formulario simple con rango de fechas |
| F4-13 | Medio | S | Producto | Mensajes y reglas de la fábrica en la UI (presentismo, “Taller”, “instaladores”) | Textos derivados de la configuración del tenant (H1–H5) |
| F4-14 | Medio | M | Onboarding | Horarios, ubicaciones y OT fuera del asistente; sin checklist de activación | Asistente extendido + checklist (ver §4) |
| F4-15 | Bajo | S | Consistencia | Formato de hora mezclado (24 h y “a. m.”) | Un helper de formato único |
| F4-16 | Bajo | S | Producto B2B | AdSense en el panel del dueño (plan Free) | Quitar; reemplazar por un upsell propio |
| F4-17 | Bajo | S | Login | Una URL de tenant inválida o un login sin slug muestra “Empresa no encontrada” sin salida (captura `02-login-tenant`) | Pantalla “Buscá tu empresa” (por email o código) y un link a la landing |

---

## Preguntas abiertas

1. **Acceso de operarios:** ¿tus operarios tienen email propio? ¿Preferís **QR/código de activación** impreso, **PIN** en el celular de cada uno, o una **tablet de planta compartida** (modo kiosco) donde fichan con legajo + PIN?
2. **Escáner:** ¿las OT tienen o podrían tener un código de barras o QR impreso? Cambia mucho la velocidad de carga de tareas.
3. **Supervisor:** ¿cada supervisor debería ver solo su división/sector? (Retoma la pregunta 1 de la Fase 2.)
4. **Reporte de obra/instalación:** ¿lo dejamos como módulo opcional “trabajo en campo” o es central para tus futuros clientes?
5. **Resumen para el dueño:** ¿te serviría un email/WhatsApp semanal automático (horas por OT, tiempo muerto por causa, ausencias)?

---

## Respuestas del dueño del producto (2026-10-06)

1. **Acceso de operarios:** **QR + PIN** (activación por QR o código y PIN para el uso diario).
2. **OT:** pueden tener **código de barras o QR** impreso según cada empresa → el escaneo debe ser opcional y configurable por tenant (además de buscar a mano).
3. **Visibilidad:** el **supervisor ve solo su división**; gerencia y administración ven todo.
4. **Reporte de obra/instalación:** **módulo opcional**.
5. **Resumen semanal automático:** sí, sirve.
