const exchange = require('./exchangeRate.service');

/**
 * Impacto de una tasa BCV en la mensualidad (aviso "Nueva tasa BCV").
 *
 * Las tarifas (tuition_fees) se fijan por año escolar en divisas (USD, u otra
 * moneda configurada), una general y opcionalmente una por nivel. Con la tasa
 * nueva se calcula su equivalente en bolívares:
 *   USD              Bs = monto × tasa
 *   otra divisa (X)  Bs = monto ÷ tasa(X) × tasa   (las tasas son "1 USD = n X")
 *   VES              no cambia con la tasa: se informa tal cual
 *
 * feeTable() es la foto que viaja en el aviso (data.tuition); el desglose por
 * alumno de cada familia sale de esa foto y de sus inscripciones del año
 * (studentsTuition), así cada representante ve el monto de SUS alumnos.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const LEVEL_SHORT = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };

/**
 * Año escolar en curso: el que contiene la fecha de hoy (y no está cerrado);
 * si no hay, el último que ya empezó; si tampoco, el próximo en empezar.
 */
async function currentSchoolPeriod(trx, tenantId) {
  return trx('school_periods')
    .where({ tenant_id: tenantId })
    .whereNull('closed_at')
    .orderByRaw(
      `CASE WHEN current_date BETWEEN start_date AND end_date THEN 0
            WHEN start_date <= current_date THEN 1 ELSE 2 END,
       CASE WHEN start_date <= current_date THEN start_date END DESC NULLS LAST,
       start_date ASC`
    )
    .first('id', 'name', 'start_date', 'end_date');
}

/** Bolívares de un monto en `currency` con la tasa VES dada (null si falta la tasa de esa divisa). */
async function toVes(trx, tenantId, amount, currency, vesRate, cache) {
  if (currency === 'VES') return round2(amount);
  if (currency === exchange.BASE) return round2(amount * vesRate);
  if (!cache.has(currency)) cache.set(currency, (await exchange.getEffectiveRate(trx, tenantId, currency))?.rate ?? null);
  const rate = cache.get(currency);
  return rate ? round2((amount / rate) * vesRate) : null;
}

/**
 * Tarifas del año en curso convertidas a bolívares con `vesRate`:
 * { school_period: { id, name }, rate, fees: [{ level_code, level_name, amount, currency, ves, fixed_ves }], same_for_all }
 * Una fila por nivel (su tarifa propia o, si no tiene, la general). null si no hay tarifas.
 */
async function feeTable(trx, tenantId, vesRate) {
  const period = await currentSchoolPeriod(trx, tenantId);
  if (!period) return null;
  const fees = await trx('tuition_fees').where({ tenant_id: tenantId, school_period_id: period.id }).select('level_code', 'amount', 'currency');
  if (!fees.length) return null;
  const general = fees.find((f) => !f.level_code) || null;
  const levels = await trx('education_levels').orderBy('sort_order').select('code', 'name');
  const cache = new Map();
  const rows = [];
  for (const level of levels) {
    const fee = fees.find((f) => f.level_code === level.code) || general;
    if (!fee) continue;
    const amount = Number(fee.amount);
    rows.push({
      level_code: level.code,
      level_name: LEVEL_SHORT[level.code] || level.name,
      amount,
      currency: fee.currency,
      ves: await toVes(trx, tenantId, amount, fee.currency, vesRate, cache),
      fixed_ves: fee.currency === 'VES', // fijada en bolívares: la tasa no la cambia
    });
  }
  if (!rows.length) return null;
  const same = rows.every((r) => r.amount === rows[0].amount && r.currency === rows[0].currency);
  return { school_period: { id: period.id, name: period.name }, rate: vesRate, fees: rows, same_for_all: same };
}

