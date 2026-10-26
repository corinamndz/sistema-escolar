const { z } = require('zod');
const f = require('../fields');
const { normalizeHeader } = require('../excel');
const { ApiError } = require('../../../utils/ApiError');
const { compareUnits } = require('../../programmatic-content/programmaticContent.service');
const { CATEGORIES, INSTRUMENTS } = require('../../evaluation-plans/activityExcel.service');
const planService = require('../../evaluation-plans/evaluationPlan.service');

/**
 * Carga masiva de las actividades de UN plan de evaluación a partir del
 * contenido programático de su materia y grado.
 *
 * Plantilla: una fila por TEMA del contenido programático (Unidad y Tema ya
 * escritos, con su ID oculto). El docente completa la evaluación de cada tema:
 * actividad, tipo, estrategia, instrumento, porcentaje, fecha estimada y
 * descripción.
 *   - Un tema sin evaluación (columnas de evaluación vacías) se omite.
 *   - Dos evaluaciones del mismo tema: se copia la fila completa.
 *   - Cada actividad queda asociada a su tema (programmatic_content_id).
 *
 * Fechas: "Fecha estimada" es la del plan (formato simple: la que se muestra).
 * En formato detallado se muestran por SECCIÓN: la fecha estimada vale para
 * todas, y con varias secciones hay una columna "Fecha Sección X" por sección
 * que la reemplaza en esa sección.
 *
 * Formato detallado: cada evaluación lleva criterios e indicadores. El primero
 * va en la fila del tema; los siguientes, en filas insertadas DEBAJO con solo
 * Criterio (si cambia), Indicador y Puntaje del indicador ("filas de
 * indicador", estado 'part'). Criterio vacío = sigue en el criterio anterior.
 * El puntaje de la actividad es la suma de sus indicadores (o "Puntaje total",
 * que debe coincidir).
 *
 * Porcentajes: los del archivo más los de las actividades que el plan ya tiene
 * no pueden pasar de 100%. Si pasan, NINGUNA fila se importa (validateAll), así
 * no queda un plan a medias. Cada actividad se guarda con upsertActivity: mismas
 * reglas que al crearla a mano (plan abierto, fechas dentro del lapso, tema de la
 * misma materia y grado, indicadores que suman el puntaje, suma ≤ 100%).
 */

