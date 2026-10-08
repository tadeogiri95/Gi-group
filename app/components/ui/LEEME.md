# Piezas de diseño de Gypi (reforma UX, R4)

Toda pantalla nueva —y los módulos Producción, Stock, Compras, Calidad y
Mantenimiento— se arma **solo** con estas piezas y los tokens de
`app/globals.css`. Nada de `style={{…}}` nuevos ni colores escritos a mano:
un test (`tests/ux-diseno.test.jsx`) cuenta los que quedan y el número solo
puede bajar.

| Pieza | Para qué | Archivo |
|---|---|---|
| `Screen` | Pantalla con "← Volver", título y la acción principal fija abajo | `ui/Screen.jsx` |
| `Button` | `primary`, `secondary`, `danger`, `ghost`; tamaños `sm` (44), `md` (48), `lg` (56) y `planta` (64, para usar con guantes) | `ui.jsx` |
| `Modal` | Ventana que sube desde abajo, con "Cerrar" de 44 px | `ui/Modal.jsx` |
| `useConfirm` | Pedir confirmación antes de algo que no se deshace | `ui/ConfirmDialog.jsx` |
| `EmptyState` | Pantalla vacía que explica el siguiente paso, con botón | `ui/EmptyState.jsx` |
| `ListItem` | Renglón de lista de 56 px (ícono, título, detalle, estado) | `ui/ListItem.jsx` |
| `Field` | Campo con etiqueta visible, ayuda y error en palabras | `ui/Field.jsx` |
| `Stat` | Número del tablero con la etiqueta completa, sin abreviar | `ui/Stat.jsx` |
| `Tag`, `Badge`, `Chip` | Estados y filtros; el color de la letra se ajusta solo para leerse | `ui.jsx` |
| `ModuloBloqueado` | Sección que la empresa no contrató (🔒 y cómo sumarla) | `ModuloBloqueado.jsx` |

## Reglas (las mismas de la evaluación de usabilidad)

1. **Una acción principal por pantalla**, grande y abajo (`Screen action`).
2. **Lo diario en 2 toques.** Para planta, `Button size="planta"`.
3. **Un nombre para cada cosa:** los términos están en `app/lib/textos.js` (`VOCABULARIO`, `nombreRol`).
4. **Letra legible:** el color de la empresa como texto es `text-gypi-amber-ink`
   (nunca `text-gypi-amber` sobre fondo claro); sobre el color de la empresa,
   `text-gypi-on-amber`. Nada por debajo de 11 px.
5. **Cada pantalla vacía dice qué hacer** (`EmptyState` con `action`).
6. **Lo que no se deshace se confirma** (`useConfirm`), lo demás avisa con `useToast`.
