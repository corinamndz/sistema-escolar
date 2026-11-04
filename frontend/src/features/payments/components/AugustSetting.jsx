import { useEffect, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';

/**
 * Panel «Tarifas de mensualidad» → Mes de agosto.
 * Las mensualidades regulares van de septiembre a julio; agosto se cobra como
 * una mensualidad propia junto con el mes regular que elija la administración
 * (misma emisión y vencimiento). Sin elegir, agosto no se genera.
 */
function AugustSetting({ schoolPeriodId, canEdit = true }) {
  const { data: status, setData, loading, error } = useFetch(() => paymentsApi.augustStatus(schoolPeriodId), [schoolPeriodId]);
  const [month, setMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (status) setMonth(status.charge_month || '');
  }, [status]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!status) return null;
  if (!status.options.length) {
    return (
      <section className="august-setting">
        <h3 className="fee-plans__title">Mes de agosto</h3>
        <Alert variant="warning">Este año escolar no tiene fechas de inicio y fin: sin ellas no se pueden elegir los meses.</Alert>
      </section>
    );
  }

  const dirty = month && month !== (status.charge_month || '');
  const save = async () => {
    setSaving(true);
    try {
      const r = await paymentsApi.setAugust(schoolPeriodId, month);
      setData(r);
      toast.success(
        `${status.august_label} se cobra con ${r.charge_label}`,
        r.created
          ? `Se generaron ${r.created} mensualidades de agosto.`
          : r.rescheduled
            ? `Se reprogramaron ${r.rescheduled} mensualidades de agosto pendientes.`
            : 'Se aplicará al generar las mensualidades.'
      );
    } catch (err) {
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="august-setting">
      <div className="fee-plans__head">
        <div>
          <h3 className="fee-plans__title">Mes de agosto</h3>
          <p className="fee-plans__intro">
            Las mensualidades regulares van de <strong>septiembre a julio</strong>. {status.august_label} también se cobra, como una mensualidad aparte que se emite y vence junto con el
            mes que elijas. Así la verán las familias en su portal.
          </p>
        </div>
      </div>

      {!status.configured && (
        <Alert variant="warning">
          Falta indicar con qué mes se cobra {status.august_label}: hasta entonces no se genera.
        </Alert>
      )}

      <div className="august-setting__row">
        <span className="august-setting__label">
          <Icon name="calendar" size={16} /> {status.august_label} se cobra con
        </span>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} disabled={!canEdit || saving} aria-label={`Mes con que se cobra ${status.august_label}`}>
          {!status.configured && <option value="">Elige el mes…</option>}
          {status.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {canEdit && (
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            {status.configured ? 'Cambiar' : 'Guardar'}
          </Button>
        )}
      </div>
      <p className="form-hint">
        {status.configured
          ? `${status.generated} mensualidad${status.generated === 1 ? '' : 'es'} de agosto generada${status.generated === 1 ? '' : 's'}. Si cambias el mes, se reprograman las que siguen pendientes y sin reportar.`
          : 'Al guardar se genera la mensualidad de agosto de cada alumno inscrito, con su tarifa o beca.'}
      </p>
    </section>
  );
}

export default AugustSetting;
