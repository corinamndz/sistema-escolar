import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import certificatesApi from '../../../api/endpoints/certificates.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import ColorPicker from '../../../components/ui/ColorPicker';
import Icon from '../../../components/ui/Icon';
import Modal from '../../../components/ui/Modal';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import FormPdfButton from '../../enrollment-forms/components/FormPdfButton';
import CertificateBackground from '../components/CertificateBackground';
import { createBackgroundSampler } from '../sampleColor';
import { cssFamily, useCertificateFonts } from '../certificateFonts';
import StandardTemplateGallery from '../components/StandardTemplateGallery';

/** Variables del sistema: lo que muestra el editor es un ejemplo; el PDF usa los datos reales. */
const VARIABLES = [
  { key: 'student_name', token: '{{student_name}}', label: 'Nombre del alumno', sample: 'María Fernanda Pérez González', y: 0.42, fontSize: 28, font: 'times', bold: true },
  { key: 'student_id', token: '{{student_id}}', label: 'Cédula / documento', sample: 'V-30123456', y: 0.5, fontSize: 14, font: 'helvetica', bold: false },
  { key: 'target_grade', token: '{{target_grade}}', label: 'Grado al que asciende', sample: '2do Grado', y: 0.58, fontSize: 18, font: 'times', bold: true },
  { key: 'school_year', token: '{{school_year}}', label: 'Año escolar', sample: '2026-2027', y: 0.66, fontSize: 14, font: 'helvetica', bold: false },
  { key: 'issue_date', token: '{{issue_date}}', label: 'Fecha de emisión', sample: '8 de noviembre de 2026', y: 0.74, fontSize: 12, font: 'helvetica', bold: false },
];
const VAR = Object.fromEntries(VARIABLES.map((v) => [v.key, v]));
const DRAG_KEY = 'application/x-modo-certificate-variable';
const DRAG_CUSTOM = '__custom_text';
const DRAG_LOGO = '__logo';
const LOGO_ID = 'logo';
const MIN_LOGO = 0.02;
const SNAP = 0.008; // cerca del centro de la hoja, se ajusta al centro
const STEP = 0.002;
const MAX_TEXT = 2000;
const BASE_COLORS = ['#0f172a', '#334155', '#64748b', '#1d4ed8', '#047857', '#b91c1c', '#b45309', '#ffffff'];
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round4 = (n) => Math.round(n * 10000) / 10000;
const TRANSLATE = { left: '0', center: '-50%', right: '-100%' };

/** Variables, bloques de texto libre y el logo se manejan igual; se identifican por su clave o su id. */
const isCustom = (f) => f.type === 'custom_text';
const isLogo = (f) => f.type === 'logo';
const idOf = (f) => (isCustom(f) || isLogo(f) ? f.id : f.key);
const labelOf = (f) => (isCustom(f) ? 'Texto libre' : isLogo(f) ? 'Logo del colegio' : VAR[f.key].label);
/** El logo llega como /storage/...: en producción el API puede estar en otro dominio. */
const assetUrl = (url) => (url && url.startsWith('/') ? `${import.meta.env.VITE_API_URL || ''}${url}` : url);
/** Alto (fracción del alto de la hoja) que respeta la proporción del logo para ese ancho. */
const logoHeightFor = (width, ratio, page) => round4(Math.min(1, Math.max(MIN_LOGO, (width * page.page_width) / ratio / page.page_height)));
/** Caja del logo: `width` × `height` de la hoja, anclada como los textos; el logo cabe entero dentro (certificateGenerator.drawLogo). */
const logoStyle = (f) => ({ width: `${f.width * 100}%`, height: `${f.height * 100}%` });
const OBJECT_POSITION = { left: 'left center', center: 'center', right: 'right center' };
const newField = (key, x = 0.5, y) => ({ key, x, y: y ?? VAR[key].y, fontSize: VAR[key].fontSize, color: '#0f172a', align: 'center', font: VAR[key].font, bold: VAR[key].bold });
const newBlock = (content, x = 0.5, y = 0.85) => ({ type: 'custom_text', id: crypto.randomUUID(), content, x, y, width: 0.6, fontSize: 12, color: '#0f172a', align: 'center', font: 'helvetica', bold: false });

const TOKEN = /\{\{\s*(\w*)\s*\}\}/g;
/** Lo que se ve en el lienzo: cada {{variable}} con su dato de ejemplo. */
const withSamples = (content) => content.replace(TOKEN, (match, key) => (VAR[key] ? VAR[key].sample : match));
const unknownTokens = (content) => [...content.matchAll(TOKEN)].map((m) => m[1]).filter((k) => !VAR[k]);

