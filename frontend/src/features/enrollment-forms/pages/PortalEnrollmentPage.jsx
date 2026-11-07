import { createContext, useContext, useEffect, useState } from 'react';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import DynamicForm from '../components/DynamicForm';
import FormPdfButton from '../components/FormPdfButton';
import EnrollmentReminder from '../components/EnrollmentReminder';
import { SUBMISSION_STATUS, validateLocally } from '../fieldTypes';

/**
 * De dónde salen los datos del portal y qué hacen los botones. El representante
 * usa su sesión; el Administrador, en «Ver como representante», usa la vista
 * simulada: los mismos datos y validaciones de ese representante, sin guardar
 * nada (no envía, no elimina, no sube fotos).
 */
const REAL_SOURCE = {
  simulated: false,
  load: () => enrollmentFormsApi.portal(),
  prefill: (formId, studentId) => enrollmentFormsApi.prefill(formId, studentId),
  submit: (formId, body) => enrollmentFormsApi.submit(formId, body),
  remove: (id) => enrollmentFormsApi.removeSubmission(id),
  pdf: (id) => enrollmentFormsApi.portalSubmissionPdf(id),
  photo: { upload: enrollmentFormsApi.uploadPhoto, load: enrollmentFormsApi.portalPhoto },
};

/** Fuente simulada para un representante (crearla una vez por representante: useMemo). */
export function previewSource(guardianId) {
  return {
    simulated: true,
    key: guardianId,
    load: () => enrollmentFormsApi.preview(guardianId),
    prefill: (formId, studentId) => enrollmentFormsApi.previewPrefill(guardianId, formId, studentId),
    submit: (formId, body) => enrollmentFormsApi.previewCheck(guardianId, formId, body),
    remove: null,
    pdf: (id) => enrollmentFormsApi.submissionPdf(id),
    photo: { upload: null, load: enrollmentFormsApi.adminPhoto },
  };
}

const SourceContext = createContext(REAL_SOURCE);
const SIM_HINT = 'Vista simulada: esta acción solo la puede hacer el representante en su portal.';

/**
 * Portal del representante → Inscripción: las planillas que publicó el
 * colegio. Se completa una por cada alumno (re-inscripción) o por un aspirante
 * nuevo; el formulario se dibuja a partir del esquema que diseñó el colegio.
 */
function PortalEnrollmentPage() {
  return <PortalEnrollmentView />;
}

/**
 * La vista del portal. Reutilizable: `source` = previewSource(guardianId) la
 * muestra tal como la ve ese representante, en modo simulación.
 *   focusStudentId   resalta a ese alumno (al venir desde su ficha)
 *   banner(data)     contenido arriba de la vista (p. ej. la franja de simulación)
 */
