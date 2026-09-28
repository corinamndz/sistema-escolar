import { useEffect, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { formatDate } from '../paymentStatus';

/**
 * Visor del comprobante adjunto a un pago. El archivo es PRIVADO: no hay URL
 * pública, se descarga con la sesión (axios, blob) y se muestra desde memoria.
 * Imagen → <img>; PDF → visor del navegador (iframe).
 */
export function ProofViewerModal({ payment, onClose }) {
  const [state, setState] = useState({ loading: true, url: null, error: null });

  useEffect(() => {
    let url = null;
    let cancelled = false;
    paymentsApi
      .getProofBlob(payment.id)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (!cancelled) setState({ loading: false, url, error: null });
      })
      .catch(async (err) => {
        // Con responseType blob el error JSON del backend llega como Blob: se lee para mostrar el mensaje.
        let message = getErrorMessage(err);
        try {
          const text = await err?.response?.data?.text?.();
          if (text) message = JSON.parse(text).error?.message || message;
        } catch {
          // se queda con el mensaje genérico
        }
        if (!cancelled) setState({ loading: false, url: null, error: message });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [payment.id]);

  const isPdf = payment.proof_mime === 'application/pdf';

  return (
    <Modal title="Comprobante del pago" onClose={onClose} size="lg">
      <div className="detail__intro">
        <Icon name="paperclip" size={16} />
        <strong>{payment.proof_original_name || 'Comprobante'}</strong>
        <span className="text-muted">
          {payment.period_label}
          {payment.proof_uploaded_at && ` · subido el ${formatDate(payment.proof_uploaded_at)}`}
        </span>
      </div>
      <Alert>{state.error}</Alert>
      {state.loading ? (
        <Spinner label="Cargando comprobante…" />
      ) : (
        state.url &&
        (isPdf ? (
          <iframe src={state.url} title="Comprobante en PDF" className="proof-viewer proof-viewer--pdf" />
        ) : (
          <div className="proof-viewer">
            <img src={state.url} alt={`Comprobante de ${payment.period_label}`} />
          </div>
        ))
      )}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        {state.url && (
          <a href={state.url} download={payment.proof_original_name || 'comprobante'} className="btn btn--primary">
            <Icon name="upload" size={16} style={{ transform: 'rotate(180deg)' }} /> Descargar
          </a>
        )}
      </div>
    </Modal>
  );
}

/** Botón "Ver comprobante" que abre el visor (solo si el pago tiene un archivo adjunto). */
export function ProofButton({ payment, size = 'sm', variant = 'secondary', label = 'Ver comprobante adjunto' }) {
  const [open, setOpen] = useState(false);
  if (!payment.proof_path) return null;
  return (
    <>
      <Button type="button" size={size} variant={variant} icon="paperclip" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <ProofViewerModal payment={payment} onClose={() => setOpen(false)} />}
    </>
  );
}
