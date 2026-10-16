import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import { useToast } from '../../../components/ui/Toast';
import { refreshNotifications } from '../../../lib/notificationEvents';

/**
 * «Simular actualización BCV» (pruebas): envía a la campana el aviso de una
 * tasa nueva, igual al real pero marcado "[Prueba]". La tasa NO se registra:
 * los montos en bolívares de las cuotas y los pagos no cambian.
 * `suggested`: tasa propuesta (la vigente + 0,35 %).
 */
function SimulateBcvModal({ suggested, onClose }) {
  const toast = useToast();
  const [rate, setRate] = useState(suggested ? String(suggested).replace('.', ',') : '');
  const [audience, setAudience] = useState('all');
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  // "1.234,56" o "880,1159" (formato venezolano) y también "880.1159".
  const raw = String(rate).trim();
  const value = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  const valid = rate === '' || value > 0;

  const send = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const r = await paymentsApi.simulateBcvRate({ ...(rate !== '' ? { rate: value } : {}), audience });
      const total = r.recipients.staff + r.recipients.guardians;
      toast.success(
        'Aviso de prueba enviado',
        `${r.notification.body} · ${total} usuario${total === 1 ? '' : 's'} (${r.recipients.staff} de administración${audience === 'all' ? `, ${r.recipients.guardians} representantes` : ''}).`
      );
      refreshNotifications(); // la campana se actualiza ya, sin esperar su consulta periódica
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    setError(null);
    try {
      const r = await paymentsApi.clearBcvSimulations();
      toast.success('Avisos de prueba borrados', `${r.deleted} aviso${r.deleted === 1 ? '' : 's'}.`);
      refreshNotifications();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setClearing(false);
    }
  };

  return (
    <Modal title="Simular actualización BCV" onClose={onClose}>
      <Alert variant="info">
        Envía a la campana el aviso de una tasa nueva para probar el flujo. <strong>La tasa no se registra</strong>: los montos en bolívares de
        cuotas y pagos no cambian. El aviso llega marcado como «[Prueba]».
      </Alert>
      <Alert>{error}</Alert>
      <form onSubmit={send}>
        <div className="form-grid">
          <Field label="Tasa simulada (Bs por 1 USD)" hint="Vacío: la tasa vigente + 0,35 %." error={valid ? null : 'Escribe un número mayor que 0.'}>
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="880,1159" suffix="VES" />
          </Field>
          <div className="form-field">
            <label>Enviar a</label>
            <label className="sim-bcv__option">
              <input type="radio" name="sim-audience" checked={audience === 'all'} onChange={() => setAudience('all')} /> Administración y representantes
            </label>
            <label className="sim-bcv__option">
              <input type="radio" name="sim-audience" checked={audience === 'staff'} onChange={() => setAudience('staff')} /> Solo administración
            </label>
            {audience === 'all' && <span className="form-hint">Las familias con acceso al portal también lo verán (marcado como prueba).</span>}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="link-button sim-bcv__clear" onClick={clear} disabled={clearing}>
            {clearing ? 'Borrando…' : 'Borrar avisos de prueba'}
          </button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="bell" loading={sending} loadingText="Enviando…" disabled={!valid}>
            Simular actualización
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default SimulateBcvModal;