/** Área de texto con botones para insertar variables donde está el cursor. */
function TextWithTokens({ value, onChange, rows, autoFocus = false, placeholder }) {
  const ref = useRef(null);
  const insert = (token) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    if (next.length > MAX_TEXT) return;
    onChange(next);
    // Tras pintar el texto nuevo, el cursor queda detrás de la variable.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <>
      <textarea ref={ref} className="input cert-textarea" rows={rows} maxLength={MAX_TEXT} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      <div className="cert-tokens" aria-label="Insertar una variable en el texto">
        {VARIABLES.map((v) => (
          <button key={v.key} type="button" className="adj-chip" onClick={() => insert(v.token)} title={`Inserta ${v.token}`}>
            + {v.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Cuadro para escribir el texto de un bloque: frases institucionales, párrafos legales, notas al pie. */
function CustomTextDialog({ initial = '', onCancel, onSave }) {
  const [text, setText] = useState(initial);
  const bad = unknownTokens(text);
  const empty = !text.trim();
  return (
    <Modal title={initial ? 'Editar texto libre' : 'Agregar texto libre'} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty) onSave(text);
        }}
        className="adj-form"
      >
        <Field label="Texto" required error={bad.length ? `Variable desconocida: {{${bad[0]}}}` : undefined} hint={`Las variables se reemplazan por los datos de cada alumno. ${text.length}/${MAX_TEXT}`}>
          <TextWithTokens value={text} onChange={setText} rows={5} autoFocus placeholder="Ej.: La Dirección certifica que {{student_name}} cursó y aprobó el año escolar {{school_year}}." />
        </Field>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" icon="check" disabled={empty || bad.length > 0}>
            {initial ? 'Guardar texto' : 'Agregar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Administración → Certificado de promoción. Un diseño general y, si se quiere,
 * diseños propios por año escolar y por nivel. Al elegir otro año o nivel se
 * vuelve a montar el editor (key) con el diseño de ese alcance.
 */
function CertificateEditorPage() {
  // `version`: recargar también el mismo alcance (al crear o eliminar su diseño).
  const [state, setState] = useState({ scope: { schoolPeriodId: '', levelCode: '' }, version: 0 });
  const { scope, version } = state;
  return <ScopedEditor key={`${scope.schoolPeriodId}|${scope.levelCode}|${version}`} scope={scope} onScopeChange={(next) => setState((s) => ({ scope: next, version: s.version + 1 }))} />;
}

/**
 * El editor de un alcance: sube el fondo y coloca sobre él las variables y los
 * textos libres, arrastrándolos. Si el alcance no tiene diseño propio, muestra el
 * que hereda, sin poder editarlo. Mismas proporciones y fuentes equivalentes a las
 * del PDF (services/pdf/certificateGenerator.js).
 */
function ScopedEditor({ scope, onScopeChange }) {
  const { data, setData, loading, error } = useFetch(() => certificatesApi.get(scope), []);
  const own = data?.template || null;
  // Lo que se ve: el diseño propio o, si no tiene, el que hereda (solo lectura).
  const template = own || data?.effective || null;
  const readOnly = !own;
  const confirm = useConfirm();
  const [scopeBusy, setScopeBusy] = useState(false);
  const [gallery, setGallery] = useState(false);
  const fonts = data?.fonts || [];
  const FONT = Object.fromEntries(fonts.map((f) => [f.key, f]));
  useCertificateFonts(data?.fonts);
  const [fields, setFields] = useState(null);
  const [selected, setSelected] = useState(null);
  const [blob, setBlob] = useState(null);
  const [backgroundFailed, setBackgroundFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [canvasW, setCanvasW] = useState(0);
  const [guide, setGuide] = useState(false);
  const [sampling, setSampling] = useState(null); // gotero alternativo: { id } del elemento que recibe el color
  const [hover, setHover] = useState(null); // { x, y, color } bajo el cursor mientras se muestrea
  const [textDialog, setTextDialog] = useState(null); // { x, y } nuevo · { id, content } editar
  const [logoRatio, setLogoRatio] = useState(null); // ancho / alto del logo del colegio
  const [logoFailed, setLogoFailed] = useState(false);
  const [keepRatio, setKeepRatio] = useState(true);
  const logoUrl = assetUrl(data?.logo_url);
  const canvasRef = useRef(null);
  const propsRef = useRef(null);
  const samplerRef = useRef(null);
  const fileRef = useRef(null);
  const dragRef = useRef(null);
  const toast = useToast();
  const ready = fields !== null;

  useEffect(() => {
    if (data && fields === null) setFields(template?.fields || []);
  }, [data, fields]);

  // Fondo: se pide con la sesión, no es un archivo público.
  const backgroundKey = template?.background_path;
  useEffect(() => {
    if (!backgroundKey) return undefined;
    let alive = true;
    setBackgroundFailed(false);
    certificatesApi
      .background(scope)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setBackgroundFailed(true));
    return () => {
      alive = false;
    };
  }, [backgroundKey]);

  // Proporción del logo, para que nazca y se redimensione sin deformarse.
  useEffect(() => {
    if (!logoUrl) return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setLogoRatio(img.naturalWidth / img.naturalHeight || 1);
    img.onerror = () => alive && setLogoFailed(true);
    img.src = logoUrl;
    return () => {
      alive = false;
    };
  }, [logoUrl]);

  // El tamaño de letra se dibuja a escala de la hoja, sea cual sea el ancho del lienzo.
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setCanvasW(entry.contentRect.width));
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
    // `ready`: el lienzo aparece después de cargar, y antes no hay nada que observar.
  }, [template?.id, backgroundKey, ready]);

  // Gotero alternativo: Esc lo cancela.
  useEffect(() => {
    if (!sampling) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSampling(null);
        setHover(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sampling]);

  // Al elegir un elemento, sus propiedades quedan a la vista dentro del panel lateral.
  useEffect(() => {
    if (selected) propsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const dirty = useMemo(() => !readOnly && fields !== null && JSON.stringify(fields) !== JSON.stringify(template?.fields || []), [fields, template, readOnly]);
  useEffect(() => {
    if (!dirty) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  if (loading || (fields === null && !error)) return <Spinner label="Cargando certificado…" />;
  if (error) return <Alert>{error}</Alert>;

  const scale = template && canvasW ? canvasW / template.page_width : 1;
  const current = fields.find((f) => idOf(f) === selected) || null;
  const blocks = fields.filter(isCustom);
  const patch = (id, values) => setFields((list) => list.map((f) => (idOf(f) === id ? { ...f, ...values } : f)));
  const add = (key, x, y) => {
    setFields((list) => (list.some((f) => f.key === key) ? list : [...list, newField(key, x, y)]));
    setSelected(key);
  };
  const logoField = fields.find(isLogo) || null;
  const addLogo = (x = 0.5, y = 0.14) => {
    if (!logoField) {
      const width = 0.14;
      setFields((list) => [...list, { type: 'logo', id: LOGO_ID, x, y, width, height: logoHeightFor(width, logoRatio || 1, template), align: 'center' }]);
    }
    setSelected(LOGO_ID);
  };
  /** Cambia el tamaño del logo; con la proporción fija, el otro lado lo acompaña. */
  const resizeLogo = (values) => {
    const next = { ...values };
    if (keepRatio && logoRatio) {
      if ('width' in values) next.height = logoHeightFor(values.width, logoRatio, template);
      else next.width = round4(Math.min(1, Math.max(MIN_LOGO, (values.height * template.page_height * logoRatio) / template.page_width)));
    }
    patch(LOGO_ID, next);
  };
  const remove = (id) => {
    setFields((list) => list.filter((f) => idOf(f) !== id));
    if (selected === id) setSelected(null);
  };
  const saveText = (content) => {
    if (textDialog.id) {
      patch(textDialog.id, { content });
      setSelected(textDialog.id);
    } else {
      const block = newBlock(content, textDialog.x, textDialog.y);
      setFields((list) => [...list, block]);
      setSelected(block.id);
    }
    setTextDialog(null);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await certificatesApi.uploadBackground(scope, file);
      setBlob(null);
      if (readOnly) {
        // Nace el diseño propio, con las posiciones del que heredaba: se recarga el alcance.
        onScopeChange({ ...scope });
        toast.success('Diseño propio creado', `${data.scope_label}: con el fondo nuevo y las posiciones de ${data.effective_label || 'cero'}.`);
        return;
      }
      setData((d) => ({ ...d, template: { ...res.template, fields: d?.template?.fields || res.template.fields } }));
      toast.success('Fondo actualizado', res.pages > 1 ? `El PDF tiene ${res.pages} páginas: se usa la primera.` : 'Coloca las variables sobre él.');
    } catch (err) {
      setUploadError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  /** Advertencia antes de publicar con el año escolar aún activo. → true si acepta. */
  const confirmActiveYear = (year) =>
    confirm({
      title: 'Advertencia: el año escolar sigue activo',
      message: `${year.all_years ? `Este diseño se usa en todos los años y el año en curso, ${year.name}, ` : `El año escolar ${year.name} `}aún se encuentra activo. Por lo general, los certificados de promoción se publican al finalizar el período. ¿Desea publicar los certificados de todas formas?`,
      icon: 'alertTriangle',
      confirmLabel: 'Sí, publicar de todos modos',
      cancelLabel: 'Cancelar',
    });

  const togglePublished = async () => {
    const publish = !template.published_at;
    // Año activo: se pregunta antes (y el servidor lo exige igual, por si cambió entretanto).
    let accepted = false;
    if (publish && data.publish_year?.active) {
      if (!(await confirmActiveYear(data.publish_year))) return;
      accepted = true;
    }
    setPublishing(true);
    try {
      let saved;
      try {
        saved = await certificatesApi.setPublished(scope, publish, { confirmActiveYear: accepted });
      } catch (err) {
        const active = err?.response?.data?.error?.details?.find?.((d) => d.code === 'SCHOOL_YEAR_ACTIVE');
        if (!active) throw err;
        if (!(await confirmActiveYear(active))) return;
        saved = await certificatesApi.setPublished(scope, publish, { confirmActiveYear: true });
      }
      setData((d) => ({ ...d, template: { ...d.template, published_at: saved.published_at } }));
      toast.success(publish ? 'Certificado publicado' : 'Certificado retirado', publish ? 'Las familias de los alumnos promovidos ya pueden descargarlo.' : 'Las familias ya no lo ven en el portal.');
    } catch (err) {
      toast.error('No se pudo cambiar la publicación', getErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await certificatesApi.saveFields(scope, fields);
      setData((d) => ({ ...d, template: saved }));
      // Lo guardado es la referencia: la base de datos reordena las claves del JSON.
      setFields(saved.fields);
      toast.success('Certificado guardado', `${saved.fields.length} elemento${saved.fields.length === 1 ? '' : 's'} en el certificado`);
    } catch (err) {
      toast.error('No se guardó el certificado', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // ---------- Plantillas estándar ----------
  const openGallery = async () => {
    if (dirty && !(await confirm({ title: '¿Descartar los cambios sin guardar?', message: 'Al usar una plantilla estándar se recarga el diseño.', confirmLabel: 'Descartar', danger: true }))) return;
    setGallery(true);
  };
  const applyStandard = async (key) => {
    const res = await certificatesApi.applyStandard(scope, key);
    toast.success('Plantilla aplicada', res.suggested ? 'Con los textos ya colocados: ajústalos a tu gusto y guarda.' : 'Tus textos se conservan sobre el fondo nuevo.');
    setGallery(false);
    onScopeChange({ ...scope });
  };

  // ---------- Alcance: otro año o nivel, crear o eliminar el diseño propio ----------
  const changeScope = async (next) => {
    if (dirty && !(await confirm({ title: '¿Descartar los cambios sin guardar?', message: 'Vas a abrir el diseño de otro año o nivel.', confirmLabel: 'Descartar', danger: true }))) return;
    onScopeChange({ ...scope, ...next });
  };
  const customize = async () => {
    setScopeBusy(true);
    try {
      await certificatesApi.customize(scope);
      toast.success('Diseño propio creado', `${data.scope_label}: es una copia de ${data.effective_label}. Ajústalo y publícalo.`);
      onScopeChange({ ...scope });
    } catch (err) {
      toast.error('No se pudo crear el diseño', getErrorMessage(err));
    } finally {
      setScopeBusy(false);
    }
  };
  const removeOwn = async () => {
    const general = !scope.schoolPeriodId && !scope.levelCode;
    const ok = await confirm({
      title: general ? '¿Eliminar el diseño general?' : `¿Eliminar el diseño de ${data.scope_label}?`,
      message: general
        ? 'Los años y niveles sin diseño propio se quedarán sin certificado.'
        : 'Este año y nivel volverán a usar el diseño del que heredan. Se borran su fondo y sus posiciones.',
      confirmLabel: 'Eliminar diseño',
      danger: true,
    });
    if (!ok) return;
    setScopeBusy(true);
    try {
      await certificatesApi.remove(scope);
      toast.success('Diseño eliminado', data.scope_label);
      onScopeChange({ ...scope });
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
      setScopeBusy(false);
    }
  };

  // ---------- Gotero para navegadores sin EyeDropper: lee el píxel del fondo ----------
  const startSampling = (id) => {
    const sampler = createBackgroundSampler(canvasRef.current?.querySelector('.cert-bg'));
    if (!sampler) {
      toast.error('Aún no se puede tomar el color', 'Espera a que cargue el fondo del certificado.');
      return;
    }
    samplerRef.current = sampler;
    setSampling({ id });
  };
  const sampleFrom = (e) => {
    const p = pointFrom(e);
    return { x: p.x, y: p.y, color: samplerRef.current(p.x, p.y) };
  };
  const finishSampling = (e) => {
    patch(sampling.id, { color: sampleFrom(e).color });
    setSampling(null);
    setHover(null);
  };

  // ---------- Arrastrar sobre el lienzo ----------
  const pointFrom = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const startDrag = (e, f) => {
    if (readOnly) return;
    e.preventDefault();
    e.currentTarget.focus(); // para seguir ajustándolo con las flechas
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFrom(e);
    dragRef.current = { id: idOf(f), dx: f.x - p.x, dy: f.y - p.y };
    setSelected(idOf(f));
  };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d || d.resize) return; // la esquina del logo redimensiona; no mueve
    const p = pointFrom(e);
    let x = clamp01(p.x + d.dx);
    const snapped = Math.abs(x - 0.5) < SNAP;
    if (snapped) x = 0.5;
    setGuide(snapped);
    patch(d.id, { x: round4(x), y: round4(clamp01(p.y + d.dy)) });
  };
  const endDrag = () => {
    dragRef.current = null;
    setGuide(false);
  };
  // Esquina inferior derecha del logo: lo agranda o achica conservando su ancla (align).
  const startResize = (e, f) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { resize: true, start: pointFrom(e), f };
  };
  const moveResize = (e) => {
    const d = dragRef.current;
    if (!d?.resize) return;
    const p = pointFrom(e);
    const dx = p.x - d.start.x;
    const grow = { left: 1, center: 2, right: 1 }[d.f.align];
    const width = round4(Math.min(1, Math.max(MIN_LOGO, d.f.width + dx * grow)));
    const values = { width, ...(d.f.align === 'right' ? { x: round4(clamp01(d.f.x + (width - d.f.width))) } : {}) };
    if (keepRatio && logoRatio) values.height = logoHeightFor(width, logoRatio, template);
    else values.height = round4(Math.min(1, Math.max(MIN_LOGO, d.f.height + (p.y - d.start.y))));
    patch(LOGO_ID, values);
  };
  const onChipKey = (e, f) => {
    const delta = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (delta) {
      e.preventDefault();
      const by = e.shiftKey ? 5 : 1;
      patch(idOf(f), { x: round4(clamp01(f.x + delta[0] * by)), y: round4(clamp01(f.y + delta[1] * by)) });
    } else if (e.key === 'Delete') {
      remove(idOf(f));
    }
  };

  return (
    <div>
      <PageHeader
        title="Certificado de promoción"
        subtitle="Un diseño general y, si lo necesitas, uno propio por año escolar o por nivel."
        actions={
          own && (
            <>
              <FormPdfButton load={() => certificatesApi.preview(scope, fields)} fileName="certificado-ejemplo.pdf" label="Vista previa en PDF" variant="secondary" size="md" />
              <Button icon="check" onClick={save} loading={saving} disabled={!dirty}>
                Guardar
              </Button>
            </>
          )
        }
      />
      <section className="card cert-scope">
        <div className="cert-scope__selects">
          <Field label="Año escolar">
            <Select value={scope.schoolPeriodId} onChange={(e) => changeScope({ schoolPeriodId: e.target.value })} disabled={scopeBusy}>
              <option value="">Todos los años</option>
              {data.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.closed_at ? ' (finalizado)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nivel educativo">
            <Select value={scope.levelCode} onChange={(e) => changeScope({ levelCode: e.target.value })} disabled={scopeBusy}>
              <option value="">Todos los niveles</option>
              {data.levels.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {data.designs.length > 0 && (
          <div className="cert-scope__designs">
            <span className="text-sm text-muted">Diseños del colegio:</span>
            {data.designs.map((d) => {
              const active = (d.school_period_id || '') === scope.schoolPeriodId && (d.level_code || '') === scope.levelCode;
              return (
                <button key={d.id} type="button" className={`cert-design ${active ? 'is-active' : ''}`} onClick={() => !active && changeScope({ schoolPeriodId: d.school_period_id || '', levelCode: d.level_code || '' })} aria-pressed={active} title={d.published ? 'Publicado para las familias' : 'Sin publicar'}>
                  <span className={`cert-status__dot ${d.published ? 'is-on' : ''}`} aria-hidden="true" />
                  {d.school_period_id || d.level_code ? d.label : 'General'}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {own && (scope.schoolPeriodId || scope.levelCode) && (
        <p className="cert-scope__note">
          <Icon name="info" size={15} /> Editas el diseño propio de <strong>{data.scope_label}</strong>.
          <button type="button" className="link-button" onClick={removeOwn} disabled={scopeBusy}>
            Eliminar este diseño
          </button>
        </p>
      )}
      {readOnly && template && (
        <div className="cert-inherit">
          <Icon name="layers" size={18} />
          <div>
            <strong>{data.scope_label} usa el diseño «{data.effective_label}».</strong>
            <span>Si lo necesitas distinto, crea uno propio: los demás años y niveles no cambian. Nace sin publicar, así que hasta que lo publiques las familias de {data.scope_label} no verán el certificado.</span>
          </div>
          <span className="cert-inherit__actions">
            <Button size="sm" icon="copy" onClick={customize} loading={scopeBusy}>
              Crear diseño propio
            </Button>
            <Button size="sm" variant="secondary" icon="image" onClick={() => fileRef.current?.click()} loading={uploading} disabled={scopeBusy}>
              Con otro fondo
            </Button>
            <Button size="sm" variant="secondary" icon="layers" onClick={openGallery} disabled={scopeBusy}>
              Plantilla estándar
            </Button>
          </span>
        </div>
      )}

      <Alert>{uploadError}</Alert>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,application/pdf" onChange={onFile} hidden />

      {!template ? (
        <div className="cert-start">
          <button type="button" className="cert-empty" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Icon name="image" size={28} />
            <strong>{uploading ? 'Subiendo…' : scope.schoolPeriodId || scope.levelCode ? `Sube el fondo para ${data.scope_label}` : 'Sube el fondo del certificado'}</strong>
            <span>PNG, JPG o PDF, de hasta 10 MB. De un PDF se usa la primera página.</span>
          </button>
          <button type="button" className="cert-empty" onClick={openGallery}>
            <Icon name="layers" size={28} />
            <strong>Usar una plantilla estándar</strong>
            <span>Cuatro diseños listos con el color de tu colegio, con los textos ya colocados.</span>
          </button>
        </div>
      ) : (
        <div className="cert-editor">
          <div className="cert-stage">
            <div
              ref={canvasRef}
              className={`cert-canvas ${readOnly ? 'is-readonly' : ''}`}
              style={{ aspectRatio: `${template.page_width} / ${template.page_height}` }}
              onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (readOnly) return;
                const key = e.dataTransfer.getData(DRAG_KEY);
                const p = pointFrom(e);
                const x = round4(clamp01(p.x));
                const y = round4(clamp01(p.y));
                if (key === DRAG_CUSTOM) setTextDialog({ x, y });
                else if (key === DRAG_LOGO) logoUrl && addLogo(x, y);
                else if (VAR[key]) add(key, x, y);
              }}
            >
              {backgroundFailed ? (
                <div className="cert-missing">
                  <Icon name="alertTriangle" size={22} />
                  <strong>No se encontró el archivo del fondo</strong>
                  <span>Tus posiciones se conservan. Súbelo de nuevo con «Cambiar fondo».</span>
                </div>
              ) : (
                <CertificateBackground blob={blob} type={template.background_type} />
              )}
              {guide && <span className="cert-guide" aria-hidden="true" />}
              {sampling && (
                <div className="cert-sampler" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => setHover(sampleFrom(e))} onPointerLeave={() => setHover(null)} onClick={finishSampling}>
                  {hover && (
                    <span className="cert-sampler__tip" style={{ left: `${hover.x * 100}%`, top: `${hover.y * 100}%` }}>
                      <i style={{ background: hover.color }} />
                      {hover.color.toUpperCase()}
                    </span>
                  )}
                </div>
              )}
              {fields.map((f) =>
                isLogo(f) ? (
                  <div
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    className={`cert-chip cert-chip--logo ${selected === f.id ? 'is-selected' : ''} ${logoUrl && !logoFailed ? '' : 'is-empty'}`}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, transform: `translate(${TRANSLATE[f.align]}, -50%)`, ...logoStyle(f) }}
                    title="Logo del colegio: arrastra para colocarlo; la esquina lo redimensiona."
                    aria-label={`Logo del colegio, en ${Math.round(f.x * 100)} % horizontal y ${Math.round(f.y * 100)} % vertical`}
                    onPointerDown={(e) => startDrag(e, f)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => onChipKey(e, f)}
                    onFocus={() => setSelected(f.id)}
                  >
                    {logoUrl && !logoFailed ? <img src={logoUrl} alt="" draggable={false} style={{ objectPosition: OBJECT_POSITION[f.align] }} /> : <span>Sin logo</span>}
                    {selected === f.id && !readOnly && (
                      <span className="cert-chip__resize" onPointerDown={(e) => startResize(e, f)} onPointerMove={moveResize} onPointerUp={endDrag} onPointerCancel={endDrag} aria-hidden="true" />
                    )}
                  </div>
                ) : (
                <button
                  key={idOf(f)}
                  type="button"
                  className={`cert-chip ${isCustom(f) ? 'cert-chip--block' : ''} ${selected === idOf(f) ? 'is-selected' : ''}`}
                  style={{
                    left: `${f.x * 100}%`,
                    top: `${f.y * 100}%`,
                    transform: `translate(${TRANSLATE[f.align]}, -50%)`,
                    fontSize: `${f.fontSize * scale}px`,
                    color: f.color,
                    fontWeight: f.bold ? 700 : 400,
                    fontFamily: cssFamily(FONT[f.font]),
                    ...(isCustom(f) ? { width: `${f.width * 100}%`, textAlign: f.align } : {}),
                  }}
                  title={isCustom(f) ? 'Arrastra para colocarlo; doble clic para editar el texto.' : `${labelOf(f)}: arrastra para colocarlo; las flechas lo ajustan.`}
                  aria-label={`${labelOf(f)}, en ${Math.round(f.x * 100)} % horizontal y ${Math.round(f.y * 100)} % vertical`}
                  onPointerDown={(e) => startDrag(e, f)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onChipKey(e, f)}
                  onFocus={() => setSelected(idOf(f))}
                  onDoubleClick={() => isCustom(f) && setTextDialog({ id: f.id, content: f.content })}
                >
                  {isCustom(f) ? withSamples(f.content) : VAR[f.key].sample}
                </button>
                ),
              )}
            </div>
            {sampling && (
              <p className="cert-sampling" role="status">
                <Icon name="pipette" size={15} /> Haz clic en el fondo del certificado para tomar su color.
                <button type="button" className="link-button" onClick={() => { setSampling(null); setHover(null); }}>
                  Cancelar (Esc)
                </button>
              </p>
            )}
            <p className="text-sm text-muted">Las variables muestran datos de ejemplo. Arrastra cada elemento; con las flechas del teclado lo ajustas con precisión.</p>
          </div>

          {readOnly ? (
            <aside className="cert-side">
              <section className="card cert-panel">
                <h3 className="card__title">Diseño heredado</h3>
                <p className="text-sm text-muted">Lo que ves es «{data.effective_label}». Para cambiarlo solo aquí, crea un diseño propio arriba.</p>
                <p className="cert-status">
                  <span className={`cert-status__dot ${template.published_at ? 'is-on' : ''}`} aria-hidden="true" />
                  {template.published_at ? 'Las familias lo descargan.' : 'Sin publicar.'}
                </p>
              </section>
            </aside>
          ) : (
          <aside className="cert-side">
            <section className="card cert-panel">
              <h3 className="card__title">Fondo</h3>
              <p className="text-sm text-muted">{template.background_type.toUpperCase()} · {Math.round(template.page_width)} × {Math.round(template.page_height)} pt</p>
              <span className="cert-panel__buttons">
                <Button variant="secondary" size="sm" icon="refresh" onClick={() => fileRef.current?.click()} loading={uploading}>
                  Cambiar fondo
                </Button>
                <Button variant="secondary" size="sm" icon="layers" onClick={openGallery}>
                  Plantilla estándar
                </Button>
              </span>
            </section>

            <section className="card cert-panel">
              <h3 className="card__title">Familias</h3>
              <p className="cert-status">
                <span className={`cert-status__dot ${template.published_at ? 'is-on' : ''}`} aria-hidden="true" />
                {template.published_at ? 'Publicado: lo descargan en el portal.' : 'Sin publicar: solo lo ve la administración.'}
              </p>
              {template.published_at && dirty && <p className="text-sm text-muted">Las familias ven lo último guardado: guarda para aplicar tus cambios.</p>}
              {!template.published_at && !(template.fields || []).length && <p className="text-sm text-muted">Coloca y guarda al menos un elemento para poder publicarlo.</p>}
              <Button variant={template.published_at ? 'secondary' : 'primary'} size="sm" icon={template.published_at ? 'lock' : 'send'} onClick={togglePublished} loading={publishing} disabled={!template.published_at && !(template.fields || []).length}>
                {template.published_at ? 'Retirar del portal' : 'Publicar para las familias'}
              </Button>
            </section>

            <section className="card cert-panel">
              <h3 className="card__title">Variables</h3>
              <p className="text-sm text-muted">Arrástralas al certificado o haz clic para agregarlas.</p>
              <button
                type="button"
                className="cert-custom-add"
                draggable
                onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, DRAG_CUSTOM)}
                onClick={() => setTextDialog({ x: 0.5, y: 0.85 })}
              >
                <Icon name="type" size={16} /> Texto libre
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  className={`cert-custom-add cert-logo-add ${logoField ? 'is-placed' : ''}`}
                  draggable={!logoField}
                  onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, DRAG_LOGO)}
                  onClick={() => addLogo()}
                  title={logoField ? 'Ya está en el certificado: haz clic para elegirlo.' : 'Arrástralo al certificado o haz clic para agregarlo.'}
                >
                  <Icon name={logoField ? 'checkCircle' : 'image'} size={16} /> Logo del colegio
                  {logoField && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="ep-icon is-danger cert-logo-add__remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(LOGO_ID);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), remove(LOGO_ID))}
                      title="Quitar"
                      aria-label="Quitar el logo"
                    >
                      <Icon name="trash" size={14} />
                    </span>
                  )}
                </button>
              ) : (
                <p className="cert-logo-missing text-sm">
                  <Icon name="image" size={15} /> Para usar el logo, súbelo primero en <Link to="/tenant/settings?tab=general">Configuración → General</Link>.
                  {logoField && ' Mientras no haya logo, su espacio sale vacío en el PDF.'}
                </p>
              )}
              <ul className="cert-vars">
                {blocks.map((b) => (
                  <li key={b.id} className={`cert-var is-placed ${selected === b.id ? 'is-selected' : ''}`}>
                    <button type="button" className="cert-var__main" onClick={() => setSelected(b.id)}>
                      <Icon name="type" size={15} />
                      <span>
                        <strong>Texto libre</strong>
                        <span className="cert-var__snippet">{b.content}</span>
                      </span>
                    </button>
                    <button type="button" className="ep-icon is-danger" onClick={() => remove(b.id)} title="Quitar" aria-label={`Quitar texto libre: ${b.content.slice(0, 40)}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
                {VARIABLES.map((v) => {
                  const placed = fields.some((f) => f.key === v.key);
                  return (
                    <li key={v.key} className={`cert-var ${placed ? 'is-placed' : ''} ${selected === v.key ? 'is-selected' : ''}`}>
                      <button
                        type="button"
                        className="cert-var__main"
                        draggable={!placed}
                        onDragStart={(e) => e.dataTransfer.setData(DRAG_KEY, v.key)}
                        onClick={() => (placed ? setSelected(v.key) : add(v.key))}
                      >
                        <Icon name={placed ? 'checkCircle' : 'plus'} size={15} />
                        <span>
                          <strong>{v.label}</strong>
                          <code>{v.token}</code>
                        </span>
                      </button>
                      {placed && (
                        <button type="button" className="ep-icon is-danger" onClick={() => remove(v.key)} title="Quitar" aria-label={`Quitar ${v.label}`}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {current && (
              <section ref={propsRef} className="card cert-panel">
                <h3 className="card__title">{labelOf(current)}</h3>
                {isCustom(current) && (
                  <Field
                    label="Texto"
                    hint={`${current.content.length}/${MAX_TEXT}`}
                    error={!current.content.trim() ? 'Escribe el texto o quita el bloque.' : unknownTokens(current.content).length ? `Variable desconocida: {{${unknownTokens(current.content)[0]}}}` : undefined}
                  >
                    <TextWithTokens value={current.content} onChange={(content) => patch(current.id, { content })} rows={4} />
                  </Field>
                )}
                {isLogo(current) ? (
                  <>
                    <Field label={`Ancho: ${Math.round(current.width * 100)} % de la hoja`}>
                      <input type="range" className="cert-range" min={2} max={100} value={Math.round(current.width * 100)} onChange={(e) => resizeLogo({ width: Number(e.target.value) / 100 })} aria-label="Ancho del logo" />
                    </Field>
                    <Field label={`Alto: ${Math.round(current.height * 100)} % de la hoja`}>
                      <input type="range" className="cert-range" min={2} max={100} value={Math.round(current.height * 100)} onChange={(e) => resizeLogo({ height: Number(e.target.value) / 100 })} aria-label="Alto del logo" />
                    </Field>
                    <label className="cert-bold">
                      <input type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} /> Mantener la proporción del logo
                    </label>
                    <p className="text-sm text-muted">El logo nunca se deforma: cabe entero en la caja, alineado según elijas abajo.</p>
                  </>
                ) : (
                <div className="cert-props">
                  <Field label="Fuente">
                    <Select
                      value={current.font}
                      // Una fuente sin negrita (la caligráfica) la desactiva.
                      onChange={(e) => patch(idOf(current), { font: e.target.value, ...(FONT[e.target.value]?.has_bold ? {} : { bold: false }) })}
                    >
                      {[...new Set(fonts.map((f) => f.group))].map((group) => (
                        <optgroup key={group} label={group}>
                          {fonts
                            .filter((f) => f.group === group)
                            .map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tamaño (pt)">
                    <Input
                      type="number"
                      min={6}
                      max={120}
                      value={current.fontSize}
                      onChange={(e) => patch(idOf(current), { fontSize: e.target.value === '' ? 6 : Math.min(120, Math.max(6, Number(e.target.value))) })}
                    />
                  </Field>
                  <Field label="Color">
                    <ColorPicker
                      label="Color del texto"
                      value={current.color}
                      onChange={(color) => patch(idOf(current), { color })}
                      onSampleFallback={() => startSampling(idOf(current))}
                      // Los que ya usa el certificado, para mantenerlo uniforme, y los habituales.
                      swatches={[...new Set([...fields.filter((f) => f.color).map((f) => f.color.toLowerCase()), ...BASE_COLORS])].slice(0, 12)}
                    />
                  </Field>
                  <Field label="Estilo">
                    <label className="cert-bold">
                      <input type="checkbox" checked={current.bold} onChange={(e) => patch(idOf(current), { bold: e.target.checked })} disabled={FONT[current.font] && !FONT[current.font].has_bold} /> Negrita
                    </label>
                  </Field>
                </div>
                )}
                {isCustom(current) && (
                  <Field label={`Ancho del bloque: ${Math.round(current.width * 100)} % de la hoja`} hint="El texto salta de línea al llegar a este ancho.">
                    <input type="range" className="cert-range" min={5} max={100} value={Math.round(current.width * 100)} onChange={(e) => patch(current.id, { width: Number(e.target.value) / 100 })} aria-label="Ancho del bloque" />
                  </Field>
                )}
                <div className="segmented" role="radiogroup" aria-label="Alineación">
                  {[
                    ['left', 'Izquierda'],
                    ['center', 'Centro'],
                    ['right', 'Derecha'],
                  ].map(([k, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={current.align === k} className={`segmented__item ${current.align === k ? 'segmented__item--active' : ''}`} onClick={() => patch(idOf(current), { align: k })}>
                      {label}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => patch(idOf(current), { x: 0.5, align: 'center' })}>
                  Centrar en la hoja
                </Button>
              </section>
            )}
          </aside>
          )}
        </div>
      )}

      {gallery && (
        <StandardTemplateGallery
          templates={data.standard_templates}
          scopeLabel={data.scope_label}
          hasFields={Boolean(own?.fields?.length)}
          onClose={() => setGallery(false)}
          onApply={applyStandard}
        />
      )}
      {textDialog && <CustomTextDialog initial={textDialog.content || ''} onCancel={() => setTextDialog(null)} onSave={saveText} />}
    </div>
  );
}

export default CertificateEditorPage;
