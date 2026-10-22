import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import SchoolPeriodsTab from '../components/SchoolPeriodsTab';
import ClassroomsTab from '../components/ClassroomsTab';
import GradesTab from '../components/GradesTab';
import SetupProgress from '../setup/SetupProgress';
import { StepGuide, StepFooter, BlockedNotice } from '../setup/StepGuide';
import { INITIAL_SETUP_KEYS, INITIAL_SETUP_STEPS, useSetupStatus } from '../setup/useSetupStatus';
import { SETUP_GUIDES, ACADEMIC_SECTIONS_PATH } from '../setup/guides';

/**
 * Configuración inicial (/configuracion-inicial): la base del colegio antes de
 * operar, como asistente de pasos — 1. Año escolar, 2. Grados y aulas.
 * La operación diaria (secciones, su personal docente y la carga por docente)
 * está en Secciones y docentes (/secciones-academicas).
 */
function InitialSetupPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const { status, loading, error } = useSetupStatus(version, INITIAL_SETUP_KEYS);

  // Cualquier alta/edición en un paso recalcula el progreso.
  const refreshProgress = useCallback(() => setVersion((v) => v + 1), []);

  // Paso abierto: el de la URL (?paso=…), o el siguiente pendiente, o el último si todo está listo.
  const fromUrl = searchParams.get('paso');
  const active = INITIAL_SETUP_KEYS.includes(fromUrl) ? fromUrl : status?.next?.key || 'structure';

  // Al entrar sin ?paso= se fija el paso sugerido en la URL: así, al completar
  // algo, la pantalla no salta sola al paso siguiente (el usuario decide cuándo avanzar).
  useEffect(() => {
    if (status && !INITIAL_SETUP_KEYS.includes(fromUrl)) setSearchParams({ paso: active }, { replace: true });
  }, [status, fromUrl, active, setSearchParams]);

  const goTo = (key) => {
    setSearchParams({ paso: key }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goToSections = () => navigate(ACADEMIC_SECTIONS_PATH);

  if (loading) return <Spinner />;

  const step = status?.byKey[active];

  return (
    <div>
      <PageHeader
        title="Configuración inicial"
        subtitle="Prepara la base del colegio antes de operar: el año escolar en curso, los grados que ofreces y sus aulas."
      />
      <Alert>{error}</Alert>

      {status && (
        <SetupProgress
          status={status}
          active={active}
          onSelect={goTo}
          done={{
            title: 'Base del colegio lista',
            text: 'Ya puedes abrir las secciones del año y asignar su personal docente. Vuelve aquí cuando necesites cambiar el año escolar, los grados o las aulas.',
            action: (
              <Button size="sm" icon="arrowRight" onClick={goToSections}>
                Ir a Secciones y docentes
              </Button>
            ),
          }}
        />
      )}

      {step && (
        <>
          <StepGuide key={active} step={step} guide={SETUP_GUIDES[active]} total={INITIAL_SETUP_STEPS.length} />
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
      </div>

      {step && (
        <StepFooter step={step} onGo={goTo} steps={INITIAL_SETUP_STEPS} finish={{ label: 'Secciones y docentes', onClick: goToSections }} />
      )}
    </div>
  );
}

export default InitialSetupPage;
