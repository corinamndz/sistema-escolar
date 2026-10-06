import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import DataTable from '../../../components/ui/DataTable';
import DetailModal from '../../../components/ui/DetailModal';
import Select from '../../../components/ui/Select';
import Badge from '../../../components/ui/Badge';
import { LEVELS, LevelBadge, LevelFilter, teacherName } from '../levels';

const ROLE_LABELS = { lead: 'Titular', assistant: 'Auxiliar' };

/** Texto corto de una asignación: "1er año A · Matemática" o "Sala 5 A · Titular". */
function assignmentLabel(a) {
  return `${a.grade_name} ${a.section_name} · ${a.type === 'subject' ? a.subject_name : ROLE_LABELS[a.role]}`;
}

/**
 * Vista por docente: todas sus asignaciones (en cualquier nivel, grado y
 * materia) y quién está libre. Es la vista para repartir la carga.
 */
function TeachingLoadTab() {
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const { data: teachers, loading, error } = useFetch(
    () => academicsApi.getTeachingLoad(schoolPeriodId ? { schoolPeriodId } : undefined),
    [schoolPeriodId]
  );
  const [level, setLevel] = useState('');
  const [viewing, setViewing] = useState(null);

  const rows = useMemo(
    () => (teachers || []).filter((t) => !level || t.levels.includes(level)),
    [teachers, level]
  );

  const columns = [
    {
      key: 'name',
      header: 'Docente',
      render: (t) => (
        <div className="cell-person">
          <span className="avatar avatar--sm">{`${t.first_name[0] || ''}${t.last_name[0] || ''}`.toUpperCase()}</span>
          <div>
            <div className="cell-person__name">{teacherName(t)}</div>
            {t.status !== 'active' && <div className="cell-person__sub">Inactivo</div>}
          </div>
        </div>
      ),
      sortValue: (t) => `${t.last_name} ${t.first_name}`,
    },
    {
      key: 'levels',
      header: 'Niveles',
      render: (t) =>
        t.levels.length ? (
          <div className="chip-list">
            {t.levels.map((code) => (
              <LevelBadge key={code} code={code} />
            ))}
          </div>
        ) : (
          <Badge variant="neutral">Disponible</Badge>
        ),
      sortValue: (t) => t.levels.length,
    },
    {
      key: 'assignments',
      header: 'Asignaciones',
      render: (t) =>
        t.assignments.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="chip-list">
            {t.assignments.slice(0, 3).map((a, i) => (
              <span key={i} className={`chip chip--${a.level_code}`}>
                {assignmentLabel(a)}
              </span>
            ))}
            {t.assignments.length > 3 && <span className="chip">+{t.assignments.length - 3} más</span>}
          </div>
        ),
      sortValue: (t) => t.assignments.length,
    },
    { key: 'sectionCount', header: 'Secciones', align: 'right' },
    { key: 'subjectCount', header: 'Materias', align: 'right' },
  ];

  return (
    <>
      <DataTable
        title="Carga docente"
        description="Un docente puede tener varias secciones, grados y materias. Aquí se ve todo lo que tiene asignado."
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar docente, grado o materia…"
        getSearchText={(t) => [teacherName(t), t.email, ...t.assignments.map(assignmentLabel)].join(' ')}
        filters={
          <>
            <LevelFilter value={level} onChange={setLevel} />
            <Select sorted value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)} aria-label="Año escolar">
              <option value="">Todos los años escolares</option>
              {(periods || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        }
        emptyMessage="No hay personal docente registrado. Regístralo en Personal con tipo “Docente”."
        onView={setViewing}
      />

      {viewing && (
        <DetailModal
          title={teacherName(viewing)}
          subtitle={`${viewing.sectionCount} sección(es) · ${viewing.subjectCount} materia(s)`}
          badge={viewing.levels.map((code) => (
            <LevelBadge key={code} code={code} />
          ))}
          fields={[]}
          onClose={() => setViewing(null)}
        >
          {viewing.assignments.length === 0 ? (
            <p>Este docente no tiene asignaciones{schoolPeriodId ? ' en el año escolar seleccionado' : ''}.</p>
          ) : (
            <ul className="assignment-list">
              {viewing.assignments.map((a, i) => (
                <li key={i}>
                  <LevelBadge code={a.level_code} />
                  <Link to={`/academics/sections/${a.section_id}`}>
                    {a.grade_name} · Sección {a.section_name}
                  </Link>
                  <span className="text-muted">{a.type === 'subject' ? a.subject_name : `Docente ${ROLE_LABELS[a.role].toLowerCase()}`}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm" style={{ marginTop: 12 }}>
            {Object.entries(LEVELS)
              .filter(([code]) => viewing.levels.includes(code))
              .map(([, l]) => l.rule)
              .join(' ')}
          </p>
        </DetailModal>
      )}
    </>
  );
}

export default TeachingLoadTab;
