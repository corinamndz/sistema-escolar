import { useMemo, useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import ImportActions from '../../../components/import/ImportActions';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LEVELS, LEVEL_CODES, LevelBadge, LevelFilter } from '../levels';

function GradesTab({ onChanged }) {
  const { can } = useAuth();
  const { data: grades, loading, error, refetch } = useFetch(() => academicsApi.listGrades(), []);
  const reload = () => {
    refetch();
    onChanged?.();
  };
  const [level, setLevel] = useState('');
  const [editing, setEditing] = useState(null);
  const [curriculumFor, setCurriculumFor] = useState(null);

  const counts = useMemo(
    () => (grades || []).reduce((acc, g) => ({ ...acc, [g.level_code]: (acc[g.level_code] || 0) + 1 }), {}),
    [grades]
  );
  const rows = useMemo(() => (grades || []).filter((g) => !level || g.level_code === level), [grades, level]);

  const columns = [
    { key: 'name', header: 'Grado', render: (g) => <span className="cell-person__name">{g.name}</span>, sortValue: (g) => g.name },
    { key: 'level_code', header: 'Nivel', render: (g) => <LevelBadge code={g.level_code} />, sortValue: (g) => LEVEL_CODES.indexOf(g.level_code) },
    {
      key: 'subject_count',
      header: 'Materias',
      render: (g) =>
        g.has_curriculum ? (
          g.subject_count ? (
            `${g.subject_count} materia${g.subject_count === 1 ? '' : 's'}`
          ) : (
            <span className="teacher-stack__missing">Sin plan de estudios</span>
          )
        ) : (
          <span className="text-muted">No aplica</span>
        ),
      sortValue: (g) => g.subject_count,
    },
    { key: 'section_count', header: 'Secciones' },
    { key: 'sort_order', header: 'Orden' },
  ];

  return (
    <>
      <DataTable
        title="Grados"
        description="Todo grado pertenece a un nivel educativo; el nivel define cómo se asignan sus docentes."
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        getSearchText={(g) => [g.name, LEVELS[g.level_code]?.name].join(' ')}
        filters={<LevelFilter value={level} onChange={setLevel} counts={counts} />}
        emptyMessage="Aún no hay grados registrados."
        createLabel="Nuevo grado"
        onCreate={() => setEditing({ level_code: level || '' })}
        canCreate={can('academics', 'create')}
        headerActions={
          can('academics', 'create') && (
            <ImportActions
              type="grades"
              noun="grados"
              description="Nombre, nivel (Inicial, Primaria o Secundaria) y orden. El nivel define cómo se asignan los docentes de sus secciones."
              onImported={reload}
            />
          )
        }
        rowActions={[
          {
            key: 'curriculum',
            icon: 'clipboard',
            label: 'Plan de estudios (materias)',
            show: (g) => g.has_curriculum,
            onClick: setCurriculumFor,
          },
        ]}
        onEdit={setEditing}
        canEdit={can('academics', 'update')}
      />

      {editing !== null && <GradeFormModal initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {curriculumFor && (
        <CurriculumModal
          grade={curriculumFor}
          canEdit={can('academics', 'update')}
          onClose={() => setCurriculumFor(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

function GradeFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    name: initial.name || '',
    levelCode: initial.level_code || '',
    sortOrder: initial.sort_order ?? '',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => academicsApi.updateGrade(initial.id, data) : academicsApi.createGrade
  );
  const toast = useToast();
  const levelChanged = isEdit && form.levelCode !== initial.level_code;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({
        name: form.name,
        levelCode: form.levelCode,
        sortOrder: form.sortOrder === '' ? undefined : Number(form.sortOrder),
      });
      toast.success(isEdit ? 'Grado actualizado' : 'Grado creado', form.name);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal (ej. cambio de nivel con asignaciones incompatibles)
    }
  };

  return (
    <Modal title={isEdit ? `Editar ${initial.name}` : 'Nuevo grado'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Nivel educativo" error={fieldErrors.levelCode} required>
          <div className="level-picker" role="radiogroup" aria-label="Nivel educativo">
            {LEVEL_CODES.map((code) => (
              <label key={code} className={`level-picker__option level-picker__option--${code} ${form.levelCode === code ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="levelCode"
                  value={code}
                  checked={form.levelCode === code}
                  onChange={() => setForm((f) => ({ ...f, levelCode: code }))}
                  required
                />
                <span className="level-picker__icon">
                  <Icon name={LEVELS[code].icon} size={18} />
                </span>
                <span className="level-picker__name">{LEVELS[code].short}</span>
                <span className="level-picker__rule">{LEVELS[code].rule}</span>
              </label>
            ))}
          </div>
        </Field>
        {levelChanged && (
          <Alert variant="warning">
            Cambiar el nivel solo es posible si el grado no tiene asignaciones incompatibles (por ejemplo, materias al pasar a
            Primaria, o docentes auxiliares al pasar de Inicial a Primaria).
          </Alert>
        )}
        <div className="form-grid" style={{ marginTop: 16 }}>
          <Field label="Nombre" error={fieldErrors.name} required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="1er año" required />
          </Field>
          <Field label="Orden" hint="Posición del grado dentro de su nivel.">
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!form.levelCode}>
            {isEdit ? 'Guardar cambios' : 'Crear grado'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Plan de estudios de un grado de Primaria o Secundaria: qué materias tiene, en qué orden
 * y cuántas horas semanales. Se guarda la lista completa.
 */
function CurriculumModal({ grade, canEdit, onClose, onSaved }) {
  const { data, loading, error } = useFetch(() => academicsApi.getGradeSubjects(grade.id), [grade.id]);
  const { data: catalog, loading: loadingCatalog } = useFetch(() => academicsApi.listSubjects(), []);
  const [items, setItems] = useState(null); // [{ subjectId, name, code, weeklyHours, assignedSections }]
  const [toAdd, setToAdd] = useState('');
  const { run, loading: saving, error: saveError } = useMutation((subjects) => academicsApi.setGradeSubjects(grade.id, subjects));
  const toast = useToast();
  const confirm = useConfirm();

  if (data && items === null) {
    setItems(
      data.subjects.map((s) => ({
        subjectId: s.id,
        name: s.name,
        code: s.code,
        weeklyHours: s.weekly_hours ?? '',
        assignedSections: s.assigned_sections,
      }))
    );
  }

  const available = (catalog || []).filter((s) => s.is_active && !items?.some((i) => i.subjectId === s.id));
  const removedWithTeachers = (data?.subjects || []).filter(
    (s) => s.assigned_sections > 0 && !items?.some((i) => i.subjectId === s.id)
  );

  const add = () => {
    const subject = catalog.find((s) => s.id === toAdd);
    if (!subject) return;
    setItems((list) => [...list, { subjectId: subject.id, name: subject.name, code: subject.code, weeklyHours: '', assignedSections: 0 }]);
    setToAdd('');
  };
  const move = (index, delta) =>
    setItems((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  const handleSave = async () => {
    if (removedWithTeachers.length) {
      const ok = await confirm({
        title: 'Quitar materias con profesores asignados',
        message: `${removedWithTeachers.map((s) => s.name).join(', ')} tiene(n) profesor en ${removedWithTeachers.reduce((n, s) => n + s.assigned_sections, 0)} sección(es). Esas asignaciones se eliminarán.`,
        danger: true,
        confirmLabel: 'Quitar y guardar',
      });
      if (!ok) return;
    }
    try {
      const result = await run(items.map((i) => ({ subjectId: i.subjectId, weeklyHours: i.weeklyHours === '' ? null : Number(i.weeklyHours) })));
      toast.success(
        'Plan de estudios guardado',
        result.removedAssignments ? `${result.removedAssignments} asignación(es) docente(s) eliminada(s).` : `${grade.name}: ${items.length} materia(s).`
      );
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={`Plan de estudios · ${grade.name}`} onClose={onClose} size="lg">
      <Alert>{error || saveError}</Alert>
      {loading || loadingCatalog || items === null ? (
        <Spinner />
      ) : (
        <>
          <p style={{ marginTop: -6 }}>
            Materias que se dictan en <strong>{grade.name}</strong>. Luego, en cada sección, se asigna un profesor por materia.
          </p>

          {canEdit && (
            <div className="bulk-assign">
              <Icon name="plus" size={17} />
              <select className="input" value={toAdd} onChange={(e) => setToAdd(e.target.value)} aria-label="Materia a agregar">
                <option value="">{available.length ? 'Agregar materia…' : 'No hay más materias activas en el catálogo'}</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.code ? ` (${s.code})` : ''}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" onClick={add} disabled={!toAdd}>
                Agregar
              </Button>
            </div>
          )}

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="clipboard" size={22} />
              </div>
              <div className="empty-state__title">Sin materias</div>
              <div className="text-sm">
                Agrega materias desde el catálogo. Si no existen aún, créalas en la pestaña <strong>Materias</strong>.
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Materia</th>
                    <th style={{ width: 150 }}>Horas / semana</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.subjectId}>
                      <td className="text-muted">{index + 1}</td>
                      <td>
                        <div className="assign-table__subject">
                          {item.name}
                          {item.code && <span className="chip">{item.code}</span>}
                        </div>
                        {item.assignedSections > 0 && (
                          <div className="cell-person__sub">Con profesor en {item.assignedSections} sección(es)</div>
                        )}
                      </td>
                      <td>
                        <Input
                          type="number"
                          min="1"
                          max="40"
                          value={item.weeklyHours}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setItems((list) => list.map((i) => (i.subjectId === item.subjectId ? { ...i, weeklyHours: e.target.value } : i)))
                          }
                          aria-label={`Horas semanales de ${item.name}`}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canEdit && (
                          <div className="row-actions">
                            <button type="button" className="row-action" onClick={() => move(index, -1)} disabled={index === 0} title="Subir" aria-label="Subir">
                              <Icon name="chevronDown" size={15} style={{ transform: 'rotate(180deg)' }} />
                            </button>
                            <button type="button" className="row-action" onClick={() => move(index, 1)} disabled={index === items.length - 1} title="Bajar" aria-label="Bajar">
                              <Icon name="chevronDown" size={15} />
                            </button>
                            <button
                              type="button"
                              className="row-action row-action--delete"
                              onClick={() => setItems((list) => list.filter((i) => i.subjectId !== item.subjectId))}
                              title="Quitar del plan"
                              aria-label={`Quitar ${item.name}`}
                            >
                              <Icon name="x" size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {canEdit ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canEdit && (
              <Button type="button" onClick={handleSave} loading={saving}>
                Guardar plan de estudios
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export { CurriculumModal };
export default GradesTab;
