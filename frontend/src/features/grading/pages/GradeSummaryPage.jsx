import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import gradingApi from '../../../api/endpoints/grading.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import ExportButton from '../../../components/ui/ExportButton';
import { LevelBadge, LevelFilter } from '../../academics/levels';
import { isQualitative, literalFor } from '../gradingScale';
import LiteralBadge from '../components/LiteralBadge';
import OfficialReportCard from '../components/OfficialReportCard';

const VIEW_KEY = 'gradeSummary.view';
const fullName = (s) => `${s.first_name} ${s.last_name}`;
const sectionOf = (s) => (s.section_id ? `${s.grade_name} · Sección ${s.section_name}` : null);
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = (s) => [fullName(s), s.national_id, s.grade_name, s.section_name].join(' ');
/** 16.3 → "16,3" */
const fmt = (n, digits = 1) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: digits }));
const shortTerm = (t) => (t.term_number ? `Lapso ${['I', 'II', 'III', 'IV'][t.term_number - 1] || t.term_number}` : t.name);

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

/**
 * Lo acumulado en un lapso (de una materia o el promedio del alumno):
 * "12,4 /20" + "Prom. 17,7 · 70% evaluado". Rojo si el rendimiento no alcanza la
 * nota mínima. En escala cualitativa, el literal del rendimiento.
 */
function TermValue({ cell, scale, passing, qualitative, compact = false }) {
  if (!cell || cell.accumulated === null) {
    return <span className="text-muted gsum-none">{cell ? 'Sin notas' : '—'}</span>;
  }
  if (qualitative) {
    return (
      <span className="gsum-value">
        <LiteralBadge level={literalFor(cell.average)} showLabel={!compact} />
        {!compact && <span className="cell-person__sub">{fmt(cell.evaluated, 0)}% evaluado</span>}
      </span>
    );
  }
  const tone = cell.average !== null && cell.average < passing ? 'grade--fail' : 'grade--pass';
  return (
    <span className="gsum-value">
      <span className={tone}>
        <strong className="gsum-value__num">{fmt(cell.final ?? cell.accumulated)}</strong>
        <span className="gsum-value__scale">/{scale}</span>
        {cell.final !== null && cell.final !== undefined && <span className="gsum-value__def">Def.</span>}
      </span>
      {!compact && (
        <span className="cell-person__sub">
          Prom. {fmt(cell.average)} · {fmt(cell.evaluated, 0)}% evaluado
        </span>
      )}
    </span>
  );
}

