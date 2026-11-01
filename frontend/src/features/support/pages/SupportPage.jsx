import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import supportApi from '../../../api/endpoints/support.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import FileDropzone from '../../../components/ui/FileDropzone';
import { useToast } from '../../../components/ui/Toast';

const STATUS_VARIANT = { open: 'warning', in_progress: 'info', resolved: 'success', closed: 'neutral' };
const PRIORITY_VARIANT = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
const ATTACH_ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] };
const dateTime = (v) => (v ? new Date(v).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'open', label: 'Abiertos' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'resolved', label: 'Resueltos' },
  { key: 'closed', label: 'Cerrados' },
];

/**
 * Soporte técnico (solo el Administrador): reportar fallas a la plataforma
 * MoDo Educa y seguir su estado. Los tickets llegan al panel central del
 * superadmin; sus respuestas aparecen aquí y en la campana.
 */
function SupportPage() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(() => supportApi.list(status ? { status } : undefined), [status]);
  const { data: options } = useFetch(() => supportApi.options(), []);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(() => params.get('ticket'));

  // Desde el aviso de la campana: /support?ticket=<id> abre ese ticket.
  useEffect(() => {
    const id = params.get('ticket');
    if (id) {
      setViewing(id);
      setParams((p) => {
        p.delete('ticket');
        return p;
      }, { replace: true });
    }
  }, [params, setParams]);

  const counts = (rows || []).reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] || 0) + 1 }), {});

  const columns = [
    { key: 'code', header: 'N°', render: (t) => <span className="support-code">{t.code}</span>, sortValue: (t) => t.code },
    {
      key: 'subject',
      header: 'Asunto',
      render: (t) => (
        <div>
          <div className="cell-person__name">
            {t.subject}
            {t.has_attachment && <Icon name="paperclip" size={12} className="support-clip" />}
          </div>
          <div className="cell-person__sub">{t.category_label}</div>
        </div>
      ),
      sortValue: (t) => t.subject,
    },
    { key: 'priority', header: 'Prioridad', render: (t) => <Badge variant={PRIORITY_VARIANT[t.priority]}>{t.priority_label}</Badge>, sortValue: (t) => ['low', 'normal', 'high', 'urgent'].indexOf(t.priority) },
    {
      key: 'status',
      header: 'Estado',
      render: (t) => (
        <div className="support-status">
          <Badge variant={STATUS_VARIANT[t.status]}>{t.status_label}</Badge>
          {t.last_reply_from_platform && ['open', 'in_progress'].includes(t.status) && (
            <span className="support-new-reply">
              <Icon name="mail" size={11} /> Respuesta de soporte
            </span>
          )}
        </div>
      ),
      sortValue: (t) => t.status,
    },
    { key: 'messages', header: 'Mensajes', align: 'right', render: (t) => t.message_count || '—' },
    { key: 'last_activity_at', header: 'Última actividad', render: (t) => dateTime(t.last_activity_at), sortValue: (t) => t.last_activity_at },
  ];

  return (
    <div>
      <PageHeader
        title="Soporte técnico"
        subtitle="Reporta fallas o dudas del sistema al equipo de MoDo Educa y sigue cada caso hasta su solución."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Reportar un problema
          </Button>
        }
      />

      <div className="support-stats">
        {[
          ['open', 'Abiertos', 'alertCircle'],
          ['in_progress', 'En progreso', 'refresh'],
          ['resolved', 'Resueltos', 'checkCircle'],
        ].map(([key, label, icon]) => (
          <button key={key} type="button" className={`support-stat support-stat--${key} ${status === key ? 'is-active' : ''}`} onClick={() => setStatus(status === key ? '' : key)}>
            <Icon name={icon} size={18} />
            <span>
              <strong>{status && status !== key ? '·' : counts[key] || 0}</strong> {label}
            </span>
          </button>
        ))}
      </div>

      <DataTable
        title="Tickets de mi colegio"
        columns={columns}
        rows={rows || []}
        loading={loading}
        error={error}
        canCreate={false}
        onRowClick={(t) => setViewing(t.id)}
        onView={(t) => setViewing(t.id)}
        searchPlaceholder="Buscar por número, asunto o categoría…"
        getSearchText={(t) => [t.code, t.subject, t.category_label, t.description].join(' ')}
        filters={
          <div className="segmented" role="tablist" aria-label="Estado">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={status === f.key} className={`segmented__item ${status === f.key ? 'segmented__item--active' : ''}`} onClick={() => setStatus(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        }
        emptyMessage={status ? 'No hay tickets con este estado.' : 'Aún no has reportado problemas. Si algo no funciona, cuéntanos con «Reportar un problema».'}
      />

      {creating && options && (
        <NewTicketDrawer
          options={options}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            refetch();
            setViewing(t.id);
          }}
        />
      )}
      {viewing && <TicketDrawer id={viewing} onClose={() => setViewing(null)} onChanged={refetch} />}
    </div>
  );
}

