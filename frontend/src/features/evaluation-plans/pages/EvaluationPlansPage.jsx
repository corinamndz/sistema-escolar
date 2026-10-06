import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import DataTable from '../../../components/ui/DataTable';
import Badge from '../../../components/ui/Badge';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LEVEL_CODES, LevelBadge, LevelRule } from '../../academics/levels';
import { FORMATS, FormatPicker } from '../components/DetailedPlanner';
import { TERM_OPTIONS, TermSelect, termLabel } from '../terms';

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

const NO_TERM = 'none';

/** Fechas "07/01 – 05/04" de un lapso, si están cargadas. */
const termRange = (t) => (t?.start_date && t?.end_date ? `${formatShort(t.start_date)} – ${formatShort(t.end_date)}` : null);
const formatShort = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Planes de evaluación agrupados por lapso académico (Lapso I, II, III) del
 * año escolar elegido. Cada bloque se puede contraer y muestra cuántos planes
 * tiene y cuántos están cerrados o listos para cerrar.
 */
function EvaluationPlansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: periods, loading: loadingPeriods } = useFetch(() => evaluationPlansApi.listPeriodOptions(), []);
  const { data: plans, loading: loadingPlans, error: plansError, refetch: refetchPlans } = useFetch(() => evaluationPlansApi.list(), []);
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const { data: terms, refetch: refetchTerms } = useFetch(
    () => (schoolPeriodId ? evaluationPlansApi.listTerms(schoolPeriodId) : Promise.resolve([])),
    [schoolPeriodId]
  );

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [editingTerm, setEditingTerm] = useState(null); // lapso cuyas fechas se editan
  const [createFor, setCreateFor] = useState(null); // { termNumber } | {} → modal de nuevo plan

  // Año por defecto: el más reciente que tenga planes (o el más reciente).
  useEffect(() => {
    if (schoolPeriodId || !periods?.length || !plans) return;
    const sorted = [...periods].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    const withPlans = sorted.find((p) => plans.some((pl) => pl.school_period_id === p.id));
    setSchoolPeriodId((withPlans || sorted[0]).id);
  }, [periods, plans, schoolPeriodId]);

  const searchText = (p) => [p.subject, p.teacher_name, p.grade_name, p.section_names || p.section_name, p.term_name, termLabel(p.term_number)].join(' ');
  const yearPlans = useMemo(() => (plans || []).filter((p) => p.school_period_id === schoolPeriodId), [plans, schoolPeriodId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? yearPlans.filter((p) => searchText(p).toLowerCase().includes(q)) : yearPlans;
  }, [yearPlans, query]);

  // Los 3 lapsos siempre (aunque estén vacíos, para poder crear planes en ellos);
  // un bloque extra si hubiera planes en un lapso sin número.
  const groups = useMemo(() => {
    const list = TERM_OPTIONS.map((t) => ({
      key: String(t.number),
      number: t.number,
      label: t.label,
      term: (terms || []).find((x) => Number(x.term_number) === t.number) || null,
      plans: filtered.filter((p) => Number(p.term_number) === t.number),
    }));
    const other = filtered.filter((p) => !TERM_OPTIONS.some((t) => t.number === Number(p.term_number)));
    if (other.length) list.push({ key: NO_TERM, number: null, label: 'Otros lapsos', term: null, plans: other });
    return query ? list.filter((g) => g.plans.length) : list;
  }, [filtered, terms, query]);

  const toggle = (key) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
    { key: 'total_weight', header: 'Ponderación', render: (p) => <PlanWeight plan={p} />, sortValue: (p) => Number(p.total_weight) },
  ];
  const rowActions = [
    { key: 'activities', icon: 'clipboard', label: 'Gestionar actividades y porcentajes', tone: 'edit', onClick: (p) => navigate(`/evaluation-plans/${p.id}`) },
    { key: 'grades', icon: 'graduation', label: 'Ver calificaciones', tone: 'view', onClick: (p) => navigate(`/grading/plans/${p.id}`) },
  ];
  const canCreate = can('evaluation_plans', 'create');

  return (
    <div>
      <PageHeader title="Planes de evaluación" subtitle="Planes y actividades de cada sección, organizados por lapso académico" />

      <div className="card data-table student-groups__toolbar">
        <div className="data-table__header">
          <div>
            <h3 className="card__title">
              Planes por lapso
              {!loadingPlans && <span className="data-table__count">{yearPlans.length}</span>}
            </h3>
            <p className="card__subtitle">Abre un plan para cargar sus actividades y porcentajes. Debe sumar exactamente 100% para poder cerrarlo.</p>
          </div>
          {canCreate && (
            <div className="data-table__header-actions">
              <Button icon="plus" onClick={() => setCreateFor({})}>
                Nuevo plan
              </Button>
            </div>
          )}
        </div>
        <div className="data-table__toolbar">
          <div className="input-group data-table__search">
            <Icon name="search" size={17} className="input-group__icon" />
            <input
              type="search"
              className="input"
              placeholder="Buscar asignatura, docente o sección…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar planes"
            />
            {query && (
              <button type="button" className="data-table__clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
          <div className="data-table__filters">
            <Select sorted value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)} disabled={loadingPeriods} aria-label="Año escolar">
              {(periods || []).map((p) => (
                <option key={p.id} value={p.id}>
                  Año {p.name}
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" icon="chevronDown" onClick={() => setCollapsed(new Set())} disabled={Boolean(query)}>
              Expandir todo
            </Button>
            <Button variant="ghost" size="sm" icon="chevronRight" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))} disabled={Boolean(query)}>
              Contraer todo
            </Button>
          </div>
        </div>
        <Alert>{plansError}</Alert>
      </div>

      {loadingPlans ? (
        <Spinner />
      ) : query && groups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="search" size={24} />
          </div>
          <div className="empty-state__title">Sin resultados</div>
          <div className="text-sm">Ningún plan coincide con “{query}”.</div>
        </div>
      ) : (
        <div className="student-groups">
          {groups.map((g) => {
            const open = Boolean(query) || !collapsed.has(g.key);
            const bodyId = `term-group-${g.key}`;
            const closed = g.plans.filter((p) => p.status === 'closed').length;
            const ready = g.plans.filter((p) => p.status !== 'closed' && Number(p.total_weight) === 100).length;
            const range = termRange(g.term);
            return (
              <section key={g.key} className={`student-group term-group ${open ? 'is-open' : ''} ${g.plans.length ? '' : 'student-group--none'}`}>
                <div className="student-group__header">
                  <button type="button" className="student-group__toggle" onClick={() => toggle(g.key)} aria-expanded={open} aria-controls={bodyId} disabled={Boolean(query)}>
                    <Icon name="chevronDown" size={18} className="student-group__chevron" />
                    <span className="student-group__title">{g.label}</span>
                    {g.term && g.term.name !== `Lapso ${g.number}` && <span className="text-sm text-muted">{g.term.name}</span>}
                    <span className="student-group__meta">
                      {range || 'Sin fechas registradas'}
                      {g.plans.length > 0 && ` · ${closed} cerrado${closed === 1 ? '' : 's'} · ${ready} listo${ready === 1 ? '' : 's'} para cerrar`}
                    </span>
                  </button>
                  <div className="student-group__side">
                    <span className="student-group__count">
                      {g.plans.length} plan{g.plans.length === 1 ? '' : 'es'}
                    </span>
                    {canCreate && g.term && (
                      <Button size="sm" variant="ghost" icon="calendar" onClick={() => setEditingTerm(g.term)} title={`Fechas del ${g.label}`}>
                        Fechas
                      </Button>
                    )}
                    {canCreate && g.number && (
                      <Button size="sm" variant="secondary" icon="plus" onClick={() => setCreateFor({ termNumber: g.number })}>
                        Plan
                      </Button>
                    )}
                  </div>
                </div>
                {open && (
                  <div id={bodyId} className="student-group__body">
                    {g.plans.length === 0 ? (
                      <p className="text-muted term-group__empty">Aún no hay planes en el {g.label}.</p>
                    ) : (
                      <DataTable bare searchable={false} paginated={false} columns={planColumns} rows={g.plans} rowActions={rowActions} emptyMessage="Sin planes." />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editingTerm && (
        <CreateTermModal
          schoolPeriodId={schoolPeriodId}
          initial={editingTerm}
          onClose={() => setEditingTerm(null)}
          onCreated={refetchTerms}
        />
      )}

      {createFor && (
        <CreatePlanModal initialTermNumber={createFor.termNumber} onClose={() => setCreateFor(null)} onCreated={refetchPlans} />
      )}
    </div>
  );
}

/** Fechas de un lapso del año (los 3 lapsos se crean con el año escolar). */
function CreateTermModal({ schoolPeriodId, initial, onClose, onCreated }) {
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const [form, setForm] = useState({
    name: initial?.name || '',
    startDate: day(initial?.start_date),
    endDate: day(initial?.end_date),
    termNumber: initial?.term_number || undefined,
  });
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
    <Modal title={initial ? `Fechas del ${termLabel(initial.term_number, initial.name)}` : 'Nuevo lapso'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Nombre" error={fieldErrors.name}>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Lapso 1" required disabled={Boolean(initial)} />
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
            {initial ? 'Guardar fechas' : 'Crear'}
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
function CreatePlanModal({ initialTermNumber, onClose, onCreated }) {
  const { data: sections, loading: loadingSections } = useFetch(() => evaluationPlansApi.listSectionOptions(), []);
  const [sectionId, setSectionId] = useState('');
  const section = sections?.find((s) => s.id === sectionId);
  const { data: terms, loading: loadingTerms } = useFetch(
    () => (section ? evaluationPlansApi.listTerms(section.school_period_id) : Promise.resolve([])),
    [sectionId, sections]
  );
  const { data: assignment, loading: loadingAssignment } = useFetch(
    () => (sectionId ? evaluationPlansApi.getSectionAssignment(sectionId) : Promise.resolve(null)),
    [sectionId]
  );

  const [form, setForm] = useState({ termNumber: initialTermNumber || '', teacherId: '', subject: '', subjectId: '' });
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
    // El lapso elegido se conserva al cambiar de sección.
    setForm((f) => ({ termNumber: f.termNumber, teacherId: '', subject: '', subjectId: '' }));
  };

  // Primaria con un único docente: se preselecciona.
  if (!bySubjects && homeroomTeachers.length === 1 && !form.teacherId) {
    setForm((f) => ({ ...f, teacherId: homeroomTeachers[0].id }));
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    const common = { sectionIds: [sectionId, ...extraSections], termNumber: Number(form.termNumber), format };
    const body = bySubjects
      ? { ...common, subjectId: form.subjectId }
      : { ...common, teacherId: form.teacherId, subject: form.subject };
    try {
      const plan = await run(body);
      toast.success('Plan de evaluación creado', `${plan.subject} · ${section.grade_name} ${section.name} · ${termLabel(form.termNumber)}`);
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
              <Select sorted value={sectionId} onChange={changeSection} required>
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

            <Field
              label="Lapso académico"
              error={fieldErrors.termNumber || fieldErrors.termId}
              full
              required
              hint="Todas las actividades de este plan se califican en el lapso elegido. Para otro lapso, crea otro plan de la misma materia."
            >
              <TermSelect value={form.termNumber} onChange={(termNumber) => setForm((f) => ({ ...f, termNumber }))} terms={terms} disabled={loadingTerms} required />
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
                {bySubjects ? (
                  <>
                    <Field
                      label="Materia"
                      error={fieldErrors.subjectId}
                      required
                      hint={primaryCurriculum ? 'Materias del plan de estudios del grado.' : 'Solo materias con profesor asignado en esta sección.'}
                    >
                      <Select sorted value={form.subjectId} onChange={set('subjectId')} required>
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
                      <Select sorted value={form.teacherId} onChange={set('teacherId')} required>
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
            <Button type="submit" loading={loading} disabled={!assignment || Boolean(blocker) || !form.termNumber}>
              Crear plan
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default EvaluationPlansPage;
