/**
 * Orden alfabético único de la aplicación para listas y selectores:
 * español, sin distinguir mayúsculas ni tildes ("Álvarez" junto a "Alvarez") y
 * con números naturales ("2do año" antes que "10mo año").
 */
export const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export const compareText = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));

/** Copia ordenada de `list` por el texto que muestra cada elemento. */
export function sortByLabel(list, getLabel = (x) => x.name) {
  return [...(list || [])].sort((a, b) => compareText(getLabel(a), getLabel(b)));
}
