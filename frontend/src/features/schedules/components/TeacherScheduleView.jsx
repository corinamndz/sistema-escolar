import { useMemo } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import ScheduleGrid, { hueOf } from './ScheduleGrid';

/**
 * Vista "Ver por docente" (solo lectura): la semana completa de un profesor
 * con TODAS sus clases en las distintas secciones del año, para auditar su
 * carga de un vistazo:
 *   - indicadores: horas por semana, secciones, huecos y días sin clase;
 *   - en la grilla, los huecos (horas libres entre dos clases del mismo día)
 *     se marcan en ámbar; cada clase muestra materia y sección;
 *   - al tocar una clase se abre el horario de esa sección para editarlo.
 */
function TeacherScheduleView({ periodId, teacherId, onOpenSection }) {
  const { data, loading, error } = useFetch(
    () => schedulesApi.query({ school_period_id: periodId, teacher_id: teacherId }),
    [periodId, teacherId],
  );

  const gapKeys = useMemo(() => new Set((data?.summary.gaps || []).map((g) => `${g.day_of_week}|${g.time_slot_id}`)), [data]);
  const conflictKeys = useMemo(
    () => new Set((data?.summary.conflicts || []).map((c) => `${c.day_of_week}|${c.time_slot_id}`)),
    [data],
  );

  if (loading) return <Spinner label="Cargando horario del docente…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { summary, teacher } = data;
  const busiest = Math.max(1, ...summary.by_day.map((d) => d.classes));

  if (!data.slots.length) {
    return (
      <Card>
        <p className="text-muted">El año {data.school_period.name} aún no tiene bloques horarios.</p>
      </Card>
    );
  }

  return (
    <div className="teacher-schedule">
      <div className="teacher-schedule__stats">
        <Stat icon="clock" value={summary.classes} label={summary.classes === 1 ? 'hora de clase por semana' : 'horas de clase por semana'} />
        <Stat icon="layers" value={summary.sections.length} label={summary.sections.length === 1 ? 'sección' : 'secciones'} />
        <Stat
          icon="alertTriangle"
          value={summary.gaps.length}
          label={summary.gaps.length === 1 ? 'hueco entre clases' : 'huecos entre clases'}
          tone={summary.gaps.length ? 'warning' : 'success'}
        />
        <Stat icon="calendar" value={summary.free_days.length} label={summary.free_days.length === 1 ? 'día sin clases' : 'días sin clases'} />
      </div>

      {!teacher.active && <Alert variant="warning">{teacher.name} está inactivo en el personal, pero aún tiene clases en el horario.</Alert>}
      {summary.conflicts.length > 0 && (
        <Alert>
          {teacher.name} tiene {summary.conflicts.length} cruce{summary.conflicts.length === 1 ? '' : 's'} de horario (dos clases a la misma hora).
        </Alert>
      )}

      <Card
        title={`Semana de ${teacher.name}`}
        subtitle={
          summary.classes
            ? 'Toca una clase para abrir el horario de su sección. En ámbar, las horas libres entre dos clases del mismo día.'
            : `Aún no tiene clases en el horario de ${data.school_period.name}.`
        }
      >
        <ScheduleGrid
          days={data.days}
          slots={data.slots}
          entries={data.entries}
          colorOf={(e) => hueOf(e.section_id)}
          entryText={(e) => ({ title: `${e.grade_name} ${e.section_name}`, sub: e.subject_name })}
          cellHint={(day, slot) => {
            const key = `${day}|${slot.id}`;
            if (conflictKeys.has(key)) return { className: 'is-conflict', title: 'Dos clases a la misma hora' };
            if (gapKeys.has(key)) return { className: 'is-gap', label: 'Hueco', title: 'Hora libre entre dos clases del mismo día' };
            return null;
          }}
          onEntryClick={onOpenSection ? (e) => onOpenSection(e.section_id) : undefined}
        />
      </Card>

      {summary.classes > 0 && (
        <div className="teacher-schedule__breakdown">
          <Card title="Carga por día">
            <ul className="load-bars">
              {summary.by_day.map((d) => (
                <li key={d.day_of_week}>
                  <span>{d.name}</span>
                  <span className="load-bars__track">
                    <span className="load-bars__fill" style={{ width: `${(d.classes / busiest) * 100}%` }} />
                  </span>
                  <strong>{d.classes ? `${d.classes} h` : 'Libre'}</strong>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Secciones que atiende">
            <ul className="teacher-schedule__sections">
              {summary.sections.map((s) => (
                <li key={s.section_id}>
                  <button
                    type="button"
                    className="teacher-schedule__section"
                    style={{ '--entry-hue': hueOf(s.section_id) }}
                    onClick={onOpenSection ? () => onOpenSection(s.section_id) : undefined}
                    disabled={!onOpenSection}
                  >
                    <span>{s.label}</span>
                    <strong>{s.classes} h</strong>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, value, label, tone }) {
  return (
    <div className={`teacher-stat ${tone ? `teacher-stat--${tone}` : ''}`}>
      <span className="teacher-stat__icon">
        <Icon name={icon} size={16} />
      </span>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default TeacherScheduleView;
