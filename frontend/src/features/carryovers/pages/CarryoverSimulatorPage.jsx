import { useState } from 'react';
import { Link } from 'react-router-dom';
import carryoversApi from '../../../api/endpoints/carryovers.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import MomentTimeline, { CARRYOVER_STATUS, fmtGrade } from '../components/MomentTimeline';
import { MAX_MOMENTS, SCALE_MAX, gradeMoment, isGraded, openCarryover, savePlan } from '../carryoverRules';

let seq = 0;
const key = () => {
  seq += 1;
  return `s${seq}`;
};
const momentRow = (n, description = '') => ({ key: key(), name: `Momento ${n}`, description });

const DEFAULT_SCENARIO = {
  studentName: 'Luis Pérez (ficticio)',
  currentGrade: '4to año',
  subjectName: 'Castellano',
  sourceGrade: '3er año',
  sourceFinal: '8',
  passing: '10',
  moments: [momentRow(1, 'Prueba escrita'), momentRow(2, 'Trabajo de investigación'), momentRow(3, 'Prueba final integral')],
};

const parseGrade = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return String(v).trim() !== '' && Number.isFinite(n) && n >= 0 && n <= SCALE_MAX ? n : null;
};
const LOG_ICON = { info: 'info', pass: 'checkCircle', fail: 'x', open: 'arrowRight', skip: 'arrowRight', notify: 'send' };

