import { useFetch } from '../../hooks/useFetch';
import { axiosClient } from '../../api/axiosClient';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';

/**
 * Períodos de evaluación de un año escolar. Cada colegio los configura (nombre,
 * cantidad y fechas) en Configuración → Períodos de evaluación, así que ninguna
 * pantalla debe suponer cuántos son ni cómo se llaman.
 */
export function useTerms(schoolPeriodId) {
  return useFetch(
    () => (schoolPeriodId ? axiosClient.get(`/school-years/${schoolPeriodId}/terms`).then((r) => r.data) : Promise.resolve([])),
    [schoolPeriodId]
  );
}

/** Nombre de un período: el que le dio el colegio; si no se conoce, su posición. */
export function termLabel(termNumber, name = '') {
  return name || (termNumber ? `Período ${termNumber}` : '—');
}

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) : null);

/** Selector de período (por su posición en el año). `terms`: los períodos del año, con sus fechas si las tienen. */
export function TermSelect({ value, onChange, terms, disabled, required, id }) {
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} disabled={disabled} required={required}>
      <option value="">Selecciona el período…</option>
      {(terms || []).map((t) => {
        const dates = t.start_date && t.end_date ? `${day(t.start_date)} – ${day(t.end_date)}` : null;
        return (
          <option key={t.id} value={t.term_number}>
            {t.name}
            {dates ? ` (${dates})` : ''}
          </option>
        );
      })}
    </Select>
  );
}

/** Etiqueta compacta del período de un plan. */
export function TermBadge({ number, name }) {
  return <Badge variant="info">{termLabel(number, name)}</Badge>;
}