/** Alumnos del representante con inscripción activa en el año escolar, con el nivel de su grado. */
async function familyStudents(trx, tenantId, guardianId, schoolPeriodId) {
  return trx('student_guardians as sg')
    .join('students as s', 's.id', 'sg.student_id')
    .join('enrollments as e', function joinEnrollment() {
      this.on('e.student_id', 's.id').andOnVal('e.status', 'active');
    })
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'sg.guardian_id': guardianId, 's.tenant_id': tenantId, 'sec.school_period_id': schoolPeriodId })
    .select('s.id as student_id', 's.first_name', 's.last_name', 'g.name as grade_name', 'sec.name as section_name', 'g.level_code', 'g.sort_order')
    .orderBy([{ column: 'g.sort_order' }, { column: 's.first_name' }]);
}

/**
 * Mensualidad de cada alumno según la foto `table` de un aviso:
 * [{ student_id, student_name, grade_name, section_name, level_code, amount, currency, ves }]
 */
function applyFees(students, table) {
  return students
    .map((r) => {
      const fee = table.fees.find((f) => f.level_code === r.level_code);
      if (!fee) return null;
      return {
        student_id: r.student_id,
        student_name: `${r.first_name} ${r.last_name}`,
        grade_name: r.grade_name,
        section_name: r.section_name,
        level_code: r.level_code,
        amount: fee.amount,
        currency: fee.currency,
        ves: fee.ves,
      };
    })
    .filter(Boolean);
}

async function studentsTuition(trx, tenantId, guardianId, table) {
  if (!guardianId || !table?.fees?.length) return [];
  return applyFees(await familyStudents(trx, tenantId, guardianId, table.school_period.id), table);
}

/** Representantes con alumnos inscritos en el año → su desglose (para personalizar el correo). */
async function tuitionByGuardian(trx, tenantId, table) {
  if (!table?.fees?.length) return new Map();
  const guardianIds = await trx('student_guardians as sg')
    .join('enrollments as e', function joinEnrollment() {
      this.on('e.student_id', 'sg.student_id').andOnVal('e.status', 'active');
    })
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('guardians as gu', 'gu.id', 'sg.guardian_id')
    .where({ 'gu.tenant_id': tenantId, 'sec.school_period_id': table.school_period.id })
    .distinct('sg.guardian_id')
    .pluck('sg.guardian_id');
  const out = new Map();
  for (const id of guardianIds) out.set(id, await studentsTuition(trx, tenantId, id, table));
  return out;
}

// ---- Textos ----

const num = (n, decimals = 2) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
/** 120 USD → "$120,00"; 95 EUR → "95,00 EUR"; Bs → "Bs 105.773,90". */
const money = (amount, currency) => (currency === 'USD' ? `$${num(amount)}` : currency === 'VES' ? `Bs ${num(amount)}` : `${num(amount)} ${currency}`);
const bs = (n) => (n === null || n === undefined ? 'sin tasa de conversión' : `Bs ${num(n)}`);

/** Línea corta para el aviso de la campana: "Mensualidad 2026-2027: $120,00 = Bs 105.773,90." */
function summaryText(table) {
  if (!table) return '';
  const label = `Mensualidad ${table.school_period.name}`;
  if (table.same_for_all) {
    const f = table.fees[0];
    return f.fixed_ves ? `${label}: ${bs(f.ves)} (fijada en bolívares).` : `${label}: ${money(f.amount, f.currency)} = ${bs(f.ves)}.`;
  }
  return `${label}: ${table.fees.map((f) => `${f.level_name} ${bs(f.ves)}`).join(' · ')}.`;
}

/** Desglose de la familia, una línea por alumno (cuerpo del correo). */
function familyText(items) {
  if (!items?.length) return '';
  const lines = items.map((s) => `• ${s.student_name} (${s.grade_name} ${s.section_name}): ${money(s.amount, s.currency)} = ${bs(s.ves)}`);
  const total = items.every((s) => s.ves !== null) ? round2(items.reduce((acc, s) => acc + s.ves, 0)) : null;
  return `Mensualidad con esta tasa:\n${lines.join('\n')}${items.length > 1 && total !== null ? `\nTotal mensual: ${bs(total)}` : ''}`;
}

module.exports = { currentSchoolPeriod, feeTable, familyStudents, applyFees, studentsTuition, tuitionByGuardian, summaryText, familyText };
