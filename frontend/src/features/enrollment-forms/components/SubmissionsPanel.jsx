import { useState } from 'react';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import DynamicForm from './DynamicForm';
import FormPdfButton from './FormPdfButton';
import ApprovalPanel from './ApprovalPanel';
import { SUBMISSION_STATUS } from '../fieldTypes';

const when = (iso) => new Date(iso).toLocaleString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Planillas recibidas de un formulario, con filtro por estado y revisión en un panel lateral. */
function SubmissionsPanel({ formId, canReview }) {
  const { data: rows, loading, error, refetch } = useFetch(() => enrollmentFormsApi.submissions(formId), [formId]);
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const list = filter ? rows.filter((r) => r.status === filter) : rows;

  return (
    <div className="card">
      <div className="level-filter ef-filter" role="group" aria-label="Filtrar por estado">
        {[['', 'Todas', rows.length], ...Object.entries(SUBMISSION_STATUS).filter(([k]) => k !== 'pending').map(([k, s]) => [k, s.label, counts[k] || 0])].map(([k, label, n]) => (
          <button key={k || 'all'} type="button" className={`level-filter__item ${filter === k ? 'level-filter__item--active' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
            <span className="level-filter__count">{n}</span>
          </button>
        ))}
      </div>
      {!list.length ? (
        <p className="text-sm text-muted ef-empty">{rows.length ? 'Ninguna planilla en este estado.' : 'Todavía no se recibió ninguna planilla.'}</p>
      ) : (
        <ul className="ef-subs">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="ef-sub" onClick={() => setOpenId(s.id)}>
                <span className="avatar avatar--sm">{(s.student_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="ef-sub__main">
                  <strong>
                    {s.student_name}
                    {!s.student_id && <span className="ef-sub__new">Aspirante nuevo</span>}
                  </strong>
                  <span>
                    Representante: {s.guardian_name} · enviada {when(s.submitted_at)}
                  </span>
                </span>
                <Badge variant={SUBMISSION_STATUS[s.status].variant}>{SUBMISSION_STATUS[s.status].label}</Badge>
                <Icon name="chevronRight" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && (
        <SubmissionDrawer
          id={openId}
          canReview={canReview}
          onClose={() => setOpenId(null)}
          onReviewed={() => {
            refetch();
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Revisión de una planilla recibida (también la usa la bandeja «Planillas recibidas»).
 * Aprobar abre «Aprobar e inscribir» (alta del alumno, representantes y matrícula).
 */
export function SubmissionDrawer({ id, canReview, onClose, onReviewed }) {
  const { data: s, loading, error } = useFetch(() => enrollmentFormsApi.submission(id), [id]);
  const [mode, setMode] = useState(null); // 'changes_requested' | 'rejected' | 'approve'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const review = async (status) => {
    setBusy(true);
    try {
      await enrollmentFormsApi.review(id, { status, note: note.trim() || null });
      toast.success({ rejected: 'Planilla rechazada', changes_requested: 'Planilla devuelta para corregir' }[status], 'El representante recibió el aviso en su portal.');
      onReviewed();
    } catch (err) {
      toast.error('No se pudo guardar la revisión', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={s ? (mode === 'approve' ? `Aprobar e inscribir · ${s.student_name}` : s.student_name) : 'Planilla recibida'} subtitle={s ? `Representante: ${s.guardian_name}` : undefined} icon="clipboard" size="lg" onClose={onClose} busy={busy}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : mode === 'approve' ? (
        <ApprovalPanel submissionId={s.id} onCancel={() => setMode(null)} onApproved={onReviewed} />
      ) : (
        <>
          <div className="ef-review__head">
            <Badge variant={SUBMISSION_STATUS[s.status].variant}>{SUBMISSION_STATUS[s.status].label}</Badge>
            <span className="text-sm text-muted">
              Enviada {when(s.submitted_at)}
              {s.guardian_phone ? ` · ${s.guardian_phone}` : ''}
              {s.guardian_email ? ` · ${s.guardian_email}` : ''}
            </span>
            {/* PDF con membrete del colegio y firmas (para el expediente o imprimir). */}
            <span className="ef-review__pdf">
              <FormPdfButton load={() => enrollmentFormsApi.submissionPdf(s.id)} fileName={`planilla-${s.student_name}.pdf`} />
            </span>
          </div>
          {s.review_note && (
            <Alert variant={s.status === 'approved' ? 'success' : 'warning'}>
              {s.reviewed_by_name ? `${s.reviewed_by_name}: ` : ''}
              {s.review_note}
            </Alert>
          )}
          {/* Se lee con los campos tal como estaban al enviarla. */}
          <DynamicForm fields={s.fields_snapshot} values={s.answers} readOnly photo={{ load: enrollmentFormsApi.adminPhoto }} />

          {canReview && ['submitted', 'changes_requested'].includes(s.status) && (
            <div className="ef-review__actions">
              {mode ? (
                <>
                  <Field label={mode === 'rejected' ? 'Motivo del rechazo' : 'Qué debe corregir'} required hint="El representante lo verá en su portal.">
                    <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus />
                  </Field>
                  <div className="form-actions">
                    <Button variant="secondary" onClick={() => (setMode(null), setNote(''))} disabled={busy}>
                      Volver
                    </Button>
                    <Button variant={mode === 'rejected' ? 'danger' : 'primary'} onClick={() => review(mode)} loading={busy} disabled={!note.trim()}>
                      {mode === 'rejected' ? 'Rechazar planilla' : 'Devolver para corregir'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="form-actions">
                  <Button variant="ghost" onClick={() => setMode('rejected')}>
                    Rechazar
                  </Button>
                  <Button variant="secondary" icon="pencil" onClick={() => setMode('changes_requested')}>
                    Pedir corrección
                  </Button>
                  <Button icon="check" onClick={() => setMode('approve')}>
                    {s.student_id ? 'Aprobar e inscribir' : 'Aprobar e inscribir alumno nuevo'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

export default SubmissionsPanel;