/** Boleta del alumno: una fila por materia y una columna por lapso, con el promedio de cada lapso al pie. */
function ReportCard({ student, terms, scale, passing }) {
  const qualitative = isQualitative(student.grading_scale);
  if (!student.section_id) return <p className="text-muted text-sm">El alumno no está inscrito en ninguna sección de este año escolar.</p>;
  if (!student.subjects.length) return <p className="text-muted text-sm">Aún no hay planes de evaluación con actividades para su sección.</p>;
  return (
    <div className="table-wrap table-wrap--stack">
      <table className="table table--stack gsum-report">
        <thead>
          <tr>
            <th>Materia</th>
            {terms.map((t) => (
              <th key={t.id}>{t.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {student.subjects.map((sub) => (
            <tr key={sub.key}>
              <td data-label="Materia" className="cell-person__name">
                {sub.name}
              </td>
              {terms.map((t) => (
                <td key={t.id} data-label={t.name}>
                  <TermValue cell={sub.terms[t.id] || null} scale={scale} passing={passing} qualitative={qualitative} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="gsum-report__total">
            <td data-label="Resumen">Promedio del lapso</td>
            {terms.map((t) => (
              <td key={t.id} data-label={t.name}>
                <TermValue cell={student.terms[t.id]} scale={scale} passing={passing} qualitative={qualitative} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Tarjeta colapsable de un alumno: cabecera con el acumulado por lapso; al abrir, su boleta. */
function StudentCard({ student, terms, scale, passing, open, onToggle, onPrint }) {
  const qualitative = isQualitative(student.grading_scale);
  return (
    <section className={`gsum-card ${open ? 'is-open' : ''}`}>
      <button type="button" className="gsum-card__head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevronDown" size={16} className="gsum-card__chevron" />
        <span className="gsum-card__who">
          <span className="cell-person__name">{fullName(student)}</span>
          <span className="cell-person__sub">
            {sectionOf(student) || 'Sin inscripción en el año'}
            {student.national_id ? ` · ${student.national_id}` : ''}
          </span>
        </span>
        {student.level_code && <LevelBadge code={student.level_code} />}
        <span className="gsum-card__terms">
          {terms.map((t) => (
            <span key={t.id} className="gsum-chip" title={t.name}>
              <span className="gsum-chip__term">{shortTerm(t)}</span>
              <TermValue cell={student.terms[t.id]} scale={scale} passing={passing} qualitative={qualitative} compact />
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="gsum-card__body">
          <ReportCard student={student} terms={terms} scale={scale} passing={passing} />
          <div className="gsum-card__foot">
            <Link to={`/students/${student.id}`} className="btn btn--ghost btn--sm">
              Ver ficha del alumno <Icon name="arrowRight" size={14} />
            </Link>
            <Button size="sm" variant="secondary" icon="file" onClick={() => onPrint(student)}>
              Imprimir boleta
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Resumen de calificaciones (Administración): todos los alumnos activos con lo
 * acumulado en cada lapso del año escolar. Dos vistas: tabla (con "Ver
 * calificaciones" → boleta) y tarjetas colapsables por alumno.
 */
function GradeSummaryPage() {
  const [periodId, setPeriodId] = useState('');
  const { data, loading, error } = useFetch(() => gradingApi.getSummary(periodId), [periodId]);
  const [view, setView] = useState(readView);
  const [level, setLevel] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [section, setSection] = useState('');
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState(null);
  const [printing, setPrinting] = useState(null); // alumno cuya boleta oficial está abierta
  const closePrint = useCallback(() => setPrinting(null), []);
  const [openIds, setOpenIds] = useState(() => new Set());

  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // preferencia no persistente
    }
  };

  const terms = data?.terms || [];
  const scale = data?.scale || 20;
  const passing = data?.passing_grade ?? 10;
  const all = useMemo(() => data?.students || [], [data]);

  const matches = (s, skip) =>
    (skip === 'level' || !level || s.level_code === level) && (!gradeId || s.grade_id === gradeId) && (!section || s.section_name === section);
  const forLevel = all.filter((s) => matches(s, 'level'));
  const levelCounts = forLevel.reduce((acc, s) => (s.level_code ? { ...acc, [s.level_code]: (acc[s.level_code] || 0) + 1 } : acc), {});
  const visible = all.filter((s) => matches(s));
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? visible.filter((s) => normalize(searchText(s)).includes(q)) : visible;
  }, [visible, query]);

  const gradeOptions = useMemo(() => {
    const map = new Map();
    all
      .filter((s) => s.grade_id && (!level || s.level_code === level))
      .forEach((s) => map.set(s.grade_id, { id: s.grade_id, name: s.grade_name, order: `${s.level_sort}-${String(s.grade_sort).padStart(3, '0')}` }));
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order, 'es', { numeric: true }));
  }, [all, level]);
  const sectionOptions = useMemo(
    () => [...new Set(all.filter((s) => s.section_name && (!gradeId || s.grade_id === gradeId) && (!level || s.level_code === level)).map((s) => s.section_name))].sort(),
    [all, gradeId, level]
  );
  const anyFilter = Boolean(level || gradeId || section);

  const termColumns = terms.map((t) => ({
    key: `term-${t.id}`,
    header: t.name,
    render: (s) => <TermValue cell={s.terms[t.id]} scale={scale} passing={passing} qualitative={isQualitative(s.grading_scale)} />,
    sortValue: (s) => s.terms[t.id]?.accumulated ?? null,
  }));
  const columns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (s) => (
        <div>
          <Link to={`/students/${s.id}`} className="cell-person__name">
            {fullName(s)}
          </Link>
          {s.national_id && <div className="cell-person__sub">{s.national_id}</div>}
        </div>
      ),
      sortValue: (s) => `${s.last_name} ${s.first_name}`,
    },
    {
      key: 'section',
      header: 'Grado y sección',
      render: (s) => (s.section_id ? sectionOf(s) : <span className="text-muted">Sin inscripción</span>),
      sortValue: (s) => (s.section_id ? `${s.level_sort}-${String(s.grade_sort).padStart(3, '0')}-${s.section_name}` : '~'),
    },
    ...termColumns,
    {
      key: 'overall',
      header: 'Promedio',
      align: 'right',
      render: (s) =>
        s.overall === null ? (
          <span className="text-muted">—</span>
        ) : isQualitative(s.grading_scale) ? (
          <LiteralBadge level={literalFor(s.overall)} />
        ) : (
          <strong className={s.overall < passing ? 'grade--fail' : 'grade--pass'}>{fmt(s.overall)}</strong>
        ),
      sortValue: (s) => s.overall,
    },
  ];

  const exportColumns = [
    { header: 'Alumno', value: fullName, width: 28 },
    { header: 'Cédula', value: (s) => s.national_id ?? '', width: 14 },
    { header: 'Grado', value: (s) => s.grade_name ?? '', width: 14 },
    { header: 'Sección', value: (s) => s.section_name ?? '', width: 10 },
    ...terms.flatMap((t) => [
      { header: `${t.name} · acumulado`, value: (s) => s.terms[t.id]?.accumulated ?? '', width: 16 },
      { header: `${t.name} · promedio`, value: (s) => s.terms[t.id]?.average ?? '', width: 16 },
      { header: `${t.name} · % evaluado`, value: (s) => s.terms[t.id]?.evaluated ?? '', width: 16 },
    ]),
    { header: 'Promedio de lo evaluado', value: (s) => s.overall ?? '', width: 18 },
  ];

  const filters = (
    <div className="filter-bar">
      <LevelFilter value={level} onChange={setLevel} counts={levelCounts} total={forLevel.length} />
    </div>
  );
  const selects = (
    <div className="filter-bar__selects">
      <Select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSection(''); }} aria-label="Filtrar por grado" disabled={!gradeOptions.length}>
        <option value="">Todos los grados</option>
        {gradeOptions.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filtrar por sección" disabled={!sectionOptions.length}>
        <option value="">Todas las secciones</option>
        {sectionOptions.map((n) => (
          <option key={n} value={n}>
            Sección {n}
          </option>
        ))}
      </Select>
      {anyFilter && (
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          onClick={() => {
            setLevel('');
            setGradeId('');
            setSection('');
          }}
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );

  const viewToggle = (
    <div className="gsum-header-actions">
      {(data?.periods || []).length > 1 && (
        <Select value={periodId || data?.school_period?.id || ''} onChange={(e) => setPeriodId(e.target.value)} aria-label="Año escolar">
          {data.periods.map((p) => (
            <option key={p.id} value={p.id}>
              Año escolar {p.name}
              {p.closed_at ? ' (finalizado)' : ''}
            </option>
          ))}
        </Select>
      )}
      <div className="segmented" role="radiogroup" aria-label="Vista">
        {[
          ['table', 'Tabla', 'menu'],
          ['cards', 'Por alumno', 'layers'],
        ].map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={view === key}
            className={`segmented__item ${view === key ? 'segmented__item--active' : ''}`}
            onClick={() => changeView(key)}
          >
            <Icon name={icon} size={15} /> {label}
          </button>
        ))}
      </div>
    </div>
  );

  const note = data?.school_period
    ? `Año escolar ${data.school_period.name} · Escala de 0 a ${scale}, se aprueba con ${passing}. Acumulado = puntos ganados hasta hoy; Prom. = rendimiento en lo ya evaluado.`
    : null;

  const toggle = (id) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <PageHeader title="Resumen de calificaciones" subtitle="Lo que lleva acumulado cada alumno en cada lapso, con su boleta por materia." actions={viewToggle} />

      {!loading && data && !data.school_period ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="calendar" size={24} />
          </div>
          <div className="empty-state__title">Aún no hay años escolares</div>
          <div className="text-sm">Crea el año escolar y sus secciones en Grados y secciones.</div>
        </div>
      ) : view === 'table' ? (
        <DataTable
          title="Calificaciones por alumno"
          description={note}
          columns={columns}
          rows={visible}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar por nombre, cédula, grado o sección…"
          getSearchText={searchText}
          filters={filters}
          searchAddons={selects}
          emptyMessage={anyFilter ? 'Ningún alumno con esos filtros.' : 'Aún no hay alumnos activos.'}
          canCreate={false}
          headerActions={<ExportButton filename={`resumen-calificaciones-${data?.school_period?.name || ''}`} columns={exportColumns} rows={visible} />}
          rowActions={[
            { key: 'grades', icon: 'eye', label: 'Ver calificaciones', tone: 'view', onClick: setViewing },
            { key: 'print', icon: 'file', label: 'Imprimir boleta oficial', onClick: setPrinting },
          ]}
          pageSize={25}
        />
      ) : (
        <>
          <div className="card data-table student-groups__toolbar">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  Calificaciones por alumno
                  {!loading && data && <span className="data-table__count">{filtered.length}</span>}
                </h3>
                {note && <p className="card__subtitle">{note}</p>}
              </div>
              <div className="data-table__header-actions">
                <Button variant="ghost" size="sm" icon="chevronDown" onClick={() => setOpenIds(new Set(filtered.map((s) => s.id)))} disabled={!filtered.length}>
                  Expandir todo
                </Button>
                <Button variant="ghost" size="sm" icon="chevronRight" onClick={() => setOpenIds(new Set())} disabled={!openIds.size}>
                  Contraer todo
                </Button>
              </div>
            </div>
            <div className="data-table__toolbar data-table__toolbar--stacked">
              <div className="data-table__search-row">
                <div className="input-group data-table__search">
                  <Icon name="search" size={17} className="input-group__icon" />
                  <input
                    type="search"
                    className="input"
                    placeholder="Buscar por nombre, cédula, grado o sección…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar alumnos"
                  />
                </div>
                <div className="data-table__search-addons">{selects}</div>
              </div>
              <div className="data-table__filters">{filters}</div>
            </div>
            <Alert>{error}</Alert>
          </div>
          {loading ? (
            <Spinner />
          ) : filtered.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state__icon">
                <Icon name={query ? 'search' : 'users'} size={24} />
              </div>
              <div className="empty-state__title">{query || anyFilter ? 'Sin resultados' : 'Aún no hay alumnos activos.'}</div>
            </div>
          ) : (
            <div className="gsum-list">
              {filtered.map((s) => (
                <StudentCard
                  key={s.id}
                  student={s}
                  terms={terms}
                  scale={scale}
                  passing={passing}
                  open={openIds.has(s.id)}
                  onToggle={() => toggle(s.id)}
                  onPrint={setPrinting}
                />
              ))}
            </div>
          )}
        </>
      )}

      {viewing && (
        <Modal title={`Calificaciones · ${fullName(viewing)}`} onClose={() => setViewing(null)} size="lg">
          <p className="text-sm text-muted" style={{ marginTop: -6 }}>
            {sectionOf(viewing) || 'Sin inscripción en el año'} · Año escolar {data?.school_period?.name}
          </p>
          <ReportCard student={viewing} terms={terms} scale={scale} passing={passing} />
          <div className="form-actions">
            <Link to={`/students/${viewing.id}`} className="btn btn--secondary">
              Ver ficha del alumno
            </Link>
            <Button variant="secondary" onClick={() => setViewing(null)}>
              Cerrar
            </Button>
            <Button
              icon="file"
              onClick={() => {
                setPrinting(viewing);
                setViewing(null);
              }}
            >
              Imprimir boleta
            </Button>
          </div>
        </Modal>
      )}

      {printing && (
        <OfficialReportCard
          student={printing}
          terms={terms}
          schoolPeriod={data?.school_period}
          scale={scale}
          passing={passing}
          onClose={closePrint}
        />
      )}
    </div>
  );
}

export default GradeSummaryPage;
