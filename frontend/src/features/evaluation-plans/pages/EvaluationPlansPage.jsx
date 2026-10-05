import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import DataTable from '../../../components/ui/DataTable';
import Badge from '../../../components/ui/Badge';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LEVEL_CODES, LevelBadge, LevelRule } from '../../academics/levels';
import { FORMATS, FormatPicker } from '../components/DetailedPlanner';

/** Estado del plan según su ponderación: cerrado, listo para cerrar, incompleto o sin actividades. */
export function planState(plan) {
  if (plan.status === 'closed') return { label: 'Cerrado', variant: 'success' };
  if (!plan.activity_count) return { label: 'Sin actividades', variant: 'neutral' };
  if (plan.total_weight === 100) return { label: 'Listo para cerrar', variant: 'info' };
  return { label: 'Incompleto', variant: 'warning' };
}

function PlanWeight({ plan }) {
  const state = planState(plan);
  const total = Number(plan.total_weight) || 0;
  return (
    <div className="plan-weight">
      <div className="plan-weight__head">
        <strong>{total}%</strong>
        <span className="text-muted">/ 100%</span>
        <Badge variant={state.variant}>{state.label}</Badge>
      </div>
      <div className={`progress-bar ${total === 100 ? 'progress-meter--complete' : ''}`}>
        <div className="progress-bar__fill" style={{ width: `${Math.min(100, total)}%` }} />
      </div>
      <span className="cell-person__sub">
        {plan.activity_count} actividad{plan.activity_count === 1 ? '' : 'es'}
      </span>
    </div>
  );
}

function EvaluationPlansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: periods, loading: loadingPeriods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [schoolPeriodId, setSchoolPeriodId] = useState('');

  const { data: terms, loading: loadingTerms, refetch: refetchTerms } = useFetch(
    () => (schoolPeriodId ? evaluationPlansApi.listTerms(schoolPeriodId) : Promise.resolve([])),
    [schoolPeriodId]
  );
  const { data: plans, loading: loadingPlans, refetch: refetchPlans } = useFetch(() => evaluationPlansApi.list(), []);

  const [showCreateTerm, setShowCreateTerm] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);

  const planColumns = [
    {
      key: 'subject',
      header: 'Asignatura',
      render: (p) => (
        <div>
          <Link to={`/evaluation-plans/${p.id}`} className="cell-person__name">
            {p.subject}
          </Link>
          <div className="cell-person__sub">
            {p.teacher_name}
            {p.format === 'detailed' && <> · {FORMATS.detailed.label}</>}
          </div>
        </div>
      ),
      sortValue: (p) => p.subject,
    },
    {
      key: 'section_name',
      header: 'Sección',
      render: (p) => (
        <div>
          <div>
            {p.grade_name} · {p.section_names && p.section_names.includes(',') ? `Secciones ${p.section_names}` : p.section_names || p.section_name}
          </div>
          <LevelBadge code={p.level_code} />
        </div>
      ),
      sortValue: (p) => `${p.grade_name} ${p.section_name}`,
    },
    { key: 'term_name', header: 'Lapso' },
    { key: 'total_weight', header: 'Ponderación', render: (p) => <PlanWeight plan={p} />, sortValue: (p) => Number(p.total_weight) },
  ];

  return (
    <div>
      <PageHeader title="Planes de evaluación" subtitle="Lapsos, planes y actividades por sección" />

      <div>
        <Card
          title="Lapsos"
          actions={
            <RequirePermission module="evaluation_plans" action="create">
              <Button size="sm" onClick={() => setShowCreateTerm(true)} disabled={!schoolPeriodId}>
                + Nuevo lapso
              </Button>
            </RequirePermission>
          }
        >
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>Año escolar</label>
            <Select value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)} disabled={loadingPeriods}>
              <option value="">Selecciona un año escolar…</option>
              {periods?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          {schoolPeriodId ? (
            loadingTerms ? <Spinner /> : (
              <ul style={{ paddingLeft: 18 }}>
                {(terms || []).map((t) => (
                  <li key={t.id}>{t.name}</li>
                ))}
                {terms?.length === 0 && <p className="text-muted">Sin lapsos para este año escolar.</p>}
              </ul>
            )
          ) : (
            <p className="text-muted">Elige un año escolar para ver o crear sus lapsos.</p>
          )}
        </Card>

      </div>

      <div style={{ marginTop: 20 }}>
        <DataTable
          title="Planes de evaluación"
          description="Abre un plan para cargar sus actividades y porcentajes. Debe sumar exactamente 100% para poder cerrarlo."
          columns={planColumns}
          rows={plans}
          loading={loadingPlans}
          searchPlaceholder="Buscar asignatura, docente, sección o lapso…"
          getSearchText={(p) => [p.subject, p.teacher_name, p.grade_name, p.section_names || p.section_name, p.term_name].join(' ')}
          emptyMessage="Aún no hay planes de evaluación."
          createLabel="Nuevo plan"
          onCreate={() => setShowCreatePlan(true)}
          canCreate={can('evaluation_plans', 'create')}
          rowActions={[
            {
              key: 'activities',
              icon: 'clipboard',
              label: 'Gestionar actividades y porcentajes',
              tone: 'edit',
              onClick: (p) => navigate(`/evaluation-plans/${p.id}`),
            },
            { key: 'grades', icon: 'graduation', label: 'Ver calificaciones', tone: 'view', onClick: (p) => navigate(`/grading/plans/${p.id}`) },
          ]}
        />
      </div>

      {showCreateTerm && (
        <CreateTermModal
          schoolPeriodId={schoolPeriodId}
          onClose={() => setShowCreateTerm(false)}
          onCreated={refetchTerms}
        />
      )}

      {showCreatePlan && (
        <CreatePlanModal onClose={() => setShowCreatePlan(false)} onCreated={refetchPlans} />
      )}
    </div>
  );
}

