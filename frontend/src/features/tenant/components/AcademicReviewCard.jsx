import { useState } from 'react';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Switch from '../../../components/ui/Switch';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';

const FLOW = [
  { icon: 'pencil', title: 'El docente prepara', text: 'Carga las unidades y temas de su materia.' },
  { icon: 'arrowRight', title: 'Envía a revisión', text: 'Queda bloqueado para editar y se avisa al coordinador del nivel.' },
  { icon: 'clipboard', title: 'Coordinación revisa', text: 'Aprueba o solicita ajustes con comentarios.' },
  { icon: 'checkCircle', title: 'Aprobado', text: 'Queda fijo; si hace falta cambiarlo, coordinación lo reabre.' },
];

/**
 * Configuración → Revisión académica: si el contenido programático pasa por
 * la revisión del coordinador de cada nivel antes de quedar aprobado.
 * Se guarda al instante, como los demás interruptores.
 */
function AcademicReviewCard({ canEdit }) {
  const toast = useToast();
  const { data, setData, loading, error } = useFetch(() => tenantApi.getAcademicSettings(), []);
  const [saving, setSaving] = useState(false);

  const toggle = async (on) => {
    setSaving(true);
    try {
      setData(await tenantApi.updateAcademicSettings(on));
      toast.success(on ? 'Revisión académica activada' : 'Revisión académica desactivada', on ? 'El contenido programático pasa por coordinación.' : 'Los docentes publican su contenido directamente.');
    } catch (err) {
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  const on = Boolean(data?.requiresAcademicReview);

  return (
    <div className="card academic-review">
      <Alert>{error}</Alert>
      <Switch
        checked={on}
        onChange={toggle}
        disabled={!canEdit || saving}
        label="El contenido programático requiere revisión de coordinación"
        description={
          on
            ? 'Activado: cada docente envía el contenido de su materia a revisión y el coordinador de su nivel lo aprueba o pide ajustes.'
            : 'Desactivado: los docentes guardan y publican su contenido programático directamente, sin revisión.'
        }
      />

      <ol className={`academic-review__flow ${on ? '' : 'is-off'}`} aria-label="Cómo funciona la revisión">
        {FLOW.map((s, i) => (
          <li key={s.title}>
            <span className="academic-review__step">
              <Icon name={s.icon} size={16} />
            </span>
            <strong>
              {i + 1}. {s.title}
            </strong>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted academic-review__note">
        <Icon name="info" size={14} /> El aviso llega por la campana al coordinador del nivel del grado (Inicial, Primaria o Secundaria); si el nivel no tiene
        coordinador, al Director.
      </p>
      <p className="text-sm text-muted academic-review__note">
        <Icon name="users" size={14} />
        {on
          ? 'Portal de las familias: solo ven el contenido programático y los planes de evaluación (con sus notas) que coordinación aprobó. Al aprobar un plan se les avisa.'
          : 'Portal de las familias: ven el contenido programático y los planes de evaluación apenas el docente los guarda.'}
      </p>
      {!on && data?.pendingContentReviews > 0 && (
        <Alert variant="warning">
          Hay {data.pendingContentReviews} contenido{data.pendingContentReviews === 1 ? '' : 's'} esperando revisión: mientras esté desactivada no aparecen en la bandeja
          de coordinación y los docentes pueden editarlos libremente.
        </Alert>
      )}
    </div>
  );
}

export default AcademicReviewCard;
