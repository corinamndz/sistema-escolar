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
import Badge from '../../../components/ui/Badge';

function SchoolPeriodsTab() {
  const { data: rows, loading, error, refetch } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const { run, loading: saving, error: saveError, fieldErrors } = useMutation(academicsApi.createSchoolPeriod);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run(form);
      setForm({ name: '', startDate: '', endDate: '' });
      refetch();
    } catch {
      // error visible arriba del formulario
    }
  };

  const columns = [
    { key: 'name', header: 'Año escolar' },
    { key: 'start_date', header: 'Inicio', render: (r) => (r.start_date ? r.start_date.slice(0, 10) : '—') },
    { key: 'end_date', header: 'Fin', render: (r) => (r.end_date ? r.end_date.slice(0, 10) : '—') },
    { key: 'is_active', header: 'Estado', render: (r) => <Badge variant={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Activo' : 'Cerrado'}</Badge> },
  ];

  return (
    <div className="grid grid--2">
      <div className="card">
        <h3 className="card__title">Años escolares</h3>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} emptyMessage="Aún no hay años escolares." />}
      </div>

      <RequirePermission module="academics" action="create">
        <div className="card">
          <h3 className="card__title">Nuevo año escolar</h3>
          <Alert>{saveError}</Alert>
          <form onSubmit={handleSubmit}>
            <Field label="Nombre" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="2026-2027" required />
            </Field>
            <div style={{ height: 12 }} />
            <div className="form-grid">
              <Field label="Fecha de inicio">
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </Field>
              <Field label="Fecha de fin">
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </Field>
            </div>
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

export default SchoolPeriodsTab;
