import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import disciplineApi from '../../../api/endpoints/discipline.api';
import studentsApi from '../../../api/endpoints/students.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { SanctionCard, SanctionFormModal, SeverityTotals, SEVERITIES, SEVERITY_KEYS } from '../components/SanctionParts';

/**
 * Convivencia: todas las sanciones (administración) o las de los alumnos de
 * la carga del docente (solo consulta). Filtros por gravedad y búsqueda.
 */
function DisciplinePage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [severity, setSeverity] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // búsqueda aplicada (con pausa al escribir)
  const [editing, setEditing] = useState(null);
  const { data, loading, error, refetch } = useFetch(() => disciplineApi.list({ severity: severity || undefined, q: q || undefined }), [severity, q]);
  const canCreate = can('discipline', 'create');
  const { data: students } = useFetch(() => (canCreate ? studentsApi.list({ status: 'active' }) : Promise.resolve([])), [canCreate]);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const remove = async (s) => {
    const ok = await confirm({
      title: '¿Eliminar esta sanción?',
      message: `"${s.fault_type}" de ${s.first_name} ${s.last_name}. Se borrará de su historial.`,
      danger: true,
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await disciplineApi.remove(s.id);
      toast.success('Sanción eliminada');
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Convivencia"
        subtitle="Registro de sanciones disciplinarias de los alumnos. Las familias las ven en el portal; cada docente, en la ficha de sus alumnos."
        actions={
          canCreate && (
            <Button icon="plus" onClick={() => setEditing({})}>
              Registrar sanción
            </Button>
          )
        }
      />

      <div className="card data-table student-groups__toolbar">
        <div className="data-table__toolbar">
          <div className="input-group data-table__search">
            <Icon name="search" size={17} className="input-group__icon" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar alumno, documento o falta…" aria-label="Buscar" />
          </div>
          <div className="data-table__filters">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Gravedad">
              <option value="">Todas las gravedades</option>
              {SEVERITY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SEVERITIES[k].label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {data && <SeverityTotals totals={data.totals} />}
      </div>

      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : data?.items.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="shield" size={24} />
          </div>
          <div className="empty-state__title">{q || severity ? 'Sin resultados' : 'Sin sanciones registradas'}</div>
        </div>
      ) : (
        <div className="sanction-list sanction-list--grid">
          {data?.items.map((s) => (
            <SanctionCard
              key={s.id}
              sanction={s}
              showStudent
              studentLink={(x) => (
                <Link to={`/students/${x.student_id}`} className="cell-person__name">
                  {x.first_name} {x.last_name}
                </Link>
              )}
              onEdit={can('discipline', 'update') ? setEditing : undefined}
              onDelete={can('discipline', 'delete') ? remove : undefined}
            />
          ))}
        </div>
      )}

      {editing && (
        <SanctionFormModal
          initial={editing.id ? editing : null}
          students={students || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success(editing.id ? 'Sanción actualizada' : 'Sanción registrada');
            refetch();
          }}
        />
      )}
    </div>
  );
}

export default DisciplinePage;
