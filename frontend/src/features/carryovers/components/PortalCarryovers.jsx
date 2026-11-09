import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Badge from '../../../components/ui/Badge';
import Card from '../../../components/ui/Card';
import MomentTimeline, { CARRYOVER_STATUS, fmtGrade } from './MomentTimeline';

/**
 * Portal: materias pendientes del alumno, sobre sus calificaciones del año. Si no
 * tiene ninguna (lo normal), no ocupa lugar.
 */
function PortalCarryovers({ studentId }) {
  const { data } = useFetch(() => portalApi.getStudentCarryovers(studentId), [studentId]);
  if (!data?.length) return null;
  const open = data.filter((c) => ['pending', 'in_progress'].includes(c.status)).length;
  return (
    <Card title="Materias pendientes" subtitle={open ? `${open} por aprobar, en paralelo a su año actual` : 'De años anteriores'}>
      <div className="cm-portal">
        {data.map((c) => {
          const status = CARRYOVER_STATUS[c.status];
          return (
            <section key={c.id} className="cm-portal__item">
              <div className="cm-portal__head">
                <div>
                  <strong>{c.subject_name}</strong>
                  <p className="text-sm text-muted">
                    {c.source_grade_name} · {c.source_period_name} · nota {fmtGrade(c.source_final_grade)} · se aprueba con {fmtGrade(c.passing_grade)}
                    {c.teacher_name ? ` · Prof. ${c.teacher_name}` : ''}
                  </p>
                </div>
                <Badge variant={status.variant}>
                  {status.label}
                  {c.final_grade !== null && c.status === 'passed' ? ` · ${fmtGrade(c.final_grade)}` : ''}
                </Badge>
              </div>
              {c.moments.length ? <MomentTimeline moments={c.moments} /> : <p className="text-sm text-muted">El profesor aún no ha definido los momentos de recuperación.</p>}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

export default PortalCarryovers;
