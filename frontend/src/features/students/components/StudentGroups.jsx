import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../../../components/ui/DataTable';
import Icon from '../../../components/ui/Icon';
import { LEVELS, LevelBadge } from '../../academics/levels';

const STORAGE_KEY = 'students.collapsedGroups';
const NO_SECTION = 'none';

function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveCollapsed(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // sin almacenamiento: el estado solo dura mientras la página está abierta
  }
}

const byText = (a, b) => (a || '').localeCompare(b || '', 'es', { numeric: true });

/** "A" → "Sección A"; si el nombre ya dice "Sección…", se deja igual. */
export const sectionLabel = (name) => (/^secci[oó]n/i.test(name) ? name : `Sección ${name}`);

/**
 * Agrupa alumnos por su inscripción vigente (grado + sección) en el orden
 * académico: nivel → grado → sección. Los que no tienen inscripción activa
 * van en un grupo aparte al final.
 */
export function groupStudents(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.section_id || NO_SECTION;
    if (!map.has(key)) {
      map.set(key, {
        key,
        sectionId: r.section_id,
        sectionName: r.section_name,
        gradeName: r.grade_name,
        levelCode: r.level_code,
        levelSort: r.level_sort ?? 99,
        gradeSort: r.grade_sort ?? 0,
        periodName: r.school_period_name,
        maxStudents: r.max_students,
        students: [],
      });
    }
    map.get(key).students.push(r);
  });
  return [...map.values()].sort(
    (a, b) =>
      (a.key === NO_SECTION) - (b.key === NO_SECTION) ||
      a.levelSort - b.levelSort ||
      a.gradeSort - b.gradeSort ||
      byText(a.gradeName, b.gradeName) ||
      byText(a.sectionName, b.sectionName)
  );
}

/**
 * Vista de la matrícula agrupada por grado y sección, con grupos colapsables.
 * Los grupos colapsados se recuerdan en el navegador; mientras hay una
 * búsqueda activa se muestran todos abiertos para no esconder resultados.
 */
function StudentGroups({ rows, columns, searching, showCapacity, onView, onEdit, canEdit, collapseSignal }) {
  const groups = useMemo(() => groupStudents(rows), [rows]);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // "Expandir todo" / "Contraer todo" desde la barra: { action, nonce }.
  const [lastSignal, setLastSignal] = useState(collapseSignal);
  if (collapseSignal !== lastSignal) {
    setLastSignal(collapseSignal);
    const next = collapseSignal?.action === 'collapse' ? new Set(groups.map((g) => g.key)) : new Set();
    setCollapsed(next);
    saveCollapsed(next);
  }

  const toggle = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsed(next);
      return next;
    });
  };

  let currentLevel = null;
  return (
    <div className="student-groups">
      {groups.map((g) => {
        const open = searching || !collapsed.has(g.key);
        const bodyId = `student-group-${g.key}`;
        const count = g.students.length;
        const isNone = g.key === NO_SECTION;
        // Separador de nivel (Inicial / Primaria / Secundaria / Sin inscripción) al cambiar.
        const levelKey = isNone ? NO_SECTION : g.levelCode;
        const heading = levelKey !== currentLevel ? (isNone ? 'Sin inscripción vigente' : LEVELS[g.levelCode]?.name) : null;
        currentLevel = levelKey;
        const full = showCapacity && g.maxStudents && count >= g.maxStudents;

        return (
          <div key={g.key}>
            {heading && <h3 className="student-groups__level">{heading}</h3>}
            <section className={`student-group ${open ? 'is-open' : ''} ${isNone ? 'student-group--none' : ''}`}>
              <div className="student-group__header">
                <button type="button" className="student-group__toggle" onClick={() => toggle(g.key)} aria-expanded={open} aria-controls={bodyId} disabled={searching}>
                  <Icon name="chevronDown" size={18} className="student-group__chevron" />
                  <span className="student-group__title">
                    {isNone ? (
                      'Sin sección asignada'
                    ) : (
                      <>
                        {g.gradeName} <span className="student-group__sep">·</span> {sectionLabel(g.sectionName)}
                      </>
                    )}
                  </span>
                  {!isNone && <LevelBadge code={g.levelCode} />}
                  <span className="student-group__meta">
                    {isNone ? 'Inscríbelos desde el detalle de una sección' : `Año escolar ${g.periodName}`}
                  </span>
                </button>

                <div className="student-group__side">
                  {showCapacity && g.maxStudents ? (
                    <span className={`student-group__capacity ${full ? 'is-full' : ''}`} title={`${count} de ${g.maxStudents} cupos ocupados`}>
                      <span className="progress-bar">
                        <span className="progress-bar__fill" style={{ width: `${Math.min(100, (count / g.maxStudents) * 100)}%` }} />
                      </span>
                      {count}/{g.maxStudents}
                    </span>
                  ) : null}
                  <span className="student-group__count">
                    {count} {count === 1 ? 'alumno' : 'alumnos'}
                  </span>
                  {!isNone && (
                    <Link to={`/academics/sections/${g.sectionId}`} className="student-group__link" title="Abrir la sección">
                      <Icon name="arrowRight" size={16} />
                      <span className="sr-only">Abrir la sección {g.gradeName} {g.sectionName}</span>
                    </Link>
                  )}
                </div>
              </div>

              {open && (
                <div id={bodyId} className="student-group__body">
                  <DataTable
                    bare
                    columns={columns}
                    rows={g.students}
                    searchable={false}
                    paginated={false}
                    onView={onView}
                    onEdit={onEdit}
                    canEdit={canEdit}
                    emptyMessage="Sin alumnos."
                  />
                </div>
              )}
            </section>
          </div>
        );
      })}
    </div>
  );
}

export default StudentGroups;
