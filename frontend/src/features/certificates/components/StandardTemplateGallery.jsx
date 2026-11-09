import { useEffect, useState } from 'react';
import certificatesApi from '../../../api/endpoints/certificates.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import CertificateBackground from './CertificateBackground';

/** Una miniatura: el fondo real de la plantilla, con el color del colegio. */
function Thumb({ templateKey }) {
  const [blob, setBlob] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    certificatesApi
      .standardPreview(templateKey)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [templateKey]);
  return <div className="cert-thumb">{failed ? <span className="text-sm text-muted">Sin vista previa</span> : blob && <CertificateBackground blob={blob} type="pdf" />}</div>;
}

/**
 * Galería de plantillas estándar: al elegir una, queda como fondo de este año y
 * nivel. Si el diseño no tenía textos, recibe la distribución sugerida.
 *   templates [{ key, label, description }]  ·  hasFields  si ya hay textos colocados
 */
function StandardTemplateGallery({ templates, scopeLabel, hasFields, onClose, onApply }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
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
        Fondos listos con el color de tu colegio, para <strong>{scopeLabel}</strong>.{' '}
        {hasFields ? 'Tus textos y variables se conservan: solo cambia el fondo.' : 'Llegan con los textos ya colocados; después puedes moverlos y editarlos.'}
      </p>
      <Alert>{error}</Alert>
      <div className="cert-gallery">
        {templates.map((t) => (
          <div key={t.key} className="cert-gallery__card">
            <Thumb templateKey={t.key} />
            <strong>{t.label}</strong>
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
