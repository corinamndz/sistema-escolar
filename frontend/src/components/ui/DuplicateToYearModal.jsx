import { useMemo, useState } from 'react';
import { getErrorMessage } from '../../api/axiosClient';
import Modal from './Modal';
import Button from './Button';
import Select from './Select';
import Field from './Field';
import Alert from './Alert';
import Icon from './Icon';

/** Año sugerido: el siguiente al de origen (por fecha de inicio); si no hay, el primer otro año abierto. */
function suggestedTarget(periods, fromId) {
  const from = periods.find((p) => p.id === fromId);
  const open = periods.filter((p) => p.id !== fromId && !p.closed_at);
  const later = open
    .filter((p) => from?.start_date && p.start_date && String(p.start_date) > String(from.start_date))
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  return (later[0] || open[0])?.id || '';
}

/**
 * Confirmación de "Duplicar para otro año escolar" (contenido programático y
 * planes de evaluación). Elige el año destino (solo años abiertos distintos al
 * de origen; sugiere el siguiente), ejecuta `onConfirm(toPeriodId)` con su
 * indicador de carga y muestra el resultado.
 *
 *   - `items`: lista de lo que se copia (textos cortos).
 *   - `onConfirm(toPeriodId)` → resultado; `renderResult(result)` → resumen.
 *   - `onGo(result, toPeriodId)`: acción "Ir al año destino" en el éxito (opcional).
 */
function DuplicateToYearModal({ title, subject, fromPeriodId, periods = [], items = [], note, onConfirm, renderResult, onGo, goLabel = 'Ver la copia', onClose }) {
  const targets = useMemo(() => periods.filter((p) => p.id !== fromPeriodId && !p.closed_at), [periods, fromPeriodId]);
  const [toPeriodId, setToPeriodId] = useState(() => suggestedTarget(periods, fromPeriodId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const fromName = periods.find((p) => p.id === fromPeriodId)?.name;
  const toName = periods.find((p) => p.id === toPeriodId)?.name;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await onConfirm(toPeriodId));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <Modal onClose={onClose} size="sm" hideHeader>
        <div className="confirm dup-year">
          <div className="confirm__icon dup-year__icon--success">
            <Icon name="checkCircle" size={24} />
          </div>
          <h3 className="confirm__title">Listo: copiado a {toName}</h3>
          <div className="confirm__message">{renderResult(result)}</div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {onGo && (
              <Button type="button" onClick={() => onGo(result, toPeriodId)} autoFocus>
                {goLabel} <Icon name="arrowRight" size={16} />
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={loading ? undefined : onClose} size="sm" hideHeader>
      <div className="confirm dup-year">
        <div className="confirm__icon">
          <Icon name="copy" size={24} />
        </div>
        <h3 className="confirm__title">{title}</h3>
        <p className="confirm__message">
          <strong>{subject}</strong>
          {fromName && <> · desde {fromName}</>}
        </p>

        {targets.length === 0 ? (
          <Alert variant="warning">No hay otro año escolar abierto. Créalo en Años escolares (o con la transición de año) para poder duplicar.</Alert>
        ) : (
          <div className="dup-year__form">
            <Field label="Año escolar de destino">
              <Select value={toPeriodId} onChange={(e) => setToPeriodId(e.target.value)} disabled={loading} autoFocus>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {items.length > 0 && (
              <ul className="dup-year__list">
                {items.map((text) => (
                  <li key={text}>
                    <Icon name="check" size={14} /> {text}
                  </li>
                ))}
              </ul>
            )}
            {note && <p className="dup-year__note">{note}</p>}
          </div>
        )}

        <Alert>{error}</Alert>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" icon="copy" onClick={run} loading={loading} loadingText="Duplicando…" disabled={!toPeriodId || targets.length === 0}>
            Duplicar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default DuplicateToYearModal;
