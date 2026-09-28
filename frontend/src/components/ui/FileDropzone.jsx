import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const formatBytes = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Zona para arrastrar y soltar (o elegir) UN archivo, con vista previa:
 * miniatura si es imagen, ícono + nombre si es PDF.
 *
 *   <FileDropzone value={file} onChange={setFile}
 *     accept={{ 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] }}
 *     maxBytes={5 * 1024 * 1024} />
 *
 * Valida tipo y peso en el navegador para avisar al instante; el backend
 * vuelve a validar (incluida la firma binaria real del archivo).
 */
function FileDropzone({ value, onChange, accept, maxBytes, label = 'Arrastra el archivo aquí', hint, error, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [preview, setPreview] = useState(null);

  const mimes = Object.keys(accept);
  const extensions = Object.values(accept).flat();

  // Miniatura temporal para imágenes; se libera al cambiar de archivo o desmontar.
  useEffect(() => {
    if (!value || !value.type.startsWith('image/')) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const pick = (file) => {
    if (!file) return;
    const ext = `.${file.name.split('.').pop().toLowerCase()}`;
    // Algunos sistemas no informan el mimetype: se acepta si la extensión es válida.
    if (!mimes.includes(file.type) && !(file.type === '' && extensions.includes(ext))) {
      setLocalError(`Formato no permitido. Usa ${extensions.map((e) => e.slice(1).toUpperCase()).join(', ')}.`);
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      setLocalError(`El archivo pesa ${formatBytes(file.size)}; el máximo es ${formatBytes(maxBytes)}.`);
      return;
    }
    setLocalError(null);
    onChange(file);
  };

  const shownError = localError || error;
  const open = () => !disabled && inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={[...mimes, ...extensions].join(',')}
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ''; // permite volver a elegir el mismo archivo
        }}
      />

      {value ? (
        <div className="dropzone-file">
          {preview ? (
            <img src={preview} alt="Vista previa del comprobante" className="dropzone-file__thumb" />
          ) : (
            <span className="dropzone-file__icon">
              <Icon name="file" size={24} />
            </span>
          )}
          <div className="dropzone-file__meta">
            <div className="dropzone-file__name" title={value.name}>
              {value.name}
            </div>
            <div className="cell-person__sub">
              {value.type === 'application/pdf' ? 'PDF' : 'Imagen'} · {formatBytes(value.size)}
            </div>
          </div>
          <div className="row-actions">
            <button type="button" className="row-action row-action--edit" onClick={open} disabled={disabled} title="Cambiar archivo" aria-label="Cambiar archivo">
              <Icon name="upload" size={15} />
            </button>
            <button type="button" className="row-action row-action--delete" onClick={() => onChange(null)} disabled={disabled} title="Quitar archivo" aria-label="Quitar archivo">
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          className={`dropzone ${dragging ? 'dropzone--dragging' : ''} ${shownError ? 'dropzone--error' : ''}`}
          onClick={open}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) pick(e.dataTransfer.files?.[0]);
          }}
        >
          <span className="dropzone__icon">
            <Icon name="upload" size={22} />
          </span>
          <span className="dropzone__label">
            {label} o <u>elígelo desde tu equipo</u>
          </span>
          {hint && <span className="cell-person__sub">{hint}</span>}
        </div>
      )}

      {shownError && (
        <span className="field-error" role="alert" style={{ marginTop: 6 }}>
          <Icon name="alertCircle" size={14} />
          {shownError}
        </span>
      )}
    </div>
  );
}

export default FileDropzone;
