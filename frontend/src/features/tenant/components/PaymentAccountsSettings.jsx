import { useState } from 'react';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Card from '../../../components/ui/Card';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ACCOUNT_METHODS, BANKS, bankByCode } from '../../payments/banks';
import { PaymentAccountCard } from '../../payments/components/PaymentInstructions';

const SECTIONS = [
  { method: 'mobile_payment', title: 'Pago móvil', subtitle: 'Cédula o RIF, teléfono afiliado y banco.', add: 'Agregar pago móvil' },
  { method: 'transfer', title: 'Transferencias bancarias', subtitle: 'Número de cuenta, tipo (corriente o ahorros) y banco. También se muestran para depósitos.', add: 'Agregar cuenta' },
];

/**
 * Configuración → Datos de pago: dónde recibe pagos el colegio. Los
 * representantes los ven al reportar un pago, según el método que elijan.
 * Se puede tener más de una cuenta por método y ocultar una sin borrarla.
 */
function PaymentAccountsSettings({ canEdit }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: accounts, loading, error, refetch } = useFetch(() => tenantApi.listPaymentAccounts(), []);
  const [editing, setEditing] = useState(null); // { method } (nueva) o la cuenta a editar

  const toggleActive = async (a) => {
    try {
      await tenantApi.updatePaymentAccount(a.id, { isActive: !a.is_active });
      toast.success(a.is_active ? 'Oculta para los representantes' : 'Visible para los representantes', a.bank_name);
      refetch();
    } catch (err) {
      toast.error('No se pudo actualizar', getErrorMessage(err));
    }
  };
  const remove = async (a) => {
    const okToDelete = await confirm({
      title: `¿Eliminar este dato de pago (${a.bank_name})?`,
      message: 'Los representantes dejarán de verlo al reportar pagos. Si solo quieres dejar de mostrarlo por un tiempo, ocúltalo.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!okToDelete) return;
    try {
      await tenantApi.deletePaymentAccount(a.id);
      toast.success('Dato de pago eliminado', a.bank_name);
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  if (loading && !accounts) return <Spinner />;

  return (
    <div className="pay-accounts">
      <Alert>{error}</Alert>
      {SECTIONS.map((section) => {
        const list = (accounts || []).filter((a) => a.method === section.method);
        return (
          <Card
            key={section.method}
            title={section.title}
            subtitle={section.subtitle}
            actions={
              canEdit && (
                <Button size="sm" icon="plus" onClick={() => setEditing({ method: section.method })}>
                  {section.add}
                </Button>
              )
            }
          >
            {list.length === 0 ? (
              <div className="pay-accounts__empty">
                <Icon name={ACCOUNT_METHODS[section.method].icon} size={20} />
                <span>Aún no registraste datos de {section.title.toLowerCase()}. Los representantes verán un aviso para consultarlos con la administración.</span>
              </div>
            ) : (
              <div className="pay-info__list pay-info__list--grid">
                {list.map((a) => (
                  <PaymentAccountCard
                    key={a.id}
                    account={a}
                    actions={
                      canEdit && (
                        <>
                          <button type="button" className="row-action row-action--edit" onClick={() => setEditing(a)} title="Editar" aria-label="Editar">
                            <Icon name="pencil" size={15} />
                          </button>
                          <button
                            type="button"
                            className="row-action row-action--view"
                            onClick={() => toggleActive(a)}
                            title={a.is_active ? 'Ocultar a los representantes' : 'Mostrar a los representantes'}
                            aria-label={a.is_active ? 'Ocultar' : 'Mostrar'}
                          >
                            <Icon name={a.is_active ? 'eye' : 'lock'} size={15} />
                          </button>
                          <button type="button" className="row-action row-action--delete" onClick={() => remove(a)} title="Eliminar" aria-label="Eliminar">
                            <Icon name="trash" size={15} />
                          </button>
                        </>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <p className="form-hint">
        <Icon name="info" size={13} /> Así es como los verán los representantes al reportar un pago: al elegir «Pago móvil», los de pago móvil; al
        elegir «Transferencia» o «Depósito», las cuentas bancarias. Cada dato tiene un botón para copiarlo.
      </p>

      {editing && <AccountFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

const OTHER_BANK = '__other';

/** Alta / edición de un dato de pago (pago móvil o cuenta bancaria). */
function AccountFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const toast = useToast();
  const knownBank = initial.bank_code && bankByCode(initial.bank_code);
  const [form, setForm] = useState({
    method: initial.method,
    bank: knownBank ? initial.bank_code : initial.bank_name ? OTHER_BANK : '',
    otherBankName: knownBank ? '' : initial.bank_name || '',
    otherBankCode: knownBank ? '' : initial.bank_code || '',
    holderId: initial.holder_id || '',
    holderName: initial.holder_name || '',
    phone: initial.phone || '',
    accountNumber: initial.account_number || '',
    accountType: initial.account_type || 'checking',
    notes: initial.notes || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) =>
    isEdit ? tenantApi.updatePaymentAccount(initial.id, data) : tenantApi.createPaymentAccount(data),
  );
  const isMobile = form.method === 'mobile_payment';
  const bank = form.bank === OTHER_BANK ? null : bankByCode(form.bank);
  const digits = form.accountNumber.replace(/\D/g, '');

  const submit = async (e) => {
    e.preventDefault();
    const data = {
      method: form.method,
      bankCode: bank ? bank.code : form.otherBankCode.trim() || null,
      bankName: bank ? bank.name : form.otherBankName.trim(),
      holderId: form.holderId,
      holderName: form.holderName,
      notes: form.notes,
      ...(isMobile ? { phone: form.phone } : { accountNumber: form.accountNumber, accountType: form.accountType }),
    };
    try {
      await run(data);
      toast.success(isEdit ? 'Dato de pago actualizado' : 'Dato de pago agregado', data.bankName);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Drawer title={`${isEdit ? 'Editar' : 'Nuevo'} · ${ACCOUNT_METHODS[form.method].label}`} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Banco" error={fieldErrors.bankName || fieldErrors.bankCode} full required>
            <select className="input" value={form.bank} onChange={set('bank')} required>
              <option value="">Selecciona…</option>
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} · {b.name}
                </option>
              ))}
              <option value={OTHER_BANK}>Otro banco (escribirlo)…</option>
            </select>
          </Field>
          {form.bank === OTHER_BANK && (
            <>
              <Field label="Nombre del banco" required>
                <Input value={form.otherBankName} onChange={set('otherBankName')} maxLength={80} required />
              </Field>
              <Field label="Código (opcional)" hint="4 dígitos, ej. 0102">
                <Input value={form.otherBankCode} onChange={set('otherBankCode')} maxLength={4} inputMode="numeric" />
              </Field>
            </>
          )}

          <Field label="Cédula o RIF" error={fieldErrors.holderId} required hint="Ej.: J-12345678-9 o V-12345678">
            <Input icon="user" value={form.holderId} onChange={set('holderId')} maxLength={20} required placeholder="J-12345678-9" />
          </Field>

          {isMobile ? (
            <Field label="Teléfono afiliado" error={fieldErrors.phone} required hint="Ej.: 0414-1234567">
              <Input icon="phone" value={form.phone} onChange={set('phone')} maxLength={20} inputMode="tel" required placeholder="0414-1234567" />
            </Field>
          ) : (
            <Field label="Tipo de cuenta" error={fieldErrors.accountType} required>
              <div className="segmented" role="radiogroup" aria-label="Tipo de cuenta">
                {[
                  ['checking', 'Corriente'],
                  ['savings', 'Ahorros'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={form.accountType === value}
                    className={`segmented__item ${form.accountType === value ? 'segmented__item--active' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, accountType: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {!isMobile && (
            <Field
              label="Número de cuenta"
              error={fieldErrors.accountNumber}
              full
              required
              hint={
                digits.length
                  ? `${digits.length} dígito${digits.length === 1 ? '' : 's'}${digits.length !== 20 ? ' (en Venezuela son 20)' : ' ✓'}${
                      bank && digits.length >= 4 && digits.slice(0, 4) !== bank.code ? ` · ojo: empieza por ${digits.slice(0, 4)} y el banco es ${bank.code}` : ''
                    }`
                  : '20 dígitos; los 4 primeros son el código del banco.'
              }
            >
              <Input value={form.accountNumber} onChange={set('accountNumber')} maxLength={40} inputMode="numeric" required placeholder="0102 0123 4567 8901 2345" />
            </Field>
          )}

          <Field label="Titular (opcional)" error={fieldErrors.holderName} full hint="Razón social o nombre que aparece al confirmar el pago.">
            <Input value={form.holderName} onChange={set('holderName')} maxLength={120} />
          </Field>
          <Field label="Indicación para el representante (opcional)" error={fieldErrors.notes} full>
            <Input value={form.notes} onChange={set('notes')} maxLength={200} placeholder="Ej.: Coloca la cédula del alumno en el concepto." />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default PaymentAccountsSettings;
