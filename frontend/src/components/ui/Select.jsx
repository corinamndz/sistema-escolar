import { Children, Fragment, cloneElement, isValidElement } from 'react';
import { compareText } from '../../utils/sortOptions';

/** Texto visible de un nodo (para ordenar opciones cuyo contenido es JSX). */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
}

/** Aplana fragmentos y arrays de hijos (las opciones suelen venir de un .map()). */
function flatten(children) {
  const out = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Fragment) out.push(...flatten(child.props.children));
    else if (isValidElement(child)) out.push(child);
  });
  return out;
}

/** Opción "vacía" (Selecciona…, Sin titular, Todos los grados): queda fija arriba. */
const isPlaceholder = (el) => el.type === 'option' && (el.props.value === '' || el.props.value === undefined);

/**
 * Ordena alfabéticamente las <option> (y las de cada <optgroup>, manteniendo
 * el orden de los grupos). Las opciones vacías iniciales quedan primero.
 */
function sortChildren(children) {
  const items = flatten(children);
  const head = [];
  while (items.length && isPlaceholder(items[0])) head.push(items.shift());
  const sorted = items
    .map((el) =>
      el.type === 'optgroup'
        ? cloneElement(el, {}, [...flatten(el.props.children)].sort((a, b) => compareText(textOf(a), textOf(b))))
        : el
    )
    .sort((a, b) => (a.type === 'optgroup' || b.type === 'optgroup' ? 0 : compareText(textOf(a), textOf(b))));
  // Al devolverse como lista, cada hijo necesita key (las opciones fijas no suelen traerla).
  return [...head, ...sorted].map((el, i) => (el.key == null ? cloneElement(el, { key: `__opt-${i}` }) : el));
}

/**
 * Selector del sistema. `sorted`: ordena las opciones alfabéticamente (A→Z),
 * dejando fija arriba la opción vacía o "todos". Se usa en las listas de datos
 * (docentes, materias, grados, secciones, alumnos…); las listas con un orden
 * lógico propio (lapsos, estados, días) no lo llevan.
 */
function Select({ error, className = '', sorted = false, children, ...props }) {
  return (
    <select className={`input ${error ? 'input--error' : ''} ${className}`} {...props}>
      {sorted ? sortChildren(children) : children}
    </select>
  );
}

export default Select;
