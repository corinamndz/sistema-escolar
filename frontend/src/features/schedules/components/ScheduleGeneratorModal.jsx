import { useEffect, useMemo, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import ScheduleGrid, { hueOf } from './ScheduleGrid';

const MODES = [
  {
    key: 'fill',
    title: 'Completar lo que falta',
    text: 'Respeta las clases que ya están en el horario y coloca las horas que faltan.',
    icon: 'plus',
  },
  {
    key: 'replace',
    title: 'Rehacer desde cero',
    text: 'Arma de nuevo el horario de las secciones elegidas. Las clases actuales se reemplazan al guardar.',
    icon: 'refresh',
  },
];

// Mensajes del panel de progreso (el cálculo corre en el servidor; suele tardar pocos segundos).
const PROGRESS_STEPS = [
  'Leyendo planes de estudio y horas semanales…',
  'Revisando la carga y la disponibilidad de cada profesor…',
  'Buscando combinaciones sin cruces…',
  'Repartiendo las materias en la semana…',
];

/**
 * Generador automático de horarios:
 *   1. Configurar: alcance (todo el año, un grado o una sección) y modo.
 *   2. Generar: el servidor calcula una VISTA PREVIA (no toca el horario).
 *   3. Revisar: resumen, conflictos y grilla por sección o por profesor.
 *   4. Guardar o descartar.
 */
function ScheduleGeneratorModal({ periodId, periodName, grades, initialGradeId, initialSectionId, onClose, onApplied, onOpenAvailability }) {
  const toast = useToast();
  const [scope, setScope] = useState(initialSectionId ? 'section' : initialGradeId ? 'grade' : 'all');
  const [gradeId, setGradeId] = useState(initialGradeId || '');
  const [sectionId, setSectionId] = useState(initialSectionId || '');
  const [mode, setMode] = useState('fill');
  const [phase, setPhase] = useState('config'); // config | running | preview
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [step, setStep] = useState(0);

  const grade = (grades || []).find((g) => g.id === gradeId);
  const sectionIds = scope === 'section' ? [sectionId].filter(Boolean) : scope === 'grade' ? (grade?.sections || []).map((s) => s.id) : null;
  const scopeReady = scope === 'all' || (sectionIds && sectionIds.length > 0);
  const totalSections = (grades || []).reduce((n, g) => n + g.sections.length, 0);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, PROGRESS_STEPS.length - 1)), 1100);
    return () => clearInterval(timer);
  }, [phase]);

  const run = async () => {
    setError(null);
    setPhase('running');
    try {
      setResult(await schedulesApi.generate(periodId, { mode, ...(sectionIds ? { sectionIds } : {}) }));
      setPhase('preview');
    } catch (err) {
      setError(getErrorMessage(err));
      setPhase('config');
    }
  };

  const discard = async () => {
    if (result?.id) await schedulesApi.discardGeneration(result.id).catch(() => {});
    onClose();
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const r = await schedulesApi.applyGeneration(result.id);
      toast.success('Horario guardado', `${r.inserted} clase${r.inserted === 1 ? '' : 's'} en ${r.sections} secci${r.sections === 1 ? 'ón' : 'ones'}`);
      onApplied?.();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const title = phase === 'preview' ? 'Vista previa del horario generado' : 'Generar horario automático';
  return (
    <Modal title={title} onClose={phase === 'running' ? undefined : phase === 'preview' ? discard : onClose} size="lg">
      {phase === 'config' && (
        <div className="generator">
          <p className="text-muted" style={{ marginTop: 0 }}>
            Año escolar <strong>{periodName}</strong>. El generador reparte las horas semanales de cada materia sin que ningún profesor tenga dos clases a la
            misma hora, respetando su disponibilidad y las aulas compartidas. Verás una vista previa antes de guardar.
          </p>
          <Alert>{error}</Alert>

          <h4 className="generator__label">¿Qué secciones?</h4>
          <div className="generator__scope">
            <div className="segmented" role="radiogroup" aria-label="Alcance">
              {[
                ['all', `Todo el año (${totalSections})`],
                ['grade', 'Un grado'],
                ['section', 'Una sección'],
              ].map(([key, label]) => (
                <button key={key} type="button" role="radio" aria-checked={scope === key} className={`segmented__item ${scope === key ? 'segmented__item--active' : ''}`} onClick={() => setScope(key)}>
                  {label}
                </button>
              ))}
            </div>
            {scope !== 'all' && (
              <div className="generator__pickers">
                <Select value={gradeId} onChange={(e) => { setGradeId(e.target.value); setSectionId(''); }} aria-label="Grado">
                  <option value="">Grado…</option>
                  {(grades || []).filter((g) => g.sections.length).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.sections.length})
                    </option>
                  ))}
                </Select>
                {scope === 'section' && (
                  <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!grade} aria-label="Sección">
                    <option value="">Sección…</option>
                    {(grade?.sections || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        Sección {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
          </div>

          <h4 className="generator__label">¿Cómo?</h4>
          <div className="generator__modes" role="radiogroup" aria-label="Modo">
            {MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} className={`generator__mode ${mode === m.key ? 'is-selected' : ''}`} onClick={() => setMode(m.key)}>
                <Icon name={m.icon} size={18} />
                <span>
                  <strong>{m.title}</strong>
                  <small>{m.text}</small>
                </span>
              </button>
            ))}
          </div>
          {mode === 'replace' && <Alert variant="warning">Al guardar se borrarán las clases actuales de esas secciones. Hasta entonces no se cambia nada.</Alert>}

          <div className="generator__tip">
            <Icon name="info" size={15} />
            <span>
              ¿Algún profesor no puede ciertos días u horas?{' '}
              <button type="button" className="link-button" onClick={onOpenAvailability}>
                Marca su disponibilidad
              </button>{' '}
              antes de generar.
            </span>
          </div>

          <div className="form-actions">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button icon="sparkles" onClick={run} disabled={!scopeReady}>
              Generar vista previa
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="generator-progress" role="status" aria-live="polite">
          <span className="generator-progress__spinner" aria-hidden="true" />
          <strong>Generando el horario…</strong>
          <ol className="generator-progress__steps">
            {PROGRESS_STEPS.map((text, i) => (
              <li key={text} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}>
                <Icon name={i < step ? 'check' : 'clock'} size={14} /> {text}
              </li>
            ))}
          </ol>
          <small className="text-muted">Suele tardar unos segundos. No se modifica nada hasta que lo guardes.</small>
        </div>
      )}

      {phase === 'preview' && result && (
        <GenerationPreview result={result} error={error} applying={applying} onApply={apply} onDiscard={discard} onRetry={() => setPhase('config')} />
      )}
    </Modal>
  );
}

