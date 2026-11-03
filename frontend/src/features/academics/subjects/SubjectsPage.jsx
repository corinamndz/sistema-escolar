import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Badge from '../../../components/ui/Badge';
import HelpTip from '../../../components/ui/HelpTip';
import Icon from '../../../components/ui/Icon';
import ImportActions from '../../../components/import/ImportActions';
import { LEVEL_CODES, LevelFilter } from '../levels';
import SubjectFormModal from './SubjectFormModal';
import { currentPeriod } from '../../../lib/schoolPeriods';

const MAX_GRADES = 4;

/** "1er año · A, B" / "2do año · todas" para la celda de la tabla. `highlight`: grado filtrado (va primero y resaltado). */
function GradesCell({ offering, highlight }) {
  const all = offering?.grades || [];
  const grades = highlight ? [...all.filter((g) => g.id === highlight), ...all.filter((g) => g.id !== highlight)] : all;
  if (!grades.length) return <span className="text-muted">Sin grados</span>;
  const label = (g) => (g.sections === 0 ? g.name : `${g.name} · ${g.available.length === g.sections ? 'todas' : g.available.join(', ') || 'ninguna'}`);
  return (
    <div className="subj-chips" title={grades.map(label).join(' / ')}>
      {grades.slice(0, MAX_GRADES).map((g) => (
        <span key={g.id} className={`chip${g.id === highlight ? ' subj-chip--match' : ''}`}>
          {label(g)}
        </span>
      ))}
      {grades.length > MAX_GRADES && <span className="text-sm text-muted">y {grades.length - MAX_GRADES} más</span>}
    </div>
  );
}

/** Secciones con docente / disponibles en el año. */
function CoverageCell({ offering }) {
  if (!offering?.sections_available) return <span className="text-muted">—</span>;
  if (offering.sections_missing > 0) return <Badge variant="warning">Faltan {offering.sections_missing} de {offering.sections_available}</Badge>;
  return (
    <Badge variant="success">
      {offering.sections_covered}/{offering.sections_available} con docente
    </Badge>
  );
}

/** ¿La materia se dicta en ese grado (o en cualquiera) y en esa sección (o en cualquiera)? */
const matchesGradeSection = (s, gradeId, section) =>
  (!gradeId && !section) ||
  (s.offering?.grades || []).some((g) => (!gradeId || g.id === gradeId) && (!section || g.available.includes(section)));

/**
 * Módulo de Materias: cada materia, en qué grados y secciones se dicta y qué
 * docente la imparte en cada sección del año escolar elegido. La estructura del
 * colegio (grados, secciones y su personal) está en Grados y secciones.
 * Filtros: año escolar, nivel, grado y sección. `?grado=<id>` llega desde
 * Grados y secciones y queda elegido en el selector de grado.
 */
function SubjectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [periodId, setPeriodId] = useState('');
  const [level, setLevel] = useState('');
  const [section, setSection] = useState('');
  const [editing, setEditing] = useState(null); // null | {} nueva | materia
  const gradeFilter = params.get('grado') || '';
  // Todos los grados del colegio, en el orden de la estructura (nivel → grado).
  const { data: allGrades } = useFetch(() => academicsApi.listGrades(), []);

  const setGradeFilter = (id) => {
    setParams(id ? { grado: id } : {}, { replace: true });
    setSection(''); // las secciones dependen del grado
  };
  const changeLevel = (code) => {
    setLevel(code);
    // El grado elegido deja de tener sentido si es de otro nivel.
    if (gradeFilter && code && allGrades?.find((g) => g.id === gradeFilter)?.level_code !== code) setGradeFilter('');
  };

  // Año por defecto: el que está en curso hoy (no el siguiente ya creado).
  useEffect(() => {
    if (periodId || !periods?.length) return;
    setPeriodId(currentPeriod(periods).id);
  }, [periods, periodId]);

  const ready = Boolean(periods) && (periodId || periods.length === 0);
  const { data: subjects, loading, error, refetch } = useFetch(
    () => (ready ? academicsApi.listSubjects(periodId ? { schoolPeriodId: periodId } : undefined) : Promise.resolve(null)),
    [ready, periodId]
  );
  const period = (periods || []).find((p) => p.id === periodId) || null;

  const levelsOf = (s) => new Set((s.offering?.grades || []).map((g) => g.level_code));
  const counts = useMemo(
    () => Object.fromEntries(LEVEL_CODES.map((code) => [code, (subjects || []).filter((s) => levelsOf(s).has(code)).length])),
    [subjects]
  );
  // Grados del selector: los del nivel elegido.
  const gradeOptions = useMemo(() => (allGrades || []).filter((g) => !level || g.level_code === level), [allGrades, level]);
  // Secciones del selector: las que tienen materias en el año, del grado elegido (o de todos).
  const sectionOptions = useMemo(() => {
    const names = new Set();
    for (const s of subjects || [])
      for (const g of s.offering?.grades || []) if (!gradeFilter || g.id === gradeFilter) g.available.forEach((n) => names.add(n));
    return [...names].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [subjects, gradeFilter]);
  const rows = useMemo(
    () => (subjects || []).filter((s) => (!level || levelsOf(s).has(level)) && matchesGradeSection(s, gradeFilter, section)),
    [subjects, level, gradeFilter, section]
  );

  const columns = [
    {
      key: 'name',
      header: 'Materia',
      render: (s) => (
        <div className="assign-table__subject cell-person__name">
          {s.name}
          {s.code && <span className="chip">{s.code}</span>}
        </div>
      ),
      sortValue: (s) => s.name,
    },
    { key: 'grades', header: 'Grados y secciones', render: (s) => <GradesCell offering={s.offering} highlight={gradeFilter} />, sortValue: (s) => s.offering?.sections_available || 0 },
    {
      key: 'coverage',
      header: (
        <>
          Docentes{' '}
          <HelpTip placement="bottom">En Inicial y Primaria, la sección sin docente propio para la materia la dicta su docente de aula.</HelpTip>
        </>
      ),
      // Sin sortValue: el encabezado lleva un HelpTip (botón) y no puede ir dentro del botón de ordenar.
      render: (s) => <CoverageCell offering={s.offering} />,
    },
    {
      key: 'is_active',
      header: 'Estado',
      render: (s) => <Badge variant={s.is_active ? 'success' : 'neutral'}>{s.is_active ? 'Activa' : 'Inactiva'}</Badge>,
      sortValue: (s) => (s.is_active ? 0 : 1),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Materias"
        subtitle="Registra cada materia y elige en qué grados y secciones se dicta y qué docente la imparte en cada sección."
      />
      <DataTable
        title="Materias del colegio"
        description={period ? `Secciones y docentes del año ${period.name}.` : 'Sin año escolar: solo se muestran los grados.'}
        columns={columns}
        rows={rows}
        loading={loading || !subjects}
        error={error}
        searchPlaceholder="Buscar materia…"
        getSearchText={(s) => [s.name, s.code, ...(s.offering?.grades || []).map((g) => g.name)].join(' ')}
        filters={
          <div className="subj-filters">
            {periods?.length > 0 && (
              <Select sorted value={periodId} onChange={(e) => setPeriodId(e.target.value)} aria-label="Año escolar">
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.closed_at ? ' (finalizado)' : ''}
                  </option>
                ))}
              </Select>
            )}
            <LevelFilter value={level} onChange={changeLevel} counts={counts} total={subjects?.length || 0} />
            <Select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              aria-label="Filtrar por grado"
              className={gradeFilter ? 'subj-filters__active' : ''}
            >
              <option value="">Todos los grados</option>
              {gradeOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              aria-label="Filtrar por sección"
              className={section ? 'subj-filters__active' : ''}
              disabled={!sectionOptions.length}
            >
              <option value="">Todas las secciones</option>
              {sectionOptions.map((name) => (
                <option key={name} value={name}>
                  Sección {name}
                </option>
              ))}
            </Select>
            {(gradeFilter || section) && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGradeFilter('')}>
                <Icon name="x" size={14} /> Limpiar
              </button>
            )}
          </div>
        }
        emptyMessage={
          gradeFilter || section
            ? 'Ninguna materia se dicta en ese grado y sección en este año escolar.'
            : 'Aún no hay materias registradas.'
        }
        createLabel="Nueva materia"
        onCreate={() => setEditing({})}
        canCreate={can('academics', 'create')}
        headerActions={
          can('academics', 'create') && (
            <ImportActions
              type="subjects"
              noun="materias"
              description="Nombre, abreviatura, descripción y, si quieres, los grados que la ven: queda disponible en todas sus secciones."
              onImported={refetch}
            />
          )
        }
        rowActions={
          can('evaluation_plans', 'read')
            ? [
                {
                  key: 'content',
                  icon: 'layers',
                  label: 'Contenido programático',
                  show: (s) => s.grade_count > 0,
                  onClick: (s) =>
                    navigate(
                      `/programmatic-content?materia=${s.id}&grado=${(gradeFilter && s.offering?.grades.some((g) => g.id === gradeFilter) ? gradeFilter : s.grade_ids[0]) || ''}${periodId ? `&ano=${periodId}` : ''}`
                    ),
                },
              ]
            : []
        }
        onEdit={setEditing}
        canEdit={can('academics', 'update')}
        onDelete={(s) => academicsApi.deleteSubject(s.id)}
        canDelete={can('academics', 'delete')}
        deleteConfirm={(s) => ({
          title: `¿Eliminar la materia "${s.name}"?`,
          message:
            s.grade_count > 0
              ? `Se dicta en ${s.grade_count} grado(s): quítala de ellos antes de eliminarla, o márcala como inactiva.`
              : 'Esta acción no se puede deshacer.',
          successMessage: `Materia "${s.name}" eliminada`,
        })}
        onDeleted={refetch}
      />
      {editing !== null && <SubjectFormModal subject={editing.id ? editing : null} period={period} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

export default SubjectsPage;
