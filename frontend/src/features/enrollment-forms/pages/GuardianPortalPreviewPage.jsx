import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/ui/Icon';
import { PortalEnrollmentView, previewSource } from './PortalEnrollmentPage';

/**
 * «Ver como representante» (solo el Administrador): el portal de Inscripción
 * EXACTAMENTE como lo ve un representante del alumno —sus planillas, la «Por
 * llenar» del año al que fue promovido, la precarga y los avisos—, en modo
 * simulación: se puede llenar y «Probar envío» con las validaciones reales,
 * pero no se guarda, envía ni elimina nada.
 *
 *   /students/:id/portal-preview?guardian=<id>   (sin guardian: el principal)
 */
function GuardianPortalPreviewPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: student, loading, error } = useFetch(() => studentsApi.getOne(id), [id]);

  const guardians = student?.guardians || [];
  const chosen = guardians.find((g) => g.id === params.get('guardian')) || guardians.find((g) => g.is_primary) || guardians[0] || null;
  const source = useMemo(() => (chosen ? previewSource(chosen.id) : null), [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner label="Preparando la vista del representante…" />;
  if (error) return <Alert>{error}</Alert>;
  const studentName = `${student.first_name} ${student.last_name}`;

  if (!chosen) {
    return (
      <div className="portal-sim">
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="users" size={24} />
          </div>
          <div className="empty-state__title">{studentName} no tiene representantes</div>
          <div className="text-sm">Asocia un representante en la ficha del alumno para ver su portal.</div>
          <Link to={`/students/${id}`} className="btn btn--secondary btn--sm">
            Volver a la ficha
          </Link>
        </div>
      </div>
    );
  }

  const banner = (data) => {
    // Comprobación rápida: ¿la planilla de este alumno está activa y lista para llenarse?
    const mine = (data.reminders || []).filter((r) => r.student_id === student.id);
    const ready = mine.filter((r) => ['missing', 'changes_requested'].includes(r.state));
    const waiting = mine.filter((r) => r.state === 'submitted');
    // Años en que está ubicado (matrícula activa) sin ninguna planilla visible para la familia:
    // p. ej. promovido a un año que aún no tiene planilla publicada.
    const periodOfForm = Object.fromEntries((data.forms || []).map((f) => [f.id, f.school_period_id]));
    const missing = (student.enrollments || []).filter(
      (e) =>
        e.status === 'active' &&
        !mine.some((r) => r.school_period_id === e.school_period_id) &&
        !(data.submissions || []).some((s) => s.student_id === student.id && periodOfForm[s.form_id] === e.school_period_id)
    );
    return (
      <>
        <div className="portal-sim__bar" role="note">
          <span className="portal-sim__icon">
            <Icon name="eye" size={18} />
          </span>
          <div className="portal-sim__text">
            <strong>Vista simulada del portal del representante</strong>
            <span>
              Así ve <b>{data.guardian.name}</b>
              {chosen.relationship ? ` (${chosen.relationship}${chosen.is_primary ? ', principal' : ''})` : ''} la sección Inscripción. Puedes abrir las planillas y probar el envío: no se guarda nada.
            </span>
          </div>
          {guardians.length > 1 && (
            <label className="portal-sim__who">
              <span>Ver como</span>
              <Select value={chosen.id} onChange={(e) => setParams({ guardian: e.target.value }, { replace: true })}>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.first_name} {g.last_name}
                    {g.relationship ? ` · ${g.relationship}` : ''}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <Link to={`/students/${id}`} className="btn btn--secondary btn--sm portal-sim__back">
            <Icon name="arrowLeft" size={15} /> Salir de la simulación
          </Link>
        </div>
        {!data.guardian.hasAccount && (
          <Alert variant="warning">{data.guardian.name} todavía no tiene acceso al portal: esto es lo que verá cuando se le cree la cuenta.</Alert>
        )}
        {(ready.length > 0 || waiting.length > 0 || !missing.length) && (
        <div className={`portal-sim__check ${ready.length ? 'is-ok' : waiting.length ? 'is-wait' : 'is-none'}`}>
          <Icon name={ready.length ? 'checkCircle' : waiting.length ? 'clock' : 'info'} size={16} />
          <span>
            {ready.length
              ? `${studentName}: ${ready.map((r) => `«${r.form_title}» (${r.school_period_name}${r.grade_name ? ` · ${r.grade_name}` : ''})`).join(', ')} — activa y lista para que la familia la complete.`
              : waiting.length
                ? `${studentName}: la planilla ya fue enviada y está en revisión del colegio.`
                : `${studentName} no tiene planillas pendientes en el portal: ya está inscrito en los años con planilla publicada.`}
          </span>
        </div>
        )}
        {missing.map((e) => (
          <div key={e.enrollment_id} className="portal-sim__check is-wait">
            <Icon name="alertTriangle" size={16} />
            <span>
              {studentName} está ubicado en {e.grade_name} · Sección {e.section_name} ({e.school_period_name}), pero la familia <b>no ve ninguna planilla de ese año</b>: no hay una planilla publicada para {e.school_period_name}, o no se le asignó.{' '}
              <Link to="/enrollment-forms">Ir a Diseño de planillas</Link>
            </span>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="portal-sim">
      <PortalEnrollmentView key={chosen.id} source={source} focusStudentId={student.id} banner={banner} />
    </div>
  );
}

export default GuardianPortalPreviewPage;
