import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import appointmentsApi from '../../../api/endpoints/appointments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { longDate, todayStr } from '../../events/eventCatalog';
import AppointmentFormModal from '../components/AppointmentFormModal';
import { APPOINTMENT_STATUSES, STATUS_KEYS, notifiedText } from '../appointmentCatalog';

const PERIODS = [
  ['upcoming', 'Próximas'],
  ['today', 'Hoy'],
  ['week', 'Próximos 7 días'],
  ['past', 'Anteriores'],
  ['all', 'Todas'],
];
const addDays = (s, n) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inPeriod = (a, period, today) => {
  if (period === 'upcoming') return a.meeting_date >= today;
  if (period === 'today') return a.meeting_date === today;
  if (period === 'week') return a.meeting_date >= today && a.meeting_date <= addDays(today, 7);
  if (period === 'past') return a.meeting_date < today;
  return true;
};
const timeLabel = (a) => (a.end_time ? `${a.start_time} – ${a.end_time}` : a.start_time);

/**
 * Citas con padres: la administración y la directiva agendan reuniones con
 * un representante para tratar un tema de uno de sus representados, eligen
 * cómo avisarle (campana y/o correo) y llevan su estado. Las citas se ven en
 * el calendario de Eventos. El docente consulta las de sus alumnos.
 */
function AppointmentsPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, refetch } = useFetch(() => appointmentsApi.list(), []);
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('upcoming');
  const [editing, setEditing] = useState(null);
  const today = todayStr();

  const manage = (action) => can('appointments', action) && !user?.isRestrictedTeacher;
  const all = useMemo(() => data || [], [data]);
  const forStatus = all.filter((a) => inPeriod(a, period, today));
  const visible = forStatus.filter((a) => !status || a.status === status);
  const counts = STATUS_KEYS.reduce((acc, k) => ({ ...acc, [k]: forStatus.filter((a) => a.status === k).length }), {});
  const todayCount = all.filter((a) => a.meeting_date === today && a.status !== 'cancelled').length;

  const changeStatus = async (a, next) => {
    const meta = APPOINTMENT_STATUSES[next];
    if (next === 'cancelled') {
      const ok = await confirm({
        title: '¿Cancelar la cita?',
        message: `"${a.topic}" con ${a.guardian_name}. ${a.notify_bell || a.notify_email ? 'Se le avisará por los canales elegidos en la cita.' : ''}`,
        danger: true,
        confirmLabel: 'Cancelar cita',
      });
      if (!ok) return;
    }
    try {
      const saved = await appointmentsApi.update(a.id, { status: next });
      toast.success(`Cita ${meta.label.toLowerCase()}`, notifiedText(saved.notified) || a.topic);
      refetch();
    } catch (err) {
      toast.error('No se pudo cambiar el estado', getErrorMessage(err));
    }
  };

  const columns = [
    {
      key: 'when',
      header: 'Fecha y hora',
      render: (a) => (
        <div>
          <div className="cell-person__name appt-date">
            {longDate(a.meeting_date)}
            {a.meeting_date === today && <span className="chip evt-card__today">Hoy</span>}
          </div>
          <div className="cell-person__sub">
            <Icon name="clock" size={12} /> {timeLabel(a)}
            {a.location ? ` · ${a.location}` : ''}
          </div>
        </div>
      ),
      sortValue: (a) => `${a.meeting_date} ${a.start_time}`,
    },
    {
      key: 'guardian',
      header: 'Representante',
      render: (a) => (
        <div>
          <div className="cell-person__name">{a.guardian_name}</div>
          <div className="cell-person__sub">{a.student_name ? `${a.student_name}${a.student_section ? ` · ${a.student_section}` : ''}` : 'Sin alumno específico'}</div>
        </div>
      ),
      sortValue: (a) => a.guardian_name,
    },
    {
      key: 'topic',
      header: 'Motivo',
      render: (a) => (
        <div className="appt-topic">
          <div>{a.topic}</div>
          {a.notes && (
            <div className="cell-person__sub appt-topic__notes" title={a.notes}>
              {a.notes}
            </div>
          )}
        </div>
      ),
      sortValue: (a) => a.topic,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (a) => <Badge variant={APPOINTMENT_STATUSES[a.status].variant}>{APPOINTMENT_STATUSES[a.status].label}</Badge>,
      sortValue: (a) => STATUS_KEYS.indexOf(a.status),
    },
    {
      key: 'notify',
      header: 'Aviso',
      render: (a) => (
        <div className="appt-notify" title={a.last_notified_at ? `Último aviso: ${new Date(a.last_notified_at).toLocaleString('es')}` : 'Aún no se ha enviado ningún aviso'}>
          <span className={`appt-notify__ch ${a.notify_bell ? 'is-on' : ''}`} aria-label={a.notify_bell ? 'Campana: sí' : 'Campana: no'}>
            <Icon name="bell" size={14} />
          </span>
          <span className={`appt-notify__ch ${a.notify_email ? 'is-on' : ''}`} aria-label={a.notify_email ? 'Correo: sí' : 'Correo: no'}>
            <Icon name="mail" size={14} />
          </span>
          {a.last_notified_at && <Icon name="check" size={13} className="appt-notify__sent" />}
        </div>
      ),
    },
  ];

  const rowActions = manage('update')
    ? [
        { key: 'confirm', icon: 'checkCircle', label: 'Marcar como confirmada', show: (a) => a.status === 'pending', onClick: (a) => changeStatus(a, 'confirmed') },
        { key: 'complete', icon: 'check', label: 'Marcar como concluida', show: (a) => ['pending', 'confirmed'].includes(a.status) && a.meeting_date <= today, onClick: (a) => changeStatus(a, 'completed') },
        { key: 'cancel', icon: 'x', label: 'Cancelar la cita', show: (a) => ['pending', 'confirmed'].includes(a.status), onClick: (a) => changeStatus(a, 'cancelled') },
      ]
    : [];

  const statusFilter = (
    <div className="level-filter" role="group" aria-label="Filtrar por estado">
      {[['', 'Todas'], ...STATUS_KEYS.map((k) => [k, APPOINTMENT_STATUSES[k].label])].map(([key, label]) => (
        <button
          key={key || 'all'}
          type="button"
          className={`level-filter__item ${status === key ? 'level-filter__item--active' : ''}`}
          onClick={() => setStatus(key)}
          aria-pressed={status === key}
        >
          {label}
          <span className="level-filter__count">{key ? counts[key] : forStatus.length}</span>
        </button>
      ))}
    </div>
  );

  const periodSelect = (
    <div className="filter-bar__selects">
      <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
        {PERIODS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Citas con padres"
        subtitle={
          user?.isRestrictedTeacher
            ? 'Reuniones agendadas por la dirección con los representantes de tus alumnos.'
            : 'Agenda reuniones con un representante para tratar el rendimiento o la conducta de un alumno, y avísale por la campana o por correo.'
        }
        actions={
          can('events', 'read') && (
            <Link to="/events" className="btn btn--secondary">
              <Icon name="calendar" size={16} /> Ver en el calendario
            </Link>
          )
        }
      />

      <DataTable
        title="Citas agendadas"
        description={todayCount ? `Hoy hay ${todayCount} cita${todayCount === 1 ? '' : 's'}.` : 'Las citas también aparecen en el calendario de Eventos.'}
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por representante, alumno o motivo…"
        getSearchText={(a) => [a.guardian_name, a.student_name, a.student_section, a.topic, a.location].join(' ')}
        filters={<div className="filter-bar">{statusFilter}</div>}
        searchAddons={periodSelect}
        emptyMessage={period === 'upcoming' && !status ? 'No hay citas próximas.' : 'Ninguna cita con esos filtros.'}
        createLabel="Agendar cita"
        onCreate={() => setEditing({})}
        canCreate={manage('create')}
        onEdit={setEditing}
        canEdit={manage('update')}
        onDelete={(a) => appointmentsApi.remove(a.id)}
        canDelete={manage('delete')}
        deleteConfirm={(a) => ({ title: '¿Eliminar la cita?', message: `"${a.topic}" con ${a.guardian_name}. Se borrará del registro sin avisar a la familia (para avisarle, cancélala).` })}
        deleteSuccessMessage="Cita eliminada"
        onDeleted={refetch}
        rowActions={rowActions}
      />

      {editing && <AppointmentFormModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

export default AppointmentsPage;
