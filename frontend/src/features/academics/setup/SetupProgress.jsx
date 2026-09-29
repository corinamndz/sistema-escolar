import Icon from '../../../components/ui/Icon';
import Button from '../../../components/ui/Button';

/**
 * Barra de progreso de la configuración + navegación entre pasos.
 * Cada paso muestra su estado real (completo / pendiente / no aplica) y se
 * puede abrir en cualquier orden; el "siguiente recomendado" va resaltado.
 */
function SetupProgress({ status, active, onSelect }) {
  const { steps, completed, total, next, allDone } = status;
  const percent = Math.round((completed / total) * 100);

  return (
    <section className={`setup-progress ${allDone ? 'setup-progress--done' : ''}`} aria-label="Progreso de configuración">
      <div className="setup-progress__head">
        <div>
          <div className="setup-progress__title">
            {allDone ? (
              <>
                <Icon name="checkCircle" size={18} /> Estructura académica lista
              </>
            ) : (
              'Configuración del colegio'
            )}
          </div>
          <div className="setup-progress__subtitle">
            {allDone
              ? 'Ya puedes inscribir alumnos desde cada sección. Vuelve a cualquier paso cuando necesites cambiar algo.'
              : `${completed} de ${total} pasos completos · Siguiente: ${next.title.toLowerCase()}`}
          </div>
        </div>
        {!allDone && next.key !== active && (
          <Button size="sm" icon="arrowRight" onClick={() => onSelect(next.key)}>
            Ir al paso {next.number}
          </Button>
        )}
      </div>

      <div className="progress-bar setup-progress__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>

      <ol className="setup-steps">
        {steps.map((step) => {
          const state = step.done ? 'done' : step.key === next?.key ? 'next' : 'todo';
          return (
            <li key={step.key}>
              <button
                type="button"
                className={`setup-step setup-step--${state} ${active === step.key ? 'is-active' : ''}`}
                onClick={() => onSelect(step.key)}
                aria-current={active === step.key ? 'step' : undefined}
              >
                <span className="setup-step__marker">
                  {step.done ? <Icon name="check" size={15} strokeWidth={2.6} /> : step.number}
                </span>
                <span className="setup-step__text">
                  <span className="setup-step__title">{step.short}</span>
                  <span className="setup-step__summary">
                    {step.optional ? 'No aplica' : step.done ? step.summary : state === 'next' ? 'Siguiente paso' : 'Pendiente'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default SetupProgress;
