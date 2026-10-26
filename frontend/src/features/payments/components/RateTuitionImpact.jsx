import Icon from '../../../components/ui/Icon';
import { formatMoney } from '../currency';

/**
 * Impacto de una tasa BCV en la mensualidad, dentro del detalle del aviso
 * (campana y Centro de notificaciones):
 *  - representante: la mensualidad de cada uno de sus alumnos (`data.my_tuition`) y el total;
 *  - administración: la tarifa por nivel del año en curso (`data.tuition`).
 * Los montos son los de la tasa de ESE aviso (se calcularon al emitirlo).
 */
function RateTuitionImpact({ data }) {
  const table = data?.tuition;
  if (!table?.fees?.length) return null;
  const mine = data.my_tuition;
  const ves = (v) => (v === null || v === undefined ? '—' : formatMoney(v, 'VES'));

  if (mine) {
    if (!mine.length) return null; // sin alumnos inscritos en el año: no aplica
    const total = mine.every((s) => s.ves !== null) ? mine.reduce((acc, s) => acc + s.ves, 0) : null;
    return (
      <section className="rti">
        <h4 className="rti__title">
          <Icon name="receipt" size={15} /> Mensualidad de tus representados con esta tasa
        </h4>
        <ul className="rti__list">
          {mine.map((s) => (
            <li key={s.student_id}>
              <span className="rti__who">
                <strong>{s.student_name}</strong>
                <small>
                  {s.grade_name} {s.section_name}
                </small>
              </span>
              <span className="rti__amount">
                <strong>{ves(s.ves)}</strong>
                <small>{formatMoney(s.amount, s.currency)}</small>
              </span>
            </li>
          ))}
        </ul>
        {mine.length > 1 && total !== null && (
          <div className="rti__total">
            <span>Total mensual</span>
            <strong>{ves(total)}</strong>
          </div>
        )}
        <p className="rti__note">Año escolar {table.school_period.name}. Las cuotas pendientes se cobran con la tasa vigente el día del pago.</p>
      </section>
    );
  }

  return (
    <section className="rti">
      <h4 className="rti__title">
        <Icon name="receipt" size={15} /> Mensualidad {table.school_period.name} con esta tasa
      </h4>
      <ul className="rti__list">
        {(table.same_for_all ? [{ ...table.fees[0], level_name: 'Todos los niveles' }] : table.fees).map((f) => (
          <li key={f.level_code}>
            <span className="rti__who">
              <strong>{f.level_name}</strong>
            </span>
            <span className="rti__amount">
              <strong>{ves(f.ves)}</strong>
              <small>{f.fixed_ves ? 'Fijada en bolívares' : formatMoney(f.amount, f.currency)}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="rti__note">Cada familia ve en su aviso el monto de sus alumnos.</p>
    </section>
  );
}

export default RateTuitionImpact;
