import { useState } from 'react';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';

function GuardiansPage() {
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.listGuardians(), []);
  const [editing, setEditing] = useState(null);

  const columns = [
    { key: 'name', header: 'Nombre', render: (g) => `${g.first_name} ${g.last_name}` },
    { key: 'phone', header: 'Teléfono', render: (g) => g.phone || '—' },
    { key: 'email', header: 'Correo', render: (g) => g.email || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => (
        <RequirePermission module="guardians" action="update">
          <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>
            Editar
          </Button>
        </RequirePermission>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Representantes"
        actions={
          <RequirePermission module="guardians" action="create">
            <Button onClick={() => setEditing({})}>+ Nuevo representante</Button>
          </RequirePermission>
        }
      />

      <div className="card">
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} />}
      </div>

      {editing !== null && <GuardianFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

function GuardianFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    nationalId: initial.national_id || '',
    phone: initial.phone || '',
    email: initial.email || '',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => studentsApi.updateGuardian(initial.id, data) : studentsApi.createGuardian
  );

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run(form);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar representante' : 'Nuevo representante'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName}>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName}>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} />
          </Field>
          <Field label="Teléfono" error={fieldErrors.phone}>
            <Input name="phone" value={form.phone} onChange={handleChange} />
          </Field>
          <Field label="Correo (para el comprobante de pago)" error={fieldErrors.email} full>
            <Input type="email" name="email" value={form.email} onChange={handleChange} />
          </Field>
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

export default GuardiansPage;
