import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Icon from '../../../components/ui/Icon';
import FormPdfButton from '../../enrollment-forms/components/FormPdfButton';

/** Por qué un alumno aún no tiene certificado, en palabras de la familia. */
function reasonOf(item) {
  if (item.locked) return item.locked;
  if (item.unpublished.length) return `El colegio aún no ha publicado el certificado de ${item.unpublished.join(' y ')}.`;
  // Lo que cursa ya se ve en la cabecera.
  if (item.current) return 'Aún no tiene certificados: el certificado se emite cuando es promovido al grado siguiente.';
  return 'Aún no tiene certificados de promoción.';
}

/**
 * Inicio del portal: los certificados de promoción de TODOS los alumnos del
 * representante, una sección por alumno, con los de todos sus años (el más
 * reciente primero). Un alumno sin certificado dice por qué. Si ningún alumno
 * tiene ni tendrá pronto uno (nada promovido todavía), la tarjeta no aparece.
 */
function PortalCertificates() {
  const { data } = useFetch(() => portalApi.getMyCertificates().catch(() => []), []);
  const items = data || [];
  if (!items.some((i) => i.certificates.length || i.unpublished.length)) return null;
  return (
    <Card title="Certificados de promoción" subtitle="De cada uno de tus alumnos, de todos los años escolares" className="portal-certs-card">
      <div className="portal-certs">
        {items.map((item) => (
          <section key={item.student.id} className="portal-certs__student">
            <header>
              <span className="avatar avatar--sm">
                {item.student.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <div>
                <strong>{item.student.name}</strong>
                {item.current && (
                  <span className="text-sm text-muted">
                    Cursa {item.current.grade_name} · {item.current.school_year}
                  </span>
                )}
              </div>
            </header>
            {item.certificates.length ? (
              <ul className="portal-certs__list">
                {item.certificates.map((c) => (
                  <li key={c.enrollment_id}>
                    <span>
                      <strong>{c.school_year}</strong>
                      <span className="text-sm text-muted">
                        {c.grade_name}
                        {c.target_grade ? ` → ${c.target_grade}` : ''}
                      </span>
                    </span>
                    <FormPdfButton load={() => portalApi.getStudentCertificate(item.student.id, c.enrollment_id)} fileName={`certificado-${item.student.name}-${c.school_year}.pdf`} label="Certificado" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`portal-certs__none ${item.locked ? 'is-locked' : ''}`}>
                <Icon name={item.locked ? 'lock' : 'info'} size={14} /> {reasonOf(item)}
              </p>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

export default PortalCertificates;
