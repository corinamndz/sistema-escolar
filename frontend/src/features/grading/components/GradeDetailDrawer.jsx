import { Link } from 'react-router-dom';
import gradingApi from '../../../api/endpoints/grading.api';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { isQualitative, literalFor } from '../gradingScale';
import LiteralBadge from './LiteralBadge';

/** 16.3 → "16,30" (como en la boleta oficial). */
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const shortTerm = (t) => (t.term_number ? `Lapso ${t.term_number}` : t.name);

/** Estado de una materia (o del año) según la nota mínima del año escolar. */
const STATUS = {
  approved: { label: 'Aprobada', variant: 'success', icon: 'checkCircle' },
  failed: { label: 'Reprobada', variant: 'danger', icon: 'alertCircle' },
  on_track: { label: 'En curso · aprobando', variant: 'info', icon: 'trendingUp' },
  at_risk: { label: 'En riesgo', variant: 'warning', icon: 'alertTriangle' },
  no_grades: { label: 'Sin notas', variant: 'neutral', icon: 'clock' },
};

/** Una nota: número coloreado (o literal en escala cualitativa); * si es parcial (acumulado a la fecha). */
function Grade({ cell, passing, qualitative, strong = false }) {
  if (!cell || cell.value === null || cell.value === undefined) return <span className="gd-grade gd-grade--none">—</span>;
  if (qualitative) {
    return (
      <span className="gd-grade">
        <LiteralBadge level={literalFor(cell.value)} />
        {cell.partial && <sup className="gd-grade__partial" title="Parcial: acumulado a la fecha">*</sup>}
      </span>
    );
  }
  const Tag = strong ? 'strong' : 'span';
  return (
    <span className={`gd-grade ${cell.value < passing ? 'is-fail' : 'is-pass'}`}>
      <Tag>{fmt(cell.value)}</Tag>
      {cell.partial && <sup className="gd-grade__partial" title="Parcial: acumulado a la fecha (el lapso aún no está evaluado completo)">*</sup>}
    </span>
  );
}

/**
 * Detalle de calificaciones de un alumno, por materia y lapso, sin descargar
 * el PDF (Resumen de calificaciones → «Ver calificaciones por materia»). Los
 * datos vienen de GET /grading/summary/students/:id, con la misma regla de la
 * boleta oficial: en cada lapso, la definitiva si el plan se evaluó completo o
 * lo acumulado a la fecha (parcial, con *); la definitiva de la materia es la
 * media de sus lapsos, y se aprueba con la nota mínima del año.
 *
 *   studentId, schoolPeriodId   alumno y año escolar elegido en el resumen
 *   onPrint()                   abre la boleta oficial (imprimir / PDF)
 */
