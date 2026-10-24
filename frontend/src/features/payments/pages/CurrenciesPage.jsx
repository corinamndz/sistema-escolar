import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import Switch from '../../../components/ui/Switch';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { formatDate } from '../paymentStatus';
import { formatRate } from '../currency';
import DeleteCurrencyModal from '../components/DeleteCurrencyModal';
import RateHistoryDrawer from '../components/RateHistoryDrawer';

const SOURCE_LABELS = { bcv: 'BCV', bcv_api: 'BCV (respaldo)', manual: 'Manual' };

/** "CLP$ 110.000" / "COL$ 110.000,00" con los valores del formulario (vista previa). */
function preview({ symbol, decimals, locale }) {
  const n = (110000).toLocaleString(locale || 'es', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${symbol || '?'} ${n}`;
}

/**
 * Administración de monedas del colegio: agregar desde el catálogo, editar
 * nombre/símbolo/decimales, activar/desactivar, elegir la predeterminada y
 * registrar la tasa del día de cada una. Solo las ACTIVAS aparecen en los
 * selectores de moneda de pagos y del portal de padres.
 */
function CurrenciesPage() {
  const { can } = useAuth();
  const canEdit = can('payments', 'update');
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, refetch } = useFetch(() => paymentsApi.currencyAdmin(), []);
  const [editing, setEditing] = useState(null); // null | {} (agregar) | moneda
  const [deleting, setDeleting] = useState(null); // moneda a eliminar (modal de advertencia)
  const [history, setHistory] = useState(null); // moneda cuyo historial de tasas está abierto

  const update = async (c, body, successTitle) => {
    try {
      await paymentsApi.updateCurrency(c.code, body);
      toast.success(successTitle, `${c.name} (${c.code})`);
      refetch();
    } catch (err) {
      toast.error('No se pudo actualizar', getErrorMessage(err));
    }
  };

  const toggleActive = async (c) => {
    if (c.is_active) {
      const ok = await confirm({
        title: `¿Desactivar ${c.name} (${c.code})?`,
        message: 'Dejará de ofrecerse en los selectores de pago. Sus tasas y los pagos ya registrados en esta moneda se conservan.',
        confirmLabel: 'Desactivar',
      });
      if (!ok) return;
    }
    update(c, { isActive: !c.is_active }, c.is_active ? 'Moneda desactivada' : 'Moneda activada');
  };

  const columns = [
    {
      key: 'code',
      header: 'Moneda',
      render: (c) => (
        <div className="cell-person">
          <span className="chip">{c.code}</span>
          <div>
            <div className="cell-person__name">
              {c.name}
              {c.name !== c.catalog_name && <span className="text-muted text-sm"> · personalizado</span>}
            </div>
            <div className="cell-person__sub">{c.country}</div>
          </div>
        </div>
      ),
      sortValue: (c) => c.sort_order,
    },
    {
      key: 'format',
      header: 'Formato',
      render: (c) => (
        <div>
          <strong>{c.symbol}</strong>
          <div className="cell-person__sub">
            {c.decimals === 0 ? 'Sin decimales' : `${c.decimals} decimales`} · {preview(c)}
          </div>
        </div>
      ),
    },
    {
      key: 'rate',
      header: 'Tasa del día (por $1)',
      render: (c) => <RateCell currency={c} today={data?.today} canEdit={canEdit} onSaved={refetch} />,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => (
        <div className="chip-list">
          <Badge variant={c.is_active ? 'success' : 'neutral'}>{c.is_active ? 'Activa' : 'Inactiva'}</Badge>
          {c.is_default && <Badge variant="primary">Predeterminada</Badge>}
        </div>
      ),
      sortValue: (c) => (c.is_default ? 0 : c.is_active ? 1 : 2),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Monedas y tasas del día"
        subtitle="Las tarifas se fijan en dólares; cada familia paga en una de las monedas activas con la tasa de ese día."
        actions={
          <Link to="/payments" className="btn btn--secondary">
            <Icon name="arrowLeft" size={17} /> Volver a Pagos
          </Link>
        }
      />

      <Alert variant="info">
        El <strong>dólar (USD)</strong> es la moneda base: siempre está disponible y no lleva tasa. Solo las monedas{' '}
        <strong>activas</strong> aparecen en los selectores de pago; la <strong>predeterminada</strong> es la que se muestra si nadie elige otra.
      </Alert>

      <DataTable
        title="Monedas del colegio"
        columns={columns}
        rows={data?.currencies}
        loading={loading}
        error={error}
        searchable={false}
        paginated={false}
        emptyMessage="No hay monedas configuradas."
        createLabel="Agregar moneda"
        onCreate={() => setEditing({})}
        canCreate={canEdit && (data?.available?.length ?? 0) > 0}
        onEdit={setEditing}
        canEdit={canEdit}
        rowActions={[
          // Consulta: visible también para quien solo puede ver Pagos.
          { key: 'history', icon: 'clock', label: 'Ver historial de tasas', tone: 'view', onClick: setHistory },
          ...(canEdit
            ? [
                {
                  key: 'default',
                  icon: 'star',
                  label: 'Marcar como predeterminada',
                  tone: 'accent',
                  show: (c) => c.is_active && !c.is_default,
                  onClick: (c) => update(c, { isDefault: true }, 'Moneda predeterminada'),
                },
                {
                  key: 'toggle',
                  icon: 'checkCircle',
                  label: 'Activar',
                  show: (c) => !c.is_active,
                  onClick: toggleActive,
                },
                {
                  key: 'deactivate',
                  icon: 'x',
                  label: 'Desactivar',
                  show: (c) => c.is_active && !c.is_default,
                  onClick: toggleActive,
                },
              ]
            : []),
        ]}
        // Eliminar: modal propio que muestra todo lo que se borrará con la moneda.
        onDeleteClick={setDeleting}
        canDelete={(c) => canEdit && !c.is_default}
      />

      {history && <RateHistoryDrawer currency={history} onClose={() => setHistory(null)} />}

      {deleting && (
        <DeleteCurrencyModal
          currency={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={refetch}
          onDeactivate={() => {
            const c = deleting;
            setDeleting(null);
            update(c, { isActive: false }, 'Moneda desactivada');
          }}
        />
      )}

      {editing !== null && (
        <CurrencyFormDrawer
          initial={editing}
          available={data?.available || []}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

/** Tasa vigente de la moneda + registro rápido de la del día (y consulta al BCV para el bolívar). */
function RateCell({ currency: c, today, canEdit, onSaved }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const rate = Number(String(value).replace(',', '.'));

  const save = async (e) => {
    e.preventDefault();
    if (!(rate > 0)) return;
    setSaving(true);
    try {
      await paymentsApi.upsertRate({ currency: c.code, rateDate: today, rate });
      toast.success('Tasa del día registrada', `${c.code}: ${formatRate(rate, c.code)} por $1`);
      setValue('');
      onSaved();
    } catch (err) {
      toast.error('No se pudo registrar la tasa', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const fetchBcv = async () => {
    setSaving(true);
    try {
      const r = await paymentsApi.fetchBcvRate();
      toast.success(`Tasa BCV: ${formatRate(r.fetched.rate, 'VES')}`, `Fecha valor ${formatDate(r.fetched.rate_date)}.`);
      onSaved();
    } catch (err) {
      toast.error('No se pudo consultar el BCV', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rate-cell">
      {c.current ? (
        <div>
          <strong>{formatRate(c.current.rate, c.code)}</strong>
          <div className={`cell-person__sub ${c.stale ? 'text-warning' : ''}`}>
            {c.stale && <Icon name="alertTriangle" size={12} />} f. valor {formatDate(c.current.rate_date)} · {SOURCE_LABELS[c.current.source] || c.current.source}
          </div>
        </div>
      ) : (
        <span className="text-warning text-sm">
          <Icon name="alertTriangle" size={13} /> Sin tasa
        </span>
      )}
      {canEdit && c.is_active && (
        <form className="rate-cell__form" onSubmit={save}>
          <input
            className="input input--sm"
            inputMode="decimal"
            placeholder="Tasa de hoy"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`Tasa de hoy de ${c.code} por 1 USD`}
          />
          <Button type="submit" size="sm" variant="secondary" loading={saving} loadingText="…" disabled={!(rate > 0)}>
            Guardar
          </Button>
          {c.official_source === 'bcv' && (
            <Button type="button" size="sm" variant="ghost" icon="sparkles" onClick={fetchBcv} disabled={saving} title="Consultar la tasa oficial en el BCV">
              BCV
            </Button>
          )}
        </form>
      )}
    </div>
  );
}

const FORM_ID = 'currency-form';

/** Agregar (desde el catálogo) o editar una moneda del colegio, en panel lateral. */
function CurrencyFormDrawer({ initial, available, onClose, onSaved }) {
  const drawer = useRef(null);
  const isEdit = Boolean(initial.code);
  const catalogOf = (code) => available.find((a) => a.code === code);
  const [code, setCode] = useState(initial.code || '');
  const [form, setForm] = useState({
    name: initial.name || '',
    symbol: initial.symbol || '',
    decimals: initial.decimals ?? 2,
    isActive: initial.is_active ?? true,
    isDefault: initial.is_default ?? false,
  });
  const { run, loading, error, fieldErrors } = useMutation((body) =>
    isEdit ? paymentsApi.updateCurrency(initial.code, body) : paymentsApi.addCurrency(body)
  );
  const toast = useToast();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const catalog = isEdit
    ? { name: initial.catalog_name, symbol: initial.catalog_symbol, decimals: initial.catalog_decimals, locale: initial.locale }
    : catalogOf(code);

  const pick = (e) => {
    const c = catalogOf(e.target.value);
    setCode(e.target.value);
    if (c) setForm((f) => ({ ...f, name: c.name, symbol: c.symbol, decimals: c.decimals }));
  };

  const resetToCatalog = () => catalog && setForm((f) => ({ ...f, name: catalog.name, symbol: catalog.symbol, decimals: catalog.decimals }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.trim(),
      symbol: form.symbol.trim(),
      decimals: Number(form.decimals),
      isActive: form.isActive,
      // En edición solo se envía si se marca (quitar la marca no aplica: se marca otra).
      ...(form.isDefault && !initial.is_default ? { isDefault: true } : {}),
    };
    try {
      const saved = await run(isEdit ? body : { code, ...body, isDefault: form.isDefault });
      toast.success(isEdit ? 'Moneda actualizada' : 'Moneda agregada', `${saved.name} (${saved.code})`);
      onSaved();
      drawer.current?.close();
    } catch {
      // error visible en el panel
    }
  };

  const customized = catalog && (form.name !== catalog.name || form.symbol !== catalog.symbol || Number(form.decimals) !== catalog.decimals);

  return (
    <Drawer
      ref={drawer}
      title={isEdit ? 'Editar moneda' : 'Agregar moneda'}
      subtitle={isEdit ? `${initial.name} (${initial.code})` : 'Desde el catálogo de monedas ISO 4217'}
      icon={isEdit ? 'pencil' : 'plus'}
      busy={loading}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => drawer.current?.close()} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={loading} loadingText="Guardando…" disabled={!code}>
            {isEdit ? 'Guardar cambios' : 'Agregar moneda'}
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <form id={FORM_ID} onSubmit={handleSubmit} className="drawer-form">
        <section className="drawer-section">
          <h4 className="drawer-section__title">Moneda</h4>
          {!isEdit && (
            <Field label="Moneda del catálogo" error={fieldErrors.code} required hint="Monedas que el colegio aún no tiene.">
              <Select sorted value={code} onChange={pick} required autoFocus>
                <option value="">Selecciona…</option>
                {available.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code}) · {c.country}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Nombre" error={fieldErrors.name} required>
            <Input value={form.name} onChange={set('name')} maxLength={60} required disabled={!code} />
          </Field>
          {isEdit && customized && (
            <p className="form-hint">
              Personalizada respecto al catálogo ({catalog.name}, {catalog.symbol}, {catalog.decimals} decimales).{' '}
              <button type="button" className="link-button" onClick={resetToCatalog}>
                Restablecer
              </button>
            </p>
          )}
        </section>

        <section className="drawer-section">
          <h4 className="drawer-section__title">Formato</h4>
          <div className="form-grid">
            <Field label="Símbolo" error={fieldErrors.symbol} required hint="Ej.: COL$, S/, Bs.">
              <Input value={form.symbol} onChange={set('symbol')} maxLength={8} required disabled={!code} />
            </Field>
            <Field label="Decimales" error={fieldErrors.decimals}>
              <Select value={form.decimals} onChange={set('decimals')} disabled={!code}>
                <option value={0}>Sin decimales</option>
                <option value={1}>1 decimal</option>
                <option value={2}>2 decimales</option>
              </Select>
            </Field>
          </div>
          <div className="currency-preview-card">
            <span>Así se verán los montos</span>
            <strong>{code ? preview({ ...form, decimals: Number(form.decimals), locale: catalog?.locale }) : '—'}</strong>
          </div>
          {isEdit && Number(form.decimals) !== initial.decimals && (
            <Alert variant="warning">Cambiar los decimales afecta solo a las conversiones futuras: los pagos ya confirmados no cambian.</Alert>
          )}
        </section>

        <section className="drawer-section">
          <h4 className="drawer-section__title">Disponibilidad</h4>
          <Switch
            checked={form.isActive}
            disabled={initial.is_default || !code}
            onChange={(on) => setForm((f) => ({ ...f, isActive: on, isDefault: on ? f.isDefault : false }))}
            label="Activa"
            description="Se ofrece en los selectores de pago y en el portal de las familias."
          />
          <Switch
            checked={form.isDefault}
            disabled={initial.is_default || !form.isActive || !code}
            onChange={(on) => setForm((f) => ({ ...f, isDefault: on }))}
            label="Predeterminada del colegio"
            description="La que se muestra si nadie elige otra moneda."
          />
          {initial.is_default && <p className="form-hint">Para desactivarla, marca antes otra moneda como predeterminada.</p>}
        </section>
      </form>
    </Drawer>
  );
}

export default CurrenciesPage;
