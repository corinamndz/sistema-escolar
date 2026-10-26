import { useState } from 'react';
import importsApi from '../../api/endpoints/imports.api';
import { getErrorMessage } from '../../api/axiosClient';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import ImportButton from './ImportButton';

/**
 * Botonera de carga masiva, igual en todos los módulos:
 *   [⤓ Descargar plantilla]  [▦ Carga masiva]
 * El primero baja el Excel del importador `type` (con `params`, ej. precargado
 * con los temas del plan); el segundo abre el panel de importación (plantilla,
 * archivo, revisión y resultado).
 *
 *   <BulkImportActions type="programmatic_content" params={{ gradeId, subjectId }}
 *     downloadLabel="Descargar plantilla" uploadLabel="Carga masiva"
 *     title="Carga masiva de contenido programático" description="…" onImported={reload} />
 */
function BulkImportActions({
  type,
  params,
  downloadLabel = 'Descargar plantilla',
  downloadTitle,
  uploadLabel = 'Carga masiva',
  title,
  description,
  skippedLabel,
  onImported,
  size,
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await importsApi.downloadTemplate(type, params);
    } catch (err) {
      toast.error('No se pudo generar la plantilla', getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button size={size} variant="secondary" icon="download" loading={downloading} loadingText="Generando…" onClick={download} title={downloadTitle}>
        {downloadLabel}
      </Button>
      <ImportButton
        size={size}
        label={uploadLabel}
        type={type}
        params={params}
        title={title}
        description={description}
        skippedLabel={skippedLabel}
        onImported={onImported}
      />
    </>
  );
}

export default BulkImportActions;
