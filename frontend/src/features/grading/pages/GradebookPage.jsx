import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import gradingApi from '../../../api/endpoints/grading.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { useAuth } from '../../../context/AuthContext';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import ImportButton from '../../../components/import/ImportButton';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Libreta de un plan: alumnos de todas sus secciones (filtrable por sección),
 * una columna por actividad y el acumulado del lapso. Las actividades del
 * formato detallado se califican por indicador (la nota es la suma).
 */
function GradebookPage() {
  const { id: planId } = useParams();
  const [sectionId, setSectionId] = useState('');
  const { data: gradebook, loading, error, refetch } = useFetch(
    () => gradingApi.getGradebook(planId, sectionId ? { sectionId } : undefined),
    [planId, sectionId]
  );
  const { data: plan } = useFetch(() => evaluationPlansApi.getOne(planId), [planId]);

  if (loading && !gradebook) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!gradebook) return null;
  const multiSection = gradebook.sections.length > 1;

  return (
    <div>
      <PageHeader
        title="Calificaciones"
        subtitle={plan ? `${plan.subject} · ${plan.grade_name} ${plan.sections.map((s) => s.name).join(', ')}` : undefined}
        actions={
          <>
            {gradebook.activities.length > 0 && gradebook.plan.status !== 'closed' && (
              <RequirePermission module="grading" action="update">
                <ImportButton
                  type="scores"
                  params={{ planId }}
                  label="Importar notas"
                  title="Importar calificaciones desde Excel"
                  description="La plantilla viene con los alumnos del plan y una columna por actividad (o por indicador en las actividades detalladas), con las notas actuales."
                  onImported={refetch}
                />
              </RequirePermission>
            )}
            <Link to={`/evaluation-plans/${planId}`} className="btn btn--secondary">
              Volver al plan
            </Link>
          </>
        }
      />

      <Card
        title="Notas por actividad"
        actions={
          multiSection && (
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Filtrar por sección">
              <option value="">Todas las secciones</option>
              {gradebook.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Sección {s.name}
                </option>
              ))}
            </Select>
          )
        }
      >
        {gradebook.activities.length === 0 ? (
          <p className="text-muted">Este plan todavía no tiene actividades. Agrégalas desde el plan de evaluación.</p>
        ) : (
          <GradesGrid gradebook={gradebook} showSection={multiSection && !sectionId} onSaved={refetch} />
        )}
      </Card>

      {plan?.pedagogicalProject && (
        <Card title="Evaluación cualitativa de competencias">
          <CompetencyGrid project={plan.pedagogicalProject} students={gradebook.rows.map((r) => r.student)} />
        </Card>
      )}
    </div>
  );
}

function GradesGrid({ gradebook, showSection, onSaved }) {
  const { activities, rows } = gradebook;
  const [grading, setGrading] = useState(null); // { activity, student, score } para las actividades por indicador

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Alumno</th>
            {activities.map((a) => (
              <th key={a.id} style={{ textAlign: 'center' }}>
                {a.title}
                <div className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>
                  {Number(a.weight_percent)}% · {a.max_score} pts{a.indicators.length ? ` · ${a.indicators.length} indicadores` : ''}
                </div>
              </th>
            ))}
            <th style={{ textAlign: 'center' }}>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.student.id}>
              <td>
                {row.student.first_name} {row.student.last_name}
                {showSection && <div className="cell-person__sub">Sección {row.student.section_name}</div>}
              </td>
              {row.scores.map((score, i) => {
                const activity = activities[i];
                return (
                  <td key={score.activityId} style={{ textAlign: 'center' }}>
                    {activity.indicators.length ? (
                      <IndicatorScoreButton score={score} activity={activity} onOpen={() => setGrading({ activity, student: row.student, score })} />
                    ) : (
                      <ScoreCell activityId={score.activityId} studentId={row.student.id} score={score} maxScore={activity.max_score} onSaved={onSaved} />
                    )}
                  </td>
                );
              })}
              <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.accumulated}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {grading && <IndicatorScoreModal {...grading} onClose={() => setGrading(null)} onSaved={onSaved} />}
    </div>
  );
}

/** Nota de una actividad por indicadores: muestra el total y abre el desglose. */
function IndicatorScoreButton({ score, activity, onOpen }) {
  const { can } = useAuth();
  const graded = score.rawScore !== null;
  if (!can('grading', 'update')) {
    return <span>{graded ? `${score.rawScore}/${activity.max_score}` : '—'}</span>;
  }
  return (
    <button type="button" className={`score-chip ${graded ? 'is-graded' : ''}`} onClick={onOpen} title="Calificar por indicador">
      {graded ? `${score.rawScore}/${activity.max_score}` : 'Calificar'}
    </button>
  );
}