function CreateTermModal({ schoolPeriodId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const { run, loading, error, fieldErrors } = useMutation(evaluationPlansApi.createTerm);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ schoolPeriodId, ...form });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Nuevo lapso" onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Nombre" error={fieldErrors.name}>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Lapso 1" required />
        </Field>
        <div style={{ height: 12 }} />
        <div className="form-grid">
          <Field label="Fecha de inicio">
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Fecha de fin">
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * El formulario se adapta al nivel de la sección elegida:
 *  - Secundaria: se elige una materia con profesor asignado; el docente se completa solo.
 *  - Inicial / Primaria: se elige entre los docentes de la sección y el área es texto libre.
 */
function CreatePlanModal({ onClose, onCreated }) {
  const { data: sections, loading: loadingSections } = useFetch(() => academicsApi.listSections(), []);
  const [sectionId, setSectionId] = useState('');
  const section = sections?.find((s) => s.id === sectionId);
  const { data: terms, loading: loadingTerms } = useFetch(
    () => (section ? evaluationPlansApi.listTerms(section.school_period_id) : Promise.resolve([])),
    [sectionId, sections]
  );
  const { data: assignment, loading: loadingAssignment } = useFetch(
    () => (sectionId ? academicsApi.getSectionTeachers(sectionId) : Promise.resolve(null)),
    [sectionId]
  );

  const [form, setForm] = useState({ termId: '', teacherId: '', subject: '', subjectId: '' });
  const [format, setFormat] = useState('simple');
  // Otras secciones del mismo grado y año a las que también se aplica el plan.
  const [extraSections, setExtraSections] = useState([]);
  const siblings = section ? sections.filter((s) => s.id !== section.id && s.grade_id === section.grade_id && s.school_period_id === section.school_period_id) : [];
  const { run, loading, error, fieldErrors } = useMutation(evaluationPlansApi.create);
  const toast = useToast();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Secundaria siempre; Primaria cuando su grado ya tiene plan de estudios.
  const primaryCurriculum = assignment?.mode === 'homeroom' && assignment.subjects?.length > 0;
  const bySubjects = assignment?.mode === 'subjects' || primaryCurriculum;
  // effectiveTeacher: el profesor de la materia, o en Primaria el titular si no hay especialista.
  const assignedSubjects = bySubjects ? assignment.subjects.filter((s) => s.effectiveTeacher) : [];
  const homeroomTeachers = assignment?.mode === 'homeroom'
    ? [
        assignment.homeroom.lead && { ...assignment.homeroom.lead, role: 'Titular' },
        assignment.homeroom.assistant && { ...assignment.homeroom.assistant, role: 'Auxiliar' },
      ].filter(Boolean)
    : [];
  const selectedSubject = assignedSubjects.find((s) => s.id === form.subjectId);

  // Sin docente/materia asignada no se puede crear el plan: se explica en vez de mostrar un selector vacío.
  let blocker = null;
  if (assignment && bySubjects && assignedSubjects.length === 0) {
    blocker = primaryCurriculum
      ? 'Esta sección no tiene docente titular. Asígnalo en Estructura académica → Secciones.'
      : 'Ninguna materia de esta sección tiene profesor asignado. Asígnalos en Estructura académica → Secciones.';
  } else if (assignment && !bySubjects && homeroomTeachers.length === 0) {
    blocker = 'Esta sección no tiene docente asignado. Asígnalo en Estructura académica → Secciones.';
  }

  const changeSection = (e) => {
    setSectionId(e.target.value);
    setExtraSections([]);
    setForm({ termId: '', teacherId: '', subject: '', subjectId: '' });
  };

  // Primaria con un único docente: se preselecciona.
  if (!bySubjects && homeroomTeachers.length === 1 && !form.teacherId) {
    setForm((f) => ({ ...f, teacherId: homeroomTeachers[0].id }));
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const common = { sectionIds: [sectionId, ...extraSections], termId: form.termId, format };
    const body = bySubjects
      ? { ...common, subjectId: form.subjectId }
      : { ...common, teacherId: form.teacherId, subject: form.subject };
    try {
      const plan = await run(body);
      toast.success('Plan de evaluación creado', `${plan.subject} · ${section.grade_name} ${section.name}`);
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Nuevo plan de evaluación" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingSections ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Tipo de formato" full>
              <FormatPicker value={format} onChange={setFormat} />
            </Field>
            <Field label="Sección" error={fieldErrors.sectionId} full required>
              <Select value={sectionId} onChange={changeSection} required>
                <option value="">Selecciona…</option>
                {LEVEL_CODES.map((code) => {
                  const list = sections.filter((s) => s.level_code === code);
                  return list.length ? (
                    <optgroup key={code} label={LEVELS[code].name}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.grade_name} · {s.name} ({s.school_period_name})
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </Select>
            </Field>

            {siblings.length > 0 && (
              <Field
                label="Aplicar también a"
                error={fieldErrors.sectionIds}
                full
                hint="El plan se redacta una vez para todas; cada sección tendrá su fecha de aplicación y sus notas. El docente debe ser el mismo."
              >
                <div className="chip-list">
                  {siblings.map((s) => (
                    <label key={s.id} className={`chip-toggle ${extraSections.includes(s.id) ? 'is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={extraSections.includes(s.id)}
                        onChange={(e) =>
                          setExtraSections((list) => (e.target.checked ? [...list, s.id] : list.filter((x) => x !== s.id)))
                        }
                      />
                      Sección {s.name}
                    </label>
                  ))}
                </div>
              </Field>
            )}

            {sectionId && loadingAssignment && (
              <div className="form-field--full">
                <Spinner label="Cargando docentes de la sección…" />
              </div>
            )}

            {assignment && (
              <div className="form-field--full">
                <LevelRule code={section.level_code} />
              </div>
            )}

            {blocker && (
              <div className="form-field--full">
                <Alert variant="warning">{blocker}</Alert>
              </div>
            )}

            {assignment && !blocker && (
              <>
                <Field label="Lapso" error={fieldErrors.termId} required>
                  <Select value={form.termId} onChange={set('termId')} disabled={loadingTerms} required>
                    <option value="">{terms?.length === 0 ? 'Sin lapsos en este año escolar' : 'Selecciona…'}</option>
                    {(terms || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                {bySubjects ? (
                  <>
                    <Field
                      label="Materia"
                      error={fieldErrors.subjectId}
                      required
                      hint={primaryCurriculum ? 'Materias del plan de estudios del grado.' : 'Solo materias con profesor asignado en esta sección.'}
                    >
                      <Select value={form.subjectId} onChange={set('subjectId')} required>
                        <option value="">Selecciona…</option>
                        {assignedSubjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label={primaryCurriculum ? 'Docente' : 'Profesor'}
                      full
                      hint={
                        primaryCurriculum
                          ? 'El especialista de la materia o, si no tiene, el titular de la sección.'
                          : 'Se toma de la asignación docente de la materia.'
                      }
                    >
                      <Input icon="user" value={selectedSubject?.effectiveTeacher.name || ''} placeholder="Elige una materia" disabled readOnly />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Docente" error={fieldErrors.teacherId} required>
                      <Select value={form.teacherId} onChange={set('teacherId')} required>
                        <option value="">Selecciona…</option>
                        {homeroomTeachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.role})
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Área / asignatura" error={fieldErrors.subject} full required>
                      <Input value={form.subject} onChange={set('subject')} placeholder="Lenguaje y comunicación" required />
                    </Field>
                  </>
                )}
              </>
            )}
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!assignment || Boolean(blocker)}>
              Crear plan
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default EvaluationPlansPage;
