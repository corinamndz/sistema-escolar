import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import rolesApi from '../../../api/endpoints/roles.api';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';

function RolesPage() {
  const { data: roles, loading, error, refetch } = useFetch(() => rolesApi.list(), []);
  const [showCreate, setShowCreate] = useState(false);

  const columns = [
    { key: 'name', header: 'Rol', render: (r) => <Link to={`/roles/${r.id}`}>{r.name}</Link> },
    {
      key: 'is_system',
      header: 'Tipo',
      render: (r) => (r.is_system ? <Badge variant="primary">Del sistema</Badge> : <Badge>Personalizado</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="table__actions">
          <Link to={`/roles/${r.id}`} className="btn btn--secondary btn--sm">
            Editar permisos
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles y permisos"
        subtitle="Define qué puede hacer cada rol en cada módulo del sistema"
        actions={
          <RequirePermission module="roles" action="create">
            <Button onClick={() => setShowCreate(true)}>+ Nuevo rol</Button>
          </RequirePermission>
        }
      />

      <div className="card">
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={roles} />}
      </div>

      {showCreate && <CreateRoleModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
    </div>
  );
}

function CreateRoleModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const { run, loading, error } = useMutation(rolesApi.create);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ name });
      onCreated();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Modal title="Nuevo rol" onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Nombre del rol">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ej. Coordinador académico" required />
        </Field>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default RolesPage;
