import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LEVEL_CODES } from '../levels';
import { isSectionStaffed } from '../setup/useSetupStatus';
import GradeWorkspace from './GradeWorkspace';

/**
 * Panel por grado: la estructura académica en una sola pantalla.
 *   Izquierda: los grados por nivel, con su estado (materias, secciones y
 *   cuántas tienen todos sus docentes) y alta rápida de grado.
 *   Derecha: el grado elegido, con sus materias y la matriz de docentes.
 */
function AcademicPanel({ onGoToSetup }) {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [periodId, setPeriodId] = useState('');
  const [version, setVersion] = useState(0);
  const { data: grades, loading: loadingGrades, error } = useFetch(() => academicsApi.listGrades(), [version]);
  const { data: sections } = useFetch(
    () => (periodId ? academicsApi.listSections({ schoolPeriodId: periodId }) : Promise.resolve([])),
    [periodId, version]
  );
  const [newGrade, setNewGrade] = useState({ name: '', levelCode: 'secondary' });
  const [query, setQuery] = useState('');
  const canEdit = can('academics', 'update');
  const gradeId = params.get('grado') || '';

  // Año por defecto: el activo más reciente.
  useEffect(() => {
    if (periodId || !periods?.length) return;
    const sorted = [...periods].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    setPeriodId((sorted.find((p) => p.is_active && !p.closed_at) || sorted[0]).id);
  }, [periods, periodId]);

  // Grado de la URL: si no viene, el primero; si no existe (enlace viejo, grado
  // eliminado o id mal copiado), se avisa y se muestra el primero.
  const [missingGrade, setMissingGrade] = useState(false);
  const gradeExists = Boolean(grades?.some((g) => g.id === gradeId));
  useEffect(() => {
    if (!grades) return;
    if (gradeId && !gradeExists) setMissingGrade(true);
    if ((!gradeId || !gradeExists) && grades.length) {
      setParams((p) => ({ ...Object.fromEntries(p), grado: grades[0].id }), { replace: true });
    }
  }, [grades, gradeId, gradeExists, setParams]);

  const period = (periods || []).find((p) => p.id === periodId);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LEVEL_CODES.map((code) => ({
      code,
      grades: (grades || []).filter((g) => g.level_code === code && (!q || g.name.toLowerCase().includes(q))),
    })).filter((g) => g.grades.length);
  }, [grades, query]);

  /** Estado del grado en el año: secciones, cuántas con todos sus docentes y si le faltan materias. */
  const statusOf = (g) => {
    const list = (sections || []).filter((s) => s.grade_id === g.id);
    const staffed = list.filter(isSectionStaffed).length;
    const needsSubjects = g.level_code !== 'initial' && !g.subject_count;
    const done = list.length > 0 && staffed === list.length && !needsSubjects;
    return { sections: list.length, staffed, needsSubjects, done };
  };

  const createGrade = async (e) => {
    e.preventDefault();
    if (!newGrade.name.trim()) return;
    try {
      const g = await academicsApi.createGrade({ name: newGrade.name.trim(), levelCode: newGrade.levelCode });
      toast.success('Grado creado', g.name);
      setNewGrade((n) => ({ ...n, name: '' }));
      setVersion((v) => v + 1);
      setParams((p) => ({ ...Object.fromEntries(p), grado: g.id }), { replace: true });
    } catch (err) {
      toast.error('No se pudo crear el grado', getErrorMessage(err));
    }
  };

  if (loadingGrades && !grades) return <Spinner />;

  return (
    <div className="gp-layout">
      <aside className="gp-sidebar">
        <label className="gp-sidebar__year">
          <span className="student-card__label">Año escolar</span>
          <Select sorted value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {(periods || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.closed_at ? ' (finalizado)' : ''}
              </option>
            ))}
          </Select>
        </label>
        {!periods?.length && (
          <Alert variant="info">
            Primero crea el año escolar.{' '}
            <button type="button" className="link-button" onClick={() => onGoToSetup('period')}>
              Ir a Año escolar
            </button>
          </Alert>
        )}
        <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar grado…" aria-label="Buscar grado" />
        <Alert>{error}</Alert>

        <nav className="gp-grades" aria-label="Grados">
          {groups.map((group) => (
            <div key={group.code}>
              <h4 className="gp-grades__level">{LEVELS[group.code].name}</h4>
              {group.grades.map((g) => {
                const st = statusOf(g);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`gp-grade ${g.id === gradeId ? 'is-active' : ''}`}
                    onClick={() => setParams((p) => ({ ...Object.fromEntries(p), grado: g.id }), { replace: true })}
                    aria-current={g.id === gradeId ? 'true' : undefined}
                  >
                    <span className={`gp-grade__dot ${st.done ? 'is-done' : st.sections ? 'is-partial' : ''}`} aria-hidden="true" />
                    <span className="gp-grade__name">{g.name}</span>
                    <span className="gp-grade__meta">
                      {g.level_code !== 'initial' && `${g.subject_count} mat. · `}
                      {st.sections ? `${st.staffed}/${st.sections} secc. completas` : 'sin secciones'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {grades?.length === 0 && <p className="text-sm text-muted">Aún no hay grados: crea el primero abajo.</p>}
        </nav>

        {canEdit && (
          <form className="gp-new-grade" onSubmit={createGrade}>
            <span className="student-card__label">Nuevo grado</span>
            <Input value={newGrade.name} onChange={(e) => setNewGrade({ ...newGrade, name: e.target.value })} placeholder="Ej. 4to año" maxLength={50} aria-label="Nombre del grado" />
            <div className="gp-new-grade__row">
              <Select value={newGrade.levelCode} onChange={(e) => setNewGrade({ ...newGrade, levelCode: e.target.value })} aria-label="Nivel">
                {LEVEL_CODES.map((c) => (
                  <option key={c} value={c}>
                    {LEVELS[c].short}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" icon="plus" disabled={!newGrade.name.trim()}>
                Crear
              </Button>
            </div>
          </form>
        )}
      </aside>

      <main className="gp-main">
        {missingGrade && (
          <Alert variant="warning">
            El grado del enlace no existe (pudo ser eliminado): se muestra otro grado.{' '}
            <button type="button" className="link-button" onClick={() => setMissingGrade(false)}>
              Cerrar
            </button>
          </Alert>
        )}
        {gradeId && gradeExists ? (
          <GradeWorkspace gradeId={gradeId} period={period} canEdit={canEdit} canDelete={can('academics', 'delete')} onChanged={() => setVersion((v) => v + 1)} />
        ) : (
          <div className="card empty-state">
            <div className="empty-state__icon">
              <Icon name="school" size={24} />
            </div>
            <div className="empty-state__title">Elige o crea un grado</div>
          </div>
        )}
      </main>
    </div>
  );
}

export default AcademicPanel;
