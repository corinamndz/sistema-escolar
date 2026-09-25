import { useState } from 'react';
import staffApi from '../../../api/endpoints/staff.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import DetailModal from '../../../components/ui/DetailModal';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';

const STAFF_TYPE_LABELS = {
  administrative: 'Administrativo',
  teaching: 'Docente',
  support: 'Obrero',
};

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('es', { timeZone: 'UTC' }) : null);

function StatusBadge({ status }) {
  return <Badge variant={status === 'active' ? 'success' : 'neutral'}>{status === 'active' ? 'Activo' : 'Inactivo'}</Badge>;
}

function StaffPage() {
  const { can } = useAuth();
  const [staffType, setStaffType] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(
    () => staffApi.list(staffType ? { staffType } : undefined),
    [staffType]
  );
  const [editing, setEditing] = useState(null); // null = cerrado, {} = crear, {...} = editar
  const [viewing, setViewing] = useState(null);

  const columns = [
    {
      key: 'name',
      header: 'Nombre',
      render: (r) => (
        <div className="cell-person">
          <span className="avatar avatar--sm">{`${r.first_name[0] || ''}${r.last_name[0] || ''}`.toUpperCase()}</span>
          <div>
            <div className="cell-person__name">{fullName(r)}</div>
            {r.national_id && <div className="cell-person__sub">{r.national_id}</div>}
          </div>
        </div>
      ),
      sortValue: (r) => `${r.last_name} ${r.first_name}`,
    },
    {
      key: 'staff_type',
      header: 'Tipo',
      render: (r) => <Badge variant="primary">{STAFF_TYPE_LABELS[r.staff_type]}</Badge>,
      sortValue: (r) => STAFF_TYPE_LABELS[r.staff_type],
    },
    { key: 'phone', header: 'Teléfono' },
    { key: 'email', header: 'Correo' },
    { key: 'status', header: 'Estado', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
  ];

  return (
    <div>
      <PageHeader title="Personal del colegio" subtitle="Administrativo, docente y obrero" />

      <DataTable
        title="Listado de personal"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por nombre, documento, correo…"
        getSearchText={(r) => [fullName(r), r.national_id, r.email, r.phone, STAFF_TYPE_LABELS[r.staff_type]].join(' ')}
        filters={
          <Select value={staffType} onChange={(e) => setStaffType(e.target.value)} aria-label="Filtrar por tipo">
            <option value="">Todos los tipos</option>
            <option value="administrative">Administrativo</option>
            <option value="teaching">Docente</option>
            <option value="support">Obrero</option>
          </Select>
        }
        emptyMessage="Aún no hay personal registrado."
        createLabel="Nuevo personal"
        onCreate={() => setEditing({})}
        canCreate={can('staff', 'create')}
        onView={setViewing}
        onEdit={setEditing}
        canEdit={can('staff', 'update')}
        onDelete={(r) => staffApi.remove(r.id)}
        canDelete={can('staff', 'delete')}
        deleteConfirm={(r) => ({
          title: `¿Eliminar a ${fullName(r)}?`,
          message: 'El registro del personal se eliminará del colegio. Esta acción no se puede deshacer.',
          successMessage: `${fullName(r)} fue eliminado`,
        })}
        onDeleted={refetch}
      />

      {viewing && (
        <DetailModal
          title={fullName(viewing)}
          subtitle={STAFF_TYPE_LABELS[viewing.staff_type]}
          badge={<StatusBadge status={viewing.status} />}
          fields={[
            { label: 'Cédula / documento', value: viewing.national_id },
            { label: 'Fecha de contratación', value: formatDate(viewing.hired_at) },
            { label: 'Teléfono', value: viewing.phone },
            { label: 'Correo', value: viewing.email },
          ]}
          onClose={() => setViewing(null)}
          onEdit={
            can('staff', 'update')
              ? () => {
                  setEditing(viewing);
                  setViewing(null);
                }
              : undefined
          }
        />
      )}

      {editing !== null && (
        <StaffFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />
      )}
    </div>
  );
}

function StaffFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    staffType: initial.staff_type || 'teaching',
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    nationalId: initial.national_id || '',
    phone: initial.phone || '',
    email: initial.email || '',
    hiredAt: initial.hired_at ? initial.hired_at.slice(0, 10) : '',
    status: initial.status || 'active',
  });
  const { run, loading, error, fieldErrors } = useMutation(isEdit ? (data) => staffApi.update(initial.id, data) : staffApi.create);
  const toast = useToast();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run(form);
      toast.success(isEdit ? 'Cambios guardados' : 'Personal registrado', `${form.firstName} ${form.lastName}`);
      onSaved();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar personal' : 'Nuevo personal'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName}>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName}>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Tipo de personal" error={fieldErrors.staffType}>
            <Select name="staffType" value={form.staffType} onChange={handleChange}>
              <option value="administrative">Administrativo</option>
              <option value="teaching">Docente</option>
              <option value="support">Obrero</option>
            </Select>
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} />
          </Field>
          <Field label="Teléfono" error={fieldErrors.phone}>
            <Input name="phone" value={form.phone} onChange={handleChange} />
          </Field>
          <Field label="Correo" error={fieldErrors.email}>
            <Input type="email" name="email" value={form.email} onChange={handleChange} />
          </Field>
          <Field label="Fecha de contratación" error={fieldErrors.hiredAt}>
            <Input type="date" name="hiredAt" value={form.hiredAt} onChange={handleChange} />
          </Field>
          {isEdit && (
            <Field label="Estado">
              <Select name="status" value={form.status} onChange={handleChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </Select>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default StaffPage;
