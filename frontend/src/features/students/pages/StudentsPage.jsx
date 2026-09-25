import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';

const STATUS_LABELS = { active: ['Activo', 'success'], inactive: ['Inactivo', 'neutral'], graduated: ['Egresado', 'primary'], withdrawn: ['Retirado', 'danger'] };

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('es', { timeZone: 'UTC' }) : null);

function StudentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.list(status ? { status } : undefined), [status]);
  const [editing, setEditing] = useState(null); // null = cerrado, {} = crear, {...} = editar

  const columns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (r) => (
        <Link to={`/students/${r.id}`} className="cell-person__name">
          {fullName(r)}
        </Link>
      ),
      sortValue: (r) => `${r.last_name} ${r.first_name}`,
    },
    { key: 'national_id', header: 'Documento' },
    { key: 'birth_date', header: 'Nacimiento', render: (r) => formatDate(r.birth_date) || '—', sortValue: (r) => r.birth_date },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => {
        const [label, variant] = STATUS_LABELS[r.status] || ['—', 'neutral'];
        return <Badge variant={variant}>{label}</Badge>;
      },
      sortValue: (r) => r.status,
    },
  ];

  return (
    <div>
      <PageHeader title="Alumnos" subtitle="Matrícula del colegio" />

      <DataTable
        title="Listado de alumnos"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por nombre o documento…"
        getSearchText={(r) => [fullName(r), r.national_id].join(' ')}
        filters={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([value, [label]]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
        emptyMessage="Aún no hay alumnos registrados."
        createLabel="Nuevo alumno"
        onCreate={() => setEditing({})}
        canCreate={can('students', 'create')}
        // "Ver" abre la ficha completa (representantes, sección actual), que ya es una página propia.
        onView={(r) => navigate(`/students/${r.id}`)}
        onEdit={setEditing}
        canEdit={can('students', 'update')}
        // Sin onDelete: el backend no expone DELETE /students/:id. Para dar de baja se cambia el estado.
      />

      {editing !== null && <StudentFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

function StudentFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    birthDate: initial.birth_date ? initial.birth_date.slice(0, 10) : '',
    nationalId: initial.national_id || '',
    status: initial.status || 'active',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => studentsApi.update(initial.id, data) : studentsApi.create
  );
  const toast = useToast();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Campos opcionales vacíos no se envían (una fecha "" no es válida para la BD).
    const data = {
      firstName: form.firstName,
      lastName: form.lastName,
      birthDate: form.birthDate || undefined,
      nationalId: form.nationalId || undefined,
      ...(isEdit ? { status: form.status } : {}),
    };
    try {
      await run(data);
      toast.success(isEdit ? 'Cambios guardados' : 'Alumno registrado', `${form.firstName} ${form.lastName}`);
      onSaved();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar alumno' : 'Nuevo alumno'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName} required>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName} required>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Fecha de nacimiento" error={fieldErrors.birthDate}>
            <Input type="date" name="birthDate" value={form.birthDate} onChange={handleChange} />
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} />
          </Field>
          {isEdit && (
            <Field label="Estado" error={fieldErrors.status} hint="Para dar de baja a un alumno, márcalo como Retirado.">
              <Select name="status" value={form.status} onChange={handleChange}>
                {Object.entries(STATUS_LABELS).map(([value, [label]]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Guardar cambios' : 'Crear alumno'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default StudentsPage;