function GradeDetailDrawer({ studentId, schoolPeriodId, onClose, onPrint }) {
  const { data, loading, error } = useFetch(() => gradingApi.getStudentDetail(studentId, schoolPeriodId), [studentId, schoolPeriodId]);
  const st = data?.student;
  const qualitative = isQualitative(st?.grading_scale);
  const passing = data?.passing_grade ?? 10;
  const terms = data?.terms || [];
  const anyPartial = (data?.subjects || []).some((s) => Object.values(s.terms).some((c) => c?.partial));
  const overallStatus = STATUS[data?.overallStatus] || STATUS.no_grades;

  return (
    <Drawer
      title={st ? `${st.first_name} ${st.last_name}` : 'Calificaciones'}
      subtitle={data?.school_period ? `Calificaciones por materia · Año escolar ${data.school_period.name}` : undefined}
      icon="award"
      size="lg"
      onClose={onClose}
    >
      {loading ? (
        <Spinner label="Cargando calificaciones…" />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <div className="gd">
          {/* Datos generales */}
          <dl className="gd-facts">
            <div>
              <dt>Alumno</dt>
              <dd>
                {st.first_name} {st.last_name}
              </dd>
            </div>
            <div>
              <dt>Cédula</dt>
              <dd>{st.national_id || '—'}</dd>
            </div>
            <div>
              <dt>Grado y sección</dt>
              <dd>{st.section_id ? `${st.grade_name} · Sección ${st.section_name}` : 'Sin inscripción en el año'}</dd>
            </div>
            <div>
              <dt>Escala</dt>
              <dd>{qualitative ? 'Cualitativa (literales A–E)' : `0 a ${data.scale} · mínima ${passing}`}</dd>
            </div>
          </dl>

          {!st.section_id ? (
            <p className="text-sm text-muted">El alumno no está inscrito en ninguna sección de {data.school_period?.name}.</p>
          ) : !data.subjects.length ? (
            <div className="empty-state gd-empty">
              <div className="empty-state__icon">
                <Icon name="clipboard" size={22} />
              </div>
              <div className="empty-state__title">Sin materias evaluadas</div>
              <div className="text-sm">Aún no hay planes de evaluación con actividades para su sección.</div>
            </div>
          ) : (
            <>
              {/* Resumen del año */}
              <div className="gd-stats">
                <div className={`gd-stat gd-stat--main is-${data.overallStatus}`}>
                  <span className="gd-stat__label">Promedio {data.overallPartial ? 'a la fecha' : 'definitivo'}</span>
                  <span className="gd-stat__value">{qualitative ? <LiteralBadge level={literalFor(data.overall)} showLabel /> : fmt(data.overall)}</span>
                  <Badge variant={overallStatus.variant}>{overallStatus.label}</Badge>
                </div>
                <div className="gd-stat">
                  <span className="gd-stat__label">Materias</span>
                  <span className="gd-stat__value">{data.subjects.length}</span>
                </div>
                <div className={`gd-stat ${data.counts.approved ? 'is-ok' : ''}`}>
                  <span className="gd-stat__label">Aprobadas</span>
                  <span className="gd-stat__value">{data.counts.approved}</span>
                </div>
                <div className={`gd-stat ${data.counts.failed ? 'is-bad' : ''}`}>
                  <span className="gd-stat__label">Reprobadas</span>
                  <span className="gd-stat__value">{data.counts.failed}</span>
                </div>
                {data.counts.at_risk > 0 && (
                  <div className="gd-stat is-warn">
                    <span className="gd-stat__label">En riesgo</span>
                    <span className="gd-stat__value">{data.counts.at_risk}</span>
                  </div>
                )}
              </div>

              {/* Materias × lapsos */}
              <div className="table-wrap table-wrap--stack">
                <table className="table table--stack gd-table">
                  <thead>
                    <tr>
                      <th>Materia</th>
                      {terms.map((t) => (
                        <th key={t.id} className="gd-table__num" title={t.name}>
                          {shortTerm(t)}
                        </th>
                      ))}
                      <th className="gd-table__num">Definitiva</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subjects.map((sub) => {
                      const status = STATUS[sub.status];
                      return (
                        <tr key={sub.key} className={sub.status === 'failed' || sub.status === 'at_risk' ? 'is-low' : undefined}>
                          <td data-label="Materia" className="gd-table__subject">
                            {sub.name}
                          </td>
                          {terms.map((t) => (
                            <td key={t.id} data-label={shortTerm(t)} className="gd-table__num">
                              <Grade cell={sub.terms[t.id]} passing={passing} qualitative={qualitative} />
                            </td>
                          ))}
                          <td data-label="Definitiva" className="gd-table__num gd-table__def">
                            <Grade cell={{ value: sub.definitive, partial: sub.partial }} passing={passing} qualitative={qualitative} strong />
                          </td>
                          <td data-label="Estado">
                            <Badge variant={status.variant}>
                              <Icon name={status.icon} size={12} /> {status.label}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="gd-table__total">
                      <td data-label="Resumen">Promedio</td>
                      {terms.map((t) => (
                        <td key={t.id} data-label={shortTerm(t)} className="gd-table__num">
                          <Grade cell={data.termAverages[t.id]} passing={passing} qualitative={qualitative} strong />
                        </td>
                      ))}
                      <td data-label="Definitiva" className="gd-table__num gd-table__def">
                        <Grade cell={{ value: data.overall, partial: data.overallPartial }} passing={passing} qualitative={qualitative} strong />
                      </td>
                      <td data-label="Estado">
                        <Badge variant={overallStatus.variant}>{overallStatus.label}</Badge>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="gd-legend">
                {qualitative ? 'Literal según el rendimiento (A–E). ' : `Escala de 0 a ${data.scale}; se aprueba con ${passing}. `}
                Definitiva = promedio de los lapsos.
                {anyPartial && ' * Parcial: el lapso aún no está evaluado completo, se muestra lo acumulado a la fecha; la materia queda «En curso» o «En riesgo» hasta completarse.'}
              </p>
            </>
          )}

          <div className="form-actions">
            <Link to={`/students/${studentId}`} className="btn btn--secondary">
              Ver ficha del alumno
            </Link>
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {onPrint && st?.section_id && (
              <Button icon="file" onClick={onPrint}>
                Imprimir boleta
              </Button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default GradeDetailDrawer;
