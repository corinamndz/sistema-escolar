import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import EvaluationRulesPanel from '../components/EvaluationRulesPanel';
import TermBreakdown, { termLabel, gradeClass } from '../components/TermBreakdown';

const ACTION_LABELS = { promote: 'Promover', retain: 'Repite', graduate: 'Egresa' };
const ACTION_VARIANT = { promote: 'success', retain: 'warning', graduate: 'primary' };
const STATUS_VARIANT = { promoted: 'success', retained: 'warning', graduated: 'primary' };
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: 2 }));

/** Destino por defecto de una fila: sección existente sugerida o "crear con el mismo nombre". */
function defaultTarget(s) {
  if (s.suggestion === 'graduate') return '';
  return s.suggested_section_id || `new:${s.section_name}`;
}

/**
 * Cierre de año escolar y promoción. Flujo:
 *   1. Elegir el año que finaliza y el año nuevo.
 *   2. Revisar cada alumno (promedio, materias reprobadas, sugerencia) y ajustar
 *      la acción y la sección destino.
 *   3. Procesar (por alumno, por selección o todos). Se puede deshacer mientras
 *      el alumno no tenga actividad en el año nuevo.
 *   4. Finalizar el año cuando no quede nadie cursando.
 * Nada se borra: la inscripción anterior queda cerrada con su resultado y su boleta.
 */
