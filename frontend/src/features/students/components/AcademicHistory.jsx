import { useState } from 'react';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { LevelBadge } from '../../academics/levels';
import { termLabel } from '../../evaluation-plans/terms';

const STATUS_VARIANT = { active: 'info', promoted: 'success', retained: 'warning', graduated: 'primary', withdrawn: 'neutral' };

/** "A" → "Sección A"; si ya dice "Sección…", igual. */
const sectionLabel = (name) => (/^secci[oó]n/i.test(name) ? name : `Sección ${name}`);
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: 2 }));

/**
 * Historial académico de un alumno: un bloque por año escolar (el más reciente
 * primero) con grado, sección, resultado (Cursando / Promovido / Repite /
 * Egresado / Retirado), promedio y la boleta por materia y lapso. Los años
 * cerrados muestran la boleta congelada al momento de la promoción.
 * `data` viene de GET /students/:id/academic-history o /portal/students/:id/history.
 */
function AcademicHistory({ data }) {
  const [open, setOpen] = useState(() => new Set(data?.years?.[0] ? [data.years[0].enrollment_id] : []));
  if (!data?.years?.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="graduation" size={24} />
        </div>
        <div className="empty-state__title">Sin historial académico</div>
        <div className="text-sm">El alumno todavía no ha sido inscrito en ningún año escolar.</div>
      </div>
    );
  }

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="history-years">
      {data.years.map((y) => {
        const isOpen = open.has(y.enrollment_id);
        const termNames = [...new Set(y.subjects.flatMap((s) => s.terms.map((t) => t.term_name)))];
        // Encabezado uniforme (Lapso I, II, III) aunque el lapso se llame "Primer Lapso".
        const headerOf = (name) => termLabel(y.subjects.flatMap((s) => s.terms).find((x) => x.term_name === name)?.term_number, name);
        return (
          <section key={y.enrollment_id} className={`history-year ${isOpen ? 'is-open' : ''}`}>
            <button type="button" className="history-year__head" onClick={() => toggle(y.enrollment_id)} aria-expanded={isOpen}>
              <Icon name="chevronDown" size={18} className="history-year__chevron" />
              <span className="history-year__period">{y.school_period.name}</span>
              <span className="history-year__grade">
                {y.grade_name} · {sectionLabel(y.section_name)}
              </span>
              <LevelBadge code={y.level_code} />
              <Badge variant={STATUS_VARIANT[y.status] || 'neutral'}>{y.status_label}</Badge>
              <span className="history-year__avg">
                {y.final_average !== null ? (
                  <>
                    Promedio <strong>{fmt(y.final_average)}</strong>/{data.scale}
                    {y.failed_subjects > 0 && <span className="text-danger"> · {y.failed_subjects} reprobada{y.failed_subjects === 1 ? '' : 's'}</span>}
                  </>
                ) : (
                  <span className="text-muted">Sin notas</span>
                )}
              </span>
            </button>

            {isOpen && (
              <div className="history-year__body">
                {y.frozen ? (
                  <p className="form-hint">
                    <Icon name="lock" size={13} /> Boleta cerrada el {new Date(y.closed_at).toLocaleDateString('es')}: estas notas no cambian.
                    {y.outcome_notes && <> Observación: {y.outcome_notes}</>}
                  </p>
                ) : (
                  <p className="form-hint">
                    <Icon name="info" size={13} /> Año en curso: notas acumuladas hasta hoy.
                  </p>
                )}
                {y.subjects.length === 0 ? (
                  <p className="text-muted text-sm">No hay calificaciones registradas en este año.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table history-table">
                      <thead>
                        <tr>
                          <th>Materia</th>
                          {termNames.map((t) => (
                            <th key={t} style={{ textAlign: 'center' }}>
                              {headerOf(t)}
                            </th>
                          ))}
                          <th style={{ textAlign: 'center' }}>Final</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {y.subjects.map((s) => (
                          <tr key={s.subject_key}>
                            <td className="cell-person__name">{s.subject_name}</td>
                            {termNames.map((t) => {
                              const term = s.terms.find((x) => x.term_name === t);
                              return (
                                <td key={t} style={{ textAlign: 'center' }}>
                                  {term ? fmt(term.grade) : <span className="text-muted">—</span>}
                                </td>
                              );
                            })}
                            <td style={{ textAlign: 'center' }}>
                              <strong className={s.passed === false ? 'text-danger' : undefined}>{fmt(s.final_grade)}</strong>
                            </td>
                            <td>
                              {s.passed === null ? (
                                <span className="text-muted text-sm">Sin notas</span>
                              ) : s.passed ? (
                                <Badge variant="success">Aprobada</Badge>
                              ) : (
                                <Badge variant="danger">Reprobada</Badge>
                              )}
                              {!s.complete && s.passed !== null && <span className="cell-person__sub">Notas incompletas</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default AcademicHistory;
