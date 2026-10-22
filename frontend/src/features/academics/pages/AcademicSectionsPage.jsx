import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import Icon from '../../../components/ui/Icon';
import SectionsTab from '../components/SectionsTab';
import TeachingLoadTab from '../components/TeachingLoadTab';
import AcademicPanel from '../panel/AcademicPanel';
import { StepGuide } from '../setup/StepGuide';
import { useSetupStatus } from '../setup/useSetupStatus';
import { SETUP_GUIDES, INITIAL_SETUP_PATH } from '../setup/guides';

/** Vistas de la operación diaria (?vista=…). Todas son de secciones y docentes. */
const VIEWS = [
  { key: 'panel', label: 'Panel por grado', icon: 'layers' },
  { key: 'secciones', label: 'Secciones', icon: 'menu' },
  { key: 'carga', label: 'Carga por docente', icon: 'users' },
];

/**
 * Secciones y docentes (/secciones-academicas): la operación del día a día.
 *   - Panel por grado: secciones del grado y su personal docente según el nivel (autoguardado).
 *   - Secciones: listado de todas las secciones del año, con alta y asignación.
 *   - Carga por docente: qué tiene asignado cada docente.
 * Las materias tienen su módulo (/academics/subjects). La base (año escolar,
 * grados y aulas) está en Configuración inicial (/configuracion-inicial).
 */
function AcademicSectionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = VIEWS.some((v) => v.key === searchParams.get('vista')) ? searchParams.get('vista') : 'panel';
  const [version, setVersion] = useState(0);
  const { status } = useSetupStatus(version);
  const refreshProgress = useCallback(() => setVersion((v) => v + 1), []);

  const setView = (key) =>
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (key === 'panel') next.delete('vista');
        else next.set('vista', key);
        return next;
      },
      { replace: true }
    );
  const goToSetup = (key) => navigate(`${INITIAL_SETUP_PATH}?paso=${key}`);

  // Sin año escolar o sin grados no hay nada que operar: se indica dónde completarlo.
  const missing = status && (!status.byKey.period.done ? status.byKey.period : !status.byKey.structure.done ? status.byKey.structure : null);

  const viewToggle = (
    <div className="segmented" role="radiogroup" aria-label="Vista">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          role="radio"
          aria-checked={view === v.key}
          className={`segmented__item ${view === v.key ? 'segmented__item--active' : ''}`}
          onClick={() => setView(v.key)}
        >
          <Icon name={v.icon} size={15} /> {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Secciones y docentes"
        subtitle="La operación del año: abre secciones, asigna su personal docente según el nivel y revisa la carga de cada docente."
        actions={viewToggle}
      />

      {missing && (
        <div className="alert alert--warning step-blocked">
          <Icon name="alertTriangle" size={17} />
          <div>
            Falta completar la <strong>Configuración inicial</strong>: {missing.todo}
          </div>
          <Link to={`${INITIAL_SETUP_PATH}?paso=${missing.key}`} className="btn btn--secondary btn--sm">
            Ir a {missing.short}
          </Link>
        </div>
      )}

      {view === 'panel' && <AcademicPanel onGoToSetup={goToSetup} />}

      {view === 'secciones' && (
        <>
          {status && (
            <StepGuide step={status.byKey.sections} guide={SETUP_GUIDES.sections} eyebrow="Año escolar en curso" />
          )}
          <SectionsTab onChanged={refreshProgress} />
        </>
      )}

      {view === 'carga' && <TeachingLoadTab />}
    </div>
  );
}

export default AcademicSectionsPage;
