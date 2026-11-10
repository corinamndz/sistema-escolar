/**
 * La recuperación de una materia pendiente, para la boleta del año en que se
 * reprobó (historial, boleta oficial, Excel). La nota original no cambia: la
 * recuperación se anota aparte. `recovery` viene del servidor
 * (backend/src/modules/carryovers/carryoverResults.js).
 */
const fmtGrade = (n) => Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

export const recoveredOk = (s) => s?.recovery?.status === 'passed';

/** Estado de la materia con su recuperación: { label, variant, note }. */
export function recoveryState(s) {
  const r = s?.recovery;
  if (!r) return null;
  if (r.status === 'passed') {
    return {
      label: 'Aprobada en recuperación',
      variant: 'success',
      note: `Recuperación: ${fmtGrade(r.grade)}${r.moment_name ? ` en ${r.moment_name}` : ''}${r.resolved_at ? ` · ${fmtDay(r.resolved_at)}` : ''}`,
    };
  }
  if (r.status === 'failed') return { label: 'Reprobada', variant: 'danger', note: `No aprobó la recuperación${r.grade !== null ? ` (${fmtGrade(r.grade)})` : ''}` };
  if (r.status === 'suspended') return { label: 'Reprobada', variant: 'danger', note: 'Recuperación en suspenso' };
  return { label: 'Reprobada', variant: 'danger', note: 'Materia pendiente: en recuperación' };
}

/** Texto para la boleta impresa y el Excel. */
export function recoveryText(s) {
  const st = recoveryState(s);
  return st ? (s.recovery.status === 'passed' ? `Aprobada en recuperación con ${fmtGrade(s.recovery.grade)}${s.recovery.moment_name ? ` (${s.recovery.moment_name}${s.recovery.resolved_at ? `, ${fmtDay(s.recovery.resolved_at)}` : ''})` : ''}` : st.note) : '';
}
