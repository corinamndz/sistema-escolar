import { useEffect, useMemo, useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LevelBadge, LevelRule, teacherName } from '../levels';

/**
 * Asignación docente de una sección. La interfaz se adapta al nivel del grado
 * (leído del backend, no elegido por el usuario):
 *   Inicial     → selector de titular + selector de auxiliar
 *   Primaria    → selector de titular único + materias del plan de estudios:
 *                 las dicta el titular salvo que se elija un especialista
 *   Secundaria  → una fila por materia del plan de estudios, con su profesor
 *
 * Las opciones de docente muestran su carga actual para repartir mejor.
 */
function TeacherAssignmentModal({ sectionId, onClose, onSaved }) {
  const { data, loading, error } = useFetch(() => academicsApi.getSectionTeachers(sectionId), [sectionId]);
  const { data: load, loading: loadingLoad } = useFetch(() => academicsApi.getTeachingLoad(), []);

  const section = data?.section;
  const title = section ? `Asignar docentes · ${section.grade_name} ${section.name}` : 'Asignar docentes';

  return (
    <Modal title={title} onClose={onClose} size={data?.mode === 'subjects' || data?.subjects?.length ? 'lg' : undefined}>
      <Alert>{error}</Alert>
      {loading || loadingLoad || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="assign-head">
            <LevelRule code={section.level_code} />
            <div className="assign-head__meta">
              <LevelBadge code={section.level_code} />
              <span className="text-sm text-muted">Año escolar {section.school_period_name}</span>
            </div>
          </div>
          {data.mode === 'homeroom' ? (
            <HomeroomForm data={data} load={load} onClose={onClose} onSaved={onSaved} />
          ) : (
            <SubjectsForm data={data} load={load} onClose={onClose} onSaved={onSaved} />
          )}
        </>
      )}
    </Modal>
  );
}

