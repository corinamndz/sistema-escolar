import { useEffect, useMemo, useRef, useState } from 'react';
import certificatesApi from '../../../api/endpoints/certificates.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import CertificateBackground from './CertificateBackground';

/**
 * Carga de miniaturas con pocas descargas a la vez: cada una es un PDF que el
 * navegador rasteriza; con 10+ plantillas, pedirlas todas juntas traba el modal.
 * Las ya descargadas se guardan mientras la galería está abierta (cambiar de
 * filtro no las vuelve a pedir).
 */
const MAX_PARALLEL = 3;
function createLoader() {
  const cache = new Map(); // key → Promise<Blob>
  const queue = [];
  let active = 0;
  const next = () => {
    while (active < MAX_PARALLEL && queue.length) {
      const { key, resolve, reject } = queue.shift();
      active += 1;
      certificatesApi
        .standardPreview(key)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          next();
        });
    }
  };
  return (key) => {
    if (!cache.has(key)) {
      const p = new Promise((resolve, reject) => {
        queue.push({ key, resolve, reject });
        next();
      });
      p.catch(() => cache.delete(key)); // un fallo se puede reintentar al volver a verla
      cache.set(key, p);
    }
    return cache.get(key);
  };
}

/** Una miniatura: el fondo real de la plantilla con el color del colegio. Se pide al entrar en pantalla. */
function Thumb({ templateKey, load }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [blob, setBlob] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    load(templateKey)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [visible, templateKey, load]);

  return (
    <div ref={ref} className={`cert-thumb ${blob ? '' : 'is-loading'}`}>
      {failed ? <span className="text-sm text-muted">Sin vista previa</span> : blob && <CertificateBackground blob={blob} type="pdf" />}
    </div>
  );
}

/**
 * Galería de plantillas estándar: al elegir una, queda como fondo de este año y
 * nivel. Si el diseño no tenía textos, recibe la distribución sugerida.
 *   templates [{ key, label, description, category, category_label }]
 *   hasFields  si ya hay textos colocados
 */
function StandardTemplateGallery({ templates, scopeLabel, hasFields, onClose, onApply }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('');
  const load = useMemo(() => createLoader(), []);

  // Filtros: las categorías presentes, en el orden del catálogo.
  const categories = useMemo(() => {
    const seen = new Map();
    templates.forEach((t) => t.category && !seen.has(t.category) && seen.set(t.category, { label: t.category_label || t.category, count: 0 }));
    templates.forEach((t) => t.category && (seen.get(t.category).count += 1));
    return [...seen];
  }, [templates]);
  const shown = category ? templates.filter((t) => t.category === category) : templates;

  const apply = async (key) => {
    setBusy(key);
    setError(null);
    try {
      await onApply(key);
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(null);
    }
  };
  return (
    <Modal title="Plantillas estándar" onClose={busy ? () => {} : onClose} size="lg">
      <p className="text-sm text-muted">
        {templates.length} diseños listos con el color de tu colegio, para <strong>{scopeLabel}</strong>.{' '}
        {hasFields ? 'Tus textos y variables se conservan: solo cambia el fondo.' : 'Llegan con los textos (y, en algunas, el logo) ya colocados; después puedes moverlos y editarlos.'}
      </p>
      {categories.length > 1 && (
        <div className="level-filter cert-gallery__filters" role="group" aria-label="Estilo">
          {[['', { label: 'Todas', count: templates.length }], ...categories].map(([key, c]) => (
            <button key={key || 'all'} type="button" className={`level-filter__item ${category === key ? 'level-filter__item--active' : ''}`} aria-pressed={category === key} onClick={() => setCategory(key)}>
              {c.label}
              <span className="level-filter__count">{c.count}</span>
            </button>
          ))}
        </div>
      )}
      <Alert>{error}</Alert>
      <div className="cert-gallery">
        {shown.map((t) => (
          <div key={t.key} className="cert-gallery__card">
            <Thumb templateKey={t.key} load={load} />
            <div className="cert-gallery__head">
              <strong>{t.label}</strong>
              {!category && t.category_label && <span className="chip">{t.category_label}</span>}
            </div>
            <span className="text-sm text-muted">{t.description}</span>
            <Button size="sm" onClick={() => apply(t.key)} loading={busy === t.key} disabled={Boolean(busy)}>
              Usar esta plantilla
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default StandardTemplateGallery;
