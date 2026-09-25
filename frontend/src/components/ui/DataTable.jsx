import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Button from './Button';
import Spinner from './Spinner';
import Alert from './Alert';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { getErrorMessage } from '../../api/axiosClient';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/** Minúsculas y sin acentos, para que "perez" encuentre "Pérez". */
function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Texto de búsqueda por defecto: todos los valores primitivos de la fila (y de objetos anidados de un nivel). */
function defaultSearchText(row) {
  return Object.values(row)
    .flatMap((v) => (v && typeof v === 'object' ? Object.values(v) : [v]))
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ');
}

/** Números de página a mostrar, con "…" cuando hay muchas: 1 … 4 5 6 … 12 */
function pageList(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [...new Set([1, total, page - 1, page, page + 1])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1] > 1 ? ['…', p] : [p]));
}

/** `true` | `false` | `(row) => boolean` → boolean */
const allowed = (rule, row) => (typeof rule === 'function' ? rule(row) : rule !== false);

/**
 * Tabla de datos con búsqueda en tiempo real, orden por columna, paginación,
 * botón "Nuevo" y columna de acciones Ver / Editar / Eliminar.
 *
 *   <DataTable
 *     title="Personal" description="Administrativo, docente y obrero"
 *     columns={[{ key: 'name', header: 'Nombre', render: (r) => ..., sortValue: (r) => r.last_name }]}
 *     rows={rows} loading={loading} error={error}
 *     createLabel="Nuevo personal" onCreate={() => ...} canCreate={can('staff', 'create')}
 *     onView={(r) => ...} onEdit={(r) => ...} canEdit={can('staff', 'update')}
 *     onDelete={(r) => staffApi.remove(r.id)} canDelete={can('staff', 'delete')}
 *     deleteConfirm={(r) => ({ title: `¿Eliminar a ${r.first_name}?` })}
 *     onDeleted={refetch}
 *   />
 *
 * Columnas: `{ key, header, render?, align?, sortable?, sortValue? }`. Son
 * ordenables por defecto si `render` no está definido o si traen `sortValue`.
 *
 * Acciones: cada botón aparece solo si se pasa su handler (`onView`, `onEdit`,
 * `onDelete`) y el permiso correspondiente (`canView`/`canEdit`/`canDelete`,
 * booleano o función por fila) no es `false`. `onDelete` debe devolver una
 * promesa: la tabla pide confirmación, muestra el estado de carga en la fila y
 * notifica el éxito o el error del backend con un toast.
 *
 * `bare` omite la tarjeta contenedora (para usarla dentro de otra tarjeta).
 */
