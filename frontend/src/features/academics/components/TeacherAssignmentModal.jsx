import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { LevelBadge, LevelRule, STAFF_ROLES, teacherName } from '../levels';

const HINTS = {
  lead: { initial: 'Responsable principal de la sección.', primary: 'Docente de grado: atiende la sección y dicta las materias que no tengan otro docente.' },
  assistant: 'Acompaña al docente en el aula.',
  guide: 'Responsable del grupo (tutoría). Los docentes de cada materia se asignan en Materias.',
};

/** Docentes seleccionables: activos, más los ya asignados aquí (aunque luego se inactivaran). */
function useTeacherOptions(load, assignedIds) {
  return useMemo(
    () =>
      (load || [])
        .filter((t) => t.status === 'active' || assignedIds.includes(t.id))
        .map((t) => ({
          id: t.id,
          label: teacherName(t),
          detail: t.assignments.length === 0 ? 'sin asignaciones' : `${t.assignments.length} asignación${t.assignments.length === 1 ? '' : 'es'}`,
          inactive: t.status !== 'active',
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load, assignedIds.join()]
  );
}

/**
 * Personal docente de una sección según el nivel de su grado (leído del backend):
 *   Inicial     docente + docente auxiliar
 *   Primaria    docente
 *   Secundaria  docente guía
 * Los docentes por materia se asignan en el módulo de Materias. Las opciones
 * muestran la carga actual de cada docente para repartir mejor.
 */
function TeacherAssignmentModal({ sectionId, onClose, onSaved }) {
  const { data, loading, error } = useFetch(() => academicsApi.getSectionTeachers(sectionId), [sectionId]);
  const { data: load, loading: loadingLoad } = useFetch(() => academicsApi.getTeachingLoad(), []);
  const section = data?.section;

  return (
    <Modal title={section ? `Personal docente · ${section.grade_name} ${section.name}` : 'Personal docente'} onClose={onClose}>
      <Alert>{error}</Alert>
      {loading || loadingLoad || !data ? <Spinner /> : <StaffForm data={data} load={load} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function StaffForm({ data, load, onClose, onSaved }) {
  const { section } = data;
  const roles = STAFF_ROLES[section.level_code] || [];
  const initial = {
    lead: data.homeroom?.lead?.id || null,
    assistant: data.homeroom?.assistant?.id || null,
    guide: data.guide?.id || null,
  };
  const [value, setValue] = useState(initial);
  const options = useTeacherOptions(load, Object.values(initial).filter(Boolean));
  const toast = useToast();
  const { run, loading, error, fieldErrors } = useMutation((body) => academicsApi.setSectionTeachers(section.id, body));

  const set = (key) => (e) =>
    setValue((v) => {
      const next = { ...v, [key]: e.target.value || null };
      // El docente elegido como titular deja de ser el auxiliar.
      if (key === 'lead' && next.lead && next.lead === next.assistant) next.assistant = null;
      return next;
    });
  const assistantError = value.assistant && !value.lead ? 'Asigna primero el docente.' : null;
  const dirty = roles.some((r) => value[r.key] !== initial[r.key]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (assistantError) return;
    const body =
      data.mode === 'subjects'
        ? { guideTeacherId: value.guide }
        : { leadTeacherId: value.lead, ...(section.allows_assistant ? { assistantTeacherId: value.assistant } : {}) };
    try {
      await run(body);
      toast.success('Personal docente guardado', `${section.grade_name} ${section.name}`);
      onSaved?.();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="assign-head">
        <LevelRule code={section.level_code} />
        <div className="assign-head__meta">
          <LevelBadge code={section.level_code} />
          <span className="text-sm text-muted">Año escolar {section.school_period_name}</span>
        </div>
      </div>
      <Alert>{error}</Alert>
      <div className={roles.length > 1 ? 'form-grid' : ''}>
        {roles.map((r) => (
          <Field
            key={r.key}
            label={r.label}
            error={(r.key === 'assistant' && assistantError) || fieldErrors[`${r.key}TeacherId`]}
            hint={typeof HINTS[r.key] === 'string' ? HINTS[r.key] : HINTS[r.key][section.level_code]}
          >
            <Select sorted value={value[r.key] || ''} onChange={set(r.key)} error={r.key === 'assistant' && Boolean(assistantError)}>
              <option value="">Sin asignar</option>
              {options
                .filter((o) => r.key !== 'assistant' || o.id !== value.lead)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} — {o.inactive ? 'inactivo' : o.detail}
                  </option>
                ))}
            </Select>
          </Field>
        ))}
      </div>
      {options.length === 0 && <Alert variant="warning">No hay personal docente activo. Regístralo en el módulo Personal con tipo "Docente".</Alert>}
      {section.has_curriculum && (
        <p className="text-sm text-muted assign-subjects-note">
          <Icon name="book" size={14} /> Los docentes de cada materia se asignan en{' '}
          <Link to="/academics/subjects" onClick={onClose}>
            Materias
          </Link>
          .
        </p>
      )}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={loading} disabled={!dirty || Boolean(assistantError)}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

export default TeacherAssignmentModal;
