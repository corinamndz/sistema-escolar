import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import gradingApi from '../../../api/endpoints/grading.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import ImportButton from '../../../components/import/ImportButton';

const DEFAULT_MAX_SCORE = 20;

function GradebookPage() {
  const { id: planId } = useParams();
  const { data: gradebook, loading, error, refetch } = useFetch(() => gradingApi.getGradebook(planId), [planId]);
  const { data: plan } = useFetch(() => evaluationPlansApi.getOne(planId), [planId]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!gradebook) return null;

  return (
    <div>
      <PageHeader
        title="Calificaciones"
        subtitle={plan?.subject}
        actions={
          <>
            {gradebook.activities.length > 0 && gradebook.plan.status !== 'closed' && (
              <RequirePermission module="grading" action="update">
                <ImportButton
                  type="scores"
                  params={{ planId }}
                  label="Importar notas"
                  title="Importar calificaciones desde Excel"
                  description="La plantilla viene con los alumnos de la sección y una columna por actividad (con las notas actuales). Solo completa las notas de 0 a 20."
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

      <Card title="Notas por actividad">
        {gradebook.activities.length === 0 ? (
          <p className="text-muted">Este plan todavía no tiene actividades. Agrégalas desde el plan de evaluación.</p>
        ) : (
          <GradesGrid gradebook={gradebook} planId={planId} onSaved={refetch} />
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

function GradesGrid({ gradebook, onSaved }) {
  const { activities, rows } = gradebook;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Alumno</th>
            {activities.map((a) => (
              <th key={a.id} style={{ textAlign: 'center' }}>
                {a.title}
                <div className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>{Number(a.weight_percent)}%</div>
              </th>
            ))}
            <th style={{ textAlign: 'center' }}>Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.student.id}>
              <td>{row.student.first_name} {row.student.last_name}</td>
              {row.scores.map((score) => (
                <td key={score.activityId} style={{ textAlign: 'center' }}>
                  <ScoreCell activityId={score.activityId} studentId={row.student.id} score={score} onSaved={onSaved} />
                </td>
              ))}
              <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.accumulated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreCell({ activityId, studentId, score, onSaved }) {
  const [value, setValue] = useState(score.rawScore ?? '');
  const { run, loading, error } = useMutation((data) => gradingApi.upsertScore(activityId, data));

  const handleBlur = async () => {
    if (value === '' || Number(value) === score.rawScore) return;
    try {
      await run({ studentId, rawScore: Number(value), maxScore: score.maxScore || DEFAULT_MAX_SCORE });
      onSaved();
    } catch {
      // el error se muestra debajo del input
    }
  };

  return (
    <RequirePermission
      module="grading"
      action="update"
      fallback={<span>{score.rawScore ?? '—'}</span>}
    >
      <div>
        <Input
          type="number"
          min="0"
          max={score.maxScore || DEFAULT_MAX_SCORE}
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
