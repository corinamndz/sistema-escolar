import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import websiteApi from '../../../api/endpoints/website.api';
import { useFetch } from '../../../hooks/useFetch';
import Spinner from '../../../components/ui/Spinner';
import SchoolSite from '../components/SchoolSite';

/**
 * /colegio/:slug — página pública del colegio, sin iniciar sesión. Si no existe
 * o no está publicada, un aviso neutro (no revela si el colegio existe).
 */
function PublicSitePage() {
  const { slug } = useParams();
  const { data, loading, error } = useFetch(() => websiteApi.getPublic(slug), [slug]);

  useEffect(() => {
    if (data?.school?.name) document.title = data.site.tagline ? `${data.school.name} · ${data.site.tagline}` : data.school.name;
  }, [data]);

  if (loading) {
    return (
      <div className="site-public site-public--center">
        <Spinner label="Cargando…" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="site-public site-public--center">
        <div className="site-missing">
          <h1>Página no disponible</h1>
          <p>{error || 'Esta página no existe o el colegio aún no la ha publicado.'}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="site-public">
      <SchoolSite school={data.school} site={data.site} intake={data.intake} events={data.events || []} intakeHref={`/colegio/${data.slug}/solicitud`} />
    </div>
  );
}

export default PublicSitePage;