function GenerationPreview({ result, error, applying, onApply, onDiscard, onRetry }) {
  const { stats, conflicts } = result;
  const [view, setView] = useState('section');
  const [sectionId, setSectionId] = useState(result.sections[0]?.id || '');
  const [teacherId, setTeacherId] = useState(result.teachers[0]?.id || '');
  const errors = conflicts.filter((c) => c.severity === 'error');
  const warnings = conflicts.filter((c) => c.severity !== 'error');
  const [showAll, setShowAll] = useState(false);

  const all = useMemo(
    () => [...result.entries, ...result.kept].map((e) => ({ ...e, id: `${e.section_id}|${e.subject_id}|${e.day_of_week}|${e.time_slot_id}` })),
    [result]
  );
  const shown = view === 'section' ? all.filter((e) => e.section_id === sectionId) : all.filter((e) => e.staff_id === teacherId);
  const sectionName = (id) => {
    const s = result.sections.find((x) => x.id === id);
    return s ? `${s.grade_name} ${s.name}` : '';
  };
  const incomplete = new Set(errors.map((c) => c.section_id).filter(Boolean));
  const listed = showAll ? errors : errors.slice(0, 6);
  const percent = stats.required ? Math.round((stats.placed / stats.required) * 100) : 100;
  // Todo lo que tenía profesor y horas quedó colocado: lo pendiente son datos (materias sin profesor u horas).
  const allPlaced = stats.placed === stats.required;
  const headline = stats.complete
    ? 'Horario completo, sin cruces'
    : allPlaced && stats.placed
      ? 'Horario sin cruces, con datos por completar'
      : stats.placed
        ? 'Horario parcial: revisa los conflictos'
        : 'No se pudo colocar ninguna clase';

  return (
    <div className="generator">
      <div className={`generator-summary ${stats.complete ? 'is-complete' : 'is-partial'}`}>
        <Icon name={stats.complete ? 'checkCircle' : 'alertTriangle'} size={22} />
        <div>
          <strong>{headline}</strong>
          {allPlaced && !stats.complete && stats.placed > 0 && (
            <span>Todas las materias con profesor y horas definidas quedaron colocadas. Completa lo marcado abajo y vuelve a generar para incluirlo.</span>
          )}
          <span>
            {stats.placed} de {stats.required} horas colocadas ({percent}%)
            {stats.kept ? ` · ${stats.kept} ya estaban` : ''} · {stats.sections_complete} de {stats.sections} secciones completas · {(stats.ms / 1000).toFixed(1)} s
            {stats.relaxed ? ' · se permitió una hora más por día en algunas materias' : ''}
          </span>
        </div>
      </div>

      <Alert>{error}</Alert>

      {errors.length > 0 && (
        <section className="generator-conflicts" aria-label="Conflictos">
          <h4>
            <Icon name="alertCircle" size={16} /> {errors.length} conflicto{errors.length === 1 ? '' : 's'} por resolver
          </h4>
          <ul>
            {listed.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
          {errors.length > listed.length && (
            <button type="button" className="link-button" onClick={() => setShowAll(true)}>
              Ver los {errors.length - listed.length} restantes
            </button>
          )}
        </section>
      )}
      {warnings.length > 0 && (
        <details className="generator-warnings">
          <summary>
            {warnings.length} aviso{warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {warnings.map((c, i) => (
              <li key={i}>{c.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="generator-preview__bar">
        <div className="segmented" role="radiogroup" aria-label="Ver vista previa">
          {[
            ['section', 'Por sección', 'school'],
            ['teacher', 'Por profesor', 'user'],
          ].map(([key, label, icon]) => (
            <button key={key} type="button" role="radio" aria-checked={view === key} className={`segmented__item ${view === key ? 'segmented__item--active' : ''}`} onClick={() => setView(key)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>
        {view === 'section' ? (
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Sección">
            {result.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.grade_name} {s.name}
                {incomplete.has(s.id) ? ' · incompleta' : ''}
              </option>
            ))}
          </Select>
        ) : (
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} aria-label="Profesor">
            {result.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.classes} h
              </option>
            ))}
          </Select>
        )}
        <span className="text-sm text-muted">{shown.length} clases</span>
      </div>

      <div className="generator-preview__grid">
        <ScheduleGrid
          days={result.days}
          slots={result.slots}
          entries={shown}
          colorOf={(e) => hueOf(e.subject_id)}
          entryText={(e) => ({
            title: e.subject_name,
            sub: `${view === 'section' ? e.teacher_name : sectionName(e.section_id)}${e.is_new ? '' : ' · ya estaba'}`,
          })}
        />
      </div>

      <div className="form-actions">
        <Button variant="ghost" icon="x" onClick={onDiscard} disabled={applying}>
          Descartar
        </Button>
        <Button variant="secondary" icon="refresh" onClick={onRetry} disabled={applying}>
          Generar de nuevo
        </Button>
        <Button icon="check" onClick={onApply} loading={applying} loadingText="Guardando…" disabled={!result.entries.length && result.mode !== 'replace'}>
          {allPlaced ? 'Guardar horario' : `Guardar lo generado (${stats.placed} de ${stats.required} h)`}
        </Button>
      </div>
    </div>
  );
}

export default ScheduleGeneratorModal;
