/**
 * Cómo se calcula el promedio anual de una materia según la normativa del año,
 * explicado para quien lee la boleta o el resumen. El cálculo está en el servidor
 * (grading/gradeAverages.js); aquí no se calcula ninguna nota.
 */
export function averageRuleText(rules) {
  if (!rules) return '';
  const n = rules.terms?.length || 0;
  if (!n) return '';
  const periods = `${n} período${n === 1 ? '' : 's'}`;
  const how =
    rules.effective_mode === 'weighted'
      ? `promedio ponderado de ${periods} (${rules.terms.map((t) => `${t.name}: ${Number(t.weight_percent).toLocaleString('es')} %`).join(', ')})`
      : `suma de las notas ÷ ${periods} del año`;
  const missing =
    rules.incomplete_average_policy === 'all_terms_closed'
      ? `Se emite cuando ${n === 1 ? 'el período tenga' : `los ${n} períodos tengan`} nota y ${n === 1 ? 'esté cerrado' : 'estén cerrados'}.`
      : 'Mientras falten períodos es provisional: se calcula solo con los que tienen nota, y un período sin evaluar no cuenta como 0.';
  const rounding = rules.grade_rounding === 'integer' ? ' Notas redondeadas al entero.' : '';
  return `Promedio de cada materia: ${how}. ${missing}${rounding}`;
}