const round2 = (n) => Math.round(n * 100) / 100;
/** 75.5 → "75,5 %" (formato venezolano en los mensajes). */
const pct = (n) => `${round2(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })} %`;
const num = (n) => round2(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
const topicKey = (unit, topic) => `${normalizeHeader(unit)}|${normalizeHeader(topic)}`;
const dateKey = (name) => `date_${normalizeHeader(name).replace(/[^a-z0-9]/g, '_')}`;
const dmy = (iso) => iso.split('-').reverse().join('/');
const CATEGORY_LABEL = Object.fromEntries(Object.entries(CATEGORIES).map(([label, code]) => [code, label]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** "20", "20%", "20,5" → 20.5 (mayor que 0 y hasta 100). */
function percent(v) {
  if (!filled(v)) return { error: 'El porcentaje es obligatorio para evaluar el tema.' };
  const raw = typeof v === 'number' ? v : Number(String(v).replace('%', '').replace(',', '.').trim());
  // Una celda con formato de porcentaje de Excel llega como fracción (20% → 0.2).
  const n = typeof v === 'number' && v > 0 && v < 1 ? v * 100 : raw;
  if (!Number.isFinite(n)) return { error: `El porcentaje "${v}" no es un número.` };
  if (n <= 0 || n > 100) return { error: `El porcentaje debe ser mayor que 0 y hasta 100 (recibido ${n}).` };
  return { value: round2(n) };
}

/** Puntaje (> 0 y hasta 100, admite coma decimal). Vacío → null (o error si es obligatorio). */
function points(v, { label, required }) {
  if (!filled(v)) return required ? { error: `${label} es obligatorio.` } : { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
  if (!Number.isFinite(n)) return { error: `${label}: "${v}" no es un número.` };
  if (n <= 0 || n > 100) return { error: `${label} debe ser mayor que 0 y hasta 100 (recibido ${n}).` };
  return { value: round2(n) };
}

const safeName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** Columnas que describen la EVALUACIÓN (no el indicador): con alguna llena, la fila es una evaluación. */
const headKeys = (ctx) => ['title', 'category', 'strategy', 'instrument', 'weight', 'plannedDate', 'description', 'maxScore', ...ctx.sections.map((s) => s.dateKey)];
const indicatorKeys = ['criterion', 'indicator', 'points'];

/** Lee el criterio/indicador de una fila y lo agrega a la evaluación `head`. Devuelve los errores. */
function addIndicator(v, head) {
  const { data, errors } = f.collect({
    criterion: [f.text, v.criterion, { max: 300, label: 'El criterio' }],
    indicator: [f.text, v.indicator, { max: 300, required: true, label: 'El indicador' }],
    points: [points, v.points, { label: 'El puntaje del indicador', required: true }],
  });
  const criterion = data.criterion || head.lastCriterion;
  if (!criterion) errors.push({ column: 'criterion', reason: 'falta el criterio', message: 'Escribe el criterio de este indicador (en las filas siguientes del mismo criterio puede ir vacío).' });
  if (errors.length) return errors;
  head.lastCriterion = criterion;
  const last = head.criteria[head.criteria.length - 1];
  if (last && last.title === criterion) last.indicators.push({ description: data.indicator, points: data.points });
  else head.criteria.push({ title: criterion, indicators: [{ description: data.indicator, points: data.points }] });
  return [];
}

module.exports = {
  type: 'plan_activities',
  label: 'Plan de evaluación',
  noun: { one: 'evaluación', many: 'evaluaciones' },
  // Filas omitidas = temas que el docente no evalúa (no "sin cambios").
  skippedText: (n) => `${n} ${n === 1 ? 'tema' : 'temas'} sin evaluación`,
  permission: ['evaluation_plans', 'create'],
  fileName: 'plan-de-evaluacion.xlsx',

  async prepare(trx, tenantId, params) {
    const planId = z.string().uuid().safeParse(params?.planId);
    if (!planId.success) throw ApiError.badRequest('Indica un plan de evaluación válido (planId).');

    const plan = await trx('evaluation_plans as ep')
      .join('sections as sec', 'sec.id', 'ep.section_id')
      .join('grades as g', 'g.id', 'sec.grade_id')
      .join('terms as t', 't.id', 'ep.term_id')
      .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
      .where({ 'ep.id': planId.data, 'ep.tenant_id': tenantId })
      .select('ep.*', 'sec.grade_id', 'g.name as grade_name', 't.name as term_name', 't.start_date as term_start', 't.end_date as term_end', trx.raw('COALESCE(sub.name, ep.subject) AS subject_name'))
      .first();
    if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
    if (plan.status === 'closed') throw ApiError.conflict('El plan de evaluación está cerrado: reábrelo para cargar actividades.');
    if (!plan.subject_id) {
      throw ApiError.unprocessable('Este plan no está vinculado a una materia del catálogo, así que no tiene contenido programático del cual partir.');
    }
    const detailed = plan.format === 'detailed';
    const sections = (await planService.listPlanSections(trx, plan.id)).map((s) => ({ id: s.id, name: s.name, dateKey: dateKey(s.name) }));
    const perSectionDates = sections.length > 1;

    const topics = (await trx('programmatic_content').where({ tenant_id: tenantId, grade_id: plan.grade_id, subject_id: plan.subject_id }).select('id', 'unit', 'topic', 'sort_order')).sort(
      (a, b) => compareUnits(a.unit, b.unit) || a.sort_order - b.sort_order
    );
    if (!topics.length) {
      throw ApiError.unprocessable(`${plan.subject_name} de ${plan.grade_name} aún no tiene contenido programático. Cárgalo primero en «Contenido programático» para generar la plantilla.`);
    }

    const existing = await trx('evaluation_activities as a')
      .leftJoin('programmatic_content as pc', 'pc.id', 'a.programmatic_content_id')
      .where({ 'a.tenant_id': tenantId, 'a.evaluation_plan_id': plan.id })
      .select('a.title', 'a.category', 'a.weight_percent', 'pc.topic')
      .orderBy('a.created_at');
    const existingTotal = round2(existing.reduce((s, a) => s + Number(a.weight_percent), 0));
    const available = round2(100 - existingTotal);
    if (available <= 0) throw ApiError.unprocessable('Las actividades del plan ya suman 100%: no queda porcentaje para agregar evaluaciones.');

    const sectionText = sections.map((s) => s.name).join(', ');
    const label = `${plan.subject_name} · ${plan.grade_name} ${sectionText} · ${plan.term_name}`;
    const termText = plan.term_start && plan.term_end ? `del ${dmy(plan.term_start)} al ${dmy(plan.term_end)}` : null;
    const inTerm = termText ? `, dentro del lapso (${termText})` : '';

    const columns = [
      { key: 'contentId', header: 'ID del tema', note: 'No modificar: identifica el tema del contenido programático.' },
      { key: 'unit', header: 'Unidad', mustExist: true, width: 20, note: 'Viene del contenido programático. No la cambies.' },
      { key: 'topic', header: 'Tema', mustExist: true, width: 34, note: 'Viene del contenido programático. Para evaluar dos veces el mismo tema, copia la fila completa.' },
      { key: 'title', header: 'Actividad', width: 30, note: 'Opcional (máx. 200). Si la dejas vacía se usa la estrategia o el tipo y el tema.' },
      { key: 'category', header: 'Tipo', mustExist: true, width: 14, options: Object.keys(CATEGORIES), note: `Tipo de evaluación: ${Object.keys(CATEGORIES).join(', ')}. Por defecto, Formativa.` },
      { key: 'strategy', header: 'Estrategia de evaluación', width: 30, note: 'Opcional (máx. 200). Ej. exposición en grupos, taller práctico.' },
      { key: 'instrument', header: 'Instrumento', width: 22, options: Object.keys(INSTRUMENTS), note: 'Opcional. Elige de la lista.' },
      { key: 'weight', header: 'Porcentaje %', mustExist: true, width: 13, note: `Obligatorio para evaluar el tema: porcentaje de la nota del lapso (ej. 20). Entre todas, hasta ${pct(available)} disponible.` },
      {
        key: 'plannedDate',
        header: 'Fecha estimada',
        date: true,
        width: 15,
        note: `Opcional (DD/MM/AAAA)${inTerm}.${detailed ? ` Es la fecha de aplicación en ${perSectionDates ? 'todas las secciones (salvo que llenes la de una sección)' : `la sección ${sectionText}`}.` : ''}`,
      },
      ...(detailed && perSectionDates
        ? sections.map((s) => ({ key: s.dateKey, header: `Fecha Sección ${s.name}`, date: true, width: 15, note: `Opcional (DD/MM/AAAA): fecha de aplicación en la sección ${s.name}; reemplaza a la fecha estimada.` }))
        : []),
      { key: 'description', header: 'Descripción', width: 34, note: 'Opcional (máx. 1000): instrucciones o criterios generales.' },
      ...(detailed
        ? [
            { key: 'maxScore', header: 'Puntaje total', width: 12, note: 'Opcional: puntaje de la evaluación. Si lo dejas vacío es la suma de los puntajes de sus indicadores.' },
            { key: 'criterion', header: 'Criterio', mustExist: true, width: 30, note: 'Criterio de evaluación (máx. 300). Escríbelo en su primer indicador; en los indicadores siguientes del mismo criterio puede ir vacío.' },
            { key: 'indicator', header: 'Indicador', mustExist: true, width: 40, note: 'Un indicador de logro por fila (máx. 300). Para más indicadores, inserta filas DEBAJO de la evaluación y llena solo Criterio, Indicador y Puntaje.' },
            { key: 'points', header: 'Puntaje del indicador', mustExist: true, width: 14, note: 'Puntos del indicador (mayor que 0; admite coma decimal).' },
          ]
        : []),
    ];

    return {
      plan,
      planId: plan.id,
      detailed,
      sections: detailed && perSectionDates ? sections : [],
      planSections: sections,
      columns,
      existingTotal,
      existingCount: existing.length,
      byId: new Map(topics.map((t) => [t.id, t])),
      byKey: new Map(topics.map((t) => [topicKey(t.unit, t.topic), t])),
      template: {
        fileName: `plan-${safeName(plan.subject_name)}-${safeName(plan.grade_name)}-${safeName(sectionText)}-${safeName(plan.term_name)}.xlsx`,
        title: `Plan de evaluación — ${label}`,
        instructions: [
          `Plan: ${label}${termText ? ` (lapso ${termText})` : ''} · formato ${detailed ? 'DETALLADO' : 'simple'}.`,
          'La hoja "Datos" ya trae una fila por cada tema del contenido programático. Completa la evaluación de los temas que vas a evaluar; los que dejes sin datos se omiten.',
          'Para evaluar dos veces el mismo tema, copia la fila completa (con Unidad y Tema) y cambia los datos de la evaluación.',
          ...(detailed
            ? [
                'Formato detallado: cada evaluación necesita al menos un CRITERIO con su INDICADOR y puntaje. El primero va en la misma fila del tema.',
                'Para más indicadores, inserta filas debajo de la evaluación y llena SOLO Criterio (si cambia), Indicador y Puntaje del indicador. Un Criterio vacío sigue en el criterio de arriba.',
                'El puntaje de la evaluación es la suma de sus indicadores (si escribes "Puntaje total", debe coincidir con esa suma).',
              ]
            : []),
          existing.length
            ? `El plan ya tiene ${existing.length} actividad(es) que suman ${pct(existingTotal)}: las de este archivo se AGREGAN y entre todas pueden sumar hasta ${pct(available)}.`
            : 'Los porcentajes de todas las evaluaciones no pueden pasar de 100% (para cerrar el plan deben sumar exactamente 100%).',
          'Si la suma pasa de 100%, no se importa nada: ajusta los porcentajes y vuelve a subir el archivo.',
        ],
        hiddenKeys: ['contentId'],
        prefill: topics.map((t) => ({ contentId: t.id, unit: t.unit, topic: t.topic })),
        examples: detailed
          ? [
              { unit: 'Unidad I', topic: 'Estructura celular', title: 'Maqueta de la célula', category: 'Proyecto', instrument: 'Rúbrica', weight: 20, plannedDate: '15/10/2026', criterion: 'Contenido', indicator: 'Identifica los organelos', points: 10 },
              { criterion: '', indicator: 'Explica la función de cada organelo', points: 5 },
              { criterion: 'Presentación', indicator: 'Orden y limpieza de la maqueta', points: 5 },
            ]
          : [{ unit: 'Unidad I', topic: 'Estructura celular', title: 'Maqueta de la célula', category: 'Proyecto', strategy: 'Trabajo en parejas', instrument: 'Rúbrica', weight: 20, plannedDate: '15/10/2026', description: 'Maqueta con los organelos rotulados.' }],
        guideTables: [
          ...(existing.length
            ? [
                {
                  title: `Actividades que el plan ya tiene (${pct(existingTotal)}; disponible ${pct(available)})`,
                  headers: ['Actividad', 'Tema', 'Tipo', 'Porcentaje'],
                  rows: existing.map((a) => [a.title, a.topic || '—', CATEGORY_LABEL[a.category] || a.category, pct(a.weight_percent)]),
                },
              ]
            : []),
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const isHead = headKeys(ctx).some((k) => filled(v[k]));
    const hasIndicator = ctx.detailed && indicatorKeys.some((k) => filled(v[k]));

    // Fila de indicador: completa la evaluación de arriba.
    if (!isHead && hasIndicator) {
      const head = state.head;
      if (!head) {
        return {
          data: {},
          errors: [{ column: 'indicator', reason: 'indicador sin evaluación', message: 'Este indicador no tiene evaluación arriba: escríbelo en la fila de su tema o debajo de una evaluación.' }],
          label: v.indicator ? String(v.indicator) : null,
          part: true,
        };
      }
      const errors = addIndicator(v, head.data);
      return { data: { headData: head.data }, errors, label: `Indicador de «${head.data.title}»`, part: true, notes: [`${String(v.indicator || '').slice(0, 60)} · ${v.points} pts`] };
    }

    const byId = v.contentId && UUID.test(String(v.contentId).trim()) ? ctx.byId.get(String(v.contentId).trim()) : null;
    const topic = byId || (v.unit && v.topic ? ctx.byKey.get(topicKey(v.unit, v.topic)) : null);
    const label = topic?.topic || (v.topic ? String(v.topic) : null);

    if (!isHead) {
      state.head = null; // un tema sin evaluación corta la evaluación de arriba
      return { data: {}, errors: [], label, skip: true, notes: ['Tema sin evaluación: se omite.'] };
    }
    if (!topic) {
      state.head = null;
      return {
        data: {},
        errors: [{ column: 'topic', reason: 'tema no encontrado', message: `No se encontró el tema "${v.topic || '(vacío)'}"${v.unit ? ` de "${v.unit}"` : ''} en el contenido programático de ${ctx.plan.subject_name}. No cambies Unidad ni Tema: descarga una plantilla nueva si el contenido cambió.` }],
        label,
      };
    }

    const { data, errors } = f.collect({
      title: [f.text, v.title, { max: 200, label: 'La actividad' }],
      category: [f.option, v.category, { options: CATEGORIES, aliases: { Formativo: 'formative', Exámen: 'exam', Prueba: 'exam' }, label: 'El tipo' }],
      strategy: [f.text, v.strategy, { max: 200, label: 'La estrategia' }],
      instrument: [f.option, v.instrument, { options: INSTRUMENTS, label: 'El instrumento' }],
      weight: [percent, v.weight],
      plannedDate: [f.date, v.plannedDate, { label: 'La fecha estimada' }],
      description: [f.text, v.description, { max: 1000, label: 'La descripción' }],
      ...(ctx.detailed ? { maxScore: [points, v.maxScore, { label: 'El puntaje total' }] } : {}),
    });

    // Fechas por sección (formato detallado con varias secciones).
    data.sectionDate = {};
    ctx.sections.forEach((s) => {
      const r = f.date(v[s.dateKey], { label: `La fecha de la sección ${s.name}` });
      if (r.error) errors.push({ column: s.dateKey, message: r.error });
      else if (r.value) data.sectionDate[s.id] = r.value;
    });

    const { term_start: start, term_end: end } = ctx.plan;
    const outside = (d) => d && ((start && d < start) || (end && d > end));
    const range = start && end ? ` (${dmy(start)} al ${dmy(end)})` : '';
    if (outside(data.plannedDate)) {
      errors.push({ column: 'plannedDate', reason: 'fecha fuera del lapso', message: `La fecha estimada debe estar dentro del ${ctx.plan.term_name}${range}.` });
    }
    ctx.sections.forEach((s) => {
      if (outside(data.sectionDate[s.id])) errors.push({ column: s.dateKey, reason: 'fecha fuera del lapso', message: `La fecha de la sección ${s.name} debe estar dentro del ${ctx.plan.term_name}${range}.` });
    });

    data.category = data.category || 'formative';
    data.contentId = topic.id;
    data.title = data.title || data.strategy || `${CATEGORY_LABEL[data.category]}: ${topic.topic}`.slice(0, 200);
    data.criteria = [];
    data.badIndicatorRows = [];
    data.row = state.row;

    // Formato detallado: el primer indicador puede ir en la misma fila.
    if (ctx.detailed && hasIndicator) errors.push(...addIndicator(v, data));
    state.head = { data };

    const parts = [`${data.title}`, CATEGORY_LABEL[data.category], pct(data.weight)];
    const dates = ctx.detailed ? Object.values(data.sectionDate).concat(data.plannedDate ? [data.plannedDate] : []) : [data.plannedDate].filter(Boolean);
    if (dates.length) parts.push(`fecha ${dmy(dates[0])}`);
    return { data, errors, label: `${topic.unit} · ${topic.topic}`, notes: [parts.join(' · ')] };
  },

  /**
   * Validación del ARCHIVO completo:
   *   - formato detallado: cada evaluación con al menos un indicador; si una de
   *     sus filas de indicador tiene errores, la evaluación tampoco se importa;
   *     el puntaje total (si se escribió) debe ser la suma de los indicadores;
   *   - porcentajes: lo que ya tiene el plan más lo del archivo ≤ 100%. Si pasa,
   *     ninguna fila se importa.
   */
  validateAll(results, ctx) {
    const fail = (r, column, columnLabel, reason, message) => {
      r.status = 'invalid';
      r.notes = [];
      r.errors.push({ column, columnLabel, reason, message });
    };

    if (ctx.detailed) {
      results.filter((r) => r.status === 'invalid' && r.data?.headData).forEach((r) => r.data.headData.badIndicatorRows.push(r.row));
      results
        .filter((r) => r.status === 'valid')
        .forEach((r) => {
          const d = r.data;
          const indicators = d.criteria.flatMap((c) => c.indicators);
          const sum = round2(indicators.reduce((s, i) => s + i.points, 0));
          if (d.badIndicatorRows.length) {
            fail(r, 'indicator', 'Indicador', 'indicadores con errores', `Corrige los indicadores de ${d.badIndicatorRows.length === 1 ? 'la fila' : 'las filas'} ${d.badIndicatorRows.join(', ')}: la evaluación se importa completa o no se importa.`);
          } else if (!indicators.length) {
            fail(r, 'indicator', 'Indicador', 'sin indicadores', 'En formato detallado cada evaluación necesita al menos un criterio con su indicador y puntaje.');
          } else if (d.maxScore && d.maxScore !== sum) {
            fail(r, 'maxScore', 'Puntaje total', 'puntaje no coincide', `Los indicadores suman ${num(sum)} puntos y el puntaje total dice ${num(d.maxScore)}: deben coincidir (o deja el puntaje total vacío).`);
          } else {
            d.maxScore = sum;
            r.notes = [`${r.notes[0] || d.title} · ${d.criteria.length} criterio(s), ${indicators.length} indicador(es), ${num(sum)} pts`];
          }
        });
    }

    const valid = results.filter((r) => r.status === 'valid');
    if (!valid.length) return null;
    const fileTotal = round2(valid.reduce((s, r) => s + r.data.weight, 0));
    const total = round2(ctx.existingTotal + fileTotal);
    const available = round2(100 - ctx.existingTotal);
    if (total > 100) {
      const message = `Los porcentajes suman ${pct(total)}${ctx.existingCount ? ` (el plan ya tiene ${pct(ctx.existingTotal)} y el archivo suma ${pct(fileTotal)})` : ''}: no pueden pasar de 100 %. Ajústalos para que el archivo sume como máximo ${pct(available)}.`;
      valid.forEach((r) => fail(r, 'weight', 'Porcentaje %', 'porcentajes exceden 100%', message));
      return { note: `No se importará nada: ${message}` };
    }
    return {
      note: total === 100 ? 'Con este archivo el plan suma 100 %: queda completo.' : `Con este archivo el plan suma ${pct(total)}: faltarán ${pct(100 - total)} para poder cerrarlo.`,
    };
  },

  async insert(trx, tenantId, data, ctx) {
    // Formato detallado: la fecha se muestra por sección (la de la sección o, si no, la estimada).
    const sectionDates = ctx.detailed
      ? ctx.planSections.map((s) => ({ sectionId: s.id, date: data.sectionDate[s.id] || data.plannedDate })).filter((d) => d.date)
      : undefined;
    await planService.upsertActivity(trx, tenantId, ctx.planId, {
      title: data.title,
      category: data.category,
      weightPercent: data.weight,
      description: data.description,
      plannedDate: data.plannedDate,
      strategy: data.strategy,
      instrument: data.instrument,
      programmaticContentId: data.contentId,
      ...(ctx.detailed ? { planFormat: 'detailed', criteria: data.criteria, maxScore: data.maxScore, sectionDates } : {}),
    });
    return {};
  },
};
