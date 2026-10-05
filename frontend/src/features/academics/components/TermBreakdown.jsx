import Badge from '../../../components/ui/Badge';
import { termLabel } from '../../evaluation-plans/terms';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: 2 }));

// Misma etiqueta de lapso que en Planes de evaluación: Lapso I, Lapso II, Lapso III.
export { termLabel };

/** Clase de color de una nota según la nota mínima. */
export const gradeClass = (grade, passing) => (grade === null || grade === undefined ? 'text-muted' : grade >= passing ? 'grade--pass' : 'grade--fail');

/**
 * Desglose de las notas de un alumno: una columna por lapso (todas las materias
 * cursadas con su definitiva del lapso y el promedio del lapso = suma de las
 * definitivas ÷ número de materias) y una columna final con
 * la nota anual de cada materia (promedio de los lapsos) y si la aprobó.
 */
function TermBreakdown({ student, passingGrade }) {
  const subjects = student.subjects;
  if (!subjects.length) return <p className="text-muted">Sin materias en el plan de estudios ni planes de evaluación en este año.</p>;
  const terms = student.term_averages || [];

  return (
    <div className="term-breakdown">
      {terms.map((t) => (
        <section key={t.term_id} className="term-breakdown__col">
          <header className="term-breakdown__head">
            <span>{termLabel(t.term_number, t.term_name)}</span>
            <span className="text-sm text-muted">
              {t.graded_subjects}/{t.total_subjects} materias
            </span>
          </header>
          <ul className="term-breakdown__list">
            {subjects.map((s) => {
              const g = s.terms.find((x) => x.term_id === t.term_id)?.grade ?? null;
              return (
                <li key={s.subject_key}>
                  <span className="term-breakdown__subject">{s.subject_name}</span>
                  <strong className={gradeClass(g, passingGrade)} title={g === null ? 'Sin definitiva en este lapso: suma 0 en el promedio' : undefined}>
                    {fmt(g)}
                  </strong>
                </li>
              );
            })}
          </ul>
          <footer className="term-breakdown__foot">
            <span>
              Promedio del lapso
              {t.average !== null && (
                <span className="term-breakdown__formula">
                  {fmt(t.sum)} ÷ {t.total_subjects} materias
                  {t.graded_subjects < t.total_subjects && ` · ${t.total_subjects - t.graded_subjects} sin nota (cuentan 0)`}
                </span>
              )}
            </span>
            <strong className={gradeClass(t.average, passingGrade)}>{fmt(t.average)}</strong>
          </footer>
        </section>
      ))}

      <section className="term-breakdown__col term-breakdown__col--final">
        <header className="term-breakdown__head">
          <span>Definitiva anual</span>
          <span className="text-sm text-muted">mínimo {fmt(passingGrade)}</span>
        </header>
        <ul className="term-breakdown__list">
          {subjects.map((s) => (
            <li key={s.subject_key}>
              <span className="term-breakdown__subject">
                {s.subject_name}
                {s.provisional && s.final_grade !== null && <span className="term-breakdown__note">provisional · falta {s.terms.filter((x) => x.grade === null).map((x) => termLabel(x.term_number, x.term_name)).join(', ')}</span>}
              </span>
              <span className="term-breakdown__final">
                <strong className={gradeClass(s.final_grade, passingGrade)}>{fmt(s.final_grade)}</strong>
                {s.passed === null ? null : s.passed ? <Badge variant="success">Aprobada</Badge> : <Badge variant="danger">Reprobada</Badge>}
              </span>
            </li>
          ))}
        </ul>
        <footer className="term-breakdown__foot">
          <span>Promedio general</span>
          <strong className={gradeClass(student.final_average, passingGrade)}>{fmt(student.final_average)}</strong>
        </footer>
      </section>
    </div>
  );
}

export default TermBreakdown;
