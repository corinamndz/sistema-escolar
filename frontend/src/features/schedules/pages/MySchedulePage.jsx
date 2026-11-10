import { useSearchParams } from 'react-router-dom';
import schedulesApi from '../../../api/endpoints/schedules.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import ScheduleGrid, { hueOf } from '../components/ScheduleGrid';

const sectionLabel = (s) => `${s.grade_name} · Sección ${s.name}`;

/**
 * "Mi horario" del docente (solo lectura). El selector de la cabecera elige qué
 * se ve: su semana completa (con la sección de cada clase) o el horario de una
 * de SUS secciones. La elección queda en la URL (?seccion=), así sobrevive a
 * recargar la página y se puede compartir el enlace.
 */
function MySchedulePage() {
  const { data, loading, error } = useFetch(() => schedulesApi.mine(), []);
  const { data: sections } = useFetch(() => evaluationPlansApi.listSectionOptions(), []);
  const [params, setParams] = useSearchParams();
  const requested = params.get('seccion') || '';
  // Una sección que ya no es suya (o de otro año) vuelve a «Mi semana».
  const section = (sections || []).find((s) => s.id === requested) || null;
  const pick = (id) => setParams(id ? { seccion: id } : {}, { replace: true });

  return (
    <div>
      <PageHeader
        title="Mi horario"
        subtitle={section ? `Horario completo de ${sectionLabel(section)} (solo lectura).` : 'Tus clases de la semana y el horario de tus secciones (solo lectura).'}
        actions={
          sections?.length > 0 && (
            <label className="my-schedule__picker">
              <span>Ver</span>
              <Select value={section ? section.id : ''} onChange={(e) => pick(e.target.value)} aria-label="Ver el horario de">
                <option value="">Mi semana (todas mis clases)</option>
                <optgroup label="Horario de una sección">
                  {[...sections]
                    .sort((a, b) => sectionLabel(a).localeCompare(sectionLabel(b), 'es', { numeric: true }))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {sectionLabel(s)}
                      </option>
                    ))}
                </optgroup>
              </Select>
            </label>
          )
        }
      />
      <Alert>{error}</Alert>
      {section ? (
        <SectionSchedule section={section} />
      ) : loading ? (
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
    </div>
  );
}

/** Horario completo de una sección (todas sus materias, no solo las del docente). */
function SectionSchedule({ section }) {
  const { data, loading, error } = useFetch(() => schedulesApi.getSection(section.id), [section.id]);
  return (
    <Card title={`Horario de ${sectionLabel(section)}`} subtitle={data?.entries ? `${data.entries.length} clase${data.entries.length === 1 ? '' : 's'} por semana` : undefined}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : !data.slots.length ? (
        <p className="text-muted">Esta sección aún no tiene horario.</p>
      ) : (
        <ScheduleGrid days={data.days} slots={data.slots} entries={data.entries} colorOf={(e) => hueOf(e.subject_id)} />
      )}
    </Card>
  );
}

export default MySchedulePage;
