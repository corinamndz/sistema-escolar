import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Drawer from '../../../components/ui/Drawer';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import FormPdfButton from '../../enrollment-forms/components/FormPdfButton';
import { SUBMISSION_STATUS } from '../../enrollment-forms/fieldTypes';
import { sectionLabel } from './StudentGroups';

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ENROLLMENT = {
  active: 'Cursando',
  promoted: 'Promovido',
  retained: 'Repite',
  graduated: 'Egresado',
  withdrawn: 'Retirado',
};

/**
 * Historial de planillas de inscripción de un alumno (Administrador): una por
 * año escolar, con el grado y la sección en que cursó ese año, el estado de la
 * planilla y su PDF con membrete del colegio.
 */
function EnrollmentFormsHistoryDrawer({ student, onClose }) {
  const { data, loading, error } = useFetch(() => enrollmentFormsApi.studentHistory(student.id), [student.id]);
  const name = `${student.first_name} ${student.last_name}`;

  return (
    <Drawer title="Historial de planillas" subtitle={name} icon="clipboard" onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data.submissions.length ? (
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="clipboard" size={24} />
          </div>
          <div className="empty-state__title">Sin planillas</div>
          <div className="text-sm">{name} aún no tiene planillas de inscripción enviadas por su representante.</div>
        </div>
      ) : (
        <ol className="fh-list">
          {data.submissions.map((s) => {
            const st = SUBMISSION_STATUS[s.status];
            return (
              <li key={s.id} className="fh-item">
                <span className="fh-item__year">{s.school_period_name}</span>
                <div className="fh-item__body">
                  <div className="fh-item__head">
                    <strong>{s.form_title}</strong>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <dl className="fh-item__facts">
                    <div>
                      <dt>Grado y sección</dt>
                      <dd>
                        {s.grade_name ? (
                          <>
                            {s.grade_name} · {sectionLabel(s.section_name)}
                            {s.enrollment_status && s.enrollment_status !== 'active' && <span className="fh-item__muted"> ({ENROLLMENT[s.enrollment_status] || s.enrollment_status})</span>}
                          </>
                        ) : (
                          <span className="fh-item__muted">{s.requested_grade ? `Sin sección · solicitó ${s.requested_grade}` : 'Sin sección asignada'}</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{s.status === 'pending' ? 'Asignada a' : 'Enviada'}</dt>
                      <dd>
                        {/* «Por llenar»: generada al promover, la familia aún no la envía. */}
                        {s.status === 'pending' ? s.guardian_name : `${date(s.submitted_at)} · ${s.guardian_name}`}
                      </dd>
                    </div>
                    {s.reviewed_at && (
                      <div>
                        <dt>Revisada</dt>
                        <dd>
                          {date(s.reviewed_at)}
                          {s.reviewed_by_name ? ` · ${s.reviewed_by_name}` : ''}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {s.review_note && <p className="fh-item__note">{s.review_note}</p>}
                  {s.status !== 'pending' && <FormPdfButton load={() => enrollmentFormsApi.submissionPdf(s.id)} fileName={`planilla-${name}-${s.school_period_name}.pdf`} label="Descargar PDF" variant="ghost" />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Drawer>
  );
}

export default EnrollmentFormsHistoryDrawer;