function PromotionPage() {
  const { can } = useAuth();
  const canEdit = can('academics', 'update');
  const canCreate = can('academics', 'create');
  const toast = useToast();
  const confirm = useConfirm();
  const { data: periods, refetch: refetchPeriods } = useFetch(() => academicsApi.listSchoolPeriods(), []);

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState({}); // enrollmentId → { selected, action, target, notes }
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [collapsed, setCollapsed] = useState(null); // Set de claves de grupo contraídas (null = aún sin decidir)

  const openPeriods = (periods || []).filter((p) => !p.closed_at);
  // Sugerencia inicial: el año que finaliza = el que empezó primero; el nuevo = el siguiente.
  useEffect(() => {
    if (!periods || fromId) return;
    const sorted = [...openPeriods].sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
    if (sorted.length >= 2) {
      setFromId(sorted[0].id);
      setToId(sorted[1].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods]);

  const load = async () => {
    if (!fromId || !toId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await academicsApi.promotionPreview({ fromPeriodId: fromId, toPeriodId: toId, gradeId: gradeId || undefined });
      setPreview(data);
      setRows(Object.fromEntries(data.students.map((s) => [s.enrollment_id, { selected: false, action: s.suggestion, target: defaultTarget(s), notes: '' }])));
    } catch (err) {
      setPreview(null);
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId, gradeId]);

  const students = preview?.students || [];
  const setRow = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const selectedIds = students.filter((s) => rows[s.enrollment_id]?.selected).map((s) => s.enrollment_id);

  /** Grado destino según la acción elegida. */
  const targetGradeOf = (s, action) => (action === 'promote' ? s.next_grade : action === 'retain' ? s.grade : null);

  const decisionFor = (s) => {
    const r = rows[s.enrollment_id];
    const d = { enrollmentId: s.enrollment_id, action: r.action, notes: r.notes || undefined };
    if (r.action === 'graduate') return d;
    if (r.target.startsWith('new:')) return { ...d, createSectionName: r.target.slice(4) };
    return { ...d, targetSectionId: r.target };
  };

  const execute = async (ids) => {
    const list = students.filter((s) => ids.includes(s.enrollment_id));
    const missing = list.filter((s) => rows[s.enrollment_id].action !== 'graduate' && !rows[s.enrollment_id].target);
    if (missing.length) {
      toast.error('Falta la sección destino', `${missing.length} alumno(s) sin sección en ${preview.to_period.name}.`);
      return;
    }
    const counts = list.reduce((acc, s) => ({ ...acc, [rows[s.enrollment_id].action]: (acc[rows[s.enrollment_id].action] || 0) + 1 }), {});
    const ok = await confirm({
      title: `¿Procesar ${list.length} alumno(s)?`,
      message: `${Object.entries(counts).map(([a, n]) => `${ACTION_LABELS[a]}: ${n}`).join(' · ')}. Su inscripción de ${preview.from_period.name} se cerrará con su boleta (no se borra nada) y se inscribirán en ${preview.to_period.name}. Podrás deshacerlo mientras no tengan notas ni pagos en el año nuevo.`,
      confirmLabel: 'Procesar',
    });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await academicsApi.executePromotion({ fromPeriodId: fromId, toPeriodId: toId, decisions: list.map(decisionFor) });
      setResults(res);
      if (res.summary.failed) toast.warning('Promoción con observaciones', res.message);
      else toast.success('Promoción realizada', res.message);
      await load();
    } catch (err) {
      toast.error('No se pudo procesar', getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const undo = async (p) => {
    const ok = await confirm({
      title: `¿Deshacer el resultado de ${p.student.first_name} ${p.student.last_name}?`,
      message: 'Vuelve a quedar cursando el año que finaliza y se quita su inscripción del año nuevo (si no tiene notas ni pagos allí).',
      confirmLabel: 'Deshacer',
    });
    if (!ok) return;
    try {
      await academicsApi.undoPromotion(p.enrollment_id);
      toast.success('Resultado deshecho', `${p.student.first_name} ${p.student.last_name}`);
      await load();
    } catch (err) {
      toast.error('No se pudo deshacer', getErrorMessage(err));
    }
  };

  const closeYear = async () => {
    const ok = await confirm({
      title: `¿Finalizar el año escolar ${preview.from_period.name}?`,
      message: 'Quedará inactivo y no se podrá volver a promover desde él. El historial y las notas se conservan. Si necesitas corregir algo, podrás reabrirlo.',
      icon: 'lock',
      confirmLabel: 'Finalizar año',
    });
    if (!ok) return;
    try {
      await academicsApi.closeSchoolPeriod(fromId);
      toast.success('Año escolar finalizado', preview.from_period.name);
      setFromId('');
      setPreview(null);
      refetchPeriods();
    } catch (err) {
      toast.error('No se pudo finalizar', getErrorMessage(err));
    }
  };

  const applySuggestions = () => suggestMany(students);

  const groups = useMemo(() => groupStudents(students, preview?.grades || []), [students, preview]);
  // Al cargar por primera vez: con pocos grupos se muestran abiertos; con muchos, contraídos (la cabecera ya resume).
  useEffect(() => {
    if (collapsed === null && groups.length) setCollapsed(new Set(groups.length > 2 ? groups.map((g) => g.key) : []));
  }, [groups, collapsed]);
  const isOpen = (key) => !collapsed?.has(key);
  const toggleGroup = (key) =>
    setCollapsed((c) => {
      const next = new Set(c || []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Cambia la acción de un alumno y recalcula su sección destino (la del mismo nombre, o "crear"). */
  const changeAction = (s, action) => {
    const g = targetGradeOf(s, action);
    const same = g && (preview.target_sections[g.id] || []).find((o) => o.name.toLowerCase() === s.section_name.toLowerCase());
    setRow(s.enrollment_id, { action, target: action === 'graduate' ? '' : same?.id || `new:${s.section_name}` });
  };
  /** Marca o desmarca a varios alumnos (un grupo o todos). */
  const selectMany = (list, selected) =>
    setRows((r) => ({ ...r, ...Object.fromEntries(list.map((s) => [s.enrollment_id, { ...r[s.enrollment_id], selected }])) }));
  /** Aplica la sugerencia del sistema a una lista de alumnos (un grupo o todos). */
  const suggestMany = (list) =>
    setRows((r) => ({ ...r, ...Object.fromEntries(list.map((s) => [s.enrollment_id, { ...r[s.enrollment_id], action: s.suggestion, target: defaultTarget(s) }])) }));

  const counts = useMemo(
    () => students.reduce((acc, s) => ({ ...acc, [s.suggestion]: (acc[s.suggestion] || 0) + 1 }), {}),
    [students]
  );

  return (
    <div>
      <PageHeader
        title="Cierre de año y promoción"
        subtitle="Promueve a los alumnos al año siguiente sin perder su historial: cada año queda cerrado con su resultado y su boleta."
        actions={
          <Link to="/academics" className="btn btn--secondary">
            <Icon name="arrowLeft" size={16} /> Estructura académica
          </Link>
        }
      />

      <Card>
        <div className="promotion-filters">
          <label>
            <span className="student-card__label">Año que finaliza</span>
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Selecciona…</option>
              {openPeriods.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === toId}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <Icon name="arrowRight" size={20} className="promotion-filters__arrow" />
          <label>
            <span className="student-card__label">Año escolar nuevo</span>
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Selecciona…</option>
              {openPeriods.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === fromId}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span className="student-card__label">Grado</span>
            <Select value={gradeId} onChange={(e) => setGradeId(e.target.value)} disabled={!preview}>
              <option value="">Todos los grados</option>
              {(preview?.grades || []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.pending} por procesar)
                </option>
              ))}
            </Select>
          </label>
        </div>
        {preview?.rules && <EvaluationRulesPanel period={preview.from_period} rules={preview.rules} canEdit={canEdit} onSaved={load} />}
        {openPeriods.length < 2 && (
          <Alert variant="info">
            Necesitas el año escolar nuevo creado (Estructura académica → Paso 1) para poder promover a los alumnos.
          </Alert>
        )}
      </Card>

      <Alert>{error}</Alert>
      {loading && <Spinner label="Calculando resultados…" />}

      {preview && !loading && (
        <>
          <div className="promotion-summary">
            <div className="promotion-summary__item">
              <strong>{preview.pending_total}</strong> por procesar en {preview.from_period.name}
            </div>
            {['promote', 'retain', 'graduate'].map((a) =>
              counts[a] ? (
                <Badge key={a} variant={ACTION_VARIANT[a]}>
                  Sugerencia · {ACTION_LABELS[a]}: {counts[a]}
                </Badge>
              ) : null
            )}
          </div>

          <div className="card data-table student-groups__toolbar promotion-toolbar">
            <div className="promotion-toolbar__title">
              <strong>Alumnos cursando {preview.from_period.name}</strong>
              <span className="text-sm text-muted">
                {students.length} alumno{students.length === 1 ? '' : 's'} en {groups.length} sección{groups.length === 1 ? '' : 'es'}
              </span>
            </div>
            {students.length > 0 && (
              <div className="data-table__filters">
                <Button variant="ghost" size="sm" icon="chevronDown" onClick={() => setCollapsed(new Set())}>
                  Expandir todo
                </Button>
                <Button variant="ghost" size="sm" icon="chevronRight" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))}>
                  Contraer todo
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="ghost" icon="sparkles" onClick={applySuggestions}>
                      Aplicar sugerencias
                    </Button>
                    {selectedIds.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => selectMany(students, false)}>
                        Quitar selección
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => execute(selectedIds)} disabled={!selectedIds.length || running}>
                      Procesar selección ({selectedIds.length})
                    </Button>
                    <Button size="sm" icon="graduation" onClick={() => execute(students.map((s) => s.enrollment_id))} loading={running} loadingText="Procesando…">
                      Procesar todos ({students.length})
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {students.length === 0 ? (
            <Card>
              <p className="text-muted">
                No quedan alumnos cursando {preview.from_period.name}
                {gradeId ? ' en este grado' : ''}.
              </p>
            </Card>
          ) : (
            <div className="student-groups promotion-groups">
              {groups.map((g, i) => (
                <div key={g.key}>
                  {g.levelName && g.levelName !== groups[i - 1]?.levelName && <h3 className="student-groups__level">{g.levelName}</h3>}
                  <PromotionGroup
                    group={g}
                    open={isOpen(g.key)}
                    onToggle={() => toggleGroup(g.key)}
                    rows={rows}
                    preview={preview}
                    canEdit={canEdit}
                    canCreate={canCreate}
                    running={running}
                    expanded={expanded}
                    onExpand={(id) => setExpanded(expanded === id ? null : id)}
                    targetGradeOf={targetGradeOf}
                    setRow={setRow}
                    changeAction={changeAction}
                    selectMany={selectMany}
                    suggestMany={suggestMany}
                    execute={execute}
                  />
                </div>
              ))}
            </div>
          )}

          {results && (
            <Card title="Resultado de la última ejecución">
              <Alert variant={results.summary.failed ? 'warning' : 'success'}>{results.message}</Alert>
              {results.results.some((r) => !r.ok) && (
                <ul className="import-errors">
                  {results.results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li key={r.enrollment_id}>{r.message}</li>
                    ))}
                </ul>
              )}
            </Card>
          )}

          <Card
            title={`Ya procesados de ${preview.from_period.name}`}
            actions={
              canEdit && (
                <Button
                  size="sm"
                  icon="lock"
                  variant={preview.pending_total === 0 ? 'primary' : 'secondary'}
                  onClick={closeYear}
                  disabled={preview.pending_total > 0}
                  title={preview.pending_total > 0 ? `Faltan ${preview.pending_total} alumno(s) por procesar` : 'Finalizar el año escolar'}
                >
                  Finalizar año {preview.from_period.name}
                </Button>
              )
            }
          >
            {preview.processed.length === 0 ? (
              <p className="text-muted">Todavía no se ha procesado a ningún alumno.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Alumno</th>
                      <th>Resultado</th>
                      <th style={{ textAlign: 'center' }}>Promedio</th>
                      <th>Año nuevo</th>
                      {canEdit && <th aria-label="Acciones" />}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.processed.map((p) => (
                      <tr key={p.enrollment_id}>
                        <td>
                          <Link to={`/students/${p.student.id}`} className="cell-person__name">
                            {p.student.last_name}, {p.student.first_name}
                          </Link>
                          <div className="cell-person__sub">
                            {p.grade.name} · Sección {p.section_name}
                          </div>
                        </td>
                        <td>
                          <Badge variant={STATUS_VARIANT[p.status]}>{p.status_label}</Badge>
                        </td>
                        <td style={{ textAlign: 'center' }}>{fmt(p.final_average)}</td>
                        <td>{p.next ? `${p.next.grade_name} · Sección ${p.next.section_name}` : <span className="text-muted">—</span>}</td>
                        {canEdit && (
                          <td style={{ textAlign: 'right' }}>
                            <Button size="sm" variant="ghost" icon="arrowLeft" onClick={() => undo(p)}>
                              Deshacer
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Agrupa a los alumnos por grado y sección, en el orden de la estructura académica
 * (nivel → grado) y luego por nombre de sección (A, B, C…).
 */
function groupStudents(students, grades) {
  const order = new Map(grades.map((g, i) => [g.id, i]));
  const levelOf = new Map(grades.map((g) => [g.id, g.level_name]));
  const map = new Map();
  for (const s of students) {
    const key = `${s.grade.id}|${s.section_name}`;
    if (!map.has(key)) {
      map.set(key, { key, grade: s.grade, nextGrade: s.next_grade, sectionName: s.section_name, levelName: levelOf.get(s.grade.id) || null, students: [] });
    }
    map.get(key).students.push(s);
  }
  return [...map.values()].sort(
    (a, b) =>
      (order.get(a.grade.id) ?? 999) - (order.get(b.grade.id) ?? 999) ||
      a.grade.name.localeCompare(b.grade.name, 'es', { numeric: true }) ||
      a.sectionName.localeCompare(b.sectionName, 'es', { numeric: true })
  );
}

/**
 * Bloque colapsable de una sección del año que finaliza: cabecera con el grado,
 * la sección, el total de alumnos y el resumen de acciones; dentro, la tabla con
 * los controles de promoción de cada alumno y las acciones del bloque.
 */
function PromotionGroup({ group, open, onToggle, rows, preview, canEdit, canCreate, running, expanded, onExpand, targetGradeOf, setRow, changeAction, selectMany, suggestMany, execute }) {
  const list = group.students;
  // Lapsos del año (normalmente 3): una columna por lapso con el promedio de todas las materias.
  const terms = preview.rules?.terms || [];
  const passingGrade = preview.passing_grade;
  const bodyId = `promotion-group-${group.key}`;
  const selected = list.filter((s) => rows[s.enrollment_id]?.selected);
  const allSelected = selected.length === list.length;
  // Resumen con la acción elegida (no la sugerida): es lo que se procesará.
  const chosen = list.reduce((acc, s) => {
    const a = rows[s.enrollment_id]?.action;
    return a ? { ...acc, [a]: (acc[a] || 0) + 1 } : acc;
  }, {});
  const noTarget = list.filter((s) => rows[s.enrollment_id] && rows[s.enrollment_id].action !== 'graduate' && !rows[s.enrollment_id].target).length;
  const toProcess = selected.length ? selected : list;

  return (
    <section className={`student-group promotion-group ${open ? 'is-open' : ''}`}>
      <div className="student-group__header">
        <button type="button" className="student-group__toggle" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
          <Icon name="chevronDown" size={18} className="student-group__chevron" />
          <span className="student-group__title">
            {group.grade.name} <span className="student-group__sep">·</span> Sección {group.sectionName}
          </span>
          <span className="student-group__meta">
            {group.nextGrade ? `Grado siguiente: ${group.nextGrade.name}` : 'Último grado: los promovidos egresan'}
            {noTarget > 0 && <span className="text-warning"> · {noTarget} sin sección destino</span>}
          </span>
        </button>
        <div className="student-group__side promotion-group__side">
          {['promote', 'retain', 'graduate'].map((a) =>
            chosen[a] ? (
              <Badge key={a} variant={ACTION_VARIANT[a]}>
                {ACTION_LABELS[a]}: {chosen[a]}
              </Badge>
            ) : null
          )}
          <span className="student-group__count">
            {list.length} {list.length === 1 ? 'alumno' : 'alumnos'}
          </span>
          {canEdit && (
            <Button size="sm" variant={selected.length ? 'primary' : 'secondary'} icon="graduation" onClick={() => execute(toProcess.map((s) => s.enrollment_id))} disabled={running}>
              {selected.length ? `Procesar ${selected.length} seleccionado${selected.length === 1 ? '' : 's'}` : `Procesar sección (${list.length})`}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div id={bodyId} className="student-group__body">
          {canEdit && (
            <div className="promotion-group__actions">
              <Button size="sm" variant="ghost" icon="sparkles" onClick={() => suggestMany(list)}>
                Aplicar sugerencias a la sección
              </Button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table promotion-table">
              <thead>
                <tr>
                  {canEdit && (
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar a todos en ${group.grade.name} ${group.sectionName}`}
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selected.length > 0 && !allSelected;
                        }}
                        onChange={(e) => selectMany(list, e.target.checked)}
                      />
                    </th>
                  )}
                  <th>Alumno</th>
                  {terms.map((t) => (
                    <th key={t.id} className="promotion-table__term" title={`Promedio de todas las materias en el ${termLabel(t.term_number, t.name)}`}>
                      {termLabel(t.term_number, t.name)}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center' }}>Promedio</th>
                  <th style={{ textAlign: 'center' }}>Reprobadas</th>
                  <th>Sugerencia</th>
                  <th>Acción</th>
                  <th>Sección en {preview.to_period.name}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const r = rows[s.enrollment_id] || {};
                  const isExpanded = expanded === s.enrollment_id;
                  const tGrade = targetGradeOf(s, r.action);
                  const options = tGrade ? preview.target_sections[tGrade.id] || [] : [];
                  const sameNameExists = options.some((o) => o.name.toLowerCase() === s.section_name.toLowerCase());
                  return [
                    <tr key={s.enrollment_id} className={`${r.selected ? 'is-selected' : ''} ${isExpanded ? 'is-expanded' : ''}`}>
                      {canEdit && (
                        <td>
                          <input type="checkbox" aria-label={`Seleccionar a ${s.student.first_name}`} checked={Boolean(r.selected)} onChange={(e) => setRow(s.enrollment_id, { selected: e.target.checked })} />
                        </td>
                      )}
                      <td>
                        <button
                          type="button"
                          className="link-button promotion-table__name"
                          onClick={() => onExpand(s.enrollment_id)}
                          aria-expanded={isExpanded}
                          aria-controls={`grades-${s.enrollment_id}`}
                          title={isExpanded ? 'Ocultar notas por materia' : 'Ver notas por materia y lapso'}
                        >
                          <Icon name="chevronDown" size={15} className="promotion-table__chevron" />
                          {s.student.last_name}, {s.student.first_name}
                        </button>
                        {s.student.national_id && <div className="cell-person__sub">{s.student.national_id}</div>}
                      </td>
                      {terms.map((t) => {
                        const ta = s.term_averages?.find((x) => x.term_id === t.id);
                        return (
                          <td key={t.id} className="promotion-table__term">
                            <button
                              type="button"
                              className={`promotion-table__term-btn ${gradeClass(ta?.average ?? null, passingGrade)}`}
                              onClick={() => onExpand(s.enrollment_id)}
                              title={ta && ta.average !== null ? `${termLabel(t.term_number, t.name)}: ${fmt(ta.sum)} ÷ ${ta.total_subjects} materias${ta.graded_subjects < ta.total_subjects ? ` (${ta.total_subjects - ta.graded_subjects} sin nota cuentan 0)` : ''}` : `${termLabel(t.term_number, t.name)}: sin notas`}
                            >
                              {fmt(ta?.average ?? null)}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{ textAlign: 'center' }}>
                        <strong className={gradeClass(s.final_average, passingGrade)}>{fmt(s.final_average)}</strong>
                        {s.graded && !s.complete && <div className="cell-person__sub text-warning">incompletas</div>}
                      </td>
                      <td style={{ textAlign: 'center' }} className={s.failed_subjects ? 'text-danger' : undefined}>
                        {s.graded ? s.failed_subjects : '—'}
                        {s.pending_subjects > 0 && (
                          <div className="cell-person__sub text-warning" title="Materias sin nota en todos los lapsos: su promedio es provisional">
                            {s.pending_subjects} provisional{s.pending_subjects === 1 ? '' : 'es'}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge variant={ACTION_VARIANT[s.suggestion]}>{ACTION_LABELS[s.suggestion]}</Badge>
                        <div className="cell-person__sub">{s.reason}</div>
                      </td>
                      <td>
                        <Select value={r.action} disabled={!canEdit} onChange={(e) => changeAction(s, e.target.value)} aria-label={`Acción para ${s.student.first_name}`}>
                          {s.next_grade ? <option value="promote">Promover a {s.next_grade.name}</option> : <option value="graduate">Egresa (último grado)</option>}
                          <option value="retain">Repite {s.grade.name}</option>
                        </Select>
                      </td>
                      <td>
                        {r.action === 'graduate' ? (
                          <span className="text-muted text-sm">No aplica</span>
                        ) : (
                          <Select value={r.target} disabled={!canEdit} onChange={(e) => setRow(s.enrollment_id, { target: e.target.value })} aria-label={`Sección destino de ${s.student.first_name}`}>
                            <option value="">Selecciona…</option>
                            {options.map((o) => (
                              <option key={o.id} value={o.id} disabled={o.free === 0}>
                                {tGrade.name} {o.name} · {o.free} cupo{o.free === 1 ? '' : 's'}
                              </option>
                            ))}
                            {!sameNameExists && canCreate && <option value={`new:${s.section_name}`}>Crear {tGrade?.name} {s.section_name}</option>}
                          </Select>
                        )}
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`${s.enrollment_id}-detail`} id={`grades-${s.enrollment_id}`} className="promotion-table__detail">
                        <td colSpan={(canEdit ? 7 : 6) + terms.length}>
                          <div className="promotion-detail__context">
                            <strong>
                              {s.student.last_name}, {s.student.first_name}
                            </strong>
                            <span className="text-muted">
                              {group.grade.name} · Sección {group.sectionName} · {preview.from_period.name}
                            </span>
                            <Badge variant={ACTION_VARIANT[s.suggestion]}>Sugerencia: {ACTION_LABELS[s.suggestion]}</Badge>
                            <span className="text-sm text-muted">{s.reason}</span>
                          </div>
                          <TermBreakdown student={s} passingGrade={passingGrade} />
                          <Input
                            value={r.notes}
                            maxLength={300}
                            placeholder="Observación (opcional): queda en el historial del alumno"
                            onChange={(e) => setRow(s.enrollment_id, { notes: e.target.value })}
                            disabled={!canEdit}
                            style={{ marginTop: 8 }}
                          />
                          {canEdit && (
                            <Button size="sm" style={{ marginTop: 8 }} onClick={() => execute([s.enrollment_id])} loading={running}>
                              Procesar solo a {s.student.first_name}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default PromotionPage;
