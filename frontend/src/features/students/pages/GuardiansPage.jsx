import { useState } from 'react';
import { Link } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LevelBadge } from '../../academics/levels';
import {
  PortalAccessFields,
  PortalStatusBadge,
  CredentialsModal,
  initialPortalState,
  validatePortal,
  buildPortalPayload,
  portalOf,
  formatDateTime,
} from '../components/PortalAccessFields';

const fullName = (p) => `${p.first_name} ${p.last_name}`;
const initialsOf = (p) => `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase();

const STUDENT_STATUS = {
  active: ['Activo', 'success'],
  inactive: ['Inactivo', 'neutral'],
  graduated: ['Egresado', 'primary'],
  withdrawn: ['Retirado', 'danger'],
};

function GuardiansPage() {
  const { can } = useAuth();
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.listGuardians(), []);
  const [editing, setEditing] = useState(null); // null = cerrado, {} = crear, {...} = editar
  const [viewingId, setViewingId] = useState(null);
  const [credentials, setCredentials] = useState(null); // { name, username, password } — se muestra una sola vez

  const columns = [
    {
      key: 'name',
      header: 'Representante',
      render: (g) => (
        <div className="cell-person">
          <span className="avatar avatar--sm">{initialsOf(g)}</span>
          <div>
            <div className="cell-person__name">{fullName(g)}</div>
            {g.national_id && <div className="cell-person__sub">{g.national_id}</div>}
          </div>
        </div>
      ),
      sortValue: (g) => `${g.last_name} ${g.first_name}`,
    },
    {
      key: 'contact',
      header: 'Contacto',
      render: (g) =>
        g.phone || g.email ? (
          <div className="contact-stack">
            {g.phone && (
              <span>
                <Icon name="user" size={13} /> {g.phone}
              </span>
            )}
            {g.email && (
              <span>
                <Icon name="inbox" size={13} /> {g.email}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted">Sin datos de contacto</span>
        ),
      sortValue: (g) => g.email || g.phone || null,
    },
    {
      key: 'students',
      header: 'Alumnos',
      render: (g) =>
        g.student_count === 0 ? (
          <span className="teacher-stack__missing">Sin alumnos</span>
        ) : (
          <div className="chip-list">
            {g.student_names.slice(0, 2).map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
            {g.student_count > 2 && <span className="chip">+{g.student_count - 2}</span>}
          </div>
        ),
      sortValue: (g) => g.student_count,
    },
    {
      key: 'portal',
      header: 'Portal',
      render: (g) => (
        <div title={g.portal_username || undefined}>
          <PortalStatusBadge portal={portalOf(g)} />
          {g.portal_username && <div className="cell-person__sub portal-username">{g.portal_username}</div>}
        </div>
      ),
      sortValue: (g) => ({ active: 0, inactive: 1 })[g.portal_status] ?? 2,
    },
  ];

  return (
    <div>
      <PageHeader title="Representantes" subtitle="Padres, madres y representantes legales de los alumnos" />

      <DataTable
        title="Listado de representantes"
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por nombre, cédula, correo o alumno…"
        getSearchText={(g) => [fullName(g), g.national_id, g.email, g.phone, g.portal_username, ...(g.student_names || [])].join(' ')}
        emptyMessage="Aún no hay representantes registrados."
        createLabel="Nuevo representante"
        onCreate={() => setEditing({})}
        canCreate={can('guardians', 'create')}
        onView={(g) => setViewingId(g.id)}
        onEdit={setEditing}
        canEdit={can('guardians', 'update')}
        onDelete={(g) => studentsApi.deleteGuardian(g.id)}
        canDelete={can('guardians', 'delete')}
        deleteConfirm={(g) => ({
          title: `¿Eliminar a ${fullName(g)}?`,
          message:
            (g.student_count > 0
              ? `Se quitará su vínculo con ${g.student_count} alumno(s) (los alumnos no se eliminan). `
              : '') +
            (g.portal_status === 'active' ? 'Su usuario del portal quedará inactivo. ' : '') +
            'Si tiene pagos registrados no se podrá eliminar. Esta acción no se puede deshacer.',
          successMessage: `${fullName(g)} fue eliminado`,
        })}
        onDeleted={refetch}
      />

      {viewingId && (
        <GuardianDetailModal
          guardianId={viewingId}
          onClose={() => setViewingId(null)}
          onEdit={
            can('guardians', 'update')
              ? (g) => {
                  setViewingId(null);
                  setEditing(g);
                }
              : undefined
          }
        />
      )}

      {editing !== null && (
        <GuardianFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            refetch();
            if (saved.temporaryPassword) {
              setCredentials({ name: fullName(saved), username: saved.portal.username, password: saved.temporaryPassword });
            }
          }}
        />
      )}

      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

/** Detalle del representante con la tabla de sus alumnos (grado y sección actual). */
function GuardianDetailModal({ guardianId, onClose, onEdit }) {
  const { data: guardian, loading, error } = useFetch(() => studentsApi.getGuardian(guardianId), [guardianId]);

  const studentColumns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (s) => (
        <div>
          <div className="assign-table__subject">
            <Link to={`/students/${s.id}`} onClick={onClose}>
              {fullName(s)}
            </Link>
            {s.is_primary && <span className="chip chip--primary-guardian">Principal</span>}
          </div>
          <div className="cell-person__sub">
            {[s.relationship, s.national_id].filter(Boolean).join(' · ') || 'Sin documento'}
          </div>
        </div>
      ),
      sortValue: (s) => `${s.last_name} ${s.first_name}`,
    },
    {
      key: 'section',
      header: 'Grado y sección',
      render: (s) =>
        s.section_id ? (
          <div>
            <Link to={`/academics/sections/${s.section_id}`} onClick={onClose} className="cell-person__name">
              {s.grade_name} · Sección {s.section_name}
            </Link>
            <div className="student-level">
              <LevelBadge code={s.level_code} />
              <span className="cell-person__sub">{s.school_period_name}</span>
            </div>
          </div>
        ) : (
          <span className="teacher-stack__missing">Sin inscripción activa</span>
        ),
      sortValue: (s) => (s.section_id ? `${s.grade_name} ${s.section_name}` : null),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (s) => {
        const [label, variant] = STUDENT_STATUS[s.status] || ['—', 'neutral'];
        return <Badge variant={variant}>{label}</Badge>;
      },
    },
  ];

  return (
    <Modal title={guardian ? fullName(guardian) : 'Representante'} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      {loading || !guardian ? (
        <Spinner />
      ) : (
        <>
          <div className="guardian-hero">
            <span className="avatar">{initialsOf(guardian)}</span>
            <div>
              <div className="cell-person__name">{fullName(guardian)}</div>
              <div className="cell-person__sub">Representante</div>
            </div>
            <PortalStatusBadge portal={guardian.portal} />
          </div>

          {guardian.portal && (
            <div className="portal-summary">
              <Icon name="lock" size={16} />
              <span>
                Usuario del portal: <strong>{guardian.portal.username}</strong>
              </span>
              <span className="text-muted">
                {guardian.portal.last_login_at
                  ? `Último ingreso: ${formatDateTime(guardian.portal.last_login_at)}`
                  : 'Aún no ha ingresado'}
              </span>
            </div>
          )}

          <dl className="detail-list">
            {[
              ['Cédula / documento', guardian.national_id],
              ['Teléfono', guardian.phone],
              ['Correo', guardian.email, 'Se usa para enviar los comprobantes de pago.'],
              ['Alumnos a cargo', String(guardian.students.length)],
            ].map(([label, value, hint]) => (
              <div key={label} className="detail-list__item">
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
                {hint && value && <div className="cell-person__sub">{hint}</div>}
              </div>
            ))}
          </dl>

          <div className="detail-section">
            <h4 className="detail-section__title">
              <Icon name="graduation" size={17} />
              Alumnos asociados
              <span className="data-table__count">{guardian.students.length}</span>
            </h4>
            <Table
              columns={studentColumns}
              rows={guardian.students}
              emptyMessage="Este representante no tiene alumnos asociados. Se vinculan desde la ficha de cada alumno."
            />
          </div>

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {onEdit && (
              <Button type="button" icon="pencil" onClick={() => onEdit(guardian)}>
                Editar
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
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
  const [portal, setPortal] = useState(() => initialPortalState(initial));
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => studentsApi.updateGuardian(initial.id, data) : studentsApi.createGuardian
  );
  const toast = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    // El correo de acceso copia el de contacto mientras el admin no lo edite a mano.
    if (name === 'email') setPortal((p) => (p.emailTouched ? p : { ...p, email: value }));
  };

  const portalErrors = validatePortal(portal);
  const portalInvalid = Object.keys(portalErrors).length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (portalInvalid) return;
    try {
      // Los campos opcionales vacíos se envían como "" y el backend los guarda como null.
      const saved = await run({ ...form, portal: buildPortalPayload(portal) });
      const portalMsg = saved.temporaryPassword
        ? ' · usuario del portal listo'
        : saved.portal && !portal.existing
          ? ' · usuario del portal creado'
          : '';
      toast.success(isEdit ? 'Cambios guardados' : 'Representante registrado', `${form.firstName} ${form.lastName}${portalMsg}`);
      onClose();
      onSaved(saved);
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? `Editar a ${initial.first_name} ${initial.last_name}` : 'Nuevo representante'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName} required>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName} required>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} maxLength={30} />
          </Field>
          <Field label="Teléfono" error={fieldErrors.phone}>
            <Input name="phone" value={form.phone} onChange={handleChange} maxLength={30} />
          </Field>
          <Field label="Correo" error={fieldErrors.email} hint="Se usa para enviar los comprobantes de pago." full>
            <Input icon="inbox" type="email" name="email" value={form.email} onChange={handleChange} placeholder="representante@correo.com" />
          </Field>
        </div>
        <PortalAccessFields state={portal} setState={setPortal} fieldErrors={fieldErrors} />

        {isEdit && (
          <p className="text-sm" style={{ marginTop: 14 }}>
            Para vincular o desvincular alumnos, hazlo desde la ficha de cada alumno.
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={portalInvalid}>
            {isEdit ? 'Guardar cambios' : 'Crear representante'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default GuardiansPage;
