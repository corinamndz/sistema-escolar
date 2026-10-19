import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LevelBadge, LEVELS, STAFF_ROLES, isAvailableFor } from '../levels';
import { sortByLabel } from '../../../utils/sortOptions';

const NEXT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Indicador por celda: guardando / guardado / error. */
function SaveMark({ state }) {
  if (!state) return null;
  if (state === 'saving') return <span className="gp-mark gp-mark--saving" aria-label="Guardando" />;
  if (state === 'saved') return <Icon name="check" size={14} className="gp-mark gp-mark--saved" />;
  return <Icon name="alertCircle" size={14} className="gp-mark gp-mark--error" />;
}

/**
 * Selector de docente con opción vacía configurable.
 *   levelCode  solo ofrece a los docentes disponibles para ese nivel (el ya elegido se conserva).
 *   sectionId  Inicial y Primaria: quien ya atiende OTRA sección del año aparece bloqueado y dice dónde.
 */
function TeacherSelect({ value, teachers, emptyLabel, onChange, disabled, ariaLabel, sectionId = null, levelCode = null }) {
  const blocked = (t) => (sectionId && t.homeroom && t.homeroom.section_id !== sectionId && t.id !== value ? t.homeroom.label : null);
  // Orden alfabético por el nombre que se muestra; los bloqueados al final y la opción vacía arriba.
  const list = sortByLabel(teachers.filter((t) => t.id === value || isAvailableFor(t, levelCode))).sort((a, b) => Boolean(blocked(a)) - Boolean(blocked(b)));
  return (
    <select className="input gp-select" value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={ariaLabel}>
      <option value="">{emptyLabel}</option>
      {list.map((t) => {
        const where = blocked(t);
        return (
          <option key={t.id} value={t.id} disabled={Boolean(where)}>
            {where ? `${t.name} (Ya asignado a ${where})` : t.name}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Área de trabajo de UN grado en un año escolar (Grados y secciones): sus
 * secciones y el personal docente de cada una según el nivel, con autoguardado.
 *   Inicial     docente + docente auxiliar
 *   Primaria    docente
 *   Secundaria  docente guía
 * Las materias y sus docentes se gestionan en el módulo de Materias.
 */
function GradeWorkspace({ gradeId, period, canEdit, canDelete, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [marks, setMarks] = useState({}); // clave de celda → 'saving' | 'saved' | 'error'
  const [busy, setBusy] = useState(false);
  // Todos los hooks van ANTES de los "return" de carga/error: si uno se declara
  // después, React cambia la cantidad de hooks entre renders y la pantalla se cae.

  // Solo la respuesta de la última petición se aplica: al entrar, el año escolar
  // llega después del grado y una respuesta anterior (sin año) podía pisarla.
  const lastRequest = useRef(0);
  const load = async () => {
    const request = ++lastRequest.current;
    try {
      const data = await academicsApi.getGradePanel(gradeId, period?.id);
      if (request !== lastRequest.current) return;
      setPanel(data);
      setError(null);
    } catch (err) {
      if (request === lastRequest.current) setError(getErrorMessage(err));
    }
  };
  useEffect(() => {
    setPanel(null);
    setMarks({});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeId, period?.id]);

  /** Guarda una celda: marca "guardando", aplica la respuesta y deja el ✓ unos segundos. */
  const saveCell = async (key, fn) => {
    setMarks((m) => ({ ...m, [key]: 'saving' }));
    try {
      await fn();
      setMarks((m) => ({ ...m, [key]: 'saved' }));
      setTimeout(() => setMarks((m) => (m[key] === 'saved' ? { ...m, [key]: undefined } : m)), 2000);
      onChanged?.();
    } catch (err) {
      setMarks((m) => ({ ...m, [key]: 'error' }));
      toast.error('No se guardó el cambio', getErrorMessage(err));
    }
    await load();
  };

  if (error) {
    return (
      <div className="card empty-state">
        <div className="empty-state__icon">
          <Icon name="alertTriangle" size={24} />
        </div>
        <div className="empty-state__title">No se pudo cargar el grado</div>
        <div className="text-sm">{error}</div>
        <Button size="sm" variant="secondary" onClick={load} style={{ marginTop: 12 }}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!panel) return <Spinner label="Cargando el grado…" />;

  const { grade, teachers, sections } = panel;
  const roles = STAFF_ROLES[grade.level_code] || [];
  const readOnly = !canEdit || Boolean(period?.closed_at);

  // ---- Secciones ----
  const addSection = async () => {
    const used = new Set(sections.map((s) => s.name.toUpperCase()));
    const name = [...NEXT_LETTERS].find((l) => !used.has(l)) || `S${sections.length + 1}`;
    setBusy(true);
    try {
      await academicsApi.createSection({ gradeId, schoolPeriodId: period.id, name });
      toast.success(`Sección ${grade.name} ${name} creada`);
      onChanged?.();
      await load();
    } catch (err) {
      toast.error('No se pudo crear la sección', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Elimina una sección creada por error. El backend lo impide si tiene alumnos
   * (inscritos o con historial) o planes de evaluación; sus docentes y clases
   * del horario se quitan con ella.
   */
  const removeSection = async (section) => {
    const assigned = (section.homeroom?.lead ? 1 : 0) + (section.homeroom?.assistant ? 1 : 0) + (section.guide ? 1 : 0);
    const ok = await confirm({
      title: `¿Eliminar la sección ${grade.name} ${section.name}?`,
      message: `${assigned ? `Se quitarán sus ${assigned} asignación(es) docente y sus clases del horario. ` : ''}Solo es posible si no tiene alumnos ni planes de evaluación. No se puede deshacer.`,
      danger: true,
      confirmLabel: 'Eliminar sección',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await academicsApi.deleteSection(section.id);
      const extra = [
        res.removedAssignments ? `${res.removedAssignments} asignación(es) docente quitadas` : null,
        res.removedScheduleClasses ? `${res.removedScheduleClasses} clase(s) del horario quitadas` : null,
      ].filter(Boolean);
      toast.success(`Sección ${grade.name} ${section.name} eliminada`, extra.join(' · ') || undefined);
      onChanged?.();
    } catch (err) {
      toast.error('No se pudo eliminar la sección', getErrorMessage(err));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const setHeader = (section, field, teacherId) => {
    const body =
      field === 'guide'
        ? { guideTeacherId: teacherId }
        : {
            leadTeacherId: field === 'lead' ? teacherId : section.homeroom?.lead?.id || null,
            assistantTeacherId: field === 'assistant' ? teacherId : section.homeroom?.assistant?.id || null,
          };
    return saveCell(`${section.id}|${field}`, () => academicsApi.setSectionTeachers(section.id, body));
  };

  return (
    <div className="gp-workspace">
      <header className="gp-head">
        <div>
          <h2 className="gp-head__title">
            {grade.name} <LevelBadge code={grade.level_code} />
          </h2>
          <p className="text-sm text-muted">{LEVELS[grade.level_code]?.rule}</p>
        </div>
        <span className="gp-autosave">
          <Icon name="checkCircle" size={15} /> Los cambios se guardan solos
        </span>
      </header>
      {readOnly && (
        <Alert variant="info">{period?.closed_at ? `El año ${period.name} está finalizado: solo lectura.` : 'No tienes permiso para editar la estructura académica.'}</Alert>
      )}

      <section className="gp-card">
        <div className="gp-card__head">
          <h3>Secciones y personal docente · {period?.name || 'sin año escolar'}</h3>
          {!readOnly && period && (
            <Button size="sm" variant="secondary" icon="plus" onClick={addSection} disabled={busy}>
              Sección
            </Button>
          )}
        </div>

        {!period ? (
          <p className="text-muted">Crea el año escolar en curso para abrir secciones (Configuración general → Año escolar).</p>
        ) : sections.length === 0 ? (
          <div className="gp-empty">
            <p>
              {grade.name} aún no tiene secciones en {period.name}.
            </p>
            {!readOnly && (
              <Button icon="plus" onClick={addSection} disabled={busy}>
                Crear sección A
              </Button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table gp-staff">
              <thead>
                <tr>
                  <th>Sección</th>
                  {roles.map((r) => (
                    <th key={r.key}>{r.label}</th>
                  ))}
                  <th className="gp-staff__num">Alumnos</th>
                  <th className="gp-staff__num">Materias</th>
                  {!readOnly && canDelete && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {sections.map((s) => (
                  <tr key={s.id}>
                    <td className="gp-staff__section">
                      <Link to={`/academics/sections/${s.id}`} className="cell-person__name">
                        Sección {s.name}
                      </Link>
                    </td>
                    {roles.map((r) => {
                      const current = r.key === 'guide' ? s.guide : s.homeroom?.[r.key];
                      const missing = !current && r.key !== 'assistant';
                      return (
                        <td key={r.key} className={missing ? 'is-missing' : undefined}>
                          <div className="gp-cell">
                            <TeacherSelect
                              value={current?.id}
                              teachers={r.key === 'assistant' ? teachers.filter((t) => t.id !== s.homeroom?.lead?.id) : teachers}
                              emptyLabel={`Sin ${r.label.toLowerCase()}`}
                              disabled={readOnly || (r.key === 'assistant' && !s.homeroom?.lead)}
                              onChange={(id) => setHeader(s, r.key, id)}
                              ariaLabel={`${r.label} de la sección ${s.name}`}
                              sectionId={r.key === 'guide' ? null : s.id}
                              levelCode={grade.level_code}
                            />
                            <SaveMark state={marks[`${s.id}|${r.key}`]} />
                          </div>
                        </td>
                      );
                    })}
                    <td className="gp-staff__num">
                      {s.enrolled}/{s.max_students}
                    </td>
                    <td className="gp-staff__num">{s.subject_count}</td>
                    {!readOnly && canDelete && (
                      <td className="gp-staff__actions">
                        <button
                          type="button"
                          className="gp-chip__icon gp-chip__icon--remove"
                          onClick={() => removeSection(s)}
                          disabled={busy || s.enrolled > 0}
                          title={s.enrolled > 0 ? `No se puede eliminar: tiene ${s.enrolled} alumno(s) inscrito(s)` : `Eliminar la sección ${s.name}`}
                          aria-label={`Eliminar la sección ${s.name}`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {grade.has_curriculum && (
        <div className="gp-subjects-link">
          <Icon name="book" size={17} />
          <span>
            {grade.subject_count
              ? `${grade.name} tiene ${grade.subject_count} materia${grade.subject_count === 1 ? '' : 's'}.`
              : `${grade.name} aún no tiene materias.`}{' '}
            Las materias, sus secciones y sus docentes se gestionan en el módulo de Materias.
          </span>
          <Link to={`/academics/subjects?grado=${gradeId}`} className="btn btn--secondary btn--sm">
            Ir a Materias
          </Link>
        </div>
      )}
    </div>
  );
}

export default GradeWorkspace;
