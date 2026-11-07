import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useAuth } from '../../../context/AuthContext';
import { canManageAdmissions } from '../../../components/layout/navigation';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import DynamicForm from '../components/DynamicForm';
import SubmissionsPanel from '../components/SubmissionsPanel';
import { FIELD_TYPES, FORM_STATUS, NO_PREFILL, PREFILL_SOURCES, SECTION_SCOPES, sectionScopeOf, WITH_OPTIONS, WITH_PLACEHOLDER, newField, newFieldId } from '../fieldTypes';

const DRAG_TYPE = 'application/x-modo-field';

/**
 * Diseñador de una planilla de inscripción: paleta de tipos de campo (se
 * arrastran al lienzo o se agregan con un clic), lienzo con los campos (se
 * reordenan arrastrando o con las flechas) y propiedades del campo elegido.
 * Pestaña «Planillas recibidas»: revisión de lo que enviaron las familias.
 */
function FormBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = canManageAdmissions(user); // Planillas: Administrador o Admisiones
  const { data: form, setData: setForm, loading, error } = useFetch(() => enrollmentFormsApi.get(id), [id]);
  const [tab, setTab] = useState('design');
  const [draft, setDraft] = useState(null); // { title, description, fields }
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [badIndex, setBadIndex] = useState(null);
  const [drag, setDrag] = useState(null); // { from: index } | { type }
  const [dropAt, setDropAt] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (form && !draft) setDraft({ title: form.title, description: form.description || '', fields: form.fields });
  }, [form, draft]);

  const dirty = useMemo(
    () => Boolean(form && draft) && JSON.stringify({ t: draft.title, d: draft.description || '', f: draft.fields }) !== JSON.stringify({ t: form.title, d: form.description || '', f: form.fields }),
    [form, draft]
  );
  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  if (loading || (!draft && !error)) return <Spinner label="Cargando planilla…" />;
  if (error) return <Alert>{error}</Alert>;

  const fields = draft.fields;
  const setFields = (next) => setDraft((d) => ({ ...d, fields: typeof next === 'function' ? next(d.fields) : next }));
  const selectedIndex = fields.findIndex((f) => f.id === selected);
  const current = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const patchField = (fid, patch) => setFields((list) => list.map((f) => (f.id === fid ? { ...f, ...patch } : f)));

  const insertAt = (index, field) => {
    setFields((list) => [...list.slice(0, index), field, ...list.slice(index)]);
    setSelected(field.id);
  };
  const addType = (type) => insertAt(selectedIndex >= 0 ? selectedIndex + 1 : fields.length, newField(type));
  const move = (from, to) => {
    if (to < 0 || to >= fields.length || from === to) return;
    setFields((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const duplicate = (i) => insertAt(i + 1, { ...structuredClone(fields[i]), id: newFieldId(fields[i].type), label: `${fields[i].label} (copia)` });
  const remove = (i) => {
    const f = fields[i];
    setFields((list) => list.filter((_, j) => j !== i));
    if (selected === f.id) setSelected(null);
  };

  // Arrastrar y soltar: desde la paleta (nuevo campo) o dentro del lienzo (reordenar).
  const onDropAt = (index) => {
    if (!drag) return;
    if (drag.type) insertAt(index, newField(drag.type));
    else if (drag.from !== undefined) move(drag.from, drag.from < index ? index - 1 : index);
    setDrag(null);
    setDropAt(null);
  };

  const save = async () => {
    setSaving(true);
    setBadIndex(null);
    try {
      const saved = await enrollmentFormsApi.update(id, { title: draft.title, description: draft.description || null, fields: draft.fields });
      setForm(saved);
      setDraft({ title: saved.title, description: saved.description || '', fields: saved.fields });
      toast.success('Planilla guardada', `${saved.fields.length} campos`);
      return true;
    } catch (err) {
      // Señala el campo con problemas (fields.<i>.<prop>).
      const detail = err?.response?.data?.error?.details?.[0]?.path || '';
      const m = /^fields\.(\d+)/.exec(detail);
      if (m) {
        setBadIndex(Number(m[1]));
        setSelected(fields[Number(m[1])]?.id || null);
      }
      toast.error('No se guardó la planilla', getErrorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    if (dirty && !(await save())) return;
    const texts = {
      published: { title: '¿Publicar la planilla?', message: 'Las familias la verán en su portal y podrán enviarla.', confirmLabel: 'Publicar' },
      closed: { title: '¿Cerrar la planilla?', message: 'Deja de recibir respuestas. Las ya recibidas se conservan.', confirmLabel: 'Cerrar' },
      draft: { title: '¿Volver a borrador?', message: 'Las familias dejarán de verla hasta que la publiques de nuevo.', confirmLabel: 'Volver a borrador' },
    }[status];
    if (!(await confirm({ ...texts, icon: 'clipboard' }))) return;
    try {
      const saved = await enrollmentFormsApi.setStatus(id, status);
      setForm(saved);
      toast.success(`Planilla ${FORM_STATUS[status].label.toLowerCase()}`, saved.title);
    } catch (err) {
      toast.error('No se pudo cambiar el estado', getErrorMessage(err));
    }
  };

  const destroy = async () => {
    if (!(await confirm({ title: `¿Eliminar «${form.title}»?`, message: 'Se borra la planilla y su diseño.', confirmLabel: 'Eliminar', danger: true, icon: 'trash' }))) return;
    try {
      await enrollmentFormsApi.remove(id);
      toast.success('Planilla eliminada', form.title);
      navigate('/enrollment-forms');
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  const status = FORM_STATUS[form.status];
  const questions = fields.filter((f) => f.type !== 'section').length;
  // Una sola foto del alumno por planilla (va en el membrete del PDF).
  const hasPhoto = fields.some((f) => f.type === 'photo');

  return (
    <div className="fb">
      <div className="fb__top">
        <Link to="/enrollment-forms" className="fb__back">
          <Icon name="arrowLeft" size={16} /> Planillas
        </Link>
        <div className="fb__title">
          <input className="fb__title-input" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={150} disabled={!canEdit} aria-label="Título de la planilla" />
          <span className="fb__subtitle">
            <Badge variant={status.variant}>{status.label}</Badge> {form.school_period_name} · {questions} pregunta{questions === 1 ? '' : 's'}
            {dirty && <span className="fb__dirty">· Cambios sin guardar</span>}
          </span>
        </div>
        <div className="fb__actions">
          <Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>
            Vista previa
          </Button>
          {canEdit && (
            <Button variant={dirty ? 'primary' : 'secondary'} icon="check" onClick={save} loading={saving} disabled={!dirty}>
              Guardar
            </Button>
          )}
          {canEdit && form.status !== 'published' && (
            <Button icon="send" onClick={() => changeStatus('published')}>
              Publicar
            </Button>
          )}
          {canEdit && form.status === 'published' && (
            <Button variant="secondary" icon="lock" onClick={() => changeStatus('closed')}>
              Cerrar
            </Button>
          )}
        </div>
      </div>

      <div className="fb__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'is-active' : ''} onClick={() => setTab('design')}>
          <Icon name="pencil" size={15} /> Diseño
        </button>
        <button type="button" role="tab" aria-selected={tab === 'submissions'} className={tab === 'submissions' ? 'is-active' : ''} onClick={() => setTab('submissions')}>
          <Icon name="inbox" size={15} /> Planillas recibidas
        </button>
      </div>

      {tab === 'submissions' ? (
        <SubmissionsPanel formId={id} canReview={canEdit} />
      ) : (
        <div className="fb__grid">
          {/* Paleta */}
          <aside className="fb__palette" aria-label="Tipos de campo">
            <span className="fb__label">Agregar campo</span>
            <p className="fb__hint">Arrástralo al lienzo o haz clic.</p>
            {Object.entries(FIELD_TYPES).map(([type, t]) => (
              <button
                key={type}
                type="button"
                className="fb__palette-item"
                draggable={canEdit && !(type === 'photo' && hasPhoto)}
                disabled={!canEdit || (type === 'photo' && hasPhoto)}
                title={type === 'photo' && hasPhoto ? 'La planilla ya tiene una foto del alumno' : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, type);
                  e.dataTransfer.effectAllowed = 'copy';
                  setDrag({ type });
                }}
                onDragEnd={() => (setDrag(null), setDropAt(null))}
                onClick={() => addType(type)}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
              </button>
            ))}
          </aside>

          {/* Lienzo */}
          <section className="fb__canvas" aria-label="Campos de la planilla">
            <textarea
              className="fb__description"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Descripción o instrucciones para las familias (opcional)"
              rows={2}
              maxLength={1000}
              disabled={!canEdit}
            />
            {!fields.length && (
              <div
                className={`fb__empty ${dropAt === 0 ? 'is-over' : ''}`}
                onDragOver={(e) => (e.preventDefault(), setDropAt(0))}
                onDrop={(e) => (e.preventDefault(), onDropAt(0))}
              >
                <Icon name="layers" size={22} />
                Arrastra aquí el primer campo, o elígelo en la paleta.
              </div>
            )}
            {fields.map((f, i) => (
              <div key={f.id}>
                <DropZone active={drag && dropAt === i} onOver={() => setDropAt(i)} onDrop={() => onDropAt(i)} visible={Boolean(drag)} />
                <div
                  className={`fb__card fb__card--${f.type} ${selected === f.id ? 'is-selected' : ''} ${badIndex === i ? 'is-bad' : ''} ${drag?.from === i ? 'is-dragging' : ''}`}
                  onClick={() => setSelected(f.id)}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, f.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDrag({ from: i });
                  }}
                  onDragEnd={() => (setDrag(null), setDropAt(null))}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDropAt(dropAt ?? i);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(f.id)}
                  aria-label={`${FIELD_TYPES[f.type]?.label}: ${f.label}`}
                >
                  {canEdit && (
                    <span className="fb__grip" aria-hidden="true" title="Arrastra para reordenar">
                      <Icon name="grip" size={16} />
                    </span>
                  )}
                  <span className="fb__card-icon">
                    <Icon name={FIELD_TYPES[f.type]?.icon || 'type'} size={16} />
                  </span>
                  <span className="fb__card-main">
                    <strong>
                      {f.label || 'Sin título'}
                      {f.required && <span className="form-field__required">*</span>}
                    </strong>
                    <span className="fb__card-meta">
                      {FIELD_TYPES[f.type]?.label}
                      {WITH_OPTIONS.includes(f.type) && ` · ${f.options?.length || 0} opciones: ${(f.options || []).slice(0, 3).join(', ')}${(f.options || []).length > 3 ? '…' : ''}`}
                      {f.help && ` · ${f.help}`}
                      {f.type === 'section' && sectionScopeOf(f) && ` · ${SECTION_SCOPES[sectionScopeOf(f)].short}${f.scope ? '' : ' (automático)'}`}
                      {f.prefill && f.prefill !== 'none' && ` · Precarga: ${PREFILL_SOURCES.find((s) => s.key === f.prefill)?.label || f.prefill}`}
                    </span>
                  </span>
                  {canEdit && (
                    <span className="fb__card-tools" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} title="Subir" aria-label="Subir">
                        <Icon name="chevronUp" size={15} />
                      </button>
                      <button type="button" onClick={() => move(i, i + 1)} disabled={i === fields.length - 1} title="Bajar" aria-label="Bajar">
                        <Icon name="chevronDown" size={15} />
                      </button>
                      <button type="button" onClick={() => duplicate(i)} title="Duplicar" aria-label="Duplicar">
                        <Icon name="copy" size={15} />
                      </button>
                      <button type="button" className="is-danger" onClick={() => remove(i)} title="Eliminar" aria-label="Eliminar">
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
            {fields.length > 0 && <DropZone active={drag && dropAt === fields.length} onOver={() => setDropAt(fields.length)} onDrop={() => onDropAt(fields.length)} visible={Boolean(drag)} />}
            {canEdit && form.status === 'draft' && (
              <button type="button" className="fb__delete-form" onClick={destroy}>
                Eliminar esta planilla
              </button>
            )}
          </section>

          {/* Propiedades */}
          <aside className="fb__props" aria-label="Propiedades del campo">
            {!current ? (
              <div className="fb__props-empty">
                <Icon name="pencil" size={20} />
                Elige un campo del lienzo para editarlo.
              </div>
            ) : (
              <FieldProps key={current.id} field={current} onChange={(patch) => patchField(current.id, patch)} disabled={!canEdit} />
            )}
          </aside>
        </div>
      )}

      {preview && (
        <Drawer title={draft.title || 'Vista previa'} subtitle="Así la verán las familias en el portal" icon="eye" size="lg" onClose={() => setPreview(false)}>
          <PreviewForm fields={fields} description={draft.description} />
        </Drawer>
      )}
    </div>
  );
}

function DropZone({ active, onOver, onDrop, visible }) {
  if (!visible) return null;
  return (
    <div
      className={`fb__drop ${active ? 'is-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        onOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    />
  );
}

/** Propiedades del campo elegido. */
function FieldProps({ field: f, onChange, disabled }) {
  const isSection = f.type === 'section';
  const [optionsText, setOptionsText] = useState((f.options || []).join('\n'));
  return (
    <div className="fb__props-form">
      <span className="fb__label">
        <Icon name={FIELD_TYPES[f.type]?.icon} size={14} /> {FIELD_TYPES[f.type]?.label}
      </span>
      <Field label={isSection ? 'Título de la sección' : 'Pregunta'} required>
        <Input value={f.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={200} disabled={disabled} autoFocus />
      </Field>
      <Field label={isSection ? 'Descripción' : 'Ayuda'} hint={isSection ? 'Texto bajo el título (opcional).' : 'Aparece bajo la pregunta (opcional).'}>
        <Input value={f.help || ''} onChange={(e) => onChange({ help: e.target.value })} maxLength={300} disabled={disabled} />
      </Field>
      {WITH_PLACEHOLDER.includes(f.type) && (
        <Field label="Texto de ejemplo" hint="Se ve en gris dentro del campo vacío.">
          <Input value={f.placeholder || ''} onChange={(e) => onChange({ placeholder: e.target.value })} maxLength={120} disabled={disabled} />
        </Field>
      )}
      {WITH_OPTIONS.includes(f.type) && (
        <Field label="Opciones" hint="Una por línea.">
          <textarea
            className="input"
            rows={Math.min(10, Math.max(3, (f.options || []).length + 1))}
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              onChange({ options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) });
            }}
            disabled={disabled}
          />
        </Field>
      )}
      {isSection && (
        <Field
          label="Las preguntas de esta sección son…"
          hint={
            f.scope
              ? 'Al re-inscribir, sus preguntas se precargan con los datos de esta persona.'
              : `Automático según el título: ${sectionScopeOf(f) ? SECTION_SCOPES[sectionScopeOf(f)].label.toLowerCase() : 'sin pista (cada pregunta se juzga por su texto)'}.`
          }
        >
          <select className="input" value={f.scope || ''} onChange={(e) => onChange({ scope: e.target.value || undefined })} disabled={disabled}>
            <option value="">Automático (según el título)</option>
            {Object.entries(SECTION_SCOPES).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!NO_PREFILL.includes(f.type) && (
        <Field label="Precargar con" hint="Al re-inscribir a un alumno ya registrado, el campo llega lleno con este dato y el representante solo lo verifica. En automático se usa la sección donde está la pregunta.">
          <select className="input" value={f.prefill || ''} onChange={(e) => onChange({ prefill: e.target.value || undefined })} disabled={disabled}>
            <option value="">Automático (según la pregunta y su sección)</option>
            <option value="none">No precargar</option>
            {PREFILL_SOURCES.filter((s) => s.types.includes(f.type)).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!isSection && (
        <label className="fb__switch">
          <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => onChange({ required: e.target.checked })} disabled={disabled} />
          <span>{f.type === 'checkbox' ? 'Obligatorio marcarla' : 'Obligatoria'}</span>
        </label>
      )}
    </div>
  );
}

/** Vista previa interactiva (no envía nada). */
function PreviewForm({ fields, description }) {
  const [values, setValues] = useState({});
  return (
    <>
      {description && <p className="dyn-form__intro">{description}</p>}
      <Alert variant="info">Vista previa: puedes probar los campos; nada se envía.</Alert>
      <DynamicForm fields={fields} values={values} onChange={(fid, v) => setValues((s) => ({ ...s, [fid]: v }))} />
    </>
  );
}

export default FormBuilderPage;
