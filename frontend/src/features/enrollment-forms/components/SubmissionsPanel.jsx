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
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import RowMenu from '../../../components/ui/RowMenu';
import { useAuth } from '../../../context/AuthContext';
import DynamicForm from './DynamicForm';
import FormPdfButton from './FormPdfButton';
import ApprovalPanel from './ApprovalPanel';
import { SUBMISSION_STATUS } from '../fieldTypes';

const when = (iso) => new Date(iso).toLocaleString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Eliminar una planilla (solo el Administrador, en cualquier estado), con
 * confirmación. Si estaba aprobada, avisa que el alumno y su inscripción quedan.
 * → (submission) => Promise<boolean>  (true si se eliminó)
 */
export function useDeleteSubmission() {
  const confirm = useConfirm();
  const toast = useToast();
  return async (s) => {
    const approved = s.status === 'approved';
    const ok = await confirm({
      title: approved ? `¿Eliminar la planilla aprobada de ${s.student_name}?` : `¿Eliminar la planilla de ${s.student_name}?`,
      message: approved
        ? `Se borran la planilla y sus respuestas. ${s.student_name} ya quedó registrado e inscrito al aprobarla: el alumno, su inscripción, sus representantes y sus cobros NO se borran. Si era de prueba, retíralo desde su ficha (Alumnos → Retirar). No se puede deshacer.`
        : s.status === 'pending'
          ? 'El representante dejará de verla como planilla por llenar en su portal. No se puede deshacer.'
          : 'Se borran la planilla y sus respuestas, y el representante deja de verla en su portal. No se puede deshacer.',
      confirmLabel: 'Eliminar planilla',
      danger: true,
    });
    if (!ok) return false;
    try {
      await enrollmentFormsApi.deleteSubmission(s.id);
      toast.success('Planilla eliminada', approved ? `${s.student_name} sigue inscrito: si era de prueba, retíralo desde su ficha.` : s.student_name);
      return true;
    } catch (err) {
      toast.error('No se pudo eliminar la planilla', getErrorMessage(err));
      return false;
    }
  };
}

/** Planillas recibidas de un formulario, con filtro por estado y revisión en un panel lateral. */
function SubmissionsPanel({ formId, canReview }) {
  const { data: rows, loading, error, refetch } = useFetch(() => enrollmentFormsApi.submissions(formId), [formId]);
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState(null);
  const { user } = useAuth();
  const remove = useDeleteSubmission();

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
            <li key={s.id} className="ef-sub-row">
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
              {user?.isAdmin && (
                <RowMenu
                  label={`Acciones de la planilla de ${s.student_name}`}
                  items={[
                    { key: 'open', label: 'Ver planilla', icon: 'eye', onClick: () => setOpenId(s.id) },
                    { key: 'delete', label: 'Eliminar planilla', icon: 'trash', danger: true, onClick: async () => (await remove(s)) && refetch() },
                  ]}
                />
              )}
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
  const { user } = useAuth();
  const remove = useDeleteSubmission();

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
          {user?.isAdmin && !mode && (
            <div className="ef-review__danger">
              <button
                type="button"
                className="link-button is-danger"
                onClick={async () => {
                  if (await remove(s)) onReviewed();
                }}
              >
                <Icon name="trash" size={14} /> Eliminar planilla
              </button>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

export default SubmissionsPanel;
