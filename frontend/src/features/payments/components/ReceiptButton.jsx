import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useToast } from '../../../components/ui/Toast';
import Icon from '../../../components/ui/Icon';

/** Lee el mensaje de error del backend cuando la respuesta pedida era un Blob. */
async function blobErrorMessage(err) {
  try {
    const text = await err?.response?.data?.text?.();
    if (text) return JSON.parse(text).error?.message || getErrorMessage(err);
  } catch {
    // mensaje genérico
  }
  return getErrorMessage(err);
}

/**
 * Abre el recibo PDF de un pago en otra pestaña. El recibo es privado: se
 * descarga con la sesión del usuario (no hay enlace público). La pestaña se
 * abre antes de pedir el archivo para que el navegador no la bloquee.
 */
export async function openReceipt(paymentId) {
  const tab = window.open('', '_blank');
  try {
    const blob = await paymentsApi.getReceiptBlob(paymentId);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      // Ventanas emergentes bloqueadas: se descarga.
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo-${String(paymentId).slice(0, 8)}.pdf`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (tab) tab.close();
    throw new Error(await blobErrorMessage(err));
  }
}

/** Botón o enlace "Descargar recibo" (privado). */
function ReceiptButton({ paymentId, label = 'Descargar PDF', className = 'link-icon', style }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      await openReceipt(paymentId);
    } catch (err) {
      toast.error('No se pudo abrir el recibo', err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} onClick={click} disabled={busy} style={style}>
      <Icon name="receipt" size={15} /> {busy ? 'Abriendo…' : label}
    </button>
  );
}

export default ReceiptButton;
