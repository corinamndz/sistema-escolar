import { useMemo, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import QuickAssign from './QuickAssign';

/**
 * Vista "Asignaciones": quién dicta qué y dónde, en una tabla plana
 * Grado/Sección → Materia → Profesor para auditar en segundos.
 *   - Resumen: materias, asignadas, SIN profesor, docentes.
 *   - Filtros: grado, texto (materia o profesor) y "solo sin profesor".
 *   - Las materias sin profesor se marcan en ámbar y se asignan ahí mismo.
 *   - Tocar una sección abre su horario.
 */
function AssignmentsView({ periodId, grades = [], teachers = [], canAssign, onAssign, onOpenSection, reloadKey }) {
  const [gradeId, setGradeId] = useState('');
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const { data, loading, error, refetch } = useFetch(
    () => schedulesApi.listAssignments({ school_period_id: periodId, grade_id: gradeId || undefined }),
    [periodId, gradeId, reloadKey],
  );

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const groups = useMemo(() => {
    const needle = norm(q.trim());
    const rows = (data?.rows || []).filter(
      (r) => (!onlyMissing || !r.teacher_id) && (!needle || norm(`${r.subject_name} ${r.teacher_name} ${r.grade_name} ${r.section_name}`).includes(needle)),
    );
    const map = new Map();
    rows.forEach((r) => {
      if (!map.has(r.section_id)) map.set(r.section_id, { section_id: r.section_id, label: `${r.grade_name} · Sección ${r.section_name}`, level: r.level_name, rows: [] });
      map.get(r.section_id).rows.push(r);
    });
    return [...map.values()];
  }, [data, q, onlyMissing]);

  const assign = async (row, teacherId) => {
    await onAssign(row.section_id, row.subject_id, teacherId);
    refetch();
  };

  const s = data?.summary;
  return (
    <div className="assignments">
      {s && (
        <div className="assignments__stats">
          <span className="assignments__stat">
            <strong>{s.total}</strong> materias por sección
          </span>
          <span className="assignments__stat assignments__stat--ok">
            <Icon name="checkCircle" size={14} /> <strong>{s.assigned}</strong> con profesor
          </span>
          <button
            type="button"
            className={`assignments__stat assignments__stat--warn ${onlyMissing ? 'is-active' : ''} ${s.unassigned ? '' : 'is-zero'}`}
            onClick={() => setOnlyMissing((v) => !v)}
            aria-pressed={onlyMissing}
            title="Mostrar solo las materias sin profesor"
          >
            <Icon name="alertTriangle" size={14} /> <strong>{s.unassigned}</strong> sin profesor
          </button>
          <span className="assignments__stat">
            <Icon name="users" size={14} /> <strong>{s.teachers}</strong> docentes
          </span>
        </div>
      )}

      <Card>
        <div className="assignments__filters">
          <div className="input-group assignments__search">
            <Icon name="search" size={17} className="input-group__icon" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar materia o profesor…" aria-label="Buscar materia o profesor" />
          </div>
          <Select value={gradeId} onChange={(e) => setGradeId(e.target.value)} aria-label="Grado">
            <option value="">Todos los grados</option>
            {grades
              .filter((g) => g.sections.length)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </Select>
          <label className="assignments__toggle">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Solo sin profesor
          </label>
        </div>

        <Alert>{error}</Alert>
        {loading && !data ? (
          <Spinner label="Cargando asignaciones…" />
        ) : !groups.length ? (
          <p className="text-muted assignments__empty">
            {onlyMissing ? '¡Todo asignado! No hay materias sin profesor con estos filtros.' : 'No hay secciones con materias en este año (o con estos filtros).'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table assignments__table">
              <thead>
                <tr>
                  <th>Grado / Sección</th>
                  <th>Materia</th>
                  <th>Profesor asignado</th>
                  <th className="assignments__hours">h/sem</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.section_id}>
                  {g.rows.map((r, i) => (
                    <tr key={`${r.section_id}-${r.subject_id}`} className={r.teacher_id ? '' : 'is-missing'}>
                      {i === 0 && (
                        <td rowSpan={g.rows.length} className="assignments__section">
                          <button type="button" className="link-button" onClick={() => onOpenSection?.(r.section_id)} title="Abrir el horario de esta sección">
                            {g.label}
                          </button>
                          <span className="text-sm text-muted">{g.level}</span>
                        </td>
                      )}
                      <td>
                        <strong>{r.subject_name}</strong>
                      </td>
                      <td>
                        <TeacherCell row={r} teachers={teachers} canAssign={canAssign} onAssign={(id) => assign(r, id)} />
                      </td>
                      <td className="assignments__hours">{r.weekly_hours ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Profesor de una materia: nombre destacado, "titular" en Primaria, o aviso + asignación rápida. */
export function TeacherCell({ row, teachers, canAssign, onAssign }) {
  if (!row.teacher_id) {
    return (
      <span className="teacher-cell">
        <span className="teacher-chip teacher-chip--missing">
          <Icon name="alertTriangle" size={13} /> Sin profesor asignado
        </span>
        {canAssign && <QuickAssign teachers={teachers} onAssign={onAssign} />}
      </span>
    );
  }
  return (
    <span className="teacher-cell">
      <span className="teacher-chip">
        <Icon name="user" size={13} /> Prof. {row.teacher_name}
      </span>
      {row.teacher_source === 'homeroom' && (
        <span className="teacher-chip__note" title="Primaria: la dicta el docente titular de la sección porque no tiene especialista.">
          titular
        </span>
      )}
      {canAssign && <QuickAssign teachers={teachers} currentId={row.teacher_source === 'subject' ? row.teacher_id : null} onAssign={onAssign} label="Cambiar" variant="ghost" allowClear={row.teacher_source === 'subject'} />}
    </span>
  );
}

export default AssignmentsView;
