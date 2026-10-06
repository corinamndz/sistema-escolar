import { useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import ScheduleGrid, { hueOf } from '../components/ScheduleGrid';

/**
 * "Mi horario" del docente (solo lectura): su semana completa, con la sección
 * de cada clase, y el horario de cualquiera de SUS secciones.
 */
function MySchedulePage() {
  const { data, loading, error } = useFetch(() => schedulesApi.mine(), []);
  const { data: sections } = useFetch(() => evaluationPlansApi.listSectionOptions(), []);
  const [sectionId, setSectionId] = useState('');

  return (
    <div>
      <PageHeader title="Mi horario" subtitle="Tus clases de la semana y el horario de tus secciones (solo lectura)." />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : !data?.periods.length ? (
        <Card>
          <p className="text-muted">Aún no tienes clases en el horario del año en curso.</p>
        </Card>
      ) : (
        data.periods.map((p) => (
          <Card key={p.school_period.id} title={`Mi semana · ${p.school_period.name}`} subtitle={`${p.entries.length} clase${p.entries.length === 1 ? '' : 's'} por semana`}>
            <ScheduleGrid
              days={p.days}
              slots={p.slots}
              entries={p.entries}
              colorOf={(e) => hueOf(e.subject_id)}
              entryText={(e) => ({ title: e.subject_name, sub: `${e.grade_name} ${e.section_name}` })}
            />
          </Card>
        ))
      )}

      {sections?.length > 0 && (
        <Card title="Horario de mis secciones">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Sección" style={{ maxWidth: 320 }}>
            <option value="">Elige una sección…</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.grade_name} · Sección {s.name}
              </option>
            ))}
          </Select>
          {sectionId && <SectionSchedule sectionId={sectionId} />}
        </Card>
      )}
    </div>
  );
}

function SectionSchedule({ sectionId }) {
  const { data, loading, error } = useFetch(() => schedulesApi.getSection(sectionId), [sectionId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data.slots.length) return <p className="text-muted">Esta sección aún no tiene horario.</p>;
  return (
    <div style={{ marginTop: 12 }}>
      <ScheduleGrid days={data.days} slots={data.slots} entries={data.entries} colorOf={(e) => hueOf(e.subject_id)} />
    </div>
  );
}

export default MySchedulePage;
