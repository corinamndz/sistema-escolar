import { useEffect, useMemo, useState } from 'react';
import notificationsApi from '../../../api/endpoints/notifications.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import MultiSelect from '../../../components/ui/MultiSelect';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import RichTextEditor from '../../../components/ui/RichTextEditor';
import RichTextView, { ANNOUNCEMENT_CATEGORIES, sanitizePreview } from '../../../components/ui/RichTextView';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { refreshNotifications } from '../../../lib/notificationEvents';

const SCOPES = [
  { key: 'school', label: 'Todo el colegio', icon: 'school' },
  { key: 'levels', label: 'Niveles', icon: 'layers' },
  { key: 'grades', label: 'Grados', icon: 'graduation' },
  { key: 'sections', label: 'Secciones', icon: 'users' },
  { key: 'people', label: 'Personas', icon: 'user' },
];
const LEVELS = [
  ['initial', 'Inicial'],
  ['primary', 'Primaria'],
  ['secondary', 'Secundaria'],
];
const STAFF_TYPES = { teaching: 'Docente', coordinator: 'Coordinación', administrative: 'Administrativo', support: 'Apoyo' };
const EMPTY = { title: '', category: 'administrative', scope: 'school', levelCodes: [], gradeIds: [], sectionIds: [], guardianIds: [], staffIds: [], groups: { guardians: true, teachers: false, staff: false }, html: '' };

