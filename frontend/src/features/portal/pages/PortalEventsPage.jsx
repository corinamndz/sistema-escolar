import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import EventBoard from '../../events/components/EventBoard';
import EventDetailModal from '../../events/components/EventDetailModal';

/**
 * Cartelera del colegio en el portal del representante: los eventos
 * publicados para todo el colegio y los dirigidos al grado o la sección de
 * sus hijos. Al tocar un evento se abre su detalle completo.
 */
function PortalEventsPage() {
  const { data, loading, error } = useFetch(() => portalApi.getEvents(), []);
  const [viewing, setViewing] = useState(null); // evento abierto en el detalle

  return (
    <div>
      <PageHeader title="Cartelera del colegio" subtitle="Actos culturales, eventos familiares, asambleas y reuniones" />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        <EventBoard
          events={data || []}
          onSelect={setViewing}
          empty={
            <div className="card empty-state">
              <div className="empty-state__icon">
                <Icon name="calendar" size={24} />
              </div>
              <div className="empty-state__title">Sin eventos programados</div>
              <div className="text-sm">Cuando el colegio publique un acto, una asamblea o un evento familiar, aparecerá aquí.</div>
            </div>
          }
        />
      )}
      {viewing && <EventDetailModal event={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

export default PortalEventsPage;
