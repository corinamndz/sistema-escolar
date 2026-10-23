import { useMemo, useState } from 'react';
import notificationLogApi from '../../../api/endpoints/notificationLog.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Tabs from '../../../components/ui/Tabs';
import Select from '../../../components/ui/Select';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

const STATUS_BADGE = { sent: 'success', delivered: 'success', pending: 'warning', retrying: 'warning', failed: 'danger' };
const CHANNELS = { email: { label: 'Correo', icon: 'mail' }, bell: { label: 'Campana', icon: 'bell' } };

/** Pestañas: por resultado y por canal. */
const TABS = [
  { key: 'all', label: 'Todas', match: () => true },
  { key: 'sent', label: 'Enviadas', match: (r) => r.status === 'sent' || r.status === 'delivered' },
  { key: 'pending', label: 'Pendientes', match: (r) => r.status === 'pending' || r.status === 'retrying' },
  { key: 'failed', label: 'Fallidas', match: (r) => r.status === 'failed' },
  { key: 'email', label: 'Correo', match: (r) => r.channel === 'email' },
  { key: 'bell', label: 'Campana', match: (r) => r.channel === 'bell' },
];
const PERIODS = [
  ['30', 'Últimos 30 días'],
  ['90', 'Últimos 90 días'],
  ['365', 'Último año'],
  ['all', 'Todo el historial'],
];

const dateTime = (v) => new Date(v).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Log de notificaciones: todo lo que el colegio envió a las familias y al
 * personal (campana, avisos por correo, credenciales y comprobantes), con su
 * resultado y la opción de reenviar cada registro.
 */
function NotificationLogPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [days, setDays] = useState('90');
  const [tab, setTab] = useState('all');
  const { data, loading, error, refetch } = useFetch(() => notificationLogApi.list(days), [days]);
  const canResend = can('tenant_settings', 'update');
  const [resendingId, setResendingId] = useState(null);

  const rows = useMemo(() => data || [], [data]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter(t.match).length])), [rows]);
  const visible = rows.filter(TABS.find((t) => t.key === tab).match);

  const resend = async (r) => {
    if (resendingId) return;
    const ok = await confirm({
      title:
        r.channel === 'bell' ? '¿Publicar de nuevo en la campana?' : r.type === 'credentials' ? '¿Enviar credenciales nuevas?' : '¿Reenviar este correo?',
      message: `"${r.subject}" a ${r.recipient}. ${r.resend_hint}`,
      icon: 'refresh',
      confirmLabel: 'Reenviar',
    });
    if (!ok) return;
    setResendingId(r.id);
    try {
      const res = await notificationLogApi.resend(r.source, r.row_id);
      if (res.ok) toast.success('Reenviado', res.message);
      else toast.error('No se pudo reenviar', res.message);
      refetch();
    } catch (err) {
      toast.error('No se pudo reenviar', getErrorMessage(err));
    } finally {
      setResendingId(null);
    }
  };

  const columns = [
    {
      key: 'created_at',
      header: 'Fecha y hora',
      render: (r) => (
        <div>
          <div style={{ whiteSpace: 'nowrap' }}>{dateTime(r.created_at)}</div>
          {r.sent_at && r.channel === 'email' && r.sent_at !== r.created_at && <div className="cell-person__sub">Enviado: {dateTime(r.sent_at)}</div>}
        </div>
      ),
      sortValue: (r) => r.created_at,
    },
    {
      key: 'subject',
      header: 'Tipo / Asunto',
      render: (r) => (
        <div className="nlog-subject">
          <span className="nlog-type">{r.type_label}</span>
          {r.resend_of && <span className="chip">Reenvío</span>}
          <div className="cell-person__name">{r.subject}</div>
          {r.body && <div className="cell-person__sub nlog-body" title={r.body}>{r.body}</div>}
        </div>
      ),
      sortValue: (r) => `${r.type_label} ${r.subject}`,
    },
    {
      key: 'recipient',
      header: 'Destinatario',
      render: (r) => (
        <div>
          <div>{r.recipient || <span className="text-muted">—</span>}</div>
          {r.recipient_detail && <div className="cell-person__sub">{r.recipient_detail}</div>}
        </div>
      ),
      sortValue: (r) => r.recipient,
    },
    {
      key: 'channel',
      header: 'Canal',
      render: (r) => (
        <span className={`nlog-channel nlog-channel--${r.channel}`}>
          <Icon name={CHANNELS[r.channel].icon} size={13} /> {CHANNELS[r.channel].label}
        </span>
      ),
      sortValue: (r) => r.channel,
    },
    {
      key: 'status',
      header: 'Resultado',
      render: (r) => (
        <div className="nlog-status">
          <Badge variant={STATUS_BADGE[r.status]}>{r.status_label}</Badge>
          {r.channel === 'bell' && <div className="cell-person__sub">{r.reads ? `Leída por ${r.reads}` : 'Sin leer'}</div>}
          {r.status === 'retrying' && <div className="cell-person__sub">Intento {r.attempts} de 3</div>}
          {r.error && (
            <div className="cell-person__sub nlog-error" title={r.error}>
              {r.error}
            </div>
          )}
          {r.status === 'failed' && r.resendable && canResend ? (
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              title={r.resend_hint}
              loading={resendingId === r.id}
              loadingText="Reenviando…"
              disabled={Boolean(resendingId)}
              onClick={() => resend(r)}
              style={{ marginTop: 6 }}
            >
              Reenviar
            </Button>
          ) : (
            !r.resendable &&
            r.source === 'mail' && (
              <div className="cell-person__sub" title={r.resend_hint}>
                <Icon name="lock" size={11} /> No se puede reenviar
              </div>
            )
          )}
        </div>
      ),
      sortValue: (r) => r.status,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Log de notificaciones"
        subtitle="Historial de todo lo que el colegio envía: avisos de la campana, correos, credenciales de acceso y comprobantes de pago, con su resultado. Reenvía cualquier registro si hace falta."
      />

      <Tabs
        tabs={TABS.map((t) => ({
          key: t.key,
          label: (
            <>
              {t.label} <span className="tabs__count">{counts[t.key]}</span>
            </>
          ),
        }))}
        active={tab}
        onChange={setTab}
      />

      <DataTable
        title="Historial de envíos"
        description={counts.failed ? `${counts.failed} envío${counts.failed === 1 ? '' : 's'} fallido${counts.failed === 1 ? '' : 's'} en el período.` : 'Del más reciente al más antiguo.'}
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        pageSize={25}
        searchPlaceholder="Buscar por asunto, destinatario, correo o tipo…"
        getSearchText={(r) => [r.subject, r.body, r.recipient, r.recipient_detail, r.type_label, r.error].join(' ')}
        searchAddons={
          <div className="filter-bar__selects">
            <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período">
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        }
        emptyMessage={tab === 'all' ? 'No hay envíos en este período.' : 'No hay envíos en esta pestaña.'}
        canCreate={false}
        rowActions={
          canResend
            ? [{ key: 'resend', icon: 'refresh', label: 'Reenviar', tone: 'accent', show: (r) => r.resendable, onClick: resend }]
            : []
        }
      />
    </div>
  );
}

export default NotificationLogPage;
