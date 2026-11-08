/**
 * Puesto del alumno en su sección, como lo calcula el servidor
 * (gradeSummary.service → sectionRanks): { position, total, tied, provisional }.
 */

/** "3 de 28", o null si aún no tiene puesto. */
export const rankText = (rank) => (rank ? `${rank.position} de ${rank.total}` : null);

/** Aclaración del puesto: "empate", "provisional" o ambas. */
export const rankNote = (rank) => [rank?.tied && 'empate', rank?.provisional && 'provisional'].filter(Boolean).join(' · ');

export const anyProvisional = (ranks) => Boolean(ranks?.annual?.provisional || Object.values(ranks?.terms || {}).some((r) => r?.provisional));
export const anyRank = (ranks) => Boolean(ranks?.annual || Object.values(ranks?.terms || {}).some(Boolean));
