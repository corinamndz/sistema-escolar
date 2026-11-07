import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';

const STATE = {
  missing: { label: 'Falta enviar la planilla', tone: 'todo' },
  changes_requested: { label: 'El colegio pidió corregirla', tone: 'todo' },
  rejected: { label: 'Planilla rechazada: comunícate con el colegio', tone: 'bad' },
  submitted: { label: 'En revisión por el colegio', tone: 'wait' },
};

/**
 * Aviso al representante: la inscripción oficial de un año se activa SOLO
 * cuando el colegio aprueba la planilla de ese año (también tras promover a un
 * grado nuevo). Lista cada alumno pendiente con su grado de ese año y en qué va.
 *
 *   reminders  [{ student_name, school_period_name, grade_name, section_name, state }]
 *   link       muestra el botón «Completar planilla» (inicio del portal)
 */
function EnrollmentReminder({ reminders: all = [], link = false }) {
  // Un renglón por alumno y año (el servidor da uno por convocatoria; un año puede tener varias).
  const reminders = all.filter((r, i) => all.findIndex((x) => x.student_id === r.student_id && x.school_period_id === r.school_period_id) === i);
  const todo = reminders.filter((r) => r.state === 'missing' || r.state === 'changes_requested');
  if (!reminders.length) return null;
  const periods = [...new Set(reminders.map((r) => r.school_period_name))].join(' y ');
  return (
    <section className={`enr-reminder ${todo.length ? 'is-action' : 'is-wait'}`} role={todo.length ? 'alert' : 'status'}>
      <span className="enr-reminder__icon">
        <Icon name={todo.length ? 'alertTriangle' : 'clock'} size={20} />
      </span>
      <div className="enr-reminder__body">
        <strong>
          {todo.length
            ? `Inscripción ${periods}: completa la planilla para activar la inscripción oficial`
            : `Inscripción ${periods}: tu planilla está en revisión`}
        </strong>
        <span className="enr-reminder__text">
          {todo.length
            ? 'Cada año escolar (y cada grado nuevo) requiere su propia planilla. Mientras el colegio no la apruebe, el alumno figura como «No inscrito».'
            : 'Te avisaremos cuando el colegio la apruebe: en ese momento la inscripción queda activa.'}
        </span>
        <ul className="enr-reminder__list">
          {reminders.map((r) => (
            <li key={`${r.school_period_name}-${r.student_name}`} className={`is-${STATE[r.state]?.tone || 'todo'}`}>
              <span className="enr-reminder__who">
                {r.student_name}
                {r.grade_name && (
                  <span className="enr-reminder__grade">
                    {r.grade_name}
                    {r.section_name ? ` · ${r.section_name}` : ''} ({r.school_period_name})
                  </span>
                )}
              </span>
              <span className="enr-reminder__state">{r.state === 'missing' && r.assigned ? 'Planilla por llenar (nuevo año escolar)' : STATE[r.state]?.label}</span>
            </li>
          ))}
        </ul>
        {link && todo.length > 0 && (
          <Link to="/portal/enrollment" className="btn btn--primary btn--sm enr-reminder__cta">
            <Icon name="clipboard" size={15} /> Completar planilla
          </Link>
        )}
      </div>
    </section>
  );
}

export default EnrollmentReminder;
