import { useState } from 'react';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { blobErrorMessage, saveBlob } from '../../../utils/download';

/**
 * «Descargar planilla en PDF»: el PDF lo genera el servidor (membrete del
 * colegio con logo, nombre, RIF y dirección; firmas al pie de la última
 * página). Se abre en otra pestaña —desde ahí se imprime o se guarda—; si el
 * navegador bloquea la pestaña, se descarga.
 *
 *   load  () => Promise<Blob>   (administración o portal, según quién lo pide)
 */
function FormPdfButton({ load, fileName = 'planilla-inscripcion.pdf', label = 'Descargar planilla en PDF', size = 'sm', variant = 'secondary' }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const open = async () => {
    // La pestaña se abre antes de pedir el archivo para que el navegador no la bloquee.
    const tab = window.open('', '_blank');
    setBusy(true);
    try {
      const blob = await load();
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (tab) tab.location.href = url;
      else saveBlob(blob, fileName);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      if (tab) tab.close();
      toast.error('No se pudo generar el PDF', await blobErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size={size} variant={variant} icon="download" onClick={open} loading={busy}>
      {label}
    </Button>
  );
}

export default FormPdfButton;
