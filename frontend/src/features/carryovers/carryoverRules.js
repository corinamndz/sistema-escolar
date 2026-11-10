/**
 * Reglas de las materias pendientes, sin servidor, para el simulador. Reproducen
 * paso a paso las del sistema real (backend/src/modules/carryovers/carryover.service.js:
 * savePlan y gradeMoment); si cambian allí, cambian aquí.
 *
 *   aprueba un momento  → nota final, materia liberada; los momentos siguientes
 *                         ya no hacen falta;
 *   reprueba un momento → se habilita el siguiente; si no quedan, la materia
 *                         queda no aprobada (la dirección puede agregar momentos).
 *   corregir            → solo el último calificado; lo que seguía se recalcula.
 *
 * Una pendencia simulada: { status, final_grade, passing_grade, moments }
 *   moments [{ position, name, description, passing_grade, status, grade }]
 * Cada momento se aprueba con su nota mínima: la del año o más alta, nunca menos.
 * Cada operación devuelve la pendencia NUEVA (no modifica la anterior) y los
 * `events`: lo que haría el sistema real, explicado.
 */

export const MAX_MOMENTS = 12;
export const SCALE_MAX = 20;
export const isGraded = (m) => m.status === 'passed' || m.status === 'failed';
const fmt = (n) => Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const names = (list) => (list.length === 1 ? list[0].name : `${list.slice(0, -1).map((m) => m.name).join(', ')} y ${list[list.length - 1].name}`);

/** Pendencia recién abierta al promover: sin plan todavía. */
export function openCarryover(passingGrade) {
  return { status: 'pending', final_grade: null, passing_grade: Number(passingGrade), moments: [] };
}

/**
 * Plan especial (savePlan): `pending` son los momentos AÚN SIN CALIFICAR, en orden.
 * Los calificados se conservan; el primero nuevo queda habilitado y los demás, bloqueados.
 */
export function savePlan(c, pending) {
  const graded = c.moments.filter(isGraded);
  if (graded.length + pending.length < 1) throw new Error('Define al menos un momento.');
  if (graded.length + pending.length > MAX_MOMENTS) throw new Error(`Máximo ${MAX_MOMENTS} momentos por materia.`);
  if (!['pending', 'in_progress', 'failed'].includes(c.status)) throw new Error('Esta materia pendiente ya está cerrada: su plan no se puede cambiar.');
  if (pending.some((m) => m.passingGrade !== null && m.passingGrade !== undefined && m.passingGrade < c.passing_grade)) throw new Error(`No puede ser menor que la nota mínima del año (${c.passing_grade}).`);
  const moments = [
    ...graded,
    ...pending.map((m, i) => ({ position: graded.length + i + 1, name: m.name, description: m.description || null, passing_grade: Number(m.passingGrade ?? c.passing_grade), status: i === 0 ? 'open' : 'locked', grade: null })),
  ];
  const events = [];
  if (!pending.length) {
    const last = graded[graded.length - 1];
    events.push({ kind: 'fail', text: `Sin más momentos: la materia queda no aprobada con ${fmt(last.grade)}.` });
    return { next: { ...c, moments, status: 'failed', final_grade: last.grade }, events };
  }
  if (c.status === 'failed') events.push({ kind: 'info', text: `La dirección agregó ${names(moments.slice(graded.length))} al plan: la materia vuelve a estar en recuperación.` });
  else events.push({ kind: 'info', text: `Plan especial con ${moments.length} momento${moments.length === 1 ? '' : 's'}. Se habilita ${moments[graded.length].name}; los demás esperan su turno.` });
  return { next: { ...c, moments, status: 'in_progress', final_grade: null }, events };
}

/**
 * Califica (gradeMoment): el momento habilitado o, para corregir, el último calificado.
 * → { next, events }
 */
export function gradeMoment(c, position, grade, { studentName = 'El alumno', subjectName = 'la materia' } = {}) {
  const value = Number(grade);
  if (!Number.isFinite(value) || value < 0 || value > SCALE_MAX) throw new Error(`Entre 0 y ${SCALE_MAX}.`);
  if (!['pending', 'in_progress', 'passed', 'failed'].includes(c.status)) throw new Error('Esta materia pendiente no se puede calificar.');
  const target = c.moments.find((m) => m.position === position);
  const lastGraded = [...c.moments].reverse().find(isGraded);
  const correcting = isGraded(target);
  if (correcting && lastGraded.position !== target.position) throw new Error('Solo se puede corregir el último momento calificado.');
  if (!correcting && target.status !== 'open') throw new Error('Este momento aún no está habilitado: el alumno debe presentar antes el anterior.');

  const passed = value >= target.passing_grade;
  const later = c.moments.filter((m) => m.position > position);
  const events = [];
  if (correcting) events.push({ kind: 'info', text: `Corrección: ${target.name} tenía ${fmt(target.grade)}. La nota anterior queda en el historial y lo que seguía se recalcula.` });
  events.push({ kind: passed ? 'pass' : 'fail', text: `${target.name}: ${fmt(value)} — ${passed ? 'aprobado' : 'reprobado'} (este momento se aprueba con ${fmt(target.passing_grade)}).` });

  let moments = c.moments.map((m) => {
    if (m.position === position) return { ...m, status: passed ? 'passed' : 'failed', grade: value };
    if (correcting && m.position > position) return { ...m, status: 'locked' };
    return m;
  });
  let next;
  let notice;
  if (passed) {
    moments = moments.map((m) => (m.position > position ? { ...m, status: 'not_needed' } : m));
    if (later.length) events.push({ kind: 'skip', text: `${names(later)}: ya no ${later.length === 1 ? 'hace' : 'hacen'} falta.` });
    events.push({ kind: 'pass', text: `La materia queda liberada con ${fmt(value)}. El arrastre se cierra y ${studentName} ya no la debe.` });
    next = { ...c, moments, status: 'passed', final_grade: value };
    notice = ['Materia pendiente aprobada', `${studentName} aprobó ${subjectName} en ${target.name}: la materia queda liberada.`];
  } else if (later.length) {
    moments = moments.map((m) => (m.position === later[0].position ? { ...m, status: 'open' } : m));
    events.push({ kind: 'open', text: `Se habilita ${later[0].name}${later.length > 1 ? `; ${names(later.slice(1))} sigue${later.length > 2 ? 'n' : ''} bloqueado${later.length > 2 ? 's' : ''}` : ''}.` });
    next = { ...c, moments, status: 'in_progress', final_grade: null };
    notice = ['Materia pendiente: siguiente momento', `${studentName} no aprobó ${subjectName} en ${target.name}. Se habilitó ${later[0].name}.`];
  } else {
    events.push({ kind: 'fail', text: `Era el último momento del plan: la materia queda no aprobada. La dirección o la coordinación pueden agregar momentos.` });
    next = { ...c, moments, status: 'failed', final_grade: value };
    notice = ['Materia pendiente no aprobada', `${studentName} completó los momentos de ${subjectName} sin aprobarla. El colegio indicará cómo continuar.`];
  }
  events.push({ kind: 'notify', text: `Aviso a la familia — «${correcting ? `${notice[0]} (nota corregida)` : notice[0]}»: ${notice[1]}` });
  return { next, events };
}
