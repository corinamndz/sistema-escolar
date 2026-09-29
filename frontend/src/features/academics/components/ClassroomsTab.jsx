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
import HelpTip from '../../../components/ui/HelpTip';
import ImportActions from '../../../components/import/ImportActions';

function ClassroomsTab({ onChanged }) {
  const { data: rows, loading, error, refetch } = useFetch(() => academicsApi.listClassrooms(), []);
  const [form, setForm] = useState({ name: '', capacity: '' });
  const { run, loading: saving, error: saveError, fieldErrors } = useMutation(academicsApi.createClassroom);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ name: form.name, capacity: form.capacity ? Number(form.capacity) : undefined });
      setForm({ name: '', capacity: '' });
      refetch();
      onChanged?.();
    } catch {
      // error visible arriba del formulario
    }
  };

  const columns = [
    { key: 'name', header: 'Aula' },
    { key: 'capacity', header: 'Capacidad', render: (r) => r.capacity ?? '—' },
  ];

  return (
    <div className="grid grid--2">
      <div className="card">
        <div className="card__header">
          <h3 className="card__title">
            Aulas físicas <span className="chip">Opcional</span>{' '}
            <HelpTip>
              Los salones reales del edificio. Al crear una sección puedes indicar en qué aula funciona; si no las registras, las
              secciones igual se pueden crear.
            </HelpTip>
          </h3>
          <RequirePermission module="academics" action="create">
            <div className="card__actions">
              <ImportActions
                type="classrooms"
                noun="aulas"
                size="sm"
                onImported={() => {
                  refetch();
                  onChanged?.();
                }}
              />
            </div>
          </RequirePermission>
        </div>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} emptyMessage="Aún no hay aulas registradas." />}
      </div>

      <RequirePermission module="academics" action="create">
        <div className="card">
          <h3 className="card__title">Nueva aula</h3>
          <Alert>{saveError}</Alert>
          <form onSubmit={handleSubmit}>
            <Field label="Nombre" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Aula 3B" required />
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Capacidad">
              <Input type="number" min="1" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </Field>
            <div className="form-actions">
              <Button type="submit" variant="secondary" icon="plus" loading={saving}>
                Agregar aula
              </Button>
            </div>
          </form>
        </div>
      </RequirePermission>
    </div>
  );
}

export default ClassroomsTab;
