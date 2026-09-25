import DataTable from './DataTable';

/**
 * Tabla simple para listas dentro de otra tarjeta (sin encabezado ni botón
 * "Nuevo"). Es un `DataTable` en modo `bare`: conserva búsqueda (visible con
 * más de 5 filas), orden, paginación y la vista de tarjetas en móvil.
 * Para módulos con CRUD completo usar `DataTable` directamente.
 *
 * `columns = [{ key, header, render?, align? }]`, `rows = [...]`.
 */
function Table({ searchThreshold = 5, ...props }) {
  return <DataTable bare searchThreshold={searchThreshold} {...props} />;
}

export default Table;
