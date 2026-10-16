# Sistema de diseño · MoDo Educa

Guía para que toda pantalla nueva se vea y se comporte igual que el resto. Los
estilos viven en `src/index.css` (CSS propio con variables; **el proyecto no
usa Tailwind**) y los componentes base en `src/components/ui/`.

## 1. Tokens (variables CSS)

Usa siempre la variable, nunca el valor fijo.

| Qué | Variables | Nota |
|---|---|---|
| Color principal | `--color-primary`, `--color-primary-hover`, `--color-primary-soft`, `--color-primary-softer`, `--color-primary-ring` | Los define el colegio en Configuración → Apariencia: no fijes `#2563eb`. |
| **Texto SOBRE fondo principal** | `--color-on-primary` | Botón, día elegido o chip activo con fondo `--color-primary`. |
| **Principal COMO texto sobre blanco** | `--color-primary-text` | Enlaces, títulos de acento. **Nunca** sobre fondo `--color-primary` (queda azul sobre azul). |
| Neutros | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-border-strong`, `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-text-subtle` | `--color-border-active` es para **bordes** de foco/selección, no para fondos. |
| Estados | `--color-{success,warning,danger,info}`, `…-soft` (fondo), `…-border`, **`…-text`** (texto sobre el fondo suave) | Badges, alertas y avisos. |
| Radios | `--radius-xs` 6 · `--radius-sm` 8 · `--radius-md` 12 · `--radius-lg` 16 · `--radius-xl` 20 | Solo `999px` (píldora) y `50%` (círculo) quedan fuera de la escala. |
| Sombras | `--shadow-xs … --shadow-xl` | Tarjetas: `--shadow-xs`/`--shadow-sm`; modales: `--shadow-xl`. |
| Movimiento | `--transition-fast` (150 ms), `--transition-base` (240 ms), `--ease-out` | Interruptores: 200 ms. |
| Tipografía | `--font-sans` (texto), `--font-display` (títulos, cifras) | |

## 2. Componentes base (`src/components/ui`)

| Necesitas… | Usa | No uses |
|---|---|---|
| Botón | `<Button variant="primary\|secondary\|ghost\|danger\|danger-solid" size="sm" icon="…" loading>` | `<button className="btn …">` a mano (mismo aspecto, pero sin `loading` ni íconos uniformes). |
| Campo con etiqueta, ayuda y error | `<Field label hint error required full>` + `<Input>` / `<Select>` | Etiquetas y mensajes de error propios. |
| Texto largo | `<textarea className="input">` | |
| **Encender / apagar una opción** | **`<Switch checked onChange label description />`** (o `ariaLabel` sin texto, en tablas) | Casillas para opciones de activar/desactivar; interruptores propios. |
| Elegir varias cosas de una lista | casillas (`<input type="checkbox">`) | |
| Alternar vistas o modos | `.segmented` + `.segmented__item(--active)` | |
| Estado / categoría | `<Badge variant="success\|warning\|danger\|info\|neutral\|primary">` | |
| Tarjeta con título | `<Card title subtitle actions>` | |
| Ventana | `<Modal title size="lg">` (formularios con varias columnas o calendario: `lg`) | |
| Confirmar | `useConfirm()` (`danger: true` para borrar) | `window.confirm` |
| Avisar el resultado | `useToast()` (`success` / `warning` / `error`) | `alert()` |
| Mensaje en el formulario | `<Alert variant>` | |
| Tabla con búsqueda, orden, paginación y acciones | `<DataTable>` (`onDeleteClick` si el borrado necesita su propio modal) | |
| Fechas sueltas | `<MultiDatePicker>` | |

## 3. Estados interactivos

- **Foco**: hay un `:focus-visible` global (contorno del color principal). Si un
  elemento lo reemplaza, debe dar otro indicador visible (`box-shadow` con
  `--color-primary-ring`). Nunca `outline: none` sin reemplazo.
- **Hover**: todo elemento que cambie color/fondo/borde al pasar el mouse lleva
  transición (`--transition-fast`). Hay una regla común al final de
  `index.css` para los que no la tenían.
- **Deshabilitado**: `disabled` real en el control + opacidad reducida y
  `cursor: default`; nunca solo visual.
- **Interruptor**: apagado gris (`--color-border-strong`), encendido color
  principal, 200 ms.

## 4. Estructura de pantallas

- **Página**: `<PageHeader title subtitle actions>` → contenido en tarjetas.
- **Configuración**: cada pestaña = indicación corta (`hint`) + una o más
  tarjetas. El subtítulo de la tarjeta no repite el `hint`. Las pestañas pasan
  a una segunda fila si no caben (siempre visibles).
- **Formularios en modal**: `form-grid` de dos columnas; campos relacionados
  en la misma fila (inicio/fin, coordinador/cupo); acciones abajo a la
  derecha, la principal al final.
- **Portal del representante**: mismos componentes que la administración, sin
  acciones de gestión.

## 5. Pendientes conocidos (no visibles, para ir corrigiendo)

- ~150 estilos en línea (`style={{…}}`), sobre todo márgenes, en ~50 archivos:
  pasarlos a clases al tocar cada pantalla.
- 16 `<button className="btn …">` a mano: cambiarlos por `<Button>` al editarlos.
- Tamaños de letra con medios píxeles (11.5, 12.5, 13.5 px): falta una escala
  tipográfica con variables.
- Colores fijos de categorías (niveles educativos, tipos de evento): son
  intencionales, pero conviene llevarlos a variables.
