import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import EvaluationCalendar from '../../schedules/components/EvaluationCalendar';
import { TERM_OPTIONS } from '../../evaluation-plans/terms';

/**
 * Pestaña "Evaluaciones" del portal del representante: el cronograma de
 * evaluaciones de la sección del alumno (la de su inscripción vigente; no
 * hay que elegir nada), por lapso. Es el mismo calendario y el mismo modal
 * de detalle que usan administración y docentes, pero con el estado del
 * propio alumno y sin datos internos de la sección.
 */
function PortalEvaluations({ studentId }) {
  const [termNumber, setTermNumber] = useState(''); // '' = todos los lapsos

  return (
    <div className="portal-evals">
      <div className="portal-evals__terms level-filter" role="group" aria-label="Lapso">
        {[{ number: '', label: 'Todos los lapsos' }, ...TERM_OPTIONS].map((t) => (
          <button
            key={t.number || 'all'}
            type="button"
            className={`level-filter__item ${String(termNumber) === String(t.number) ? 'level-filter__item--active' : ''}`}
            onClick={() => setTermNumber(t.number)}
            aria-pressed={String(termNumber) === String(t.number)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <EvaluationCalendar
        fetcher={() => portalApi.getStudentEvaluations(studentId, termNumber || null)}
        fetchKey={`${studentId}|${termNumber}`}
        termNumber={termNumber}
      />
    </div>
  );
}

export default PortalEvaluations;
