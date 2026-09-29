import { useState } from 'react';
import Button from '../ui/Button';
import ImportModal from './ImportModal';

/**
 * Botón "Importar desde Excel" + su modal. Pensado para el encabezado de
 * las tablas (DataTable `headerActions`) o el PageHeader:
 *
 *   <ImportButton type="students" title="Importar alumnos" onImported={refetch} />
 */
function ImportButton({ label = 'Importar Excel', size, variant = 'secondary', ...modalProps }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} icon="spreadsheet" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <ImportModal {...modalProps} onClose={() => setOpen(false)} />}
    </>
  );
}

export default ImportButton;
