import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';

const STEPS = ['Año de origen', 'Año nuevo', 'Qué copiar', 'Revisar'];

/** Opciones de copia, en el orden en que se muestran. `count(preview)` = cuánto hay en el año de origen. */
const PARTS = [
  {
    key: 'sections',
    icon: 'layers',
    title: 'Secciones y aulas',
    desc: 'Las mismas secciones de cada grado (A, B…), con su aula y cupo máximo.',
    count: (p) => p.counts.sections,
    unit: ['sección', 'secciones'],
  },
  {
    key: 'teachers',
    icon: 'users',
    title: 'Docentes asignados',
    desc: 'Titular y auxiliar de cada sección, profesor guía y profesor de cada materia.',
    count: (p) => p.counts.homeroom_teachers + p.counts.subject_teachers + p.counts.guide_teachers,
    unit: ['asignación', 'asignaciones'],
  },
  {
    key: 'terms',
    icon: 'calendar',
    title: 'Lapsos',
    desc: 'Los mismos lapsos, con sus fechas corridas un año.',
    count: (p) => p.counts.terms,
    unit: ['lapso', 'lapsos'],
  },
  {
    key: 'evaluationRules',
    icon: 'clipboard',
    title: 'Reglas de evaluación',
    desc: (p) => `Nota mínima ${Number(p.rules.passing_grade)}, hasta ${p.rules.max_failed_subjects} materia(s) reprobada(s) para promover.`,
    count: () => 1,
    unit: null,
  },
  {
    key: 'timeSlots',
    icon: 'clock',
    title: 'Bloques horarios',
    desc: 'Horas de entrada, de cada clase y de los recreos.',
    count: (p) => p.counts.time_slots,
    unit: ['bloque', 'bloques'],
  },
  {
    key: 'schedule',
    icon: 'spreadsheet',
    title: 'Horario de clases',
    desc: 'Qué materia y qué docente hay en cada bloque de cada sección.',
    count: (p) => p.counts.schedule_classes,
    unit: ['clase', 'clases'],
  },
  {
    key: 'tuition',
    icon: 'wallet',
    title: 'Mensualidades',
    desc: 'Monto y día de vencimiento de la mensualidad por nivel.',
    count: (p) => p.counts.tuition_fees,
    unit: ['tarifa', 'tarifas'],
  },
];
const PART_BY_KEY = Object.fromEntries(PARTS.map((p) => [p.key, p]));

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const dateLabel = (v) => {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Marcar una opción marca lo que necesita; desmarcarla desmarca lo que depende de ella (según `requires` del servidor). */
function withDependencies(options, key, on, requires) {
  const next = { ...options };
  const mark = (k) => {
    next[k] = true;
    (requires[k] || []).forEach(mark);
  };
  if (on) mark(key);
  else {
    next[key] = false;
    let changed = true;
    while (changed) {
      changed = false;
      for (const [part, needs] of Object.entries(requires)) {
        if (next[part] && needs.some((n) => !next[n])) {
          next[part] = false;
          changed = true;
        }
      }
    }
  }
  return next;
}

/**
 * Asistente de transición de año escolar: copia la estructura del año anterior
 * al nuevo en 4 pasos. Grados, materias y plan de estudios ya son del colegio
 * (se usan sin copiar); los alumnos pasan después con Promoción.
 */
function YearRolloverWizard({ periods, initialSourceId, onClose, onDone }) {
  const { can } = useAuth();
  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState(initialSourceId || (periods.find((p) => p.section_count > 0) || periods[0])?.id || '');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [mode, setMode] = useState('new');
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [existingId, setExistingId] = useState('');
  const [options, setOptions] = useState({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!sourceId) return undefined;
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    academicsApi
      .getRolloverPreview(sourceId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setForm({ name: p.suggestion.name, startDate: p.suggestion.startDate || '', endDate: p.suggestion.endDate || '' });
        setExistingId(p.target_candidates[0]?.id || '');
        setMode('new');
        // Por defecto se copia todo lo que tiene datos.
        setOptions(Object.fromEntries(PARTS.map((part) => [part.key, part.count(p) > 0])));
      })
      .catch((err) => !cancelled && setPreviewError(getErrorMessage(err)))
      .finally(() => !cancelled && setLoadingPreview(false));
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const chosen = PARTS.filter((p) => options[p.key]);
  const targetName = mode === 'new' ? form.name.trim() : preview?.target_candidates.find((c) => c.id === existingId)?.name;
  const datesInvalid = mode === 'new' && form.startDate && form.endDate && form.startDate > form.endDate;
  const canNext = useMemo(() => {
    if (!preview || loadingPreview) return false;
    if (step === 1) return mode === 'new' ? Boolean(form.name.trim()) && !datesInvalid : Boolean(existingId);
    if (step === 2) return chosen.length > 0;
    return true;
  }, [preview, loadingPreview, step, mode, form.name, datesInvalid, existingId, chosen.length]);

  const toggle = (key, on) => setOptions((o) => withDependencies(o, key, on, preview.requires));

  const run = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const target = mode === 'new' ? { name: form.name.trim(), startDate: form.startDate || null, endDate: form.endDate || null } : { periodId: existingId };
      const res = await academicsApi.executeRollover(sourceId, { target, options: Object.fromEntries(PARTS.map((p) => [p.key, Boolean(options[p.key])])) });
      setResult(res);
      onDone?.(res);
    } catch (err) {
      setRunError(getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const close = running ? () => {} : onClose;

  if (result) return <RolloverDone result={result} source={preview.source} canPromote={can('promotion', 'update')} onClose={onClose} />;

  return (
    <Modal title="Preparar el nuevo año escolar" size="lg" onClose={close} className="rollover">
      <Stepper step={step} />

      <div className="rollover__body">
        {step === 0 && (
          <>
            <p className="rollover__lead">Elige el año del que quieres copiar la estructura. No se modifica: solo se usa como modelo.</p>
            <Field label="Copiar desde el año escolar">
              <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={loadingPreview}>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.closed_at ? ' (finalizado)' : p.is_active ? ' (activo)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Alert>{previewError}</Alert>
            {loadingPreview ? (
              <Spinner label="Revisando el año escolar…" />
            ) : (
              preview && (
                <>
                  <div className="rollover-stats">
                    <Stat icon="layers" value={preview.counts.sections} label="secciones" />
                    <Stat icon="users" value={preview.counts.homeroom_teachers + preview.counts.subject_teachers + preview.counts.guide_teachers} label="asignaciones docentes" />
                    <Stat icon="spreadsheet" value={preview.counts.schedule_classes} label="clases en el horario" />
                    <Stat icon="graduation" value={preview.counts.active_students} label="alumnos cursando" />
                  </div>
                  {preview.counts.sections === 0 && (
                    <Alert variant="warning">Este año no tiene secciones. Elige el año que usaste como base (normalmente el más reciente).</Alert>
                  )}
                </>
              )
            )}
          </>
        )}

        {step === 1 && preview && (
          <>
            <p className="rollover__lead">¿Dónde se copia la estructura?</p>
            <div className="rollover-choices" role="radiogroup" aria-label="Año de destino">
              <ChoiceCard selected={mode === 'new'} onSelect={() => setMode('new')} icon="plus" title="Crear un año nuevo" desc="Recomendado. Te sugerimos el nombre y las fechas." />
              <ChoiceCard
                selected={mode === 'existing'}
                onSelect={() => setMode('existing')}
                disabled={!preview.target_candidates.length}
                icon="calendar"
                title="Usar un año que ya creé"
                desc={preview.target_candidates.length ? 'Un año sin secciones todavía.' : 'No hay años vacíos disponibles.'}
              />
            </div>
            {mode === 'new' ? (
              <div className="rollover__form">
                <Field label="Nombre del nuevo año">
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="2027-2028" maxLength={30} autoFocus />
                </Field>
                <div className="form-grid">
                  <Field label="Fecha de inicio">
                    <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </Field>
                  <Field label="Fecha de fin" error={datesInvalid ? 'Debe ser posterior al inicio.' : undefined}>
                    <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                  </Field>
                </div>
                <p className="text-sm text-muted">Las fechas se calcularon sumando un año a las de {preview.source.name}. Puedes cambiarlas ahora o después.</p>
              </div>
            ) : (
              <div className="rollover__form">
                <Field label="Año de destino">
                  <Select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
                    {preview.target_candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </>
        )}

        {step === 2 && preview && (
          <>
            <p className="rollover__lead">Marca lo que quieres llevar a {targetName}. Lo que no marques lo podrás cargar después.</p>
            <div className="rollover-options">
              {PARTS.map((part) => {
                const n = part.count(preview);
                const needs = (preview.requires[part.key] || []).map((k) => PART_BY_KEY[k].title);
                return (
                  <OptionCard
                    key={part.key}
                    part={part}
                    preview={preview}
                    count={n}
                    checked={Boolean(options[part.key])}
                    disabled={n === 0}
                    needs={needs}
                    onChange={(on) => toggle(part.key, on)}
                  />
                );
              })}
            </div>

            {options.teachers && preview.ineligible_teachers.length > 0 && (
              <Alert variant="warning">
                {plural(preview.ineligible_teachers.length, ['docente ya no está activo', 'docentes ya no están activos'])} (o ya no son personal docente):{' '}
                <strong>{preview.ineligible_teachers.map((t) => t.name).join(', ')}</strong>. Sus asignaciones no se copiarán y esos puestos quedarán vacantes para que asignes a otra persona.
              </Alert>
            )}

            <div className="rollover-included">
              <span className="rollover-included__title">
                <Icon name="checkCircle" size={15} /> Ya incluido, sin copiar
              </span>
              <p className="text-sm">
                {plural(preview.shared.grades, ['grado', 'grados'])}, {plural(preview.shared.subjects, ['materia', 'materias'])}, el plan de estudios y{' '}
                {plural(preview.shared.classrooms, ['aula', 'aulas'])} son del colegio y sirven para todos los años.
              </p>
            </div>
            <div className="rollover-included rollover-included--muted">
              <span className="rollover-included__title">
                <Icon name="graduation" size={15} /> Los alumnos no se copian
              </span>
              <p className="text-sm">
                El nuevo año empieza sin alumnos. Las inscripciones de {preview.source.name} se conservan como historial (notas y boletas). Al terminar te llevamos a
                <strong> Cierre y promoción</strong> para pasar a cada alumno a su nuevo grado.
              </p>
            </div>
          </>
        )}

        {step === 3 && preview && (
          <>
            <div className="rollover-summary">
              <div className="rollover-summary__flow">
                <div>
                  <span className="rollover-summary__label">Desde</span>
                  <strong>{preview.source.name}</strong>
                </div>
                <Icon name="arrowRight" size={20} />
                <div>
                  <span className="rollover-summary__label">{mode === 'new' ? 'Se creará' : 'Hacia'}</span>
                  <strong>{targetName}</strong>
                  {mode === 'new' && (form.startDate || form.endDate) && (
                    <span className="text-sm text-muted">
                      {dateLabel(form.startDate) || '—'} → {dateLabel(form.endDate) || '—'}
                    </span>
                  )}
                </div>
              </div>
              <span className="rollover-summary__label">Se copiará</span>
              <ul className="rollover-summary__list">
                {chosen.map((p) => (
                  <li key={p.key}>
                    <Icon name="check" size={15} /> {p.title}
                    {p.unit && <span className="text-muted"> · {plural(p.count(preview), p.unit)}</span>}
                  </li>
                ))}
              </ul>
              {PARTS.some((p) => !options[p.key]) && (
                <>
                  <span className="rollover-summary__label">No se copiará</span>
                  <p className="text-sm text-muted">{PARTS.filter((p) => !options[p.key]).map((p) => p.title).join(', ')}.</p>
                </>
              )}
            </div>
            <Alert variant="info">Todo se copia de una sola vez: si algo falla, no se guarda nada y puedes intentarlo de nuevo. El año {preview.source.name} no se modifica.</Alert>
            <Alert>{runError}</Alert>
          </>
        )}
      </div>

      <div className="rollover__footer">
        <Button variant="ghost" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)} disabled={running} icon={step === 0 ? undefined : 'arrowLeft'}>
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext || (step === 0 && !preview?.counts.sections)}>
            Continuar <Icon name="arrowRight" size={16} />
          </Button>
        ) : (
          <Button icon="sparkles" onClick={run} loading={running} loadingText="Copiando…" disabled={!canNext}>
            {mode === 'new' ? `Crear ${targetName} y copiar` : `Copiar a ${targetName}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function Stepper({ step }) {
  return (
    <div className="rollover-stepper">
      <ol>
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="rollover-stepper__dot">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
            <span className="rollover-stepper__label">{label}</span>
          </li>
        ))}
      </ol>
      <div className="progress-bar" aria-hidden="true">
        <div className="progress-bar__fill" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
      </div>
    </div>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="rollover-stat">
      <Icon name={icon} size={18} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ChoiceCard({ selected, onSelect, disabled, icon, title, desc }) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} className={`rollover-choice ${selected ? 'is-selected' : ''}`} onClick={onSelect}>
      <Icon name={icon} size={20} />
      <span>
        <strong>{title}</strong>
        <span className="text-sm text-muted">{desc}</span>
      </span>
    </button>
  );
}

function OptionCard({ part, preview, count, checked, disabled, needs, onChange }) {
  const desc = typeof part.desc === 'function' ? part.desc(preview) : part.desc;
  return (
    <label className={`rollover-option ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="rollover-option__icon">
        <Icon name={part.icon} size={18} />
      </span>
      <span className="rollover-option__text">
        <strong>{part.title}</strong>
        <span className="text-sm text-muted">{desc}</span>
        <span className="rollover-option__meta">
          {disabled ? 'Nada que copiar' : part.unit ? plural(count, part.unit) : 'Configuración del año'}
          {needs.length > 0 && !disabled && <> · Incluye {needs.join(', ').toLowerCase()}</>}
        </span>
      </span>
      <span className="rollover-option__check" aria-hidden="true">
        <Icon name="check" size={14} />
      </span>
    </label>
  );
}

const SKIP_LABELS = {
  guide_teachers: ['profesor guía', 'profesores guía'],
  homeroom_teachers: ['docente de aula', 'docentes de aula'],
  subject_teachers: ['profesor por materia', 'profesores por materia'],
  schedule_classes: ['clase del horario', 'clases del horario'],
};

function RolloverDone({ result, source, canPromote, onClose }) {
  const target = result.target;
  const copied = PARTS.filter((p) => result.options[p.key]);
  const skipped = Object.entries(result.skipped).filter(([, n]) => n > 0);
  return (
    <Modal title="Año escolar listo" size="lg" onClose={onClose} className="rollover">
      <div className="rollover__body rollover-done">
        <div className="rollover-done__icon">
          <Icon name="checkCircle" size={34} />
        </div>
        <h3>{result.created ? `¡${target.name} está creado!` : `Estructura copiada a ${target.name}`}</h3>
        <p className="text-muted">Se copió la estructura de {source.name}.</p>
        <ul className="rollover-summary__list rollover-done__list">
          {copied.map((p) => (
            <li key={p.key}>
              <Icon name="check" size={15} /> {p.title}
              {p.unit && <span className="text-muted"> · {plural(result.copied[p.key], p.unit)}</span>}
            </li>
          ))}
        </ul>
        {skipped.length > 0 && (
          <Alert variant="warning">
            No se copiaron {skipped.map(([k, n]) => plural(n, SKIP_LABELS[k])).join(', ')} porque el docente ya no está activo o la materia ya no está en el plan del grado. Revisa
            esos puestos en Secciones y docentes.
          </Alert>
        )}
        <span className="rollover-summary__label">Siguientes pasos</span>
        <div className="rollover-next">
          {canPromote && (
            <Link to={`/academics/promotion?from=${source.id}&to=${target.id}`} className="rollover-next__item" onClick={onClose}>
              <Icon name="graduation" size={20} />
              <span>
                <strong>Pasar a los alumnos</strong>
                <span className="text-sm text-muted">Promueve a cada alumno a su nuevo grado y sección.</span>
              </span>
              <Icon name="arrowRight" size={16} />
            </Link>
          )}
          <Link to="/secciones-academicas" className="rollover-next__item" onClick={onClose}>
            <Icon name="layers" size={20} />
            <span>
              <strong>Revisar secciones y docentes</strong>
              <span className="text-sm text-muted">Ajusta lo que cambió para el nuevo año.</span>
            </span>
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>
      </div>
      <div className="rollover__footer">
        <span />
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Modal>
  );
}

export default YearRolloverWizard;
