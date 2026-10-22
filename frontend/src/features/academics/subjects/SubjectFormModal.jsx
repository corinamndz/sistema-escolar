import { useEffect, useMemo, useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Switch from '../../../components/ui/Switch';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LEVELS, LEVEL_CODES } from '../levels';
import { sortByLabel } from '../../../utils/sortOptions';

/** Estado editable: gradeId → { offered, weeklyHours, sections: { sectionId → { available, teacherId } } }. */
function toFormState(grades) {
  return Object.fromEntries(
    grades.map((g) => [
      g.id,
      {
        offered: g.offered,
        weeklyHours: g.weekly_hours ?? '',
        // Grado sin la materia: al marcarlo, todas sus secciones quedan incluidas.
        sections: Object.fromEntries(g.sections.map((s) => [s.id, { available: g.offered ? s.available : true, teacherId: s.teacher?.id || null }])),
      },
    ])
  );
}

/** Docente de la materia en una sección. Vacío: en Inicial/Primaria la dicta el docente de aula. */
function TeacherSelect({ value, teachers, emptyLabel, onChange, disabled, ariaLabel }) {
  return (
    <select className="input subj-section__teacher" value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-label={ariaLabel}>
      <option value="">{emptyLabel}</option>
      {sortByLabel(teachers).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.inactive ? ' (inactivo)' : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Formulario de una materia del módulo de Materias: el nombre, en qué grados y
 * secciones se dicta y qué docente la imparte en cada sección. Todo se guarda
 * junto, en una sola operación.
 *
 * `period`: año escolar cuyas secciones se muestran (las del grado en ese año).
 */
function SubjectFormModal({ subject, period, onClose, onSaved }) {
  const isEdit = Boolean(subject?.id);
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error: loadError } = useFetch(
    () => (isEdit ? academicsApi.getSubjectAssignments(subject.id, period?.id) : academicsApi.getSubjectAssignmentOptions(period?.id)),
    [subject?.id, period?.id]
  );
  const [name, setName] = useState(subject?.name || '');
  const [isActive, setIsActive] = useState(subject?.is_active ?? true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data) setForm(toFormState(data.grades));
  }, [data]);

  const closed = Boolean(data?.school_period?.closed);
  const teachers = useMemo(() => (data?.teachers || []).filter((t) => !t.inactive), [data]);

  const groups = useMemo(
    () => LEVEL_CODES.map((code) => ({ code, grades: (data?.grades || []).filter((g) => g.level_code === code) })).filter((g) => g.grades.length),
    [data]
  );

  const setGrade = (gradeId, patch) => setForm((f) => ({ ...f, [gradeId]: { ...f[gradeId], ...patch } }));
  const setSection = (gradeId, sectionId, patch) =>
    setForm((f) => ({
      ...f,
      [gradeId]: { ...f[gradeId], sections: { ...f[gradeId].sections, [sectionId]: { ...f[gradeId].sections[sectionId], ...patch } } },
    }));
  /** Mismo docente en todas las secciones marcadas del grado. */
  const setAllTeachers = (gradeId, teacherId) =>
    setForm((f) => ({
      ...f,
      [gradeId]: {
        ...f[gradeId],
        sections: Object.fromEntries(Object.entries(f[gradeId].sections).map(([id, s]) => [id, s.available ? { ...s, teacherId } : s])),
      },
    }));

  // Resumen de lo marcado (encabezado de la lista).
  const summary = useMemo(() => {
    if (!form || !data) return { grades: 0, sections: 0, missing: 0 };
    let sections = 0;
    let missing = 0;
    for (const g of data.grades) {
      const st = form[g.id];
      if (!st?.offered) continue;
      for (const s of g.sections) {
        if (!st.sections[s.id]?.available) continue;
        sections += 1;
        if (!st.sections[s.id].teacherId && !(g.assignment_mode === 'homeroom' && s.homeroom_teacher)) missing += 1;
      }
    }
    return { grades: Object.values(form).filter((g) => g.offered).length, sections, missing };
  }, [form, data]);

  /** Grados desmarcados con contenido programático (se borra con la materia del grado). */
  const removedContents = () => (data?.grades || []).filter((g) => g.offered && !form[g.id].offered && g.content_count > 0);

  /** Docentes que se quitarían al guardar (grado o sección desmarcados que tenían docente). */
  const removedTeachers = () =>
    (data?.grades || []).flatMap((g) =>
      g.sections
        .filter((s) => g.offered && s.available && s.teacher && (!form[g.id].offered || !form[g.id].sections[s.id].available))
        .map((s) => `${g.name} ${s.name} (${s.teacher.name})`)
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const removed = removedTeachers();
    const contents = removedContents();
    if (removed.length || contents.length) {
      const parts = [
        removed.length ? `Se quitará su docente en ${removed.join(', ')}, junto con sus clases del horario.` : null,
        contents.length ? `Se borrará su contenido programático en ${contents.map((g) => `${g.name} (${g.content_count} tema${g.content_count === 1 ? '' : 's'})`).join(', ')}.` : null,
        'Si ya tiene planes de evaluación, no se podrá quitar.',
      ];
      const ok = await confirm({
        title: '¿Quitar la materia de esas secciones?',
        message: parts.filter(Boolean).join(' '),
        danger: true,
        confirmLabel: 'Guardar y quitar',
      });
      if (!ok) return;
    }
    const grades = data.grades
      .filter((g) => form[g.id].offered)
      .map((g) => {
        const st = form[g.id];
        return {
          gradeId: g.id,
          weeklyHours: st.weeklyHours === '' ? null : Number(st.weeklyHours),
          // Año finalizado: sus secciones son de solo lectura (solo se eligen grados).
          sections: closed
            ? undefined
            : g.sections.map((s) => ({
                sectionId: s.id,
                available: st.sections[s.id].available,
                ...(st.sections[s.id].available ? { teacherId: st.sections[s.id].teacherId } : {}),
              })),
        };
      });
    const body = { name: name.trim(), assignments: { grades } };
    setSaving(true);
    setError(null);
    try {
      const res = isEdit ? await academicsApi.updateSubject(subject.id, { ...body, isActive }) : await academicsApi.createSubject(body);
      const extra = [
        res.removedAssignments ? `${res.removedAssignments} docente(s) quitado(s)` : null,
        res.removedScheduleClasses ? `${res.removedScheduleClasses} clase(s) del horario quitada(s)` : null,
        res.removedContents ? `${res.removedContents} tema(s) del contenido programático borrado(s)` : null,
      ].filter(Boolean);
      toast.success(isEdit ? 'Materia actualizada' : 'Materia creada', [name.trim(), ...extra].join(' · '));
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? `Editar ${subject.name}` : 'Nueva materia'} onClose={onClose} size="lg">
      <Alert>{error || loadError}</Alert>
      {loading || !form ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Nombre de la materia" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Matemática, Biología" maxLength={100} required autoFocus={!isEdit} />
            </Field>
            {isEdit && (
              <div className="subj-active">
                <Switch checked={isActive} onChange={setIsActive} label="Materia activa" description="Inactiva: no se puede agregar a más grados." />
              </div>
            )}
          </div>

          <div className="subj-offering">
            <div className="subj-offering__head">
              <div>
                <strong>Grados y secciones</strong>
                <p className="text-sm text-muted">
                  Marca los grados donde se dicta y, en cada uno, las secciones y su docente
                  {data.school_period ? ` (secciones de ${data.school_period.name})` : ''}.
                </p>
              </div>
              <span className="subj-offering__summary text-sm">
                {summary.grades} grado{summary.grades === 1 ? '' : 's'} · {summary.sections} secci{summary.sections === 1 ? 'ón' : 'ones'}
                {summary.missing > 0 && <span className="subj-offering__missing"> · {summary.missing} sin docente</span>}
              </span>
            </div>

            {!data.school_period && <Alert variant="info">No hay un año escolar: elige los grados; las secciones y sus docentes se asignan cuando lo crees.</Alert>}
            {closed && <Alert variant="info">El año {data.school_period.name} está finalizado: sus secciones y docentes son de solo lectura.</Alert>}
            {groups.length === 0 && <Alert variant="warning">Aún no hay grados. Créalos en Configuración inicial → Grados y aulas.</Alert>}

            {groups.map((group) => (
              <div key={group.code} className="subj-level">
                <h4 className={`subj-level__title subj-level__title--${group.code}`}>{LEVELS[group.code].name}</h4>
                {group.grades.map((g) => {
                  const st = form[g.id];
                  const homeroom = g.assignment_mode === 'homeroom';
                  const gradeHasPlans = g.offered && g.sections.some((s) => s.has_plans);
                  return (
                    <div key={g.id} className={`subj-grade ${st.offered ? 'is-on' : ''}`}>
                      <div className="subj-grade__head">
                        <label className="checkbox-row subj-grade__toggle" title={gradeHasPlans && st.offered ? 'Tiene planes de evaluación: no se puede quitar del grado' : undefined}>
                          <input type="checkbox" checked={st.offered} disabled={gradeHasPlans && st.offered} onChange={(e) => setGrade(g.id, { offered: e.target.checked })} />
                          <span>{g.name}</span>
                        </label>
                        {st.offered && (
                          <label className="subj-grade__hours">
                            <input
                              type="number"
                              className="input"
                              min="1"
                              max="40"
                              value={st.weeklyHours}
                              onChange={(e) => setGrade(g.id, { weeklyHours: e.target.value })}
                              placeholder="—"
                              aria-label={`Horas semanales en ${g.name}`}
                            />
                            h/sem.
                          </label>
                        )}
                        {st.offered && !closed && g.sections.filter((s) => st.sections[s.id].available).length > 1 && (
                          <select className="input subj-grade__all" value="" onChange={(e) => e.target.value && setAllTeachers(g.id, e.target.value === '-' ? null : e.target.value)} aria-label={`Mismo docente en todas las secciones de ${g.name}`}>
                            <option value="">Mismo docente en todas…</option>
                            <option value="-">{homeroom ? 'Docente de aula de cada sección' : 'Ninguno (quitar)'}</option>
                            {sortByLabel(teachers).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {st.offered &&
                        (g.sections.length === 0 ? (
                          <p className="subj-grade__empty text-sm text-muted">
                            {data.school_period ? `Sin secciones en ${data.school_period.name}: la materia quedará disponible en las que se creen.` : 'Disponible en todas sus secciones.'}
                          </p>
                        ) : (
                          <ul className="subj-sections">
                            {g.sections.map((s) => {
                              const sec = st.sections[s.id];
                              const lockedOn = sec.available && s.has_plans;
                              return (
                                <li key={s.id} className={`subj-section ${sec.available ? '' : 'is-off'}`}>
                                  <label className="checkbox-row" title={lockedOn ? 'Tiene planes de evaluación de esta materia: no se puede quitar' : undefined}>
                                    <input type="checkbox" checked={sec.available} disabled={closed || lockedOn} onChange={(e) => setSection(g.id, s.id, { available: e.target.checked })} />
                                    <span>Sección {s.name}</span>
                                  </label>
                                  {sec.available ? (
                                    <TeacherSelect
                                      value={sec.teacherId}
                                      teachers={sec.teacherId && !teachers.some((t) => t.id === sec.teacherId) ? [...teachers, ...data.teachers.filter((t) => t.id === sec.teacherId)] : teachers}
                                      emptyLabel={homeroom ? `Docente de aula${s.homeroom_teacher ? ` (${s.homeroom_teacher.name})` : ' (sin asignar)'}` : 'Sin docente'}
                                      onChange={(teacherId) => setSection(g.id, s.id, { teacherId })}
                                      disabled={closed}
                                      ariaLabel={`Docente de ${name || 'la materia'} en ${g.name} ${s.name}`}
                                    />
                                  ) : (
                                    <span className="text-sm text-muted">No se dicta en esta sección</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ))}
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-sm text-muted">Las secciones que se abran después en un grado marcado reciben la materia automáticamente.</p>
          </div>

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!name.trim()}>
              {isEdit ? 'Guardar cambios' : 'Crear materia'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default SubjectFormModal;