/** Calificación por indicador: una nota por indicador (0 a su puntaje); la nota es la suma. */
function IndicatorScoreModal({ activity, student, score, onClose, onSaved }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(activity.indicators.map((i) => [i.id, score.indicatorScores?.[i.id] ?? '']))
  );
  const { run, loading, error } = useMutation((data) => gradingApi.upsertScore(activity.id, data));
  const toast = useToast();

  const parsed = activity.indicators.map((i) => {
    const raw = values[i.id];
    const n = raw === '' ? NaN : Number(String(raw).replace(',', '.'));
    const err = raw === '' ? 'Falta la nota.' : !Number.isFinite(n) || n < 0 ? 'Nota inválida.' : n > i.points ? `Máximo ${i.points}.` : null;
    return { ...i, n, err };
  });
  const invalid = parsed.some((p) => p.err);
  const total = round2(parsed.reduce((sum, p) => sum + (Number.isFinite(p.n) ? p.n : 0), 0));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await run({ studentId: student.id, indicatorScores: parsed.map((p) => ({ indicatorId: p.id, points: round2(p.n) })) });
      toast.success('Nota registrada', `${student.first_name} ${student.last_name}: ${total}/${activity.max_score}`);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={`${activity.title} · ${student.first_name} ${student.last_name}`} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <table className="table indicator-scores">
          <thead>
            <tr>
              <th>Indicador</th>
              <th style={{ textAlign: 'right' }}>Nota</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="planner-code">{p.code}</span> {p.description}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Input
                    inputMode="decimal"
                    value={values[p.id]}
                    onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    suffix={`/ ${p.points}`}
                    className="indicator-scores__input"
                    aria-label={`Nota del indicador ${p.code}`}
                    aria-invalid={Boolean(values[p.id] !== '' && p.err)}
                  />
                  {values[p.id] !== '' && p.err && <div className="field-error">{p.err}</div>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Nota de la actividad</th>
              <th style={{ textAlign: 'right' }}>
                {total} / {activity.max_score}
              </th>
            </tr>
          </tfoot>
        </table>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={invalid}>
            Guardar nota
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ScoreCell({ activityId, studentId, score, maxScore, onSaved }) {
  const [value, setValue] = useState(score.rawScore ?? '');
  const { run, loading, error } = useMutation((data) => gradingApi.upsertScore(activityId, data));

  const handleBlur = async () => {
    if (value === '' || Number(value) === score.rawScore) return;
    try {
      await run({ studentId, rawScore: Number(value), maxScore: score.maxScore || maxScore });
      onSaved();
    } catch {
      // el error se muestra debajo del input
    }
  };

  return (
    <RequirePermission module="grading" action="update" fallback={<span>{score.rawScore ?? '—'}</span>}>
      <div>
        <Input
          type="number"
          min="0"
          max={score.maxScore || maxScore}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          style={{ width: 70, textAlign: 'center' }}
          disabled={loading}
        />
        {error && <div className="field-error" style={{ maxWidth: 90 }}>{error}</div>}
      </div>
    </RequirePermission>
  );
}

function CompetencyGrid({ project, students }) {
  const { data: report, loading, refetch } = useFetch(() => gradingApi.getCompetencyReport(project.id), [project.id]);

  if (loading) return <Spinner />;
  if (!report || report.length === 0) return <p className="text-muted">Este proyecto no tiene competencias definidas.</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Alumno</th>
            {report.map((c) => (
              <th key={c.id}>{c.description}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id}>
              <td>{student.first_name} {student.last_name}</td>
              {report.map((competency) => {
                const existing = competency.assessments.find((a) => a.student_id === student.id);
                return (
                  <td key={competency.id}>
                    <CompetencyCell competencyId={competency.id} studentId={student.id} initial={existing?.result} onSaved={refetch} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompetencyCell({ competencyId, studentId, initial, onSaved }) {
  const [value, setValue] = useState(initial || '');
  const { run, loading } = useMutation((data) => gradingApi.assessCompetency(competencyId, data));

  const handleChange = async (e) => {
    const result = e.target.value;
    setValue(result);
    if (!result) return;
    try {
      await run({ studentId, result });
      onSaved();
    } catch {
      // silencioso: el select vuelve a mostrar el valor previo en el próximo refetch
    }
  };

  return (
    <RequirePermission
      module="grading"
      action="update"
      fallback={<span>{value === 'achieved' ? 'Alcanzó' : value === 'needs_improvement' ? 'Debe mejorar' : '—'}</span>}
    >
      <Select value={value} onChange={handleChange} disabled={loading} style={{ minWidth: 140 }}>
        <option value="">Sin evaluar</option>
        <option value="achieved">Alcanzó las competencias</option>
        <option value="needs_improvement">Debe mejorar</option>
      </Select>
    </RequirePermission>
  );
}

export default GradebookPage;
