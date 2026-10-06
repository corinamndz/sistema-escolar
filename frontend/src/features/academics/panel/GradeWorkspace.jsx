import { useEffect, useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LevelBadge, LEVELS } from '../levels';
import { sortByLabel } from '../../../utils/sortOptions';

const NEXT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Indicador por celda: guardando / guardado / error. */
function SaveMark({ state }) {
  if (!state) return null;
  if (state === 'saving') return <span className="gp-mark gp-mark--saving" aria-label="Guardando" />;
  if (state === 'saved') return <Icon name="check" size={14} className="gp-mark gp-mark--saved" />;
  return <Icon name="alertCircle" size={14} className="gp-mark gp-mark--error" />;
}

/** Selector de docente con opción vacía configurable. */
function TeacherSelect({ value, teachers, emptyLabel, onChange, disabled, ariaLabel }) {
  return (
    <select className="input gp-select" value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={ariaLabel}>
      <option value="">{emptyLabel}</option>
      {/* Orden alfabético por el nombre que se muestra; la opción vacía queda arriba. */}
      {sortByLabel(teachers).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Área de trabajo de UN grado en un año escolar: todo en una pantalla y con
 * autoguardado.
 *   1. Materias del grado: se marcan/desmarcan del catálogo (y sus horas).
 *   2. Matriz materia × sección: el profesor de cada materia en cada sección,
 *      y en la cabecera de cada sección el responsable del grupo
 *      (Secundaria: profesor guía opcional; Inicial/Primaria: titular/auxiliar).
 */
function GradeWorkspace({ gradeId, period, canEdit, canDelete, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [marks, setMarks] = useState({}); // clave de celda → 'saving' | 'saved' | 'error'
  const [newSubject, setNewSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null); // materia del catálogo en edición
  // Todos los hooks van ANTES de los "return" de carga/error: si uno se declara
  // después, React cambia la cantidad de hooks entre renders y la pantalla se cae.

  const load = async () => {
    try {
      setPanel(await academicsApi.getGradePanel(gradeId, period?.id));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
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

  const { grade, curriculum, catalog, teachers, sections } = panel;
  const bySubject = grade.assignment_mode === 'subjects';
  const readOnly = !canEdit || Boolean(period?.closed_at);
  const inCurriculum = new Set(curriculum.map((c) => c.id));

  // ---- Plan de estudios ----
  const saveCurriculum = async (list, { label }) => {
    setBusy(true);
    try {
      const res = await academicsApi.setGradeSubjects(
        gradeId,
        list.map((c) => ({ subjectId: c.id, weeklyHours: c.weekly_hours ? Number(c.weekly_hours) : null }))
      );
      const extra = [
        res.removedAssignments ? `${res.removedAssignments} asignación(es) docente quitadas` : null,
        res.removedScheduleClasses ? `${res.removedScheduleClasses} clase(s) del horario quitadas` : null,
      ].filter(Boolean);
      toast.success(label, extra.join(' · ') || undefined);
      onChanged?.();
    } catch (err) {
      toast.error('No se guardó el plan de estudios', getErrorMessage(err));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const addSubject = (subject) =>
    saveCurriculum([...curriculum, { id: subject.id, weekly_hours: null }], { label: `${subject.name} agregada a ${grade.name}` });

  /**
   * Quita la materia del plan de estudios del grado (no del catálogo). Si no
   * tiene profesores asignados es inmediato; si los tiene, pide confirmación.
   */
  const removeSubject = async (subject, { silent = false } = {}) => {
    const assigned = sections.filter((s) => s.subjects.find((x) => x.id === subject.id)?.teacher).length;
    if (assigned && !silent) {
      const ok = await confirm({
        title: `¿Quitar ${subject.name} de ${grade.name}?`,
        message: `Tiene profesor en ${assigned} sección(es): esas asignaciones y sus clases del horario se quitarán. Si ya tiene planes de evaluación, no se podrá quitar.`,
        danger: true,
        confirmLabel: 'Quitar materia',
      });
      if (!ok) return false;
    }
    await saveCurriculum(curriculum.filter((c) => c.id !== subject.id), { label: `${subject.name} quitada de ${grade.name}` });
    return true;
  };

  // ---- Catálogo: renombrar o eliminar una materia (p. ej. creada por error) ----
  const renameSubject = async (subject, name) => {
    await academicsApi.updateSubject(subject.id, { name });
    toast.success('Materia actualizada', name);
    onChanged?.();
    await load();
  };

  const deleteFromCatalog = async (subject) => {
    const otherGrades = (subject.grade_count || 0) - (inCurriculum.has(subject.id) ? 1 : 0);
    if (otherGrades > 0) {
      toast.error(
        'No se puede eliminar del catálogo',
        `${subject.name} también está en el plan de estudios de ${otherGrades} grado(s) más. Quítala de esos grados o márcala como inactiva en Configuración general → Materias.`
      );
      return false;
    }
    const ok = await confirm({
      title: `¿Eliminar ${subject.name} del catálogo?`,
      message: inCurriculum.has(subject.id)
        ? `Se quitará de ${grade.name} y se borrará del catálogo de materias. Si ya tiene planes de evaluación, no se podrá eliminar.`
        : 'Se borrará del catálogo de materias del colegio.',
      danger: true,
      confirmLabel: 'Eliminar materia',
    });
    if (!ok) return false;
    try {
      if (inCurriculum.has(subject.id)) {
        await academicsApi.setGradeSubjects(
          gradeId,
          curriculum.filter((c) => c.id !== subject.id).map((c) => ({ subjectId: c.id, weeklyHours: c.weekly_hours ? Number(c.weekly_hours) : null }))
        );
      }
      await academicsApi.deleteSubject(subject.id);
      toast.success('Materia eliminada del catálogo', subject.name);
      onChanged?.();
      return true;
    } catch (err) {
      toast.error('No se pudo eliminar la materia', getErrorMessage(err));
      return false;
    } finally {
      await load();
    }
  };

  const saveHours = (subject, value) => {
    const hours = value === '' ? null : Number(value);
    if ((subject.weekly_hours ?? null) === hours) return;
    saveCurriculum(curriculum.map((c) => (c.id === subject.id ? { ...c, weekly_hours: hours } : c)), { label: `Horas de ${subject.name} guardadas` });
  };

  const addNewSubject = async (e) => {
    e.preventDefault();
    const name = newSubject.trim();
    if (!name) return;
    setBusy(true);
    try {
      const existing = catalog.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const subject = existing || (await academicsApi.createSubject({ name }));
      setNewSubject('');
      if (!inCurriculum.has(subject.id)) await saveCurriculum([...curriculum, { id: subject.id, weekly_hours: null }], { label: `${subject.name} agregada a ${grade.name}` });
    } catch (err) {
      toast.error('No se pudo crear la materia', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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
    const assigned = (section.homeroom?.lead ? 1 : 0) + (section.homeroom?.assistant ? 1 : 0) + (section.guide ? 1 : 0) + section.subjects.filter((x) => x.teacher).length;
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

  const setSubjectTeacher = (section, subjectId, teacherId) =>
    saveCell(`${section.id}|${subjectId}`, () => academicsApi.setSectionTeachers(section.id, { subjects: [{ subjectId, teacherId }] }));

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

  /** Copia el profesor de esta materia en la primera sección a las demás (un clic en vez de varios). */
  const copyToAll = async (subjectId) => {
    const first = sections[0].subjects.find((x) => x.id === subjectId)?.teacher;
    if (!first) return;
    for (const s of sections.slice(1)) {
      // eslint-disable-next-line no-await-in-loop
      await saveCell(`${s.id}|${subjectId}`, () => academicsApi.setSectionTeachers(s.id, { subjects: [{ subjectId, teacherId: first.id }] }));
    }
  };

  const coverage = (s) => {
    const total = s.subjects.length;
    const assigned = bySubject ? s.subjects.filter((x) => x.teacher).length : s.homeroom?.lead ? total : s.subjects.filter((x) => x.teacher).length;
    return { total, assigned };
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

      {grade.has_curriculum && (
        <section className="gp-card">
          <div className="gp-card__head">
            <h3>
              <span className="gp-step">1</span> Materias de {grade.name}
            </h3>
            <span className="text-sm text-muted">
              {curriculum.length} materia{curriculum.length === 1 ? '' : 's'} · marca o desmarca del catálogo
            </span>
          </div>
          <div className="gp-chips">
            {catalog.map((s) => {
              const on = inCurriculum.has(s.id);
              const row = curriculum.find((c) => c.id === s.id);
              return (
                <div key={s.id} className={`gp-chip ${on ? 'is-on' : ''}`}>
                  {/* Marcada: el nombre no hace nada (se quita con la ×). Sin marcar: un clic la agrega. */}
                  <button
                    type="button"
                    className="gp-chip__name"
                    onClick={() => !on && addSubject(s)}
                    disabled={readOnly || busy}
                    aria-pressed={on}
                    title={on ? `${s.name} es parte de ${grade.name}` : `Agregar ${s.name} a ${grade.name}`}
                  >
                    <Icon name={on ? 'check' : 'plus'} size={14} /> {s.name}
                  </button>
                  {on && (
                    <label className="gp-chip__hours" title="Horas semanales">
                      <input
                        key={row?.weekly_hours ?? 'none'}
                        type="number"
                        min="1"
                        max="40"
                        defaultValue={row?.weekly_hours ?? ''}
                        placeholder="h"
                        disabled={readOnly || busy}
                        onBlur={(e) => saveHours(row, e.target.value)}
                        aria-label={`Horas semanales de ${s.name}`}
                      />
                      h
                    </label>
                  )}
                  {!readOnly && (
                    <span className="gp-chip__actions">
                      <button type="button" className="gp-chip__icon" onClick={() => setEditingSubject(s)} disabled={busy} title={`Editar o eliminar ${s.name} del catálogo`} aria-label={`Editar ${s.name}`}>
                        <Icon name="pencil" size={12} />
                      </button>
                      {on && (
                        <button
                          type="button"
                          className="gp-chip__icon gp-chip__icon--remove"
                          onClick={() => removeSubject(s)}
                          disabled={busy}
                          title={`Quitar ${s.name} de ${grade.name}`}
                          aria-label={`Quitar ${s.name} de ${grade.name}`}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            {!readOnly && (
              <form className="gp-chip gp-chip--new" onSubmit={addNewSubject}>
                <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Nueva materia…" maxLength={80} aria-label="Nueva materia" />
                <Button type="submit" size="sm" variant="ghost" icon="plus" disabled={!newSubject.trim() || busy}>
                  Agregar
                </Button>
              </form>
            )}
          </div>
        </section>
      )}

      <section className="gp-card">
        <div className="gp-card__head">
          <h3>
            <span className="gp-step">{grade.has_curriculum ? 2 : 1}</span> Secciones y docentes · {period?.name || 'sin año escolar'}
          </h3>
          {!readOnly && period && (
            <Button size="sm" variant="secondary" icon="plus" onClick={addSection} disabled={busy}>
              Sección
            </Button>
          )}
        </div>

        {!period ? (
          <p className="text-muted">Crea el año escolar en curso para abrir secciones (Configuración → Año escolar).</p>
        ) : sections.length === 0 ? (
          <div className="gp-empty">
            <p>{grade.name} aún no tiene secciones en {period.name}.</p>
            {!readOnly && (
              <Button icon="plus" onClick={addSection} disabled={busy}>
                Crear sección A
              </Button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="gp-matrix">
              <thead>
                <tr>
                  <th className="gp-matrix__subject">{grade.has_curriculum ? 'Materia' : ''}</th>
                  {sections.map((s) => {
                    const c = coverage(s);
                    return (
                      <th key={s.id}>
                        <div className="gp-section-head">
                          <span className="gp-section-head__title">
                            <strong>Sección {s.name}</strong>
                            {!readOnly && canDelete && (
                              <button
                                type="button"
                                className="gp-chip__icon gp-chip__icon--remove"
                                onClick={() => removeSection(s)}
                                disabled={busy || s.enrolled > 0}
                                title={s.enrolled > 0 ? `No se puede eliminar: tiene ${s.enrolled} alumno(s) inscrito(s)` : `Eliminar la sección ${s.name}`}
                                aria-label={`Eliminar la sección ${s.name}`}
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            )}
                          </span>
                          <span className="text-sm text-muted">
                            {s.enrolled}/{s.max_students} alumnos
                            {grade.has_curriculum && ` · ${c.assigned}/${c.total} con profesor`}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
                {/* Responsable del grupo en la cabecera de cada sección. */}
                <tr className="gp-matrix__lead-row">
                  <th className="gp-matrix__subject">{bySubject ? 'Profesor guía (opcional)' : 'Docente titular'}</th>
                  {sections.map((s) => (
                    <th key={s.id}>
                      <div className="gp-cell">
                        <TeacherSelect
                          value={bySubject ? s.guide?.id : s.homeroom?.lead?.id}
                          teachers={teachers}
                          emptyLabel={bySubject ? 'Sin profesor guía' : 'Sin titular'}
                          disabled={readOnly}
                          onChange={(id) => setHeader(s, bySubject ? 'guide' : 'lead', id)}
                          ariaLabel={`${bySubject ? 'Profesor guía' : 'Titular'} de la sección ${s.name}`}
                        />
                        <SaveMark state={marks[`${s.id}|${bySubject ? 'guide' : 'lead'}`]} />
                      </div>
                    </th>
                  ))}
                </tr>
                {grade.allows_assistant && (
                  <tr className="gp-matrix__lead-row">
                    <th className="gp-matrix__subject">Docente auxiliar</th>
                    {sections.map((s) => (
                      <th key={s.id}>
                        <div className="gp-cell">
                          <TeacherSelect
                            value={s.homeroom?.assistant?.id}
                            teachers={teachers.filter((t) => t.id !== s.homeroom?.lead?.id)}
                            emptyLabel="Sin auxiliar"
                            disabled={readOnly || !s.homeroom?.lead}
                            onChange={(id) => setHeader(s, 'assistant', id)}
                            ariaLabel={`Auxiliar de la sección ${s.name}`}
                          />
                          <SaveMark state={marks[`${s.id}|assistant`]} />
                        </div>
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              {grade.has_curriculum && (
                <tbody>
                  {curriculum.length === 0 && (
                    <tr>
                      <td colSpan={sections.length + 1} className="text-muted">
                        Marca arriba las materias del grado para asignarles profesor.
                      </td>
                    </tr>
                  )}
                  {curriculum.map((subject) => {
                    const firstTeacher = sections[0].subjects.find((x) => x.id === subject.id)?.teacher;
                    return (
                      <tr key={subject.id}>
                        <th className="gp-matrix__subject">
                          <span>{subject.name}</span>
                          {subject.weekly_hours && <small>{subject.weekly_hours} h/sem</small>}
                          {!readOnly && sections.length > 1 && firstTeacher && (
                            <button type="button" className="gp-copy" onClick={() => copyToAll(subject.id)} title={`Asignar a ${firstTeacher.name} en todas las secciones`}>
                              <Icon name="arrowRight" size={13} /> Todas
                            </button>
                          )}
                        </th>
                        {sections.map((s) => {
                          const cell = s.subjects.find((x) => x.id === subject.id);
                          const key = `${s.id}|${subject.id}`;
                          return (
                            <td key={s.id} className={!cell?.teacher && bySubject ? 'is-missing' : undefined}>
                              <div className="gp-cell">
                                <TeacherSelect
                                  value={cell?.teacher?.id}
                                  teachers={teachers}
                                  emptyLabel={bySubject ? 'Sin profesor' : s.homeroom?.lead ? `Titular (${s.homeroom.lead.name})` : 'Titular'}
                                  disabled={readOnly}
                                  onChange={(id) => setSubjectTeacher(s, subject.id, id)}
                                  ariaLabel={`Profesor de ${subject.name} en la sección ${s.name}`}
                                />
                                <SaveMark state={marks[key]} />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
        )}
        {!bySubject && grade.has_curriculum && sections.length > 0 && (
          <p className="text-sm text-muted">En Primaria el titular dicta todas las materias; elige un profesor solo para las que tienen especialista.</p>
        )}
      </section>

      {editingSubject && (
        <SubjectEditModal
          subject={editingSubject}
          gradeName={grade.name}
          inGrade={inCurriculum.has(editingSubject.id)}
          onRename={renameSubject}
          onDelete={deleteFromCatalog}
          onClose={() => setEditingSubject(null)}
        />
      )}
    </div>
  );
}

/** Editar el nombre de una materia del catálogo, o eliminarla (si se creó por error). */
function SubjectEditModal({ subject, gradeName, inGrade, onRename, onDelete, onClose }) {
  const [name, setName] = useState(subject.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === subject.name) return onClose();
    setSaving(true);
    setError(null);
    try {
      await onRename(subject, name.trim());
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <Modal title={`Materia · ${subject.name}`} onClose={onClose} size="sm">
      <Alert>{error}</Alert>
      <form onSubmit={save}>
        <Field label="Nombre" hint="El cambio se aplica en todos los grados que la tienen.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
        </Field>
        <div className="gp-danger-zone">
          <div>
            <strong>Eliminar del catálogo</strong>
            <p className="text-sm text-muted">
              {inGrade ? `Se quita de ${gradeName} y se borra del catálogo. ` : ''}Solo si no está en otros grados ni tiene planes de evaluación; si
              no, márcala como inactiva en Configuración general → Materias.
            </p>
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon="trash"
            onClick={async () => {
              if (await onDelete(subject)) onClose();
            }}
          >
            Eliminar
          </Button>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default GradeWorkspace;
