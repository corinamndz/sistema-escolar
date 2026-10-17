import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Card from '../../../components/ui/Card';
import Icon from '../../../components/ui/Icon';

/**
 * Gráficos del inicio (se cargan aparte para no sumar Recharts al resto de la app).
 * Los colores salen de los tokens CSS del sistema (niveles y estados).
 */

const LEVEL_TOKENS = { initial: '--level-initial', primary: '--level-primary', secondary: '--level-secondary' };
const SOLVENCY_TOKENS = { up_to_date: '--color-success', pending: '--color-warning', in_review: '--color-info', overdue: '--color-danger' };

/** Valores actuales de los tokens CSS (Recharts necesita colores concretos, no `var(--…)`). */
function useTokens(names) {
  const [tokens] = useState(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((name) => [name, css.getPropertyValue(name).trim()]));
  });
  return tokens;
}

const percent = (value, total) => (total ? Math.round((value / total) * 100) : 0);

function ChartTooltip({ active, payload, total, noun }) {
  if (!active || !payload?.length) return null;
  const { name, value, payload: row } = payload[0];
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip__dot" style={{ background: row.fill || payload[0].color }} />
      <strong>{row.label || name}</strong>
      <span>
        {value} {noun} · {percent(value, total)}%
      </span>
    </div>
  );
}

function EnrollmentDonut({ enrollment }) {
  const t = useTokens([...Object.values(LEVEL_TOKENS), '--color-surface', '--color-border-strong']);
  const data = enrollment.byLevel.map((l) => ({ ...l, label: l.name, fill: t[LEVEL_TOKENS[l.code]] }));
  if (enrollment.unenrolled) data.push({ code: 'none', name: 'Sin inscripción', label: 'Sin inscripción', value: enrollment.unenrolled, fill: t['--color-border-strong'] });
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <Card
      title="Distribución de la matrícula"
      subtitle="Alumnos activos por nivel educativo (inscripción del año en curso)"
      actions={
        <Link to="/students" className="btn btn--ghost btn--sm">
          Ver alumnos <Icon name="arrowRight" size={14} />
        </Link>
      }
    >
      {total === 0 ? (
        <ChartEmpty icon="graduation" text="Aún no hay alumnos activos." />
      ) : (
        <div className="chart-donut">
          <div className="chart-donut__chart">
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke={t['--color-surface']} strokeWidth={2} isAnimationActive>
                  {data
                    .filter((d) => d.value > 0)
                    .map((d) => (
                      <Cell key={d.code} fill={d.fill} />
                    ))}
                </Pie>
                <Tooltip content={<ChartTooltip total={total} noun="alumnos" />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="chart-donut__center" aria-hidden="true">
              <strong>{total}</strong>
              <span>alumnos</span>
            </div>
          </div>
          <ul className="chart-legend">
            {data.map((d) => (
              <li key={d.code}>
                <span className="chart-legend__dot" style={{ background: d.fill }} />
                <span className="chart-legend__label">{d.label}</span>
                <strong>{d.value}</strong>
                <span className="chart-legend__pct">{percent(d.value, total)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function SolvencyBars({ solvency }) {
  const t = useTokens([...Object.values(SOLVENCY_TOKENS), '--color-border', '--color-text-muted', '--color-surface-muted']);
  const data = solvency.map((s) => ({ ...s, fill: t[SOLVENCY_TOKENS[s.key]] }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const upToDate = data.find((d) => d.key === 'up_to_date')?.value || 0;

  return (
    <Card
      title="Solvencia de los representantes"
      subtitle={total ? `${percent(upToDate, total)}% de los representantes está al día` : 'Representantes con alumnos vinculados'}
      actions={
        <Link to="/payments" className="btn btn--ghost btn--sm">
          Ver pagos <Icon name="arrowRight" size={14} />
        </Link>
      }
    >
      {total === 0 ? (
        <ChartEmpty icon="users" text="Aún no hay representantes con alumnos vinculados." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={t['--color-border']} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: t['--color-text-muted'], fontSize: 12 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: t['--color-text-muted'], fontSize: 12 }} />
              <Tooltip cursor={{ fill: t['--color-surface-muted'] }} content={<ChartTooltip total={total} noun="representantes" />} />
              <Bar dataKey="value" name="Representantes" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="chart-note">
            Cada representante cuenta una vez, en su situación más urgente: vencido, pendiente por pagar o pago reportado en revisión.
          </p>
        </>
      )}
    </Card>
  );
}

function ChartEmpty({ icon, text }) {
  return (
    <div className="empty-state chart-empty">
      <div className="empty-state__icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

function DashboardCharts({ summary }) {
  const charts = [
    summary.enrollment && <EnrollmentDonut key="enrollment" enrollment={summary.enrollment} />,
    summary.solvency && <SolvencyBars key="solvency" solvency={summary.solvency} />,
  ].filter(Boolean);
  if (!charts.length) return null;
  return <div className={`grid ${charts.length > 1 ? 'grid--2' : ''} dashboard-charts`}>{charts}</div>;
}

export default DashboardCharts;
