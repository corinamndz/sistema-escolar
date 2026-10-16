import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { CLUB_CATEGORIES, sessionSummary } from '../../clubs/clubCatalog';
import { SessionChips } from '../../clubs/components/ClubModals';

const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Pestaña "Clubes" del portal del representante: a qué clubes y actividades
 * extracurriculares está inscrito su hijo (también las personalizadas
 * creadas con "OTRO"). Los del año en curso arriba; los anteriores o de los
 * que se retiró, como historial.
 */
function PortalClubs({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentClubs(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const current = (data || []).filter((m) => m.status === 'active' && m.period_active);
  const past = (data || []).filter((m) => !(m.status === 'active' && m.period_active));

  if (!data?.length) {
    return (
      <div className="card empty-state">
        <div className="empty-state__icon">
          <Icon name="star" size={24} />
        </div>
        <div className="empty-state__title">Sin clubes ni actividades</div>
        <div className="text-sm">Tu representado aún no está inscrito en ningún club o actividad extracurricular.</div>
      </div>
    );
  }

  const Card = ({ m }) => {
    const cat = CLUB_CATEGORIES[m.category] || CLUB_CATEGORIES.otro;
    return (
      <article className={`club-card club-card--${m.category} portal-club ${m.status !== 'active' ? 'is-inactive' : ''}`}>
        <div className="club-card__main">
          <span className="club-card__icon">
            <Icon name={cat.icon} size={20} />
          </span>
          <span className="club-card__body">
            <strong className="club-card__name">{m.club_name}</strong>
            <span className="club-card__meta">
              {cat.label}
              {m.is_custom && <span className="chip club-card__custom">Personalizada</span>}
            </span>
            {sessionSummary(m) && (
              <span className="club-card__line">
                <Icon name="clock" size={13} /> {sessionSummary(m)}
              </span>
            )}
            {m.status === 'active' && m.session_dates?.some((d) => d >= today) && <SessionChips dates={m.session_dates.filter((d) => d >= today)} />}
            {m.coordinator_name && (
              <span className="club-card__line">
                <Icon name="user" size={13} /> Coordina: Prof. {m.coordinator_name}
              </span>
            )}
            {m.description && <span className="club-card__line text-muted">{m.description}</span>}
          </span>
        </div>
        <div className="club-card__foot">
          <span className="text-sm text-muted">
            {m.school_period_name} · desde el {dmy(m.joined_on)}
            {m.status !== 'active' && m.withdrawn_on ? ` · retirado el ${dmy(m.withdrawn_on)}` : ''}
          </span>
        </div>
      </article>
    );
  };

  return (
    <div className="portal-clubs">
      {current.length > 0 ? (
        <div className="clubs-grid">
          {current.map((m) => (
            <Card key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <p className="text-muted">Este año no está inscrito en ningún club.</p>
      )}
      {past.length > 0 && (
        <>
          <h3 className="portal-clubs__title">Años anteriores y actividades dejadas</h3>
          <div className="clubs-grid">
            {past.map((m) => (
              <Card key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default PortalClubs;
