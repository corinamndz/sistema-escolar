import { useState } from 'react';
import Button from './Button';
import { exportToExcel } from '../../utils/exportExcel';

/**
 * Botón "Exportar Excel" reutilizable. Toma las filas ya filtradas y las
 * convierte a .xlsx en el navegador (sin llamada al servidor).
 *
 * @param {string} filename  Nombre del archivo sin extensión.
 * @param {Array}  columns   [{header, value(row), width?}]
 * @param {Array}  rows      Filas visibles en pantalla (post-filtro).
 */
function ExportButton({ filename, columns, rows, size, variant = 'secondary' }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!rows?.length) return;
    setLoading(true);
    try {
      await exportToExcel(filename, columns, rows);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      icon="download"
      onClick={handleClick}
      loading={loading}
      disabled={!rows?.length}
      title={rows?.length ? `Exportar ${rows.length} registro(s) a Excel` : 'Sin datos para exportar'}
    >
      Exportar Excel
    </Button>
  );
}

export default ExportButton;
