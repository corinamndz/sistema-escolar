import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { ReviewInbox, ReviewStatusBadge } from '../../reviews/components/ReviewWidgets';
import { DirectApproveButton, useCanDirectApprove } from '../../reviews/components/DirectApprove';
import ReviewDrawer from '../../reviews/components/ReviewDrawer';
import DataTable from '../../../components/ui/DataTable';
import Badge from '../../../components/ui/Badge';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useExpandedSet } from '../../../hooks/useExpandedSet';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LEVEL_CODES, LevelBadge, LevelRule } from '../../academics/levels';
import { FORMATS, FormatPicker } from '../components/DetailedPlanner';
import { TermSelect, termLabel } from '../terms';
import { canManagePeriods } from '../../../components/layout/navigation';
import DuplicateToYearModal from '../../../components/ui/DuplicateToYearModal';
import { useDefaultSchoolPeriod } from '../../../hooks/useDefaultSchoolPeriod';
import { currentPeriod } from '../../../lib/schoolPeriods';

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

/** Fechas "07/01 – 05/04" de un período, si están cargadas. */
const termRange = (t) => (t?.start_date && t?.end_date ? `${formatShort(t.start_date)} – ${formatShort(t.end_date)}` : null);
const formatShort = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Planes de evaluación del año escolar elegido, en dos niveles plegables:
 *   1. Materia (A-Z): docentes, períodos con plan, cerrados / listos para cerrar.
 *   2. Período (I, II, III) dentro de cada materia, con sus planes por sección.
 * Los períodos sin plan de la materia se ofrecen para crearlo en un clic, y las
 * fechas de los períodos se editan en la barra superior.
 */
