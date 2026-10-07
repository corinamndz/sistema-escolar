import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Button from './Button';

const DEFAULT_ACCEPT = ['image/png', 'image/jpeg'];
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Selector de imagen con arrastrar y soltar y vista previa local.
 *
 * - `currentUrl`: imagen ya guardada (se muestra si no hay archivo nuevo).
 * - `file`: archivo elegido (controlado por el padre), `onChange(file | null)`.
 * - `removed` / `onRemove`: para quitar la imagen guardada sin subir otra.
 * - `placeholderUrl` / `placeholderLabel`: imagen que se usará si no hay
 *   ninguna (p. ej. el logo de MoDo Educa por defecto).
 *
 * Valida tipo y peso en el navegador para dar feedback inmediato; el backend
 * vuelve a validar (incluida la firma binaria del archivo).
 */
function ImageUpload({
  currentUrl,
  file,
  onChange,
  removed = false,
  onRemove,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  error,
  disabled,
  placeholderUrl,
  placeholderLabel,
}) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [dragging, setDragging] = useState(false);

  // URL temporal para la vista previa; se libera al cambiar de archivo o desmontar.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (candidate) => {
    if (!candidate) return;
    if (!accept.includes(candidate.type)) {
      setLocalError('Formato no permitido. Usa una imagen PNG o JPG.');
      return;
    }
    if (candidate.size > maxBytes) {
      setLocalError(`La imagen pesa ${formatBytes(candidate.size)}; el máximo es ${formatBytes(maxBytes)}.`);
      return;
    }
    setLocalError(null);
    onChange(candidate);
  };

  const handleInput = (e) => {
    pick(e.target.files?.[0]);
    e.target.value = ''; // permite volver a elegir el mismo archivo
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) pick(e.dataTransfer.files?.[0]);
  };

  const shownUrl = preview || (!removed ? currentUrl : null);
  const shownError = localError || error;

  return (
    <div>
      <div
        className={[
          'image-upload',
          dragging ? 'image-upload--dragging' : '',
          shownError ? 'image-upload--error' : '',
          disabled ? 'image-upload--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div className="image-upload__preview">
          {shownUrl ? (
            <img src={shownUrl} alt="Vista previa del logo" />
          ) : placeholderUrl ? (
            <img src={placeholderUrl} alt={placeholderLabel || ''} />
          ) : (
            <Icon name="school" size={28} />
          )}
        </div>

        <div className="image-upload__body">
          {file ? (
            <>
              <div className="image-upload__title">{file.name}</div>
              <div className="image-upload__meta">
                {formatBytes(file.size)} · <span className="text-success">Nueva imagen, se guardará al enviar</span>
              </div>
            </>
          ) : (
            <>
              <div className="image-upload__title">{shownUrl ? 'Logo actual' : placeholderLabel || 'Sin logo'}</div>
              <div className="image-upload__meta">
                Arrastra una imagen aquí o elígela desde tu equipo. PNG o JPG, máx. {formatBytes(maxBytes)}.
              </div>
            </>
          )}

          <div className="image-upload__actions">
            <input
              ref={inputRef}
              type="file"
              accept={accept.join(',')}
              onChange={handleInput}
              disabled={disabled}
              className="sr-only"
              tabIndex={-1}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
            >
              {shownUrl ? 'Cambiar imagen' : 'Elegir imagen'}
            </Button>
            {file && (
              <Button type="button" size="sm" variant="ghost" icon="x" onClick={() => onChange(null)} disabled={disabled}>
                Descartar
              </Button>
            )}
            {!file && currentUrl && !removed && onRemove && (
              <Button type="button" size="sm" variant="danger" icon="trash" onClick={onRemove} disabled={disabled}>
                Quitar logo
              </Button>
            )}
          </div>
        </div>
      </div>

      {shownError && (
        <span className="field-error" role="alert" style={{ marginTop: 6 }}>
          <Icon name="alertCircle" size={14} />
          {shownError}
        </span>
      )}
    </div>
  );
}

export default ImageUpload;