/** Docentes seleccionables: activos, más los que ya están asignados aquí (aunque luego se inactivaran). */
function useTeacherOptions(load, assignedIds) {
  return useMemo(
    () =>
      (load || [])
        .filter((t) => t.status === 'active' || assignedIds.includes(t.id))
        .map((t) => ({
          id: t.id,
          label: teacherName(t),
          detail:
            t.assignments.length === 0
              ? 'sin asignaciones'
              : `${t.assignments.length} asignación${t.assignments.length === 1 ? '' : 'es'}`,
          inactive: t.status !== 'active',
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, assignedIds.join()]
  );
}

function TeacherSelect({ value, onChange, options, excludeId, placeholder = 'Sin asignar', ...props }) {
  return (
    <Select sorted value={value || ''} onChange={(e) => onChange(e.target.value || null)} {...props}>
      <option value="">{placeholder}</option>
      {options
        .filter((o) => o.id !== excludeId)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} — {o.inactive ? 'inactivo' : o.detail}
          </option>
        ))}
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Inicial / Primaria
// ---------------------------------------------------------------------------

function HomeroomForm({ data, load, onClose, onSaved }) {
  const { section, homeroom, subjects = [] } = data;
  const allowsAssistant = section.allows_assistant;
  const initial = { lead: homeroom.lead?.id || null, assistant: homeroom.assistant?.id || null };
  const [lead, setLead] = useState(initial.lead);
  const [assistant, setAssistant] = useState(initial.assistant);
  // Primaria: especialista por materia (null = la dicta el titular).
  const initialSpecialists = useMemo(() => Object.fromEntries(subjects.map((x) => [x.id, x.teacher?.id || null])), [subjects]);
  const [specialists, setSpecialists] = useState(initialSpecialists);
  const options = useTeacherOptions(load, [initial.lead, initial.assistant, ...Object.values(initialSpecialists)].filter(Boolean));
  const toast = useToast();
  const { run, loading, error, fieldErrors } = useMutation((body) => academicsApi.setSectionTeachers(section.id, body));

  // Si el titular elegido es el mismo que el auxiliar, se libera el auxiliar.
  useEffect(() => {
    if (lead && lead === assistant) setAssistant(null);
  }, [lead, assistant]);

  const assistantError = assistant && !lead ? 'Asigna primero el docente titular.' : null;
  const changedSubjects = subjects.filter((x) => specialists[x.id] !== initialSpecialists[x.id]);
  const dirty = lead !== initial.lead || assistant !== initial.assistant || changedSubjects.length > 0;
  const leadLabel = options.find((o) => o.id === lead)?.label;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (assistantError) return;
    const body = allowsAssistant ? { leadTeacherId: lead, assistantTeacherId: assistant } : { leadTeacherId: lead };
    if (changedSubjects.length) body.subjects = changedSubjects.map((x) => ({ subjectId: x.id, teacherId: specialists[x.id] }));
    try {
      await run(body);
      toast.success('Docentes asignados', `${section.grade_name} ${section.name}`);
      onSaved?.();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Alert>{error}</Alert>
      <div className={allowsAssistant ? 'form-grid' : ''}>
        <Field
          label="Docente titular"
          error={fieldErrors.leadTeacherId}
          hint={
            allowsAssistant
              ? 'Responsable principal de la sección.'
              : section.has_curriculum
                ? 'Maestra/o de grado: dicta todas las materias que no tengan especialista.'
                : 'Maestra/o de grado: atiende todas las áreas.'
          }
        >
          <TeacherSelect value={lead} onChange={setLead} options={options} />
        </Field>
        {allowsAssistant && (
          <Field label="Docente auxiliar" error={assistantError || fieldErrors.assistantTeacherId} hint="Acompaña al titular en el aula.">
            <TeacherSelect value={assistant} onChange={setAssistant} options={options} excludeId={lead} error={Boolean(assistantError)} />
          </Field>
        )}
      </div>
      {options.length === 0 && (
        <Alert variant="warning">No hay personal docente activo. Regístralo en el módulo Personal con tipo "Docente".</Alert>
      )}

      {section.has_curriculum && (
        <div className="specialists">
          <div className="specialists__head">
            <strong>Materias del plan de estudios</strong>
            <span className="text-sm text-muted">
              Por defecto las dicta el titular. Elige un especialista solo para las materias que da otro docente (ej. Inglés,
              Educación Física).
            </span>
          </div>
          {subjects.length === 0 ? (
            <Alert variant="info">
              {section.grade_name} todavía no tiene materias. Configura su plan de estudios en Estructura académica → Paso 3 para
              evaluar por materia.
            </Alert>
          ) : (
            <div className="table-wrap">
              <table className="table assign-table">
                <thead>
                  <tr>
                    <th>Materia</th>
                    <th style={{ width: '52%' }}>Quién la dicta</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((x) => {
                    const isChanged = specialists[x.id] !== initialSpecialists[x.id];
                    return (
                      <tr key={x.id} className={isChanged ? 'is-changed' : undefined}>
                        <td>
                          <div className="assign-table__subject">
                            {x.name}
                            {x.code && <span className="chip">{x.code}</span>}
                            {isChanged && <span className="assign-table__dot" title="Cambio sin guardar" />}
                          </div>
                          {x.weekly_hours && <div className="cell-person__sub">{x.weekly_hours} h semanales</div>}
                        </td>
                        <td>
                          <TeacherSelect
                            value={specialists[x.id]}
                            onChange={(id) => setSpecialists((m) => ({ ...m, [x.id]: id }))}
                            options={options}
                            excludeId={lead}
                            placeholder={leadLabel ? `Titular (${leadLabel})` : 'Titular (sin asignar)'}
                            aria-label={`Docente de ${x.name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={loading} disabled={!dirty || Boolean(assistantError)}>
          Guardar asignación
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Secundaria
// ---------------------------------------------------------------------------

function SubjectsForm({ data, load, onClose, onSaved }) {
  const { section, subjects } = data;
  const initial = useMemo(() => Object.fromEntries(subjects.map((s) => [s.id, s.teacher?.id || null])), [subjects]);
  const [assigned, setAssigned] = useState(initial);
  const [bulkTeacher, setBulkTeacher] = useState(null);
  const options = useTeacherOptions(load, Object.values(initial).filter(Boolean));
  const toast = useToast();
  const { run, loading, error } = useMutation((body) => academicsApi.setSectionTeachers(section.id, body));

  const changed = subjects.filter((s) => assigned[s.id] !== initial[s.id]);
  const coverage = subjects.filter((s) => assigned[s.id]).length;
  const empty = subjects.filter((s) => !assigned[s.id]);

  // Cuántas materias lleva cada profesor en ESTA sección (para mostrarlo al lado del selector).
  const perTeacher = Object.values(assigned).reduce((acc, id) => (id ? { ...acc, [id]: (acc[id] || 0) + 1 } : acc), {});

  if (subjects.length === 0) {
    return (
      <>
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="clipboard" size={24} />
          </div>
          <div className="empty-state__title">{section.grade_name} todavía no tiene materias</div>
          <div className="text-sm">
            Configura su plan de estudios en la pestaña <strong>Grados</strong> (acción “Plan de estudios”) y vuelve aquí para
            asignar un profesor por materia.
          </div>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </>
    );
  }

  const applyBulk = () => {
    if (!bulkTeacher) return;
    setAssigned((a) => ({ ...a, ...Object.fromEntries(empty.map((s) => [s.id, bulkTeacher])) }));
    setBulkTeacher(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Solo se envían las materias modificadas (el backend acepta actualizaciones parciales).
      await run({ subjects: changed.map((s) => ({ subjectId: s.id, teacherId: assigned[s.id] })) });
      toast.success('Profesores asignados', `${changed.length} materia(s) actualizada(s) en ${section.grade_name} ${section.name}`);
      onSaved?.();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Alert>{error}</Alert>

      <div className="coverage">
        <div className="coverage__head">
          <span>
            <strong>{coverage}</strong> de {subjects.length} materias con profesor
          </span>
          {coverage === subjects.length ? (
            <span className="badge badge--success">Completa</span>
          ) : (
            <span className="badge badge--warning">Faltan {subjects.length - coverage}</span>
          )}
        </div>
        <div className={`progress-bar ${coverage === subjects.length ? 'progress-meter--complete' : ''}`}>
          <div className="progress-bar__fill" style={{ width: `${(coverage / subjects.length) * 100}%` }} />
        </div>
      </div>

      {empty.length > 0 && (
        <div className="bulk-assign">
          <Icon name="users" size={17} />
          <span className="text-sm">Asignar a las {empty.length} materias sin profesor:</span>
          <TeacherSelect value={bulkTeacher} onChange={setBulkTeacher} options={options} placeholder="Elige un profesor…" />
          <Button type="button" size="sm" variant="secondary" onClick={applyBulk} disabled={!bulkTeacher}>
            Aplicar
          </Button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table assign-table">
          <thead>
            <tr>
              <th>Materia</th>
              <th style={{ width: '48%' }}>Profesor</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => {
              const teacherId = assigned[s.id];
              const isChanged = teacherId !== initial[s.id];
              return (
                <tr key={s.id} className={isChanged ? 'is-changed' : !teacherId ? 'is-missing' : undefined}>
                  <td>
                    <div className="assign-table__subject">
                      {s.name}
                      {s.code && <span className="chip">{s.code}</span>}
                      {isChanged && <span className="assign-table__dot" title="Cambio sin guardar" />}
                    </div>
                    {s.weekly_hours && <div className="cell-person__sub">{s.weekly_hours} h semanales</div>}
                  </td>
                  <td>
                    <TeacherSelect
                      value={teacherId}
                      onChange={(id) => setAssigned((a) => ({ ...a, [s.id]: id }))}
                      options={options}
                      aria-label={`Profesor de ${s.name}`}
                    />
                    {teacherId && perTeacher[teacherId] > 1 && (
                      <div className="cell-person__sub">Da {perTeacher[teacherId]} materias en esta sección</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="form-actions">
        <span className="text-sm text-muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>
          {changed.length ? `${changed.length} cambio(s) sin guardar` : 'Sin cambios'}
        </span>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={loading} disabled={changed.length === 0}>
          Guardar asignación
        </Button>
      </div>
    </form>
  );
}

export default TeacherAssignmentModal;