function EvaluationPlansPage() {
  const { can, user } = useAuth();
  const canDirectApprove = useCanDirectApprove();
  const navigate = useNavigate();
  const { data: periods, loading: loadingPeriods } = useFetch(() => evaluationPlansApi.listPeriodOptions(), []);
  const { data: plans, setData: setPlans, loading: loadingPlans, error: plansError, refetch: refetchPlans } = useFetch(() => evaluationPlansApi.list(), []);
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const { data: terms } = useFetch(
    () => (schoolPeriodId ? evaluationPlansApi.listTerms(schoolPeriodId) : Promise.resolve([])),
    [schoolPeriodId]
  );

  const [query, setQuery] = useState('');
  const [createFor, setCreateFor] = useState(null); // { termNumber } | {} → modal de nuevo plan

  // Año por defecto: el año escolar en curso (regla común de los selectores de año).
  useDefaultSchoolPeriod(periods, schoolPeriodId, setSchoolPeriodId);

  const searchText = (p) => [p.subject, p.teacher_name, p.grade_name, p.section_names || p.section_name, p.term_name, termLabel(p.term_number)].join(' ');
  const yearPlans = useMemo(() => (plans || []).filter((p) => p.school_period_id === schoolPeriodId), [plans, schoolPeriodId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? yearPlans.filter((p) => searchText(p).toLowerCase().includes(q)) : yearPlans;
  }, [yearPlans, query]);

  /**
   * Jerarquía Materia → Período → planes. Las materias van de la A a la Z (el
   * backend ya entrega los planes en ese orden); dentro de cada materia, sus
   * períodos en orden (I, II, III, y "Otros" si hubiera alguno sin número).
   */
  const subjectGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach((p) => {
      const key = p.subject_key || `txt:${String(p.subject).trim().toLowerCase()}`;
      if (!map.has(key)) map.set(key, { key, name: p.subject_name || p.subject, code: p.subject_code, plans: [] });
      map.get(key).plans.push(p);
    });
    return [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
      .map((s) => {
        const termGroups = (terms || []).map((t) => ({
          key: t.id,
          number: t.term_number,
          label: t.name,
          term: t,
          plans: s.plans.filter((p) => p.term_id === t.id),
        }));
        const other = s.plans.filter((p) => !(terms || []).some((t) => t.id === p.term_id));
        if (other.length) termGroups.push({ key: NO_TERM, number: null, label: 'Otros períodos', term: null, plans: other });
        return {
          ...s,
          termGroups: termGroups.filter((t) => t.plans.length),
          missingTerms: termGroups.filter((t) => t.number && !t.plans.length),
          teachers: [...new Set(s.plans.map((p) => p.teacher_name))].sort((a, b) => a.localeCompare(b, 'es')),
          closed: s.plans.filter((p) => p.status === 'closed').length,
          ready: s.plans.filter((p) => p.status !== 'closed' && Number(p.total_weight) === 100).length,
        };
      });
  }, [filtered, terms]);

  // Acordeones: materias (clave de la materia) y períodos dentro (materia|período).
  // CERRADOS por defecto: se abre solo lo que se quiere consultar. Al buscar se
  // abre todo para ver los resultados.
  const subjectsOpen = useExpandedSet();
  const termsOpen = useExpandedSet();
  const toggle = subjectsOpen.toggle;
  const toggleTerm = termsOpen.toggle;

  // Dentro de una materia la columna "Asignatura" sobra: se muestra sección y docente.
  const planColumns = [
    {
      key: 'section_name',
      header: 'Grado y sección',
      render: (p) => (
        <div>
          <Link to={`/evaluation-plans/${p.id}`} className="cell-person__name">
            {p.grade_name} · {p.section_names && p.section_names.includes(',') ? `Secciones ${p.section_names}` : `Sección ${p.section_names || p.section_name}`}
          </Link>
          <div className="cell-person__sub">
            <LevelBadge code={p.level_code} />
          </div>
        </div>
      ),
      sortValue: (p) => `${p.grade_name} ${p.section_name}`,
    },
    {
      key: 'teacher_name',
      header: 'Docente',
      render: (p) => (
        <div>
          <div>{p.teacher_name}</div>
          <div className="cell-person__sub">{p.format === 'detailed' ? FORMATS.detailed.label : FORMATS.simple.label}</div>
        </div>
      ),
      sortValue: (p) => p.teacher_name,
    },
    { key: 'total_weight', header: 'Ponderación', render: (p) => <PlanWeight plan={p} />, sortValue: (p) => Number(p.total_weight) },
    // Revisión y aprobación (coordinación del nivel o dirección).
    {
      key: 'review_status',
      header: 'Revisión',
      // Administrador / Coordinador del nivel: «Aprobar» directo (plan al 100 %, sin envío a revisión).
      render: (p) => (
        <div className="review-cell">
          <ReviewStatusBadge status={p.review_status} />
          {p.review_status !== 'aprobado' && canDirectApprove(p.level_code) && Math.abs(Number(p.total_weight) - 100) < 0.01 && (
            <DirectApproveButton target={{ planId: p.id }} what="plan" status={p.review_status} onApproved={refetchPlans} />
          )}
        </div>
      ),
      sortValue: (p) => ['observado', 'en_revision', 'borrador', 'aprobado'].indexOf(p.review_status) },
  ];
  const [reviewing, setReviewing] = useState(null);
  const [duplicating, setDuplicating] = useState(null);
  const rowActions = [
    { key: 'review', icon: 'inbox', label: 'Revisión y comentarios', tone: 'view', onClick: (p) => setReviewing(p) },
    { key: 'activities', icon: 'clipboard', label: 'Gestionar actividades y porcentajes', tone: 'edit', onClick: (p) => navigate(`/evaluation-plans/${p.id}`) },
    ...(can('grading', 'read') ? [{ key: 'grades', icon: 'graduation', label: 'Ver calificaciones', tone: 'view', onClick: (p) => navigate(`/grading/plans/${p.id}`) }] : []),
    ...(can('evaluation_plans', 'create') ? [{ key: 'duplicate', icon: 'copy', label: 'Duplicar a otro año', tone: 'view', onClick: (p) => setDuplicating(p) }] : []),
  ];
  const canCreate = can('evaluation_plans', 'create');

  return (
    <div>
      <PageHeader title="Planes de evaluación" subtitle="Organizados por materia y, dentro de cada una, por período académico" />
      {/* Coordinador / Director: planes que esperan su revisión. */}
      <ReviewInbox type="plan" onChanged={refetchPlans} />
      {duplicating && (
        <DuplicateToYearModal
          title="Duplicar plan de evaluación"
          subject={`${duplicating.subject_name || duplicating.subject} · ${duplicating.grade_name} ${duplicating.section_names || duplicating.section_name || ''} · ${termLabel(duplicating.term_number, duplicating.term_name)}`}
          fromPeriodId={duplicating.school_period_id}
          periods={periods || []}
          items={['Actividades con sus porcentajes, criterios e indicadores', 'Fechas corridas al período equivalente', 'Proyecto pedagógico y temas evaluados']}
          note="Va al mismo grado, secciones (por nombre) y período del otro año, a nombre del docente que dicta la materia allí. Las notas no se copian."
          onConfirm={(toPeriodId) => evaluationPlansApi.duplicate(duplicating.id, toPeriodId)}
          renderResult={(r) => (
            <>
              Plan creado en {r.period} · {r.term_name} · sección {r.sections.join(', ')}
              {r.teacher_name ? ` · ${r.teacher_name}` : ''}. {r.activities} {r.activities === 1 ? 'actividad' : 'actividades'}.
              {r.missing_sections.length > 0 && ` Sin equivalente en ${r.period}: sección ${r.missing_sections.join(', ')}.`}
            </>
          )}
          goLabel="Abrir el plan nuevo"
          onGo={(r) => navigate(`/evaluation-plans/${r.plan_id}`)}
          onClose={() => {
            setDuplicating(null);
            refetchPlans();
          }}
        />
      )}
      {reviewing && (
        <ReviewDrawer
          target={{ planId: reviewing.id }}
          title={`${reviewing.subject_name} · ${reviewing.grade_name}`}
          onClose={() => setReviewing(null)}
          onChanged={refetchPlans}
        />
      )}

      <div className="card data-table student-groups__toolbar">
        <div className="data-table__header">
          <div>
            <h3 className="card__title">
              Planes por materia
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
            <Button
              variant="ghost"
              size="sm"
              icon="chevronDown"
              onClick={() => {
                subjectsOpen.expandAll(subjectGroups.map((g) => g.key));
                termsOpen.expandAll(subjectGroups.flatMap((g) => g.termGroups.map((t) => `${g.key}|${t.key}`)));
              }}
              disabled={Boolean(query)}
            >
              Expandir todo
            </Button>
            <Button variant="ghost" size="sm" icon="chevronRight" onClick={() => {
                subjectsOpen.collapseAll();
                termsOpen.collapseAll();
              }} disabled={Boolean(query)}>
              Contraer todo
            </Button>
          </div>
        </div>
        <Alert>{plansError}</Alert>

        {/* Períodos del año con sus fechas (antes eran los grupos principales). */}
        <div className="term-bar" aria-label="Períodos del año escolar">
          {(terms || []).map((term) => (
            <span key={term.id} className="term-bar__item">
              <strong>{term.name}</strong>
              <span className="text-sm text-muted">{termRange(term) || 'Sin fechas'}</span>
            </span>
          ))}
          {canManagePeriods(user) && (
            <Link to="/tenant/settings?tab=periodos" className="link-button term-bar__edit">
              <Icon name="calendar" size={13} /> Configurar períodos
            </Link>
          )}
        </div>
      </div>

      {loadingPlans ? (
        <Spinner />
      ) : !query && subjectGroups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="clipboard" size={24} />
          </div>
          <div className="empty-state__title">Aún no hay planes en este año escolar</div>
          <div className="text-sm">Crea el primero: elige la sección, la materia y el período.</div>
          {canCreate && (
            <Button icon="plus" onClick={() => setCreateFor({})} style={{ marginTop: 12 }}>
              Nuevo plan
            </Button>
          )}
        </div>
      ) : query && subjectGroups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="search" size={24} />
          </div>
          <div className="empty-state__title">Sin resultados</div>
          <div className="text-sm">Ningún plan coincide con “{query}”.</div>
        </div>
      ) : (
        <div className="student-groups">
          {subjectGroups.map((s) => {
            const open = Boolean(query) || subjectsOpen.isOpen(s.key);
            const bodyId = `subject-group-${s.key.replace(/[^a-z0-9-]/gi, '-')}`;
            return (
              <section key={s.key} className={`student-group subject-group ${open ? 'is-open' : ''}`}>
                {/* Nivel 1: la materia */}
                <div className="student-group__header">
                  <button type="button" className="student-group__toggle" onClick={() => toggle(s.key)} aria-expanded={open} aria-controls={bodyId} disabled={Boolean(query)}>
                    <Icon name="chevronDown" size={16} className="student-group__chevron" />
                    <span className="student-group__title">{s.name}</span>
                    {s.code && <span className="chip">{s.code}</span>}
                    <span className="student-group__meta">
                      {s.teachers.length ? `Prof. ${s.teachers.join(', ')}` : ''}
                      {` · ${s.termGroups.map((t) => t.label).join(', ')}`}
                      {s.closed > 0 && ` · ${s.closed} cerrado${s.closed === 1 ? '' : 's'}`}
                      {s.ready > 0 && ` · ${s.ready} listo${s.ready === 1 ? '' : 's'} para cerrar`}
                    </span>
                  </button>
                  <div className="student-group__side">
                    <span className="student-group__count">
                      {s.plans.length} plan{s.plans.length === 1 ? '' : 'es'}
                    </span>
                  </div>
                </div>

                {open && (
                  <div id={bodyId} className="student-group__body subject-group__body">
                    {/* Nivel 2: los períodos de la materia */}
                    {s.termGroups.map((t) => {
                      const termKey = `${s.key}|${t.key}`;
                      const termOpen = Boolean(query) || termsOpen.isOpen(termKey);
                      const termBodyId = `${bodyId}-${t.key}`;
                      const closed = t.plans.filter((p) => p.status === 'closed').length;
                      return (
                        <div key={t.key} className={`term-subgroup ${termOpen ? 'is-open' : ''}`}>
                          <div className="term-subgroup__header">
                            <button
                              type="button"
                              className="term-subgroup__toggle"
                              onClick={() => toggleTerm(termKey)}
                              aria-expanded={termOpen}
                              aria-controls={termBodyId}
                              disabled={Boolean(query)}
                            >
                              <Icon name="chevronDown" size={16} className="term-subgroup__chevron" />
                              <span className="term-subgroup__title">{t.label}</span>
                              <span className="term-subgroup__meta">
                                {termRange(t.term) || 'Sin fechas'} · {t.plans.length} plan{t.plans.length === 1 ? '' : 'es'}
                                {closed > 0 && ` · ${closed} cerrado${closed === 1 ? '' : 's'}`}
                              </span>
                            </button>
                            {canCreate && t.number && (
                              <Button size="sm" variant="ghost" icon="plus" onClick={() => setCreateFor({ termNumber: t.number })}>
                                Plan
                              </Button>
                            )}
                          </div>
                          {termOpen && (
                            <div id={termBodyId} className="term-subgroup__body">
                              <DataTable
                                bare
                                searchable={false}
                                paginated={false}
                                columns={planColumns}
                                rows={t.plans}
                                rowActions={rowActions}
                                onDelete={(p) => evaluationPlansApi.remove(p.id)}
                                canDelete={can('evaluation_plans', 'delete')}
                                deleteConfirm={(p) => ({
                                  title: '¿Eliminar este plan de evaluación?',
                                  message: `${p.subject_name || p.subject} · ${p.grade_name} ${p.section_names || p.section_name || ''} · ${termLabel(p.term_number, p.term_name)}. Esta acción no se puede deshacer${
                                    p.activity_count > 0
                                      ? ` y borrará ${p.activity_count === 1 ? 'su actividad' : `sus ${p.activity_count} actividades`} con sus criterios y fechas`
                                      : ''
                                  }. Si ya tiene notas de alumnos o constancias de lectura de las familias, no se podrá eliminar.`,
                                  confirmLabel: 'Sí, eliminar',
                                  successMessage: 'Plan de evaluación eliminado',
                                })}
                                // Se quita de la tabla al instante (sin recargar) y luego se sincroniza.
                                onDeleted={(p) => {
                                  setPlans((list) => (list || []).filter((x) => x.id !== p.id));
                                  refetchPlans();
                                }}
                                emptyMessage="Sin planes."
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!query && s.missingTerms.length > 0 && (
                      <div className="subject-group__missing">
                        <span className="text-sm text-muted">Sin plan en: {s.missingTerms.map((t) => t.label).join(', ')}</span>
                        {canCreate &&
                          s.missingTerms.map((t) => (
                            <Button key={t.key} size="sm" variant="ghost" icon="plus" onClick={() => setCreateFor({ termNumber: t.number })}>
                              {t.label}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}


      {createFor && (
        // Los planes nuevos son del año escolar en curso (no del siguiente ya preparado).
        <CreatePlanModal initialTermNumber={createFor.termNumber} schoolPeriod={currentPeriod(periods)} onClose={() => setCreateFor(null)} onCreated={refetchPlans} />
      )}
    </div>
  );
}

/**
 * El formulario se adapta al nivel de la sección elegida, pero la materia
 * SIEMPRE se elige de una lista desplegable:
 *  - Grado con materias marcadas (cualquier nivel): las materias del grado; el
 *    docente se completa solo (profesor de la materia, especialista o titular).
 *    Las que no tienen docente aparecen deshabilitadas, con el motivo.
 *  - Inicial / Primaria sin materias marcadas en el grado: se elige el docente
 *    de aula y el área del catálogo de materias activas del colegio.
 */
/**
 * `schoolPeriod`: el año escolar en curso. Solo se listan SUS secciones: los
 * planes de otro año se arman con "Duplicar a otro año" desde un plan existente.
 */
function CreatePlanModal({ initialTermNumber, schoolPeriod, onClose, onCreated }) {
  const { data: sections, loading: loadingSections } = useFetch(() => evaluationPlansApi.listSectionOptions(schoolPeriod?.id), [schoolPeriod?.id]);
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

  // Materias del grado: en Secundaria siempre; en Inicial/Primaria cuando el grado ya tiene materias marcadas.
  const curriculumSize = assignment ? (assignment.curriculum_size ?? assignment.subjects?.length ?? 0) : 0;
  const primaryCurriculum = assignment?.mode === 'homeroom' && curriculumSize > 0;
  const bySubjects = assignment?.mode === 'subjects' || primaryCurriculum;
  // effectiveTeacher: el profesor de la materia, o en Inicial/Primaria el titular si no hay especialista.
  const gradeSubjects = bySubjects ? assignment.subjects || [] : [];
  const assignedSubjects = gradeSubjects.filter((s) => s.effectiveTeacher);
  // Sin materias marcadas en el grado (Inicial/Primaria): el área se elige del catálogo.
  const catalog = assignment?.catalog || [];
  const homeroomTeachers = assignment?.mode === 'homeroom'
    ? [
        assignment.homeroom.lead && { ...assignment.homeroom.lead, role: 'Titular' },
        assignment.homeroom.assistant && { ...assignment.homeroom.assistant, role: 'Auxiliar' },
      ].filter(Boolean)
    : [];
  const selectedSubject = assignedSubjects.find((s) => s.id === form.subjectId);

  // Sin docente/materia asignada no se puede crear el plan: se explica en vez de mostrar un selector vacío.
  let blocker = null;
  if (assignment && assignment.mode === 'subjects' && curriculumSize === 0) {
    blocker = 'El grado aún no tiene materias: márcalas en Estructura académica → Materias (campo «Grados donde se dicta»).';
  } else if (assignment && bySubjects && assignedSubjects.length === 0) {
    blocker = primaryCurriculum
      ? 'Esta sección no tiene docente titular. Asígnalo en Estructura académica → Secciones.'
      : 'Ninguna materia de esta sección tiene profesor asignado. Asígnalos en Estructura académica → Secciones (o desde Horarios).';
  } else if (assignment && !bySubjects && homeroomTeachers.length === 0) {
    blocker = 'Esta sección no tiene docente asignado. Asígnalo en Estructura académica → Secciones.';
  } else if (assignment && !bySubjects && catalog.length === 0) {
    blocker = 'Aún no hay materias en el catálogo: créalas en Estructura académica → Materias.';
  }

  const changeSection = (e) => {
    setSectionId(e.target.value);
    setExtraSections([]);
    // El período elegido se conserva al cambiar de sección.
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
    <Drawer title="Nuevo plan de evaluación" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingSections ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Tipo de formato" full>
              <FormatPicker value={format} onChange={setFormat} />
            </Field>
            <Field
              label="Sección"
              error={fieldErrors.sectionId}
              full
              required
              hint={schoolPeriod ? `Secciones del año escolar en curso (${schoolPeriod.name}).` : undefined}
            >
              <Select sorted value={sectionId} onChange={changeSection} required>
                <option value="">Selecciona…</option>
                {LEVEL_CODES.map((code) => {
                  const list = sections.filter((s) => s.level_code === code);
                  return list.length ? (
                    <optgroup key={code} label={LEVELS[code].name}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.grade_name} · {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </Select>
            </Field>

            <Field
              label="Período académico"
              error={fieldErrors.termNumber || fieldErrors.termId}
              full
              required
              hint="Todas las actividades de este plan se califican en el período elegido. Para otro período, crea otro plan de la misma materia."
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
                      hint={
                        gradeSubjects.length > assignedSubjects.length
                          ? 'Materias del grado. Las deshabilitadas aún no tienen docente asignado en esta sección.'
                          : 'Materias del plan de estudios del grado.'
                      }
                    >
                      <Select sorted value={form.subjectId} onChange={set('subjectId')} required>
                        <option value="">Selecciona…</option>
                        {gradeSubjects.map((s) => (
                          <option key={s.id} value={s.id} disabled={!s.effectiveTeacher}>
                            {s.name}
                            {s.effectiveTeacher ? '' : ' — sin docente asignado'}
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
                    <Field
                      label="Área / asignatura"
                      error={fieldErrors.subject}
                      full
                      required
                      hint="Materias activas del colegio. Para que aquí aparezcan solo las del grado, márcalas en Materias → «Grados donde se dicta»."
                    >
                      <Select sorted value={form.subject} onChange={set('subject')} required>
                        <option value="">Selecciona…</option>
                        {catalog.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                            {c.code ? ` (${c.code})` : ''}
                          </option>
                        ))}
                      </Select>
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
    </Drawer>
  );
}

export default EvaluationPlansPage;
