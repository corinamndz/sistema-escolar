import { useEffect, useMemo, useState } from 'react';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Icon from '../../../components/ui/Icon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';

/**
 * «Aprobar e inscribir»: el administrador confirma (y corrige si hace falta)
 * lo que se dará de alta al aprobar la planilla. El backend lo hace todo en
 * una sola transacción:
 *   alumno (crear o actualizar) → representante legal (asociar o crear, principal)
 *   → vínculo de quien envió → matrícula en la sección → planilla aprobada.
 */
function ApprovalPanel({ submissionId, onCancel, onApproved }) {
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [student, setStudent] = useState(null);
  const [legal, setLegal] = useState(null);
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [submitterRel, setSubmitterRel] = useState('Tutor / Familiar');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    enrollmentFormsApi
      .approvalDraft(submissionId)
      .then((d) => {
        setDraft(d);
        setStudent({ existingId: null, firstName: d.student.firstName, lastName: d.student.lastName, nationalId: d.student.nationalId || '', birthDate: d.student.birthDate || '' });
        setLegal({
          guardianId: d.legal.match?.id || null,
          firstName: d.legal.firstName,
          lastName: d.legal.lastName,
          nationalId: d.legal.nationalId,
          phone: d.legal.phone,
          email: d.legal.email,
          relationship: d.legal.relationship,
        });
        const sug = d.placement.sections.find((s) => s.id === d.placement.suggestedSectionId);
        setGradeId(sug?.grade_id || '');
        setSectionId(sug?.id || '');
        if (d.submitter.relationship) setSubmitterRel(d.submitter.relationship);
      })
      .catch((err) => setLoadError(getErrorMessage(err)));
  }, [submissionId]);

  const grades = useMemo(() => {
    const seen = new Map();
    (draft?.placement.sections || []).forEach((s) => !seen.has(s.grade_id) && seen.set(s.grade_id, { id: s.grade_id, name: s.grade_name, level: s.level_name }));
    return [...seen.values()];
  }, [draft]);

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!draft || !student) return <Spinner label="Preparando la inscripción…" />;

  const isNew = draft.student.mode === 'new';
  const usingExisting = Boolean(student.existingId);
  const current = draft.placement.current;
  const gradeSections = draft.placement.sections.filter((s) => s.grade_id === gradeId);
  const chosen = draft.placement.sections.find((s) => s.id === sectionId);
  const legalIsNew = !legal.guardianId;
  const setS = (k) => (e) => setStudent((s) => ({ ...s, [k]: e.target.value }));
  const setL = (k) => (e) => setLegal((l) => ({ ...l, [k]: e.target.value }));
  const err = (path) => errors[path];

  const approve = async () => {
    const local = {};
    if (!student.firstName.trim()) local['student.firstName'] = 'Requerido.';
    if (!student.lastName.trim()) local['student.lastName'] = 'Requerido.';
    if (!sectionId && (isNew || !current)) local.sectionId = 'Elige la sección.';
    if (legalIsNew && !legal.firstName.trim()) local['legal.firstName'] = 'Requerido.';
    if (legalIsNew && !legal.lastName.trim()) local['legal.lastName'] = 'Requerido.';
    setErrors(local);
    if (Object.keys(local).length) return setFormError('Completa los datos marcados.');
    setBusy(true);
    setFormError(null);
    try {
      const { result } = await enrollmentFormsApi.approve(submissionId, {
        student: { ...student, nationalId: student.nationalId || null, birthDate: student.birthDate || null },
        sectionId: sectionId || null,
        legal: legalIsNew
          ? { firstName: legal.firstName, lastName: legal.lastName, nationalId: legal.nationalId || null, phone: legal.phone || null, email: legal.email || '', relationship: legal.relationship }
          : { guardianId: legal.guardianId, relationship: legal.relationship },
        submitterRelationship: draft.legal.isSubmitter ? null : submitterRel,
        note: note.trim() || null,
      });
      const parts = [
        result.student.created ? 'alumno registrado' : 'ficha del alumno actualizada',
        result.enrollment ? `${result.enrollment.created ? 'inscrito en' : 'cursa'} ${result.enrollment.label}` : null,
        ...result.guardians.filter((g) => g.role === 'legal').map((g) => (g.created ? `representante ${g.name} creado` : `representante ${g.name} asociado`)),
      ].filter(Boolean);
      toast.success(`${result.student.name}: planilla aprobada`, `${parts.join(' · ')}.`);
      onApproved(result);
    } catch (e) {
      setErrors(getFieldErrors(e));
      setFormError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ap">
      <p className="ap__intro">
        Al aprobar se registra todo de una vez: si algo falla (por ejemplo, la sección se llenó), no se guarda nada y la planilla sigue en revisión.
      </p>
      <Alert>{formError}</Alert>

      {/* ---- 1. Alumno ---- */}
      <section className="ap__card">
        <header className="ap__head">
          <span className="ap__num">1</span>
          <h3>Alumno</h3>
          {usingExisting ? (
            <Badge variant="info">Registrado · se actualizará</Badge>
          ) : isNew ? (
            <Badge variant="success">Nuevo · se registrará</Badge>
          ) : (
            <Badge variant="info">Registrado · se actualizará su ficha</Badge>
          )}
        </header>
        {isNew && draft.student.duplicates.length > 0 && (
          <div className="ap__dups">
            <Icon name="alertTriangle" size={16} />
            <div>
              <strong>{usingExisting ? 'Se usará el alumno registrado.' : 'Este aspirante podría estar ya registrado:'}</strong>
              {draft.student.duplicates.map((d) => (
                <div key={d.id} className="ap__dup">
                  <span>
                    {d.first_name} {d.last_name}
                    {d.national_id ? ` · ${d.national_id}` : ''} <span className="text-muted">(misma {d.via})</span>
                  </span>
                  {student.existingId === d.id ? (
                    <Button size="sm" variant="ghost" onClick={() => setStudent((s) => ({ ...s, existingId: null }))}>
                      Registrar como nuevo
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setStudent((s) => ({ ...s, existingId: d.id }))}>
                      Usar este alumno
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="ap__grid">
          <Field label="Nombres" required error={err('student.firstName')}>
            <Input value={student.firstName} onChange={setS('firstName')} maxLength={100} />
          </Field>
          <Field label="Apellidos" required error={err('student.lastName')}>
            <Input value={student.lastName} onChange={setS('lastName')} maxLength={100} />
          </Field>
          <Field label="Cédula / cédula escolar" error={err('student.nationalId')}>
            <Input value={student.nationalId} onChange={setS('nationalId')} maxLength={30} />
          </Field>
          <Field label="Fecha de nacimiento" error={err('student.birthDate')}>
            <Input type="date" value={student.birthDate} onChange={setS('birthDate')} />
          </Field>
        </div>
      </section>

      {/* ---- 2. Inscripción ---- */}
      <section className="ap__card">
        <header className="ap__head">
          <span className="ap__num">2</span>
          <h3>Inscripción · {draft.form.schoolPeriodName}</h3>
        </header>
        {draft.placement.requestedGrade && (
          <p className="ap__hint">
            La familia solicitó: <strong>{draft.placement.requestedGrade}</strong>
          </p>
        )}
        {current && (
          <p className="ap__hint">
            Ya cursa <strong>{current.grade_name} «{current.section_name}»</strong> este año escolar: se mantiene.
          </p>
        )}
        {!draft.placement.sections.length ? (
          <Alert variant="warning">El año escolar {draft.form.schoolPeriodName} no tiene secciones. Créalas en Académico → Secciones y docentes.</Alert>
        ) : (
          <div className="ap__grid">
            <Field label="Grado" required>
              <Select
                value={gradeId}
                disabled={Boolean(current)}
                onChange={(e) => {
                  setGradeId(e.target.value);
                  const firstFree = draft.placement.sections.find((s) => s.grade_id === e.target.value && s.enrolled_count < s.max_students);
                  setSectionId(firstFree?.id || '');
                }}
              >
                <option value="">Elige el grado…</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.level ? ` · ${g.level}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sección" required error={err('sectionId')}>
              <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!gradeId || Boolean(current)}>
                <option value="">Elige la sección…</option>
                {gradeSections.map((s) => {
                  const full = s.enrolled_count >= s.max_students && s.id !== current?.section_id;
                  return (
                    <option key={s.id} value={s.id} disabled={full}>
                      Sección {s.name} · {s.enrolled_count}/{s.max_students} alumnos{full ? ' (sin cupo)' : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          </div>
        )}
        {chosen && !current && <p className="ap__hint ap__hint--ok">Quedan {chosen.max_students - chosen.enrolled_count} cupo(s) en esta sección. Se generan sus mensualidades del año.</p>}
      </section>

      {/* ---- 3. Representantes ---- */}
      <section className="ap__card">
        <header className="ap__head">
          <span className="ap__num">3</span>
          <h3>Representante legal</h3>
          {legalIsNew ? <Badge variant="success">Nuevo · se registrará</Badge> : <Badge variant="info">Registrado · se asociará</Badge>}
          <span className="ap__primary">
            <Icon name="star" size={13} /> Principal
          </span>
        </header>
        {legalIsNew ? (
          <div className="ap__grid">
            <Field label="Nombres" required error={err('legal.firstName')}>
              <Input value={legal.firstName} onChange={setL('firstName')} maxLength={100} />
            </Field>
            <Field label="Apellidos" required error={err('legal.lastName')}>
              <Input value={legal.lastName} onChange={setL('lastName')} maxLength={100} />
            </Field>
            <Field label="Cédula" error={err('legal.nationalId')}>
              <Input value={legal.nationalId} onChange={setL('nationalId')} maxLength={30} />
            </Field>
            <Field label="Teléfono" error={err('legal.phone')}>
              <Input value={legal.phone} onChange={setL('phone')} maxLength={30} />
            </Field>
            <Field label="Correo" error={err('legal.email')} hint="El acceso al portal se crea luego desde Representantes.">
              <Input type="email" value={legal.email} onChange={setL('email')} maxLength={150} />
            </Field>
          </div>
        ) : (
          <div className="ap__match">
            <span className="avatar avatar--sm">{draft.legal.match.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div>
              <strong>{draft.legal.match.name}</strong>
              <span className="text-sm text-muted">
                {draft.legal.isSubmitter ? 'Es quien envió la planilla' : `Encontrado por ${draft.legal.match.via}`}
                {draft.legal.match.nationalId ? ` · ${draft.legal.match.nationalId}` : ''}
                {draft.legal.match.email ? ` · ${draft.legal.match.email}` : ''}
              </span>
            </div>
          </div>
        )}
        <div className="ap__grid">
          <Field label="Parentesco con el alumno" required error={err('legal.relationship')}>
            <Select value={legal.relationship} onChange={setL('relationship')}>
              {draft.relationships.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!draft.legal.isSubmitter && (
          <div className="ap__submitter">
            <div>
              <strong>{draft.submitter.name}</strong>
              <span className="text-sm text-muted">Envió la planilla · {draft.submitter.linked ? 'ya está vinculado' : 'quedará vinculado para ver al alumno en su portal'}</span>
            </div>
            <Select value={submitterRel} onChange={(e) => setSubmitterRel(e.target.value)} aria-label="Parentesco de quien envió la planilla">
              {draft.relationships.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
        )}
      </section>

      <Field label="Mensaje para el representante" hint="Opcional. Lo recibe junto con el aviso de aprobación.">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>

      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Volver a la planilla
        </Button>
        <Button icon="check" onClick={approve} loading={busy} loadingText="Inscribiendo…" disabled={draft.form.periodClosed || !draft.placement.sections.length}>
          Aprobar e inscribir
        </Button>
      </div>
    </div>
  );
}

export default ApprovalPanel;