export function PortalEnrollmentView({ source = REAL_SOURCE, focusStudentId = null, banner = null }) {
  const { data, loading, error, refetch } = useFetch(() => source.load(), [source]);
  const [filling, setFilling] = useState(null); // { form, student?, submission? , applicant? }
  const remove = useRemoveSubmission(refetch, source);

  if (loading) return <Spinner label="Cargando planillas…" />;
  if (error) return <Alert>{error}</Alert>;
  const { forms, students, submissions, reminders = [] } = data;

  return (
    <SourceContext.Provider value={source}>
    <div className={source.simulated ? 'portal-sim__view' : undefined}>
      {banner?.(data)}
      <PageHeader title="Inscripción" subtitle="Completa la planilla de inscripción de cada uno de tus representados: la inscripción de cada año se activa cuando el colegio la aprueba." />
      <EnrollmentReminder reminders={reminders} />
      {!forms.length ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="clipboard" size={24} />
          </div>
          <div className="empty-state__title">No hay planillas abiertas</div>
          <div className="text-sm">Cuando el colegio abra el proceso de inscripción, la planilla aparecerá aquí.</div>
        </div>
      ) : (
        forms.map((form) => {
          const subs = submissions.filter((s) => s.form_id === form.id);
          const applicants = subs.filter((s) => !s.student_id);
          // Alumnos a quienes les toca esta planilla: los que ya tienen la suya (enviada o «Por llenar»)
          // y los pendientes según el servidor (año vigente, o el año nuevo al que fueron promovidos).
          const mine = students.filter((st) => subs.some((s) => s.student_id === st.id) || reminders.some((r) => r.student_id === st.id && r.form_id === form.id));
          const toFill = subs.filter((s) => s.status === 'pending').length;
          return (
            <section key={form.id} className="card pe-form">
              <div className="pe-form__head">
                <span className="pe-form__icon">
                  <Icon name="clipboard" size={22} />
                </span>
                <div>
                  <h2>{form.title}</h2>
                  <p className="text-sm text-muted">Año escolar {form.school_period_name}</p>
                </div>
                {toFill > 0 && (
                  <span className="pe-form__todo">
                    <Icon name="alertTriangle" size={14} /> {toFill === 1 ? '1 planilla por llenar' : `${toFill} planillas por llenar`}
                  </span>
                )}
              </div>
              {form.description && <p className="pe-form__desc">{form.description}</p>}
              <ul className="pe-rows">
                {mine.map((st) => {
                  const own = subs.find((s) => s.student_id === st.id);
                  // «Por llenar» (asignada al promover) = todavía sin enviar: se abre vacía, con la precarga.
                  const assigned = own?.status === 'pending';
                  const sub = assigned ? null : own;
                  const reminder = reminders.find((r) => r.student_id === st.id && r.form_id === form.id);
                  return <Row key={st.id} focus={st.id === focusStudentId} name={`${st.first_name} ${st.last_name}`} sub={sub} assigned={assigned || Boolean(reminder?.assigned && !sub)} reminder={reminder} onOpen={() => setFilling({ form, student: st, submission: sub })} onDelete={() => remove(sub, `${st.first_name} ${st.last_name}`)} />;
                })}
                {!mine.length && !applicants.length && <li className="pe-rows__empty text-sm text-muted">Ninguno de tus representados tiene esta planilla pendiente.</li>}
                {applicants.map((sub) => (
                  <Row key={sub.id} name={sub.student_name} sub={sub} applicant onOpen={() => setFilling({ form, applicant: true, submission: sub })} onDelete={() => remove(sub, sub.student_name)} />
                ))}
              </ul>
              <Button variant="ghost" icon="plus" onClick={() => setFilling({ form, applicant: true })}>
                Inscribir a un aspirante nuevo (hermano, otro representado)
              </Button>
            </section>
          );
        })
      )}
      {filling && (
        <FillDrawer
          {...filling}
          onClose={() => setFilling(null)}
          onDelete={async () => {
            if (await remove(filling.submission, filling.student ? `${filling.student.first_name} ${filling.student.last_name}` : filling.submission.student_name)) setFilling(null);
          }}
          onSent={() => {
            setFilling(null);
            refetch();
          }}
        />
      )}
    </div>
    </SourceContext.Provider>
  );
}

/**
 * Eliminar (anular) una planilla propia mientras está en revisión o por
 * corregir: queda libre para enviar una nueva. Devuelve true si se eliminó.
 */
function useRemoveSubmission(onDone, source = REAL_SOURCE) {
  const confirm = useConfirm();
  const toast = useToast();
  return async (sub, name) => {
    if (!source.remove) return false; // simulación: no se elimina nada
    const ok = await confirm({
      title: `¿Eliminar la planilla de ${name}?`,
      message: 'Se borra la planilla enviada y sus respuestas. Podrás completar una nueva desde cero.',
      confirmLabel: 'Eliminar planilla',
      danger: true,
      icon: 'trash',
    });
    if (!ok) return false;
    try {
      await source.remove(sub.id);
      toast.success('Planilla eliminada', `Puedes completar de nuevo la planilla de ${name}.`);
      onDone();
      return true;
    } catch (err) {
      toast.error('No se pudo eliminar la planilla', getErrorMessage(err));
      onDone();
      return false;
    }
  };
}