const plainLength = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  // Un cartel (imagen) sin texto también cuenta como mensaje.
  return div.textContent.trim().length + (div.querySelector('img') ? 3 : 0);
};
const when = (iso) => new Date(iso).toLocaleString('es-VE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Comunicados: la administración redacta un aviso con formato, elige a quién va
 * (todo el colegio, niveles, grados, secciones o personas concretas) y lo envía.
 * Llega a la campana y al Centro de notificaciones de cada destinatario; el
 * historial muestra cuántos lo leyeron.
 */
function AnnouncementsPage() {
  const { data: options, loading, error } = useFetch(() => notificationsApi.broadcastOptions(), []);
  const { data: sent, refetch: refetchSent } = useFetch(() => notificationsApi.broadcastHistory(), []);
  const [form, setForm] = useState(EMPTY);
  const [editorKey, setEditorKey] = useState(0); // reinicia el editor tras enviar
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState({});
  const confirm = useConfirm();
  const toast = useToast();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const scopePayload = useMemo(
    () => ({
      scope: form.scope,
      levelCodes: form.scope === 'levels' ? form.levelCodes : [],
      gradeIds: form.scope === 'grades' ? form.gradeIds : [],
      sectionIds: form.scope === 'sections' ? form.sectionIds : [],
      guardianIds: form.scope === 'people' ? form.guardianIds : [],
      staffIds: form.scope === 'people' ? form.staffIds : [],
      groups: { ...form.groups, staff: form.scope === 'school' && form.groups.staff },
    }),
    [form.scope, form.levelCodes, form.gradeIds, form.sectionIds, form.guardianIds, form.staffIds, form.groups]
  );
  const scopeReady =
    (form.scope === 'school' && Object.values(scopePayload.groups).some(Boolean)) ||
    (form.scope === 'levels' && form.levelCodes.length > 0 && Object.values(scopePayload.groups).some(Boolean)) ||
    (form.scope === 'grades' && form.gradeIds.length > 0 && Object.values(scopePayload.groups).some(Boolean)) ||
    (form.scope === 'sections' && form.sectionIds.length > 0 && Object.values(scopePayload.groups).some(Boolean)) ||
    (form.scope === 'people' && form.guardianIds.length + form.staffIds.length > 0);

  // Destinatarios en vivo (sin enviar nada), con una pequeña espera mientras se elige.
  useEffect(() => {
    if (!scopeReady) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      notificationsApi
        .broadcastPreview(scopePayload)
        .then((p) => !cancelled && (setPreview(p), setPreviewError(null)))
        .catch((err) => !cancelled && setPreviewError(getErrorMessage(err)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scopePayload, scopeReady]);

  const gradeOptions = useMemo(
    () => (options?.grades || []).map((g) => ({ id: g.id, label: g.name, sub: options.levels[g.level_code] })),
    [options]
  );
  const sectionOptions = useMemo(
    () => (options?.sections || []).map((s) => ({ id: s.id, label: `${s.grade_name} ${s.name}`, sub: `${options.levels[s.level_code]} · ${s.school_period_name}` })),
    [options]
  );
  const guardianOptions = useMemo(
    () => (options?.guardians || []).map((g) => ({ id: g.id, label: `${g.first_name} ${g.last_name}`, sub: ['Representante', g.national_id, g.email].filter(Boolean).join(' · '), search: `${g.national_id || ''} ${g.email || ''}` })),
    [options]
  );
  const staffOptions = useMemo(
    () => (options?.staff || []).map((s) => ({ id: s.id, label: `${s.first_name} ${s.last_name}`, sub: [STAFF_TYPES[s.staff_type] || 'Personal', s.email].filter(Boolean).join(' · '), search: s.email || '' })),
    [options]
  );

  const validate = () => {
    const e = {};
    if (form.title.trim().length < 3) e.title = 'Escribe el asunto (mínimo 3 caracteres).';
    if (plainLength(form.html) < 3) e.html = 'Escribe el mensaje.';
    if (!scopeReady) e.scope = form.scope === 'people' ? 'Elige al menos un destinatario.' : 'Completa el alcance y elige a quién va dirigido.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) return;
    const total = preview?.total ?? 0;
    if (!total) {
      setErrors({ scope: 'Nadie del alcance elegido tiene acceso al sistema.' });
      return;
    }
    const ok = await confirm({
      title: `¿Enviar «${form.title.trim()}»?`,
      message: `Lo recibirán ${total} persona${total === 1 ? '' : 's'} (${preview.scope_label}) en su campana y su Centro de notificaciones. No se puede deshacer.`,
      confirmLabel: `Enviar a ${total}`,
      icon: 'send',
      danger: form.category === 'urgent',
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await notificationsApi.broadcast({ ...scopePayload, title: form.title.trim(), category: form.category, html: form.html });
      toast.success('Comunicado enviado', `Lo recibieron ${r.recipients} persona${r.recipients === 1 ? '' : 's'} · ${r.scope_label}`);
      setForm((f) => ({ ...EMPTY, scope: f.scope, groups: f.groups, levelCodes: f.levelCodes, gradeIds: f.gradeIds, sectionIds: f.sectionIds }));
      setEditorKey((k) => k + 1);
      setErrors({});
      refetchSent();
      // La campana de quien envía se actualiza al momento (los demás, en su próxima consulta).
      refreshNotifications();
    } catch (err) {
      toast.error('No se envió el comunicado', getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner label="Cargando…" />;
  if (error) return <Alert>{error}</Alert>;

  const category = ANNOUNCEMENT_CATEGORIES[form.category];

  return (
    <div>
      <PageHeader title="Comunicados" subtitle="Redacta un aviso y elige a quién llega: todo el colegio, niveles, grados, secciones o personas concretas." />

      <div className="ann-layout">
        <Card className="ann-composer">
          <div className="ann-section">
            <Field label="Asunto" error={errors.title} required>
              <Input value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={150} placeholder="Ej.: Suspensión de clases por lluvias" />
            </Field>
          </div>

          <div className="ann-section">
            <span className="ann-label">Categoría</span>
            <div className="ann-pills" role="radiogroup" aria-label="Categoría">
              {Object.entries(ANNOUNCEMENT_CATEGORIES).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={form.category === key}
                  className={`ann-pill ann-pill--${key} ${form.category === key ? 'is-active' : ''}`}
                  onClick={() => set({ category: key })}
                >
                  <Icon name={c.icon} size={14} /> {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ann-section">
            <span className="ann-label">Destinatarios</span>
            <div className="ann-scopes" role="radiogroup" aria-label="Alcance">
              {SCOPES.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={form.scope === s.key} className={`ann-scope ${form.scope === s.key ? 'is-active' : ''}`} onClick={() => set({ scope: s.key })}>
                  <Icon name={s.icon} size={16} />
                  {s.label}
                </button>
              ))}
            </div>

            {form.scope === 'levels' && (
              <div className="ann-pills" role="group" aria-label="Niveles">
                {LEVELS.map(([code, label]) => {
                  const on = form.levelCodes.includes(code);
                  return (
                    <button key={code} type="button" aria-pressed={on} className={`ann-pill ${on ? 'is-active' : ''}`} onClick={() => set({ levelCodes: on ? form.levelCodes.filter((c) => c !== code) : [...form.levelCodes, code] })}>
                      {on && <Icon name="check" size={14} />} {label}
                    </button>
                  );
                })}
              </div>
            )}
            {form.scope === 'grades' && <MultiSelect options={gradeOptions} value={form.gradeIds} onChange={(ids) => set({ gradeIds: ids })} placeholder="Buscar grado…" ariaLabel="Grados" />}
            {form.scope === 'sections' && <MultiSelect options={sectionOptions} value={form.sectionIds} onChange={(ids) => set({ sectionIds: ids })} placeholder="Buscar sección (ej. 1er Grado A)…" ariaLabel="Secciones" />}
            {form.scope === 'people' && (
              <div className="ann-people">
                <Field label="Representantes" hint="Solo los que tienen acceso al portal.">
                  <MultiSelect options={guardianOptions} value={form.guardianIds} onChange={(ids) => set({ guardianIds: ids })} placeholder="Buscar por nombre, cédula o correo…" ariaLabel="Representantes" />
                </Field>
                <Field label="Personal" hint="Docentes, coordinación y administración con usuario.">
                  <MultiSelect options={staffOptions} value={form.staffIds} onChange={(ids) => set({ staffIds: ids })} placeholder="Buscar por nombre o correo…" ariaLabel="Personal" />
                </Field>
              </div>
            )}

            {form.scope !== 'people' && (
              <div className="ann-groups" role="group" aria-label="Para quién">
                <span className="text-sm text-muted">Para:</span>
                {[
                  ['guardians', 'Representantes'],
                  ['teachers', form.scope === 'school' ? 'Docentes' : 'Sus docentes'],
                  ...(form.scope === 'school' ? [['staff', 'Personal administrativo']] : []),
                ].map(([key, label]) => (
                  <label key={key} className="ann-check">
                    <input type="checkbox" checked={Boolean(form.groups[key])} onChange={(e) => set({ groups: { ...form.groups, [key]: e.target.checked } })} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {errors.scope && <span className="field-error">{errors.scope}</span>}
          </div>

          <div className="ann-section">
            <span className="ann-label">
              Mensaje <span className="form-field__required">*</span>
            </span>
            <RichTextEditor
              key={editorKey}
              value={form.html}
              onChange={(html) => set({ html })}
              onUploadImage={notificationsApi.uploadBroadcastImage} invalid={Boolean(errors.html)} placeholder="Escribe el comunicado: títulos, colores, listas, enlaces e imágenes." />
            {errors.html && <span className="field-error">{errors.html}</span>}
          </div>

          <div className="ann-actions">
            <Button variant="secondary" onClick={() => (setForm(EMPTY), setEditorKey((k) => k + 1), setErrors({}))} disabled={sending}>
              Limpiar
            </Button>
            <Button icon="send" onClick={submit} loading={sending} loadingText="Enviando…">
              {preview?.total ? `Enviar a ${preview.total}` : 'Enviar comunicado'}
            </Button>
          </div>
        </Card>

        <aside className="ann-side">
          <Card className="ann-summary">
            <span className="ann-label">Lo recibirán</span>
            {!scopeReady ? (
              <p className="text-sm text-muted">Elige el alcance y a quién va dirigido para ver cuántas personas lo recibirán.</p>
            ) : previewError ? (
              <Alert>{previewError}</Alert>
            ) : !preview ? (
              <Spinner />
            ) : (
              <>
                <div className="ann-summary__total">
                  {preview.total}
                  <small>persona{preview.total === 1 ? '' : 's'}</small>
                </div>
                <p className="ann-summary__scope">{preview.scope_label}</p>
                <ul className="ann-summary__groups">
                  {preview.by_group.guardians > 0 && <li><Icon name="users" size={14} /> {preview.by_group.guardians} representante(s)</li>}
                  {preview.by_group.teachers > 0 && <li><Icon name="graduation" size={14} /> {preview.by_group.teachers} docente(s)</li>}
                  {preview.by_group.staff > 0 && <li><Icon name="briefcase" size={14} /> {preview.by_group.staff} del personal</li>}
                </ul>
                {Object.values(preview.without_access).some(Boolean) && (
                  <p className="ann-summary__warn">
                    <Icon name="info" size={14} />
                    {[
                      preview.without_access.guardians && `${preview.without_access.guardians} representante(s)`,
                      preview.without_access.teachers && `${preview.without_access.teachers} docente(s)`,
                      preview.without_access.staff && `${preview.without_access.staff} del personal`,
                    ]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    no tienen acceso al sistema y no lo recibirán.
                  </p>
                )}
                {preview.sample.length > 0 && <p className="text-sm text-muted">Ej.: {preview.sample.join(', ')}{preview.total > preview.sample.length ? '…' : ''}</p>}
              </>
            )}
          </Card>

          <Card className="ann-preview">
            <span className="ann-label">Así lo verán</span>
            <div className="ann-preview__card">
              <div className="ann-preview__head">
                <span className="ann-preview__icon">
                  <Icon name="megaphone" size={16} />
                </span>
                <div>
                  <strong>{form.title.trim() || 'Asunto del comunicado'}</strong>
                  <Badge variant={form.category === 'urgent' ? 'danger' : 'primary'}>{category.label}</Badge>
                </div>
              </div>
              {plainLength(form.html) ? <RichTextView html={sanitizePreview(form.html)} /> : <p className="text-sm text-muted">El mensaje aparecerá aquí.</p>}
            </div>
          </Card>
        </aside>
      </div>

      <Card title="Comunicados enviados" subtitle="Cuántos destinatarios ya lo leyeron">
        {!sent ? (
          <Spinner />
        ) : !sent.length ? (
          <p className="text-sm text-muted">Todavía no se envió ningún comunicado.</p>
        ) : (
          <ul className="ann-history">
            {sent.map((a) => (
              <SentItem key={a.id} item={a} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SentItem({ item: a }) {
  const [open, setOpen] = useState(false);
  const pct = a.recipients ? Math.round((a.reads / a.recipients) * 100) : 0;
  const cat = ANNOUNCEMENT_CATEGORIES[a.category];
  return (
    <li className={`ann-history__item ${open ? 'is-open' : ''}`}>
      <button type="button" className="ann-history__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`ann-history__icon ann-history__icon--${a.category}`}>
          <Icon name={cat?.icon || 'megaphone'} size={16} />
        </span>
        <span className="ann-history__main">
          <strong>{a.title}</strong>
          <span className="ann-history__meta">
            {cat?.label} · {when(a.created_at)} · {a.scope_label || '—'}
            {a.sender_name ? ` · ${a.sender_name}` : ''}
          </span>
        </span>
        <span className="ann-history__reads" title={`${a.reads} de ${a.recipients} lo leyeron`}>
          <span className="ann-history__bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          {a.reads}/{a.recipients} leído
        </span>
        <Icon name="chevronDown" size={16} className="ann-history__chevron" />
      </button>
      {open && <RichTextView html={a.body_html} className="ann-history__body" />}
    </li>
  );
}

export default AnnouncementsPage;
