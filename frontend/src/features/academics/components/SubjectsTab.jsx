import { useState } from 'react';
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
import Badge from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';

/** Catálogo de materias del colegio (se usan en los planes de estudio de Secundaria). */
function SubjectsTab() {
  const { can } = useAuth();
  const { data: rows, loading, error, refetch } = useFetch(() => academicsApi.listSubjects(), []);
  const [editing, setEditing] = useState(null);

  const columns = [
    {
      key: 'name',
      header: 'Materia',
      render: (s) => (
        <div>
          <div className="assign-table__subject cell-person__name">
            {s.name}
            {s.code && <span className="chip">{s.code}</span>}
          </div>
          {s.description && <div className="cell-person__sub">{s.description}</div>}
        </div>
      ),
      sortValue: (s) => s.name,
    },
    { key: 'grade_count', header: 'Grados', render: (s) => (s.grade_count ? `${s.grade_count} grado(s)` : '—'), sortValue: (s) => s.grade_count },
    {
      key: 'assignment_count',
      header: 'Secciones con profesor',
      render: (s) => s.assignment_count || '—',
      sortValue: (s) => s.assignment_count,
    },
    {
      key: 'is_active',
      header: 'Estado',
      render: (s) => <Badge variant={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Activa' : 'Inactiva'}</Badge>,
      sortValue: (s) => (s.is_active ? 0 : 1),
    },
  ];

  return (
    <>
      <DataTable
        title="Materias"
        description="Catálogo de asignaturas. Se agregan al plan de estudios de cada grado de Secundaria."
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar materia o abreviatura…"
        getSearchText={(s) => [s.name, s.code, s.description].join(' ')}
        emptyMessage="Aún no hay materias en el catálogo."
        createLabel="Nueva materia"
        onCreate={() => setEditing({})}
        canCreate={can('academics', 'create')}
        onEdit={setEditing}
        canEdit={can('academics', 'update')}
        onDelete={(s) => academicsApi.deleteSubject(s.id)}
        canDelete={can('academics', 'delete')}
        deleteConfirm={(s) => ({
          title: `¿Eliminar la materia "${s.name}"?`,
          message:
            s.grade_count > 0
              ? `Está en el plan de estudios de ${s.grade_count} grado(s); el sistema no permitirá eliminarla. Puedes marcarla como inactiva.`
              : 'Esta acción no se puede deshacer.',
          successMessage: `Materia "${s.name}" eliminada`,
        })}
        onDeleted={refetch}
      />
      {editing !== null && <SubjectFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </>
  );
}

function SubjectFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    name: initial.name || '',
    code: initial.code || '',
    description: initial.description || '',
    isActive: initial.is_active ?? true,
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => academicsApi.updateSubject(initial.id, data) : academicsApi.createSubject
  );
  const toast = useToast();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = { name: form.name, code: form.code.trim(), description: form.description.trim() };
    try {
      await run(isEdit ? { ...data, isActive: form.isActive } : { ...data, code: data.code || undefined, description: data.description || undefined });
      toast.success(isEdit ? 'Materia actualizada' : 'Materia creada', form.name);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal (ej. nombre repetido)
    }
  };

  return (
    <Modal title={isEdit ? `Editar ${initial.name}` : 'Nueva materia'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombre" error={fieldErrors.name} required>
            <Input value={form.name} onChange={set('name')} placeholder="Matemática" maxLength={100} required />
          </Field>
          <Field label="Abreviatura" error={fieldErrors.code} hint="Opcional. Ej.: MAT">
            <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={20} />
          </Field>
          <Field label="Descripción" error={fieldErrors.description} full>
            <textarea className="input" rows={2} value={form.description} onChange={set('description')} maxLength={500} />
          </Field>
          {isEdit && (
            <Field label="Estado" full hint="Una materia inactiva no se puede agregar a nuevos planes de estudio.">
              <label className="checkbox-row">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Materia activa
              </label>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Guardar cambios' : 'Crear materia'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default SubjectsTab;