function Row({ name, sub, assigned = false, reminder = null, applicant = false, focus = false, onOpen, onDelete }) {
  const source = useContext(SourceContext);
  const st = sub ? SUBMISSION_STATUS[sub.status] : null;
  const editable = !sub || ['submitted', 'changes_requested'].includes(sub.status);
  return (
    <li className={`pe-row ${sub?.status === 'changes_requested' || assigned ? 'is-attention' : ''} ${focus ? 'is-focus' : ''}`}>
      <span className="avatar avatar--sm">{name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
      <span className="pe-row__main">
        <strong>
          {name}
          {applicant && <span className="ef-sub__new">Aspirante nuevo</span>}
        </strong>
        {/* Dónde quedó ubicado ese año (p. ej. tras la promoción) y qué falta para la inscripción oficial. */}
        {reminder?.grade_name && (
          <span className="pe-row__note">
            <Icon name="graduation" size={13} /> {reminder.grade_name}
            {reminder.section_name ? ` · Sección ${reminder.section_name}` : ''} en {reminder.school_period_name}
            {reminder.state === 'missing' ? (assigned ? ': el colegio te asignó la planilla del nuevo año, llénala para activar su inscripción.' : ': completa la planilla para activar su inscripción.') : ''}
          </span>
        )}
        {sub?.status === 'approved' && (
          <span className="pe-row__note is-ok">
            <Icon name="checkCircle" size={13} /> Inscripción oficial activa
          </span>
        )}
        {sub?.review_note && (
          <span className={`pe-row__note ${sub.status === 'changes_requested' ? 'is-warn' : ''}`}>
            <Icon name="info" size={13} /> {sub.review_note}
          </span>
        )}
      </span>
      {st ? <Badge variant={st.variant}>{st.label}</Badge> : assigned ? <Badge variant={SUBMISSION_STATUS.pending.variant}>{SUBMISSION_STATUS.pending.label}</Badge> : <Badge variant="neutral">Sin enviar</Badge>}
      {sub && <FormPdfButton load={() => source.pdf(sub.id)} fileName={`planilla-${name}.pdf`} label="PDF" variant="ghost" />}
      {sub && editable && (
        <Button size="sm" variant="ghost" icon="trash" className="pe-row__delete" onClick={onDelete} disabled={source.simulated} title={source.simulated ? SIM_HINT : 'Eliminar esta planilla para enviar una nueva'} aria-label={`Eliminar la planilla de ${name}`}>
          Eliminar
        </Button>
      )}
      <Button size="sm" variant={!sub || sub.status === 'changes_requested' ? 'primary' : 'secondary'} onClick={onOpen}>
        {!sub ? 'Completar' : sub.status === 'changes_requested' ? 'Corregir' : editable ? 'Ver o editar' : 'Ver'}
      </Button>
    </li>
  );
}

function FillDrawer({ form, student, applicant, submission, onClose, onSent, onDelete }) {
  const source = useContext(SourceContext);
  const [values, setValues] = useState(() => submission?.answers || {});
  // Re-inscripción de un alumno registrado: los datos que ya tiene el colegio llegan precargados.
  const [prefill, setPrefill] = useState({ loading: Boolean(student && !submission), marks: {}, previous: null });
  useEffect(() => {
    if (!student || submission) return undefined;
    let alive = true;
    source
      .prefill(form.id, student.id)
      .then((p) => {
        if (!alive) return;
        setValues((v) => ({ ...p.answers, ...v }));
        setPrefill({ loading: false, marks: p.sources, previous: p.previous, guardian: p.guardian });
      })
      .catch(() => alive && setPrefill({ loading: false, marks: {}, previous: null })); // sin precarga: se completa a mano
    return () => {
      alive = false;
    };
  }, [form.id, student, submission, source]);
  const prefilledCount = Object.keys(prefill.marks).length;
  const [applicantName, setApplicantName] = useState(applicant ? submission?.applicant_name || '' : '');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const readOnly = submission && ['approved', 'rejected'].includes(submission.status);
  const who = student ? `${student.first_name} ${student.last_name}` : submission?.student_name || 'Aspirante nuevo';

  const send = async (e) => {
    e.preventDefault();
    const local = validateLocally(form.fields, values);
    if (applicant && !applicantName.trim()) local.__applicant = 'Escribe el nombre del aspirante.';
    setErrors(local);
    if (Object.keys(local).length) {
      setFormError('Revisa los campos marcados.');
      requestAnimationFrame(() => document.querySelector('.drawer .has-error, .drawer .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      await source.submit(form.id, {
        studentId: student?.id || null,
        applicantName: applicant ? applicantName.trim() : null,
        submissionId: applicant ? submission?.id || null : null,
        answers: values,
      });
      if (source.simulated) {
        // Mismas validaciones del envío real, sin guardar: la planilla está lista para que la familia la envíe.
        toast.success('Prueba superada', `${who}: el representante podría enviarla así. No se guardó nada.`);
        return;
      }
      toast.success(submission ? 'Planilla actualizada' : 'Planilla enviada', `${who}: el colegio la revisará y te avisará.`);
      onSent();
    } catch (err) {
      // Errores por campo del servidor: answers.<id>.
      const fe = getFieldErrors(err);
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^answers\./, ''), v])));
      setFormError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer title={form.title} subtitle={who} icon="clipboard" size="lg" onClose={onClose} busy={sending}>
      <form onSubmit={send} noValidate>
        {source.simulated && !readOnly && (
          <Alert variant="info">Simulación: puedes llenarla y probar el envío con las mismas validaciones del portal. No se guarda ni se envía nada.</Alert>
        )}
        {submission?.status === 'changes_requested' && submission.review_note && <Alert variant="warning">El colegio pidió corregir: {submission.review_note}</Alert>}
        {readOnly && <Alert variant={submission.status === 'approved' ? 'success' : 'info'}>Esta planilla ya fue {submission.status === 'approved' ? 'aprobada' : 'rechazada'}: solo puedes consultarla.</Alert>}
        {form.description && !readOnly && <p className="dyn-form__intro">{form.description}</p>}
        {prefilledCount > 0 && (
          <div className="pe-prefill" role="status">
            <Icon name="sparkles" size={18} />
            <div>
              <strong>Precargamos {prefilledCount === 1 ? '1 dato' : `${prefilledCount} datos`} que el colegio ya tiene.</strong>
              <span>
                Verifícalos, corrige lo que haya cambiado y envía.
                {prefill.guardian && Object.keys(prefill.marks).some((k) => prefill.marks[k] === 'record') && !prefill.guardian.isSelf && ` Los datos del representante son de ${prefill.guardian.name}${prefill.guardian.relationship ? ` (${prefill.guardian.relationship})` : ''}, representante principal.`}
                {prefill.previous && ` Algunas respuestas vienen de «${prefill.previous.title}».`}
              </span>
            </div>
          </div>
        )}
        <Alert>{formError}</Alert>
        {applicant && !readOnly && (
          <Field label="Nombre completo del aspirante" required error={errors.__applicant || errors.applicantName}>
            <Input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} maxLength={150} autoFocus />
          </Field>
        )}
        {prefill.loading ? (
          <Spinner label="Cargando los datos del alumno…" />
        ) : (
        <DynamicForm
          fields={readOnly ? submission.fields_snapshot || form.fields : form.fields}
          values={values}
          errors={errors}
          readOnly={readOnly}
          marks={prefill.marks}
          photo={source.photo}
          onChange={(id, v) => {
            setValues((s) => ({ ...s, [id]: v }));
            if (errors[id]) setErrors(({ [id]: _, ...rest }) => rest);
            if (prefill.marks[id]) setPrefill((p) => ({ ...p, marks: Object.fromEntries(Object.entries(p.marks).filter(([k]) => k !== id)) }));
          }}
        />
        )}
        <div className="form-actions">
          {submission && (
            <span className="pe-drawer__extra">
              <FormPdfButton load={() => source.pdf(submission.id)} fileName={`planilla-${who}.pdf`} />
              {!readOnly && (
                <Button type="button" variant="ghost" icon="trash" className="pe-row__delete" onClick={onDelete} disabled={sending || source.simulated} title={source.simulated ? SIM_HINT : undefined}>
                  Eliminar
                </Button>
              )}
            </span>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {readOnly ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!readOnly && (
            <Button type="submit" icon="send" loading={sending} disabled={prefill.loading}>
              {source.simulated ? 'Probar envío' : submission ? 'Enviar corrección' : 'Enviar planilla'}
            </Button>
          )}
        </div>
      </form>
    </Drawer>
  );
}

export default PortalEnrollmentPage;
