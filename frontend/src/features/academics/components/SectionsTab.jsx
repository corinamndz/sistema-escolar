import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LEVEL_CODES, LevelBadge, LevelFilter, LevelRule } from '../levels';
import TeacherAssignmentModal from './TeacherAssignmentModal';

/** Resumen de la asignación docente de una sección, según su nivel. */
export function TeachersSummary({ section }) {
  if (section.assignment_mode === 'subjects') {
    const { total, assigned } = section.subjectCoverage || { total: 0, assigned: 0 };
    if (total === 0) return <span className="text-muted text-sm">Grado sin materias</span>;
    return (
      <div className="coverage-mini" title={`${assigned} de ${total} materias con profesor`}>
        <div className="progress-bar">
          <div className="progress-bar__fill" style={{ width: `${(assigned / total) * 100}%` }} />
        </div>
        <span className={assigned === total ? 'text-success' : 'text-muted'}>
          {assigned}/{total} materias
        </span>
      </div>
    );
  }
  const { lead, assistant } = section.teachers || {};
  return (
    <div className="teacher-stack">
      {lead ? <span>{lead.name}</span> : <span className="teacher-stack__missing">Sin titular</span>}
      {section.allows_assistant &&
        (assistant ? (
          <span className="cell-person__sub">Aux.: {assistant.name}</span>
        ) : (
          <span className="cell-person__sub teacher-stack__missing">Sin auxiliar</span>
        ))}
    </div>
  );
}

function SectionsTab() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data: sections, loading, error, refetch } = useFetch(() => academicsApi.listSections(), []);
  const [level, setLevel] = useState('');
  const [editing, setEditing] = useState(null); // null | {} crear | sección
  const [assigning, setAssigning] = useState(null); // id de sección

  const counts = useMemo(
    () => (sections || []).reduce((acc, s) => ({ ...acc, [s.level_code]: (acc[s.level_code] || 0) + 1 }), {}),
    [sections]
  );
  const rows = useMemo(() => (sections || []).filter((s) => !level || s.level_code === level), [sections, level]);

  const columns = [
    {
      key: 'name',
      header: 'Sección',
      render: (s) => (
        <div>
          <Link to={`/academics/sections/${s.id}`} className="cell-person__name">
            {s.grade_name} · {s.name}
          </Link>
          <div className="cell-person__sub">
            {s.school_period_name}
            {s.classroom_name && ` · ${s.classroom_name}`}
          </div>
        </div>
      ),
      sortValue: (s) => `${LEVEL_CODES.indexOf(s.level_code)}-${s.grade_name}-${s.name}`,
    },
    { key: 'level_code', header: 'Nivel', render: (s) => <LevelBadge code={s.level_code} />, sortValue: (s) => LEVEL_CODES.indexOf(s.level_code) },
    { key: 'teachers', header: 'Docentes', render: (s) => <TeachersSummary section={s} /> },
    {
      key: 'enrolled_count',
      header: 'Inscritos',
      render: (s) => (
        <span className={s.enrolled_count >= s.max_students ? 'text-danger' : undefined}>
          {s.enrolled_count}/{s.max_students}
        </span>
      ),
      sortValue: (s) => s.enrolled_count / s.max_students,
    },
  ];

  return (
    <>
      <DataTable
        title="Secciones"
        description="Cada sección pertenece a un grado y hereda las reglas docentes de su nivel."
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por grado, sección o docente…"
        getSearchText={(s) =>
          [s.grade_name, s.name, s.school_period_name, s.classroom_name, s.teachers?.lead?.name, s.teachers?.assistant?.name, LEVELS[s.level_code]?.short].join(' ')
        }
        filters={<LevelFilter value={level} onChange={setLevel} counts={counts} />}
        emptyMessage="Aún no hay secciones creadas."
        createLabel="Nueva sección"
        onCreate={() => setEditing({})}
        canCreate={can('academics', 'create')}
        rowActions={
          can('academics', 'update')
            ? [{ key: 'assign', icon: 'users', label: 'Asignar docentes', onClick: (s) => setAssigning(s.id) }]
            : []
        }
        onView={(s) => navigate(`/academics/sections/${s.id}`)}
        onEdit={setEditing}
        canEdit={can('academics', 'update')}
      />

      {editing !== null && (
        <SectionFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            refetch();
            // Recién creada: se abre directamente la asignación docente de su nivel.
            if (isNew && can('academics', 'update')) setAssigning(saved.id);
          }}
        />
      )}

      {assigning && <TeacherAssignmentModal sectionId={assigning} onClose={() => setAssigning(null)} onSaved={refetch} />}
    </>
  );
}

function SectionFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const { data: grades, loading: loadingGrades } = useFetch(() => academicsApi.listGrades(), []);
  const { data: periods, loading: loadingPeriods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const { data: classrooms, loading: loadingClassrooms } = useFetch(() => academicsApi.listClassrooms(), []);
  const toast = useToast();

  const [form, setForm] = useState({
    gradeId: initial.grade_id || '',
    schoolPeriodId: initial.school_period_id || '',
    classroomId: initial.classroom_id || '',
    name: initial.name || '',
    maxStudents: initial.max_students || 30,
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => academicsApi.updateSection(initial.id, data) : academicsApi.createSection
  );

  const selectedGrade = grades?.find((g) => g.id === form.gradeId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const base = { name: form.name, maxStudents: Number(form.maxStudents), classroomId: form.classroomId || null };
    try {
      const saved = await run(isEdit ? base : { ...base, gradeId: form.gradeId, schoolPeriodId: form.schoolPeriodId });
      toast.success(isEdit ? 'Sección actualizada' : 'Sección creada', `${saved.grade_name} ${saved.name}`);
      onClose();
      onSaved(saved, !isEdit);
    } catch {
      // error visible en el modal
    }
  };

  const loadingOptions = loadingGrades || loadingPeriods || loadingClassrooms;

  return (
    <Modal title={isEdit ? `Editar sección ${initial.grade_name} ${initial.name}` : 'Nueva sección'} onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingOptions ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field
              label="Grado"
              error={fieldErrors.gradeId}
              required
              hint={isEdit ? 'El grado no se puede cambiar: definiría otro nivel y otras reglas docentes.' : undefined}
            >
              <Select value={form.gradeId} onChange={set('gradeId')} required disabled={isEdit}>
                <option value="">Selecciona…</option>
                {LEVEL_CODES.map((code) => {
                  const list = grades.filter((g) => g.level_code === code);
                  return list.length ? (
                    <optgroup key={code} label={LEVELS[code].name}>
                      {list.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </Select>
            </Field>
            <Field label="Año escolar" error={fieldErrors.schoolPeriodId} required>
              <Select value={form.schoolPeriodId} onChange={set('schoolPeriodId')} required disabled={isEdit}>
                <option value="">Selecciona…</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedGrade && !isEdit && (
              <div className="form-field--full">
                <LevelRule code={selectedGrade.level_code} />
              </div>
            )}
            <Field label="Nombre de la sección" error={fieldErrors.name} required>
              <Input value={form.name} onChange={set('name')} placeholder="A" required />
            </Field>
            <Field label="Cupo máximo" error={fieldErrors.maxStudents} required>
              <Input type="number" min="1" value={form.maxStudents} onChange={set('maxStudents')} required />
            </Field>
            <Field label="Aula física" full>
              <Select value={form.classroomId} onChange={set('classroomId')}>
                <option value="">Sin asignar</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {grades.length === 0 && <Alert variant="warning">Primero crea al menos un grado en la pestaña Grados.</Alert>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              {isEdit ? 'Guardar cambios' : 'Crear y asignar docentes'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default SectionsTab;
