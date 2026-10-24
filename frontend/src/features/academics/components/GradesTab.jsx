import { useMemo, useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import ImportActions from '../../../components/import/ImportActions';
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

  const counts = useMemo(
    () => (grades || []).reduce((acc, g) => ({ ...acc, [g.level_code]: (acc[g.level_code] || 0) + 1 }), {}),
    [grades]
  );
  const rows = useMemo(() => (grades || []).filter((g) => !level || g.level_code === level), [grades, level]);

  const columns = [
    { key: 'name', header: 'Grado', render: (g) => <span className="cell-person__name">{g.name}</span>, sortValue: (g) => g.name },
    { key: 'level_code', header: 'Nivel', render: (g) => <LevelBadge code={g.level_code} />, sortValue: (g) => LEVEL_CODES.indexOf(g.level_code) },
    { key: 'section_count', header: 'Secciones' },
    { key: 'sort_order', header: 'Orden' },
  ];

  return (
    <>
      <DataTable
        title="Grados"
        description="Todo grado pertenece a un nivel educativo; el nivel define el personal docente de sus secciones."
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
        onEdit={setEditing}
        canEdit={can('academics', 'update')}
      />

      {editing !== null && <GradeFormModal initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
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
    <Drawer title={isEdit ? `Editar ${initial.name}` : 'Nuevo grado'} onClose={onClose}>
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
            Cambiar el nivel solo es posible si el grado no tiene personal incompatible (por ejemplo, docentes auxiliares al pasar
            de Inicial a Primaria, o docentes de aula al pasar a Secundaria).
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
    </Drawer>
  );
}

export default GradesTab;
