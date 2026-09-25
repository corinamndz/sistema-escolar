import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import rolesApi from '../../../api/endpoints/roles.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { EXTRA_ACTIONS_BY_MODULE } from '../extraActions';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';

const CRUD = [
  { key: 'canCreate', label: 'Crear' },
  { key: 'canRead', label: 'Leer' },
  { key: 'canUpdate', label: 'Actualizar' },
  { key: 'canDelete', label: 'Eliminar' },
];

function buildInitialMatrix(modules, role) {
  const matrix = {};
  modules.forEach((mod) => {
    const existing = role?.permissions?.find((p) => p.module_code === mod.code);
    matrix[mod.code] = {
      canCreate: existing?.can_create || false,
      canRead: existing?.can_read || false,
      canUpdate: existing?.can_update || false,
      canDelete: existing?.can_delete || false,
      extraActions: { ...(existing?.extra_actions || {}) },
    };
  });
  return matrix;
}

function RoleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: modules, loading: loadingModules } = useFetch(() => rolesApi.listModules(), []);
  const { data: role, loading: loadingRole, error, refetch } = useFetch(() => rolesApi.getOne(id), [id]);

  const [matrix, setMatrix] = useState({});
  const { run: saveRun, loading: saving, error: saveError } = useMutation(rolesApi.setPermissions);
  const { run: removeRun, error: removeError } = useMutation(rolesApi.remove);
  const [success, setSuccess] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (modules && role) setMatrix(buildInitialMatrix(modules, role));
  }, [modules, role]);

  const toggleCrud = (moduleCode, key) => {
    setMatrix((m) => ({ ...m, [moduleCode]: { ...m[moduleCode], [key]: !m[moduleCode][key] } }));
  };

  const toggleExtra = (moduleCode, actionKey) => {
    setMatrix((m) => ({
      ...m,
      [moduleCode]: {
        ...m[moduleCode],
        extraActions: { ...m[moduleCode].extraActions, [actionKey]: !m[moduleCode].extraActions[actionKey] },
      },
    }));
  };

  const handleSave = async () => {
    setSuccess(false);
    const permissions = Object.entries(matrix).map(([moduleCode, perm]) => ({ moduleCode, ...perm }));
    try {
      await saveRun(id, permissions);
      await refetch();
      setSuccess(true);
    } catch {
      // el error queda visible abajo
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `¿Eliminar el rol "${role.name}"?`,
      message: 'Esta acción no se puede deshacer.',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeRun(id);
      toast.success('Rol eliminado', role.name);
      navigate('/roles');
    } catch {
      // el error queda visible abajo
    }
  };

  const loading = loadingModules || loadingRole;

  return (
    <div>
      <PageHeader
        title={role ? role.name : 'Rol'}
        subtitle={role?.is_system ? 'Rol del sistema' : 'Rol personalizado'}
        actions={
          <>
            <Link to="/roles" className="btn btn--secondary">
              Volver
            </Link>
            {role && !role.is_system && (
              <RequirePermission module="roles" action="delete">
                <Button variant="danger" onClick={handleDelete}>
                  Eliminar rol
                </Button>
              </RequirePermission>
            )}
          </>
        }
      />

      <Alert>{error || saveError || removeError}</Alert>
      <Alert variant="success">{success ? 'Permisos guardados.' : null}</Alert>

      {loading ? (
        <Spinner />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Módulo</th>
                  {CRUD.map((c) => (
                    <th key={c.key} style={{ textAlign: 'center' }}>
                      {c.label}
                    </th>
                  ))}
                  <th>Acciones especiales</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((mod) => (
                  <tr key={mod.code}>
                    <td>{mod.label}</td>
                    {CRUD.map((c) => (
                      <td key={c.key} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(matrix[mod.code]?.[c.key])}
                          onChange={() => toggleCrud(mod.code, c.key)}
                        />
                      </td>
                    ))}
                    <td>
                      {(EXTRA_ACTIONS_BY_MODULE[mod.code] || []).map((action) => (
                        <label key={action.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(matrix[mod.code]?.extraActions?.[action.key])}
                            onChange={() => toggleExtra(mod.code, action.key)}
                          />
                          {action.label}
                        </label>
                      ))}
                      {!(EXTRA_ACTIONS_BY_MODULE[mod.code] || []).length && <span className="text-muted text-sm">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <RequirePermission module="roles" action="update">
            <div className="form-actions">
              <Button onClick={handleSave} loading={saving}>
                Guardar permisos
              </Button>
            </div>
          </RequirePermission>
        </div>
      )}
    </div>
  );
}

export default RoleDetailPage;