/** Reportar un problema: categoría, prioridad, asunto, descripción, pantalla y captura opcional. */
function NewTicketDrawer({ options, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ category: 'bug', priority: 'normal', subject: '', description: '', pageUrl: '' });
  const [file, setFile] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) => supportApi.create(data, file));
  const incomplete = form.subject.trim().length < 5 || form.description.trim().length < 20;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (incomplete) return;
    try {
      const t = await run({ ...form, pageUrl: form.pageUrl.trim() || undefined });
      toast.success(`Ticket ${t.code} enviado`, 'El equipo de soporte lo revisará; verás su respuesta aquí y en la campana.');
      onCreated(t);
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  return (
    <Drawer title="Reportar un problema" icon="helpCircle" onClose={onClose}>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Mientras más detalle nos des (qué hacías, qué esperabas y qué pasó), más rápido lo resolvemos.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Categoría" error={fieldErrors.category} required>
            <Select value={form.category} onChange={set('category')}>
              {options.categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad" error={fieldErrors.priority} hint={form.priority === 'urgent' ? 'Úsala si el colegio no puede operar.' : undefined}>
            <Select value={form.priority} onChange={set('priority')}>
              {options.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Asunto" error={fieldErrors.subject} full required>
            <Input value={form.subject} onChange={set('subject')} maxLength={150} placeholder="Ej. No se genera el recibo al confirmar un pago" />
          </Field>
          <Field label="Descripción" error={fieldErrors.description} full required hint={`${form.description.trim().length}/5000 · mínimo 20 caracteres.`}>
            <textarea
              className="input"
              rows={6}
              maxLength={5000}
              value={form.description}
              onChange={set('description')}
              placeholder={'1. Qué estabas haciendo\n2. Qué esperabas que pasara\n3. Qué pasó (mensaje de error, si apareció)'}
            />
          </Field>
          <Field label="Pantalla o módulo (opcional)" error={fieldErrors.pageUrl} full>
            <Input value={form.pageUrl} onChange={set('pageUrl')} maxLength={300} placeholder="Ej. Pagos → Registrar pago" />
          </Field>
          <Field label="Captura de pantalla (opcional)" error={fieldErrors.attachment} full>
            <FileDropzone
              value={file}
              onChange={setFile}
              accept={ATTACH_ACCEPT}
              maxBytes={5 * 1024 * 1024}
              label="Arrastra aquí la captura o el PDF"
              hint="JPG, PNG o PDF · máximo 5 MB"
              disabled={loading}
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="check" loading={loading} loadingText="Enviando…" disabled={incomplete}>
            Enviar a soporte
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/** Detalle de un ticket: datos, adjunto, conversación con soporte y respuesta. */
function TicketDrawer({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data: t, setData, loading, error } = useFetch(() => supportApi.get(id), [id]);
  const [reply, setReply] = useState('');
  const send = useMutation((body) => supportApi.reply(id, body));
  const [preview, setPreview] = useState(null);

  // Adjunto privado: se descarga con la sesión y se muestra desde memoria.
  useEffect(() => {
    if (!t?.has_attachment) return undefined;
    let url = null;
    supportApi
      .attachmentBlob(id)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setPreview({ url, isPdf: t.attachment_mime === 'application/pdf' });
      })
      .catch(() => setPreview(null));
    return () => url && URL.revokeObjectURL(url);
  }, [id, t?.has_attachment, t?.attachment_mime]);

  const submitReply = async (e) => {
    e.preventDefault();
    try {
      setData(await send.run(reply));
      setReply('');
      onChanged?.();
      toast.success('Mensaje enviado', 'Soporte verá tu mensaje en su panel.');
    } catch (err) {
      toast.error('No se pudo enviar', getErrorMessage(err));
    }
  };

  return (
    <Drawer title={t ? `${t.code} · ${t.subject}` : 'Ticket'} icon="helpCircle" size="lg" onClose={onClose}>
      <Alert>{error}</Alert>
      {loading || !t ? (
        <Spinner />
      ) : (
        <div className="ticket">
          <div className="ticket__meta">
            <Badge variant={STATUS_VARIANT[t.status]}>{t.status_label}</Badge>
            <Badge variant={PRIORITY_VARIANT[t.priority]}>Prioridad {t.priority_label.toLowerCase()}</Badge>
            <span className="text-sm text-muted">{t.category_label}</span>
            <span className="text-sm text-muted">· Enviado el {dateTime(t.created_at)} por {t.reporter_name}</span>
          </div>
          {t.page_url && (
            <p className="text-sm text-muted ticket__page">
              <Icon name="layers" size={13} /> {t.page_url}
            </p>
          )}

          <div className="ticket__thread">
            <article className="ticket-msg ticket-msg--school">
              <header>
                <strong>{t.reporter_name}</strong> <span>{dateTime(t.created_at)}</span>
              </header>
              <p>{t.description}</p>
              {preview &&
                (preview.isPdf ? (
                  <a href={preview.url} target="_blank" rel="noreferrer" className="ticket__file">
                    <Icon name="file" size={15} /> {t.attachment_name}
                  </a>
                ) : (
                  <a href={preview.url} target="_blank" rel="noreferrer" className="ticket__shot" title="Abrir en tamaño completo">
                    <img src={preview.url} alt={t.attachment_name} />
                  </a>
                ))}
            </article>
            {t.messages.map((m) => (
              <article key={m.id} className={`ticket-msg ticket-msg--${m.author_type}`}>
                <header>
                  <strong>
                    {m.author_type === 'platform' && <Icon name="helpCircle" size={13} />} {m.author_name}
                  </strong>
                  <span>{dateTime(m.created_at)}</span>
                </header>
                <p>{m.body}</p>
                {m.status_change_label && (
                  <div className="ticket-msg__status">
                    <Icon name="refresh" size={12} /> Estado: {m.status_change_label}
                  </div>
                )}
              </article>
            ))}
          </div>

          {t.status === 'closed' ? (
            <Alert variant="info">Este ticket está cerrado. Si el problema continúa, reporta uno nuevo.</Alert>
          ) : (
            <form onSubmit={submitReply} className="ticket__reply">
              <Field label={t.status === 'resolved' ? 'Responder (reabre el ticket)' : 'Agregar información o responder'}>
                <textarea className="input" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escribe tu mensaje para el equipo de soporte…" />
              </Field>
              <div className="form-actions">
                <Button type="submit" icon="mail" loading={send.loading} loadingText="Enviando…" disabled={reply.trim().length < 2}>
                  Enviar mensaje
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default SupportPage;
