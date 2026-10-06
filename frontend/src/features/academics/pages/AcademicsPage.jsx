import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import SchoolPeriodsTab from '../components/SchoolPeriodsTab';
import ClassroomsTab from '../components/ClassroomsTab';
import GradesTab from '../components/GradesTab';
import SectionsTab from '../components/SectionsTab';
import SubjectsTab from '../components/SubjectsTab';
import TeachingLoadTab from '../components/TeachingLoadTab';
import SetupProgress from '../setup/SetupProgress';
import CurriculumChecklist from '../setup/CurriculumChecklist';
import { StepGuide, StepFooter, BlockedNotice } from '../setup/StepGuide';
import { SETUP_STEPS, useSetupStatus } from '../setup/useSetupStatus';
import { LEVELS } from '../levels';
import AcademicPanel from '../panel/AcademicPanel';

/** Textos de ayuda de cada paso: qué hacer y cómo se conecta con el resto. */
const GUIDES = {
  period: {
    intro:
      'El año escolar es el contenedor de todo un ciclo. Empieza creando el año en curso: sin él no se pueden abrir secciones ni inscribir alumnos.',
    links: [
      'Las secciones, las inscripciones y las notas quedan asociadas a un año escolar.',
      'Al comenzar un nuevo ciclo creas otro año y abres secciones nuevas; el historial del anterior se conserva.',
    ],
  },
  structure: {
    intro:
      'Registra los grados que ofrece el colegio (ej. "Sala 5", "3er grado", "1er año"). Al crear cada grado eliges su nivel educativo, y el nivel define cómo se asignan los docentes:',
    links: [
      `Inicial — ${LEVELS.initial.rule}`,
      `Primaria — ${LEVELS.primary.rule}`,
      `Secundaria — ${LEVELS.secondary.rule}`,
      'Las aulas físicas son opcionales: solo sirven para indicar dónde funciona cada sección.',
    ],
  },
  subjects: {
    intro:
      'Necesario para Primaria y Secundaria. Primero crea el catálogo de materias (una sola vez) y después arma el plan de estudios de cada grado (ej. 1er a 6to grado: Castellano, Matemática, Ciencias Naturales…).',
    links: [
      'Una misma materia (ej. Matemática) se reutiliza en todos los grados que la vean.',
      'Las materias del plan de estudios son las que tendrán plan de evaluación y notas por lapso. En Primaria las dicta el titular de la sección (o un especialista); en Secundaria, un profesor por materia (paso 4).',
    ],
  },
  sections: {
    intro:
      'Crea las secciones del año en curso (ej. "3er grado A") y asígnales docentes. Cada sección hereda las reglas del nivel de su grado:',
    links: [
      'Inicial: docente titular y auxiliar. Primaria: un titular que dicta las materias, con especialistas opcionales. Secundaria: un profesor por materia.',
      'Al crear una sección se abre directamente la asignación de docentes.',
      'Después, inscribe a los alumnos desde el detalle de cada sección.',
    ],
  },
};

const STEP_KEYS = SETUP_STEPS.map((s) => s.key);

/**
 * Estructura académica. Vista principal: el PANEL POR GRADO (materias del grado,
 * secciones, profesor guía y docentes por materia en una sola pantalla, con
 * autoguardado). La configuración por pasos queda para lo general: años
 * escolares, grados y aulas, catálogo de materias y carga por docente.
 */
function AcademicsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('vista') === 'pasos' || searchParams.get('paso') ? 'steps' : 'panel';
  const setView = (v) => setSearchParams(v === 'steps' ? { vista: 'pasos' } : {}, { replace: true });
  const goToSetup = (key) => setSearchParams({ vista: 'pasos', paso: key }, { replace: true });
  const [version, setVersion] = useState(0);
  const [sectionsView, setSectionsView] = useState('sections');
  const { status, loading, error } = useSetupStatus(version);

  // Cualquier alta/edición en un paso recalcula el progreso.
  const refreshProgress = useCallback(() => setVersion((v) => v + 1), []);

  // Paso abierto: el de la URL (?paso=…), o el siguiente pendiente, o el 4 si todo está listo.
  const fromUrl = searchParams.get('paso');
  const active = STEP_KEYS.includes(fromUrl) ? fromUrl : status?.next?.key || 'sections';

  // Al entrar sin ?paso= se fija el paso sugerido en la URL: así, al completar
  // algo, la pantalla no salta sola al paso siguiente (el usuario decide cuándo avanzar).
  useEffect(() => {
    if (view === 'steps' && status && !STEP_KEYS.includes(fromUrl)) setSearchParams({ vista: 'pasos', paso: active }, { replace: true });
  }, [view, status, fromUrl, active, setSearchParams]);

  const goTo = (key) => {
    setSearchParams({ vista: 'pasos', paso: key }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const viewTabs = (
    <Tabs
      tabs={[
        { key: 'panel', label: 'Panel por grado' },
        { key: 'steps', label: 'Configuración general' },
      ]}
      active={view}
      onChange={setView}
    />
  );

  if (view === 'panel') {
    return (
      <div>
        <PageHeader title="Estructura académica" subtitle="Elige un grado y configúralo en una sola pantalla: sus materias, sus secciones y el docente de cada una. Los cambios se guardan solos." />
        {viewTabs}
        <AcademicPanel onGoToSetup={goToSetup} />
      </div>
    );
  }

  if (loading) return <Spinner />;

  const step = status?.byKey[active];

  return (
    <div>
      <PageHeader
        title="Estructura académica"
        subtitle="Años escolares, grados y aulas, catálogo de materias y carga por docente. Para armar cada grado usa el Panel por grado."
      />
      {viewTabs}
      <Alert>{error}</Alert>

      {status && <SetupProgress status={status} active={active} onSelect={goTo} />}

      {step && (
        <>
          <StepGuide key={active} step={step} guide={GUIDES[active]} />
          {step.blockedBy && <BlockedNotice blockedBy={step.blockedBy} onGo={goTo} />}
        </>
      )}

      <div className="setup-step-content">
        {active === 'period' && <SchoolPeriodsTab onChanged={refreshProgress} />}

        {active === 'structure' && (
          <>
            <GradesTab onChanged={refreshProgress} />
            <ClassroomsTab onChanged={refreshProgress} />
          </>
        )}

        {active === 'subjects' && (
          <div className="setup-split">
            <SubjectsTab onChanged={refreshProgress} />
            <CurriculumChecklist onChanged={refreshProgress} />
          </div>
        )}

        {active === 'sections' && (
          <>
            <Tabs
              tabs={[
                { key: 'sections', label: 'Por sección' },
                { key: 'load', label: 'Carga por docente' },
              ]}
              active={sectionsView}
              onChange={setSectionsView}
            />
            {sectionsView === 'sections' ? <SectionsTab onChanged={refreshProgress} /> : <TeachingLoadTab />}
          </>
        )}
      </div>

      {step && <StepFooter step={step} onGo={goTo} />}
    </div>
  );
}

export default AcademicsPage;
