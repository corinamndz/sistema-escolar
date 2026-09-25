import { useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';

function GradesTab() {
  const { data: rows, loading, error, refetch } = useFetch(() => academicsApi.listGrades(), []);
  const [form, setForm] = useState({ name: '', sortOrder: '' });
  const { run, loading: saving, error: saveError, fieldErrors } = useMutation(academicsApi.createGrade);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ name: form.name, sortOrder: form.sortOrder ? Number(form.sortOrder) : undefined });
      setForm({ name: '', sortOrder: '' });
      refetch();
    } catch {
      // error visible arriba del formulario
    }
  };

  const columns = [
    { key: 'sort_order', header: 'Orden' },
    { key: 'name', header: 'Grado' },
  ];

  return (
    <div className="grid grid--2">
      <div className="card">
        <h3 className="card__title">Grados</h3>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} emptyMessage="Aún no hay grados registrados." />}
      </div>

      <RequirePermission module="academics" action="create">
        <div className="card">
          <h3 className="card__title">Nuevo grado</h3>
          <Alert>{saveError}</Alert>
          <form onSubmit={handleSubmit}>
            <Field label="Nombre" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="3er grado" required />
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Orden (para listar los grados en secuencia)">
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
            </Field>
            <div className="form-actions">
              <Button type="submit" loading={saving}>
                Crear
              </Button>
            </div>
          </form>
        </div>
      </RequirePermission>
    </div>
  );
}

export default GradesTab;
