import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';

/** Lapsos académicos del año escolar (term_number en la base). */
export const TERM_OPTIONS = [
  { number: 1, label: 'Lapso I' },
  { number: 2, label: 'Lapso II' },
  { number: 3, label: 'Lapso III' },
];

/** Número de lapso deducido del nombre: "Lapso 2", "Segundo lapso", "3er lapso", "Lapso II". */
function numberFromName(name = '') {
  const n = name.toLowerCase();
  if (/(^|\D)1(\D|$)|primer|\bi\b/.test(n)) return 1;
  if (/(^|\D)2(\D|$)|segundo|\bii\b/.test(n)) return 2;
  if (/(^|\D)3(\D|$)|tercer|\biii\b/.test(n)) return 3;
  return null;
}

/**
 * Etiqueta única de un lapso en toda la aplicación: "Lapso I", "Lapso II",
 * "Lapso III". Usa el número del lapso y, si no lo trae (datos antiguos), lo
 * deduce del nombre; si tampoco se puede, muestra el nombre tal cual.
 */
export function termLabel(termNumber, fallbackName = '') {
  const n = Number(termNumber) || numberFromName(fallbackName);
  return TERM_OPTIONS.find((t) => t.number === n)?.label || fallbackName || '—';
}

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) : null);

/** Fechas del lapso N del año (si están cargadas): "07/01 – 05/04". */
function termDates(terms, number) {
  const t = (terms || []).find((x) => Number(x.term_number) === number);
  return t && t.start_date && t.end_date ? `${day(t.start_date)} – ${day(t.end_date)}` : null;
}

/**
 * Selector de lapso académico: siempre Lapso I, II y III. Si se pasan los
 * lapsos del año (`terms`), muestra sus fechas junto a cada opción.
 */
export function TermSelect({ value, onChange, terms, disabled, required, id }) {
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} disabled={disabled} required={required}>
      <option value="">Selecciona el lapso…</option>
      {TERM_OPTIONS.map((t) => {
        const dates = termDates(terms, t.number);
        return (
          <option key={t.number} value={t.number}>
            {t.label}
            {dates ? ` (${dates})` : ''}
          </option>
        );
      })}
    </Select>
  );
}

/** Etiqueta compacta del lapso de un plan. */
export function TermBadge({ number, name }) {
  return <Badge variant="info">{termLabel(number, name)}</Badge>;
}
