import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { RecognitionCelebration } from '../../recognitions/components/RecognitionCard';
import { CertificateModal } from '../../recognitions/components/RecognitionCertificate';

/** Portal: los reconocimientos del alumno (del más reciente al más antiguo), con su tarjeta de celebración y su certificado (ver, imprimir, PDF). */
function PortalRecognitions({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentRecognitions(studentId), [studentId]);
  const [certificate, setCertificate] = useState(null);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data.length) {
    return (
      <div className="card empty-state">
        <div className="empty-state__icon">
          <Icon name="award" size={24} />
        </div>
        <div className="empty-state__title">Aún no tiene reconocimientos</div>
        <div className="text-sm">Cuando el colegio reconozca un logro, lo verás aquí y te llegará un aviso.</div>
      </div>
    );
  }
  return (
    <div className="rec-wall">
      <p className="rec-wall__count">
        <Icon name="award" size={16} /> {data.length} reconocimiento{data.length === 1 ? '' : 's'}
      </p>
      {data.map((r) => (
        <div key={r.id} className="rec-wall__item">
          <RecognitionCelebration recognition={r} />
          <Button variant="secondary" icon="file" className="btn--block" onClick={() => setCertificate(r)}>
            Ver certificado · Descargar PDF
          </Button>
        </div>
      ))}
      {certificate && (
        <CertificateModal
          recognition={certificate}
          loadPdf={() => portalApi.getRecognitionCertificateBlob(studentId, certificate.id)}
          onClose={() => setCertificate(null)}
        />
      )}
    </div>
  );
}

export default PortalRecognitions;
