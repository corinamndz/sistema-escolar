/**
 * Módulos que se pueden apagar temporalmente (p. ej. para una presentación) sin
 * borrar nada. Con `false`, el módulo desaparece del menú lateral, de los accesos
 * rápidos del inicio y del portal de las familias, y su dirección lleva al inicio.
 * Los datos y el servidor no cambian: al volver a `true`, todo reaparece igual.
 */
export const FEATURES = {
  // Materias pendientes (arrastres) y su simulador. Oculto para la presentación del 2026-11-10.
  carryovers: false,
};

/** ¿Está encendido el módulo? Un ítem sin `feature` siempre lo está. */
export const isFeatureOn = (key) => !key || FEATURES[key] !== false;