function DataTable({
  columns,
  rows,
  rowKey = 'id',
  loading = false,
  error = null,
  title,
  description,
  bare = false,
  // Búsqueda
  searchable = true,
  searchThreshold = 0,
  searchPlaceholder = 'Buscar…',
  getSearchText = defaultSearchText,
  filters = null,
  // Paginación
  pageSize: initialPageSize = 10,
  // Crear
  createLabel = 'Nuevo registro',
  onCreate,
  canCreate = true,
  // Acciones por fila
  onView,
  onEdit,
  onDelete,
  canView = true,
  canEdit = true,
  canDelete = true,
  deleteConfirm,
  onDeleted,
  deleteSuccessMessage = 'Registro eliminado',
  // Otros
  emptyMessage = 'No hay registros todavía.',
  stackOnMobile = true,
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [sort, setSort] = useState(null); // { key, dir: 'asc' | 'desc' }
  const [deletingKey, setDeletingKey] = useState(null);

  const allRows = useMemo(() => rows || [], [rows]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    let result = q ? allRows.filter((row) => normalize(getSearchText(row)).includes(q)) : allRows;

    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const valueOf = col?.sortValue || ((r) => r[sort.key]);
      result = [...result].sort((a, b) => {
        const va = valueOf(a);
        const vb = valueOf(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1; // vacíos siempre al final
        if (vb == null) return -1;
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [allRows, query, sort, columns, getSearchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  useEffect(() => setPage(1), [query, pageSize, sort]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const showCreate = Boolean(onCreate) && canCreate;
  const showSearch = searchable && allRows.length > searchThreshold;
  const hasActions = Boolean(onView || onEdit || onDelete);

  const handleDelete = async (row) => {
    const texts = deleteConfirm?.(row) || {};
    const ok = await confirm({
      title: texts.title || '¿Eliminar este registro?',
      message: texts.message || 'Esta acción no se puede deshacer.',
      confirmLabel: texts.confirmLabel || 'Eliminar',
      danger: true,
    });
    if (!ok) return;

    setDeletingKey(row[rowKey]);
    try {
      await onDelete(row);
      toast.success(texts.successMessage || deleteSuccessMessage);
      onDeleted?.(row);
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    } finally {
      setDeletingKey(null);
    }
  };

  const toggleSort = (col) => {
    setSort((s) => {
      if (!s || s.key !== col.key) return { key: col.key, dir: 'asc' };
      if (s.dir === 'asc') return { key: col.key, dir: 'desc' };
      return null; // tercer click: vuelve al orden original
    });
  };

  const isSortable = (col) => col.sortable ?? (!col.render || Boolean(col.sortValue));

  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const from = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, filtered.length);

  // ---------- Render ----------

  const header = (title || description || showCreate) && (
    <div className="data-table__header">
      <div>
        {title && (
          <h3 className="card__title">
            {title}
            {!loading && rows && <span className="data-table__count">{allRows.length}</span>}
          </h3>
        )}
        {description && <p className="card__subtitle">{description}</p>}
      </div>
      {showCreate && (
        <Button icon="plus" onClick={onCreate} className="data-table__create">
          {createLabel}
        </Button>
      )}
    </div>
  );

  const toolbar = (showSearch || filters) && (
    <div className="data-table__toolbar">
      {showSearch && (
        <div className="input-group data-table__search">
          <Icon name="search" size={17} className="input-group__icon" />
          <input
            type="search"
            className="input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar en la tabla"
          />
          {query && (
            <button type="button" className="data-table__clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
              <Icon name="x" size={15} />
            </button>
          )}
        </div>
      )}
      {filters && <div className="data-table__filters">{filters}</div>}
    </div>
  );

  let body;
  if (loading) {
    body = <Spinner />;
  } else if (allRows.length === 0) {
    body = (
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="inbox" size={24} />
        </div>
        <div className="empty-state__title">Sin registros</div>
        <div className="text-sm">{emptyMessage}</div>
        {showCreate && (
          <Button icon="plus" size="sm" onClick={onCreate} style={{ marginTop: 14 }}>
            {createLabel}
          </Button>
        )}
      </div>
    );
  } else if (filtered.length === 0) {
    body = (
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="search" size={22} />
        </div>
        <div className="empty-state__title">Sin resultados</div>
        <div className="text-sm">No hay registros que coincidan con “{query}”.</div>
        <Button variant="secondary" size="sm" onClick={() => setQuery('')} style={{ marginTop: 14 }}>
          Limpiar búsqueda
        </Button>
      </div>
    );
  } else {
    body = (
      <div className={`table-wrap ${stackOnMobile ? 'table-wrap--stack' : ''}`}>
        <table className={`table ${stackOnMobile ? 'table--stack' : ''}`}>
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = isSortable(col);
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {sortable ? (
                      <button type="button" className={`th-sort ${active ? 'th-sort--active' : ''}`} onClick={() => toggleSort(col)}>
                        {col.header}
                        <Icon
                          name="chevronDown"
                          size={13}
                          className={`th-sort__icon ${active && sort.dir === 'asc' ? 'th-sort__icon--asc' : ''}`}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {hasActions && (
                <th style={{ textAlign: 'right' }} className="data-table__actions-th">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = row[rowKey];
              const deleting = deletingKey === key;
              return (
                <tr key={key} className={deleting ? 'is-busy' : undefined}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      data-label={typeof col.header === 'string' ? col.header : ''}
                      style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                    >
                      {col.render ? col.render(row) : row[col.key] ?? '—'}
                    </td>
                  ))}
                  {hasActions && (
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <div className="row-actions">
                        {onView && allowed(canView, row) && (
                          <button type="button" className="row-action row-action--view" onClick={() => onView(row)} title="Ver detalle" aria-label="Ver detalle">
                            <Icon name="eye" size={16} />
                          </button>
                        )}
                        {onEdit && allowed(canEdit, row) && (
                          <button type="button" className="row-action row-action--edit" onClick={() => onEdit(row)} title="Editar" aria-label="Editar">
                            <Icon name="pencil" size={15} />
                          </button>
                        )}
                        {onDelete && allowed(canDelete, row) && (
                          <button
                            type="button"
                            className="row-action row-action--delete"
                            onClick={() => handleDelete(row)}
                            disabled={deleting}
                            title="Eliminar"
                            aria-label="Eliminar"
                          >
                            {deleting ? <span className="btn__spinner" /> : <Icon name="trash" size={15} />}
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // Con pocos registros (caben en la página más chica) el pie solo agrega ruido.
  const footer = !loading && filtered.length > 0 && allRows.length > Math.min(initialPageSize, PAGE_SIZE_OPTIONS[0]) && (
    <nav className="pagination" aria-label="Paginación">
      <div className="pagination__info">
        <span>
          Mostrando <strong>{from}–{to}</strong> de <strong>{filtered.length}</strong>
          {query && ` (filtrado de ${allRows.length})`}
        </span>
        <label className="pagination__size">
          Filas
          <select className="input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[...new Set([initialPageSize, ...PAGE_SIZE_OPTIONS])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {totalPages > 1 && (
        <div className="pagination__pages">
          <button type="button" className="pagination__btn" onClick={() => setPage((p) => p - 1)} disabled={page === 1} aria-label="Página anterior">
            <Icon name="chevronLeft" size={16} />
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="pagination__gap">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`pagination__btn ${p === page ? 'pagination__btn--active' : ''}`}
                onClick={() => setPage(p)}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            )
          )}
          <button type="button" className="pagination__btn" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages} aria-label="Página siguiente">
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}
    </nav>
  );

  const content = (
    <>
      {header}
      <Alert>{error}</Alert>
      {toolbar}
      {body}
      {footer}
    </>
  );

  return bare ? <div className="data-table">{content}</div> : <div className="card data-table">{content}</div>;
}

export default DataTable;
