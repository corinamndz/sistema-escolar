import { useState } from 'react';
import Icon from '../../../components/ui/Icon';
import Button from '../../../components/ui/Button';
import { SETUP_STEPS } from './useSetupStatus';

const storageKey = (key) => `academics.guide.${key}.collapsed`;

function readCollapsed(key) {
  try {
    return localStorage.getItem(storageKey(key)) === '1';
  } catch {
    return false;
  }
}

/**
 * Banner de ayuda de un paso: qué hacer aquí, cómo se conecta con el resto
 * y cuál es la siguiente acción concreta. Se puede contraer (se recuerda por
 * navegador) para no estorbar a quien ya conoce el flujo.
 */
export function StepGuide({ step, guide }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(step.key));

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(storageKey(step.key), c ? '0' : '1');
      } catch {
        // almacenamiento no disponible: solo afecta a recordar la preferencia
      }
      return !c;
    });
  };

  return (
    <div className={`step-guide ${collapsed ? 'step-guide--collapsed' : ''}`}>
      <div className="step-guide__head">
        <span className="step-guide__icon">
          <Icon name={step.icon} size={18} />
        </span>
        <div className="step-guide__heading">
          <div className="step-guide__eyebrow">Paso {step.number} de {SETUP_STEPS.length}</div>
          <h3>{step.title}</h3>
        </div>
        <button type="button" className="step-guide__toggle" onClick={toggle} aria-expanded={!collapsed}>
          <Icon name="helpCircle" size={15} />
          {collapsed ? 'Ver guía' : 'Ocultar guía'}
        </button>
      </div>

      {!collapsed && (
        <div className="step-guide__body">
          <p>{guide.intro}</p>
          {guide.links?.length > 0 && (
            <ul className="step-guide__links">
              {guide.links.map((text, i) => (
                <li key={i}>
                  <Icon name="arrowRight" size={14} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step.todo ? (
        <div className="step-guide__todo">
          <strong>Qué falta:</strong> {step.todo}
        </div>
      ) : (
        <div className="step-guide__todo step-guide__todo--done">
          <Icon name="checkCircle" size={15} />
          {step.optional ? step.summary : `Paso completo · ${step.summary}`}
        </div>
      )}
    </div>
  );
}

/** Aviso cuando se abre un paso cuyo requisito previo aún no está listo. */
export function BlockedNotice({ blockedBy, onGo }) {
  const prev = SETUP_STEPS.find((s) => s.key === blockedBy);
  if (!prev) return null;
  return (
    <div className="alert alert--warning step-blocked">
      <Icon name="alertTriangle" size={17} />
      <div>
        Antes de este paso completa <strong>Paso {prev.number}: {prev.title}</strong>. Lo que hagas aquí depende de eso.
      </div>
      <Button size="sm" variant="secondary" onClick={() => onGo(prev.key)}>
        Ir al paso {prev.number}
      </Button>
    </div>
  );
}

/**
 * Pie de cada paso: volver / continuar. El botón de continuar es primario solo
 * cuando el paso actual ya está completo, para no competir con la acción
 * principal de la pantalla ("Nuevo grado", "Nueva sección"…).
 */
export function StepFooter({ step, onGo }) {
  const index = SETUP_STEPS.findIndex((s) => s.key === step.key);
  const prev = SETUP_STEPS[index - 1];
  const next = SETUP_STEPS[index + 1];

  return (
    <div className="step-footer">
      {prev ? (
        <Button variant="ghost" icon="arrowLeft" onClick={() => onGo(prev.key)}>
          {prev.short}
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <div className="step-footer__next">
          {!step.done && <span className="text-sm text-muted">Puedes seguir y volver luego.</span>}
          <Button variant={step.done ? 'primary' : 'secondary'} onClick={() => onGo(next.key)}>
            Continuar: {next.short}
            <Icon name="arrowRight" size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