/** El escenario: el alumno ficticio, la materia que arrastra y su plan especial. */
function ScenarioForm({ value, onChange, onStart, realItems }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setMoment = (k, patch) => set({ moments: value.moments.map((m) => (m.key === k ? { ...m, ...patch } : m)) });
  const passing = parseGrade(value.passing);
  const sourceFinal = parseGrade(value.sourceFinal);
  const problems = [
    !value.studentName.trim() && 'Escribe el nombre del alumno.',
    !value.subjectName.trim() && 'Escribe la materia pendiente.',
    passing === null && `La nota mínima va de 0 a ${SCALE_MAX}.`,
    sourceFinal === null && `La nota del año reprobado va de 0 a ${SCALE_MAX}.`,
    passing !== null && sourceFinal !== null && sourceFinal >= passing && 'Con esa nota el alumno habría aprobado: no tendría la materia pendiente.',
    value.moments.some((m) => !m.name.trim()) && 'Cada momento necesita un nombre.',
  ].filter(Boolean);

  const copyReal = (id) => {
    const c = realItems.find((x) => x.id === id);
    if (!c) return;
    onChange({
      studentName: `${c.first_name} ${c.last_name}`,
      currentGrade: c.current_grade_name || '',
      subjectName: c.subject_name,
      sourceGrade: c.source_grade_name || '',
      sourceFinal: c.source_final_grade === null ? '' : String(c.source_final_grade),
      passing: String(c.passing_grade),
      moments: c.moments.length ? c.moments.map((m) => ({ key: key(), name: m.name, description: m.description || '' })) : DEFAULT_SCENARIO.moments.map((m) => ({ ...m, key: key() })),
    });
  };

  return (
    <section className="card sim-panel">
      <h3 className="card__title">1 · El escenario</h3>
      {realItems.length > 0 && (
        <Field label="Partir de una materia pendiente real (opcional)" hint="Se copian sus datos y su plan; la materia real no cambia.">
          <Select value="" onChange={(e) => copyReal(e.target.value)}>
            <option value="">Elegir…</option>
            {realItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name} · {c.subject_name} ({c.source_grade_name})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="sim-grid">
        <Field label="Alumno">
          <Input value={value.studentName} onChange={(e) => set({ studentName: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Cursa ahora">
          <Input value={value.currentGrade} onChange={(e) => set({ currentGrade: e.target.value })} maxLength={40} />
        </Field>
        <Field label="Materia pendiente">
          <Input value={value.subjectName} onChange={(e) => set({ subjectName: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Del año">
          <Input value={value.sourceGrade} onChange={(e) => set({ sourceGrade: e.target.value })} maxLength={40} />
        </Field>
        <Field label="Nota con la que la reprobó">
          <Input type="number" inputMode="decimal" min={0} max={SCALE_MAX} step="0.01" value={value.sourceFinal} onChange={(e) => set({ sourceFinal: e.target.value })} />
        </Field>
        <Field label="Se aprueba con" hint="La nota mínima del año en que la reprobó.">
          <Input type="number" inputMode="decimal" min={0} max={SCALE_MAX} step="0.01" value={value.passing} onChange={(e) => set({ passing: e.target.value })} />
        </Field>
      </div>

      <h4 className="sim-subtitle">Plan de evaluación especial</h4>
      <ol className="sim-moments">
        {value.moments.map((m, i) => (
          <li key={m.key}>
            <span className="sim-moments__n">{i + 1}</span>
            <Input value={m.name} onChange={(e) => setMoment(m.key, { name: e.target.value })} maxLength={80} aria-label={`Nombre del momento ${i + 1}`} />
            <Input value={m.description} onChange={(e) => setMoment(m.key, { description: e.target.value })} maxLength={200} placeholder="Actividad (opcional)" aria-label={`Actividad del momento ${i + 1}`} />
            <button type="button" className="ep-icon is-danger" onClick={() => set({ moments: value.moments.filter((x) => x.key !== m.key) })} disabled={value.moments.length === 1} title="Quitar" aria-label={`Quitar ${m.name}`}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ol>
      <Button size="sm" variant="secondary" icon="plus" onClick={() => set({ moments: [...value.moments, momentRow(value.moments.length + 1)] })} disabled={value.moments.length >= MAX_MOMENTS}>
        Agregar momento
      </Button>
      {problems.length > 0 && <p className="sim-problem">{problems[0]}</p>}
      <Button icon="sparkles" onClick={onStart} disabled={problems.length > 0}>
        Comenzar la simulación
      </Button>
    </section>
  );
}

/** Calificar el momento habilitado (o corregir el último): botones rápidos y nota libre. */
function GradeControls({ moment, passing, correcting, onGrade, onCancel }) {
  const [value, setValue] = useState(correcting ? String(moment.grade) : '');
  const grade = parseGrade(value);
  const pass = Math.min(SCALE_MAX, Math.ceil(passing) + 4);
  const fail = Math.max(0, Math.floor(passing) - 4);
  return (
    <div className="cm-grade sim-grade">
      {!correcting && (
        <div className="sim-grade__quick">
          <Button size="sm" icon="check" onClick={() => onGrade(pass)}>
            Simular aprobado ({fmtGrade(pass)})
          </Button>
          <Button size="sm" variant="danger" icon="x" onClick={() => onGrade(fail)}>
            Simular reprobado ({fmtGrade(fail)})
          </Button>
        </div>
      )}
      <form
        className="sim-grade__free"
        onSubmit={(e) => {
          e.preventDefault();
          if (grade !== null) onGrade(grade);
        }}
      >
        <Input type="number" inputMode="decimal" min={0} max={SCALE_MAX} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder={correcting ? 'Nota corregida' : 'Otra nota'} aria-label="Nota" autoFocus={correcting} />
        <Button size="sm" variant="secondary" type="submit" disabled={grade === null}>
          {correcting ? 'Corregir' : 'Calificar'}
        </Button>
        {correcting && (
          <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </form>
      {grade !== null && (
        <p className={`cm-grade__effect ${grade >= passing ? 'is-pass' : 'is-fail'}`}>
          <Icon name={grade >= passing ? 'checkCircle' : 'alertTriangle'} size={15} />
          {grade >= passing ? 'Con esta nota aprueba: la materia queda liberada.' : 'Con esta nota reprueba: se habilita el siguiente momento, si queda alguno.'}
        </p>
      )}
    </div>
  );
}

/** La situación del alumno, como la verían la dirección y la familia. */
function StudentStatus({ scenario, carryover }) {
  const status = CARRYOVER_STATUS[carryover.status];
  const owes = carryover.status !== 'passed';
  return (
    <section className={`card sim-status sim-status--${carryover.status}`}>
      <div className="sim-status__who">
        <span className="sim-status__avatar">
          <Icon name="user" size={20} />
        </span>
        <div>
          <strong>{scenario.studentName}</strong>
          <span className="text-sm text-muted">Cursa {scenario.currentGrade || 'el año nuevo'} con normalidad</span>
        </div>
      </div>
      <dl className="cm-facts">
        <div>
          <dt>Materia pendiente</dt>
          <dd>
            {scenario.subjectName} {scenario.sourceGrade && `· ${scenario.sourceGrade}`}
          </dd>
        </div>
        <div>
          <dt>Estado del arrastre</dt>
          <dd>
            <Badge variant={status.variant}>{status.label}</Badge>
          </dd>
        </div>
        <div>
          <dt>Nota de recuperación</dt>
          <dd>{carryover.final_grade === null ? 'Aún no' : fmtGrade(carryover.final_grade)}</dd>
        </div>
        <div>
          <dt>Situación del alumno</dt>
          <dd className={owes ? 'sim-owes' : 'sim-clear'}>{owes ? `Debe 1 materia (${scenario.subjectName})` : 'Al día: sin materias pendientes'}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Académico → Materias pendientes → Simulador. Practica el flujo de recuperación
 * por momentos con un alumno ficticio: nada se guarda ni se envía. Las reglas son
 * las del sistema real (carryoverRules.js).
 */
function CarryoverSimulatorPage() {
  const { data } = useFetch(() => carryoversApi.list(), []);
  const realItems = data?.items || [];
  const [scenario, setScenario] = useState(DEFAULT_SCENARIO);
  // { carryover, steps: [{ title, events }], history: [carryover anterior] }
  const [sim, setSim] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState(null);
  const ctx = { studentName: scenario.studentName, subjectName: scenario.subjectName };

  const start = () => {
    const passing = parseGrade(scenario.passing);
    const opened = openCarryover(passing);
    const { next, events } = savePlan(
      opened,
      scenario.moments.map((m) => ({ name: m.name.trim(), description: m.description.trim() }))
    );
    setSim({
      carryover: next,
      history: [],
      steps: [
        {
          title: 'Promoción',
          events: [
            { kind: 'info', text: `${scenario.studentName} pasa a ${scenario.currentGrade || 'el año siguiente'} con ${scenario.subjectName} reprobada (${fmtGrade(parseGrade(scenario.sourceFinal))}): el sistema abre la materia pendiente. La boleta de ${scenario.sourceGrade || 'ese año'} no se modifica.` },
            ...events,
          ],
        },
      ],
    });
    setError(null);
  };

  const apply = (title, fn) => {
    try {
      const { next, events } = fn(sim.carryover);
      setSim((s) => ({ carryover: next, history: [...s.history, s.carryover], steps: [...s.steps, { title, events }] }));
      setCorrecting(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };
  const grade = (m, value) => apply(correcting ? `Corrección de ${m.name}` : `${m.name} calificado`, (c) => gradeMoment(c, m.position, value, ctx));
  const addMoment = () => apply('Decisión de la dirección', (c) => savePlan(c, [{ name: `Momento ${c.moments.length + 1}`, description: 'Agregado por la dirección' }]));
  const undo = () => {
    setSim((s) => ({ carryover: s.history[s.history.length - 1], history: s.history.slice(0, -1), steps: s.steps.slice(0, -1) }));
    setCorrecting(false);
    setError(null);
  };

  const c = sim?.carryover;
  const lastGraded = c ? [...c.moments].reverse().find(isGraded) : null;
  const moments = c ? c.moments.map((m) => ({ ...m, id: `p${m.position}`, scheduled_on: null, notes: null })) : [];

  return (
    <div>
      <PageHeader
        title="Simulador de arrastres y recuperación"
        subtitle="Prueba el flujo de una materia pendiente con un alumno ficticio, momento a momento."
        actions={
          <Link to="/carryovers" className="btn btn--secondary">
            <Icon name="arrowLeft" size={16} /> Materias pendientes
          </Link>
        }
      />
      <div className="sim-banner" role="note">
        <Icon name="shield" size={18} />
        <span>
          <strong>Modo simulación.</strong> Nada de lo que hagas aquí se guarda ni se notifica: no cambia ninguna materia, nota ni alumno real. Las reglas son las mismas que aplica el sistema.
        </span>
      </div>

      <div className="sim-layout">
        <aside className="sim-side">
          {sim ? (
            <section className="card sim-panel">
              <h3 className="card__title">1 · El escenario</h3>
              <p className="text-sm">
                <strong>{scenario.studentName}</strong> cursa {scenario.currentGrade} y arrastra <strong>{scenario.subjectName}</strong> de {scenario.sourceGrade} (nota {fmtGrade(parseGrade(scenario.sourceFinal))}). Se aprueba con {fmtGrade(parseGrade(scenario.passing))}.
              </p>
              <Button size="sm" variant="secondary" icon="refresh" onClick={() => setSim(null)}>
                Cambiar el escenario
              </Button>
            </section>
          ) : (
            <ScenarioForm value={scenario} onChange={setScenario} onStart={start} realItems={realItems} />
          )}
          <section className="card sim-panel">
            <h3 className="card__title">Así funciona</h3>
            <ul className="sim-rules">
              <li>
                <Icon name="lock" size={14} /> Solo un momento está habilitado a la vez; los demás esperan su turno.
              </li>
              <li>
                <Icon name="checkCircle" size={14} /> <span>Si <b>aprueba</b> un momento, la materia queda liberada y los momentos siguientes ya no hacen falta.</span>
              </li>
              <li>
                <Icon name="arrowRight" size={14} /> <span>Si <b>reprueba</b>, se habilita el siguiente. Si era el último, la materia queda no aprobada y la dirección decide si agrega momentos.</span>
              </li>
              <li>
                <Icon name="pencil" size={14} /> Solo se corrige la última nota; lo que seguía se recalcula.
              </li>
            </ul>
          </section>
        </aside>

        <div className="sim-main">
          {!sim ? (
            <div className="sim-empty">
              <Icon name="sparkles" size={28} />
              <strong>Prepara el escenario y pulsa «Comenzar la simulación»</strong>
              <span>Verás el plan especial y podrás simular que el alumno aprueba o reprueba cada momento.</span>
            </div>
          ) : (
            <>
              <StudentStatus scenario={scenario} carryover={c} />
              <section className="card sim-panel">
                <div className="cm-section-head">
                  <h3 className="card__title">2 · Plan especial por momentos</h3>
                  <span className="sim-actions">
                    <Button size="sm" variant="ghost" icon="arrowLeft" onClick={undo} disabled={!sim.history.length}>
                      Deshacer
                    </Button>
                    <Button size="sm" variant="ghost" icon="refresh" onClick={start}>
                      Reiniciar
                    </Button>
                  </span>
                </div>
                {error && <p className="sim-problem">{error}</p>}
                <MomentTimeline
                  moments={moments}
                  renderExtra={(m) => {
                    if (m.status === 'open') return <GradeControls key={`g${m.position}`} moment={m} passing={c.passing_grade} onGrade={(v) => grade(m, v)} />;
                    if (lastGraded?.position === m.position)
                      return correcting ? (
                        <GradeControls key={`c${m.position}`} moment={m} passing={c.passing_grade} correcting onGrade={(v) => grade(m, v)} onCancel={() => setCorrecting(false)} />
                      ) : (
                        <button type="button" className="link-button sim-fix" onClick={() => setCorrecting(true)}>
                          Corregir esta nota
                        </button>
                      );
                    return null;
                  }}
                />
                {c.status === 'passed' && (
                  <p className="sim-result is-pass">
                    <Icon name="checkCircle" size={18} /> Arrastre cerrado: {scenario.studentName} aprobó {scenario.subjectName} con {fmtGrade(c.final_grade)}.
                  </p>
                )}
                {c.status === 'failed' && (
                  <div className="sim-result is-fail">
                    <Icon name="alertTriangle" size={18} />
                    <span>Completó el plan sin aprobar. En el sistema real, la dirección o la coordinación pueden agregar otro momento.</span>
                    <Button size="sm" variant="secondary" icon="plus" onClick={addMoment} disabled={c.moments.length >= MAX_MOMENTS}>
                      Agregar un momento
                    </Button>
                  </div>
                )}
              </section>

              <section className="card sim-panel">
                <h3 className="card__title">3 · Lo que hace el sistema</h3>
                <ol className="sim-log">
                  {[...sim.steps].reverse().map((step, i) => (
                    <li key={sim.steps.length - i}>
                      <span className="sim-log__step">
                        Paso {sim.steps.length - i} · {step.title}
                      </span>
                      <ul>
                        {step.events.map((e, k) => (
                          <li key={k} className={`sim-log__event is-${e.kind}`}>
                            <Icon name={LOG_ICON[e.kind]} size={14} /> <span>{e.text}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CarryoverSimulatorPage;
