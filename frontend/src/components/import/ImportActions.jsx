import { useState } from 'react';
import importsApi from '../../api/endpoints/imports.api';
import { getErrorMessage } from '../../api/axiosClient';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import ImportModal from './ImportModal';

/**
 * "Descargar plantilla" + "Importar masivo" para el encabezado de una tabla
 * (DataTable `headerActions`) o de una tarjeta. Al terminar una importación
 * muestra un toast con el resumen y llama a `onImported` para recargar.
 *
 *   <ImportActions type="grades" noun="grados" onImported={reload} />
 */
function ImportActions({ type, noun, title, description, params, onImported, size }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const download = async () => {
    setDownloading(true);
    try {
      await importsApi.downloadTemplate(type, params);
    } catch (err) {
      toast.error('No se pudo descargar la plantilla', getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const handleImported = (report) => {
    const { imported, invalid } = report.summary;
    if (invalid > 0) toast.warning('Importación con observaciones', report.message);
    else toast.success(`${imported} ${noun} importado${imported === 1 ? '' : 's'}`, report.message);
    onImported?.(report);
  };

  return (
    <>
      <Button variant="ghost" size={size} icon="download" onClick={download} loading={downloading} loadingText="Generando…">
        Plantilla
      </Button>
      <Button variant="secondary" size={size} icon="spreadsheet" onClick={() => setOpen(true)}>
        Importar masivo
      </Button>
      {open && (
        <ImportModal
          type={type}
          params={params}
          title={title || `Importar ${noun} desde Excel`}
          description={description}
          onClose={() => setOpen(false)}
          onImported={handleImported}
        />
      )}
    </>
  );
}

export default ImportActions;
