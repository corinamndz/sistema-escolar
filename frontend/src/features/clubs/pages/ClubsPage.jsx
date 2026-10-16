import { useEffect, useMemo, useState } from 'react';
import clubsApi from '../../../api/endpoints/clubs.api';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ClubFormModal, EnrollModal, MembersModal } from '../components/ClubModals';
import { CLUB_CATEGORIES, sessionSummary } from '../clubCatalog';

/**
 * Clubes y actividades extracurriculares: catálogo del colegio (con la
 * opción "OTRO" para actividades personalizadas) e inscripción de alumnos por
 * año escolar, individual o masiva. El coordinador de un club también puede
 * inscribir y retirar alumnos de SU club.
 */
function ClubsPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [periodId, setPeriodId] = useState('');
  useEffect(() => {
    if (periodId || !periods?.length) return;
    setPeriodId((periods.find((p) => p.is_active && !p.closed_at) || periods[0]).id);
  }, [periods, periodId]);
  const period = (periods || []).find((p) => p.id === periodId);

  const { data: clubs, loading, error, refetch } = useFetch(() => (periodId ? clubsApi.list(periodId) : Promise.resolve([])), [periodId]);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // {} nuevo | club
  const [enrolling, setEnrolling] = useState(null); // { clubId? }
  const [viewing, setViewing] = useState(null); // club

  const canAdmin = can('clubs', 'update') || can('clubs', 'create');
  const myStaffId = user?.teachingStaffId || user?.staffId || null;
  const canManage = (club) => canAdmin || (myStaffId && club.coordinator_id === myStaffId);
  const closed = Boolean(period?.closed_at);

  const list = useMemo(() => (clubs || []).filter((c) => showInactive || c.is_active), [clubs, showInactive]);
  const totals = useMemo(() => ({ clubs: (clubs || []).filter((c) => c.is_active).length, members: (clubs || []).reduce((n, c) => n + c.member_count, 0) }), [clubs]);

  const toggleActive = async (c) => {
    try {
      await clubsApi.update(c.id, { isActive: !c.is_active });
      toast.success(c.is_active ? 'Club desactivado' : 'Club activado', c.name);
      refetch();
    } catch (err) {
      toast.error('No se pudo actualizar', getErrorMessage(err));
    }
  };
  const remove = async (c) => {
    if (!(await confirm({ title: `¿Eliminar el club "${c.name}"?`, message: 'Solo es posible si nunca tuvo alumnos inscritos.', danger: true }))) return;
    try {
      await clubsApi.remove(c.id);
      toast.success('Club eliminado', c.name);
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Clubes y actividades"
        subtitle="Coro, banda, deportes, robótica… y cualquier actividad extracurricular del colegio"
        actions={
          <>
            {can('clubs', 'create') && (
              <Button variant="secondary" icon="plus" onClick={() => setEditing({})}>
                Nuevo club
              </Button>
            )}
            {(canAdmin || (clubs || []).some(canManage)) && (
              <Button icon="users" onClick={() => setEnrolling({})} disabled={!period || closed}>
                Inscribir alumnos
              </Button>
            )}
          </>
        }
      />

      <div className="card clubs-toolbar">
        <label>
          <span className="student-card__label">Año escolar</span>
          <Select sorted value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {(periods || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.closed_at ? ' (finalizado)' : ''}
              </option>
            ))}
          </Select>
        </label>
        <span className="clubs-toolbar__stat">
          <strong>{totals.clubs}</strong> club{totals.clubs === 1 ? '' : 'es'} activo{totals.clubs === 1 ? '' : 's'}
        </span>
        <span className="clubs-toolbar__stat">
          <strong>{totals.members}</strong> inscripcion{totals.members === 1 ? '' : 'es'} en {period?.name || '—'}
        </span>
        <label className="clubs-toolbar__toggle">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos
        </label>
      </div>

      {closed && <Alert variant="info">El año {period.name} está finalizado: se puede consultar, pero no admite inscripciones.</Alert>}
      <Alert>{error}</Alert>

      {loading ? (
        <Spinner />
      ) : !list.length ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="star" size={24} />
          </div>
          <div className="empty-state__title">Aún no hay clubes</div>
          <div className="text-sm">Crea el primero (Coro escolar, Banda musical, Ajedrez…) o una actividad propia con la opción «OTRO».</div>
          {can('clubs', 'create') && (
            <Button icon="plus" onClick={() => setEditing({})} style={{ marginTop: 12 }}>
              Nuevo club
            </Button>
          )}
        </div>
      ) : (
        <div className="clubs-grid">
          {list.map((c) => {
            const cat = CLUB_CATEGORIES[c.category] || CLUB_CATEGORIES.otro;
            const pct = c.capacity ? Math.min(100, Math.round((c.member_count / c.capacity) * 100)) : null;
            return (
              <article key={c.id} className={`club-card club-card--${c.category} ${c.is_active ? '' : 'is-inactive'}`}>
                <button type="button" className="club-card__main" onClick={() => setViewing(c)} title="Ver alumnos inscritos">
                  <span className="club-card__icon">
                    <Icon name={cat.icon} size={20} />
                  </span>
                  <span className="club-card__body">
                    <strong className="club-card__name">{c.name}</strong>
                    <span className="club-card__meta">
                      {cat.label}
                      {c.is_custom && <span className="chip club-card__custom">Personalizada</span>}
                      {!c.is_active && <span className="chip">Inactivo</span>}
                    </span>
                    {c.coordinator_name && <span className="club-card__line">Coordina: Prof. {c.coordinator_name}</span>}
                    {sessionSummary(c) && (
                      <span className="club-card__line">
                        <Icon name="calendar" size={13} /> {sessionSummary(c)}
                      </span>
                    )}
                  </span>
                </button>
                <div className="club-card__foot">
                  <span>
                    <strong>{c.member_count}</strong>
                    {c.capacity ? ` / ${c.capacity}` : ''} inscrito{c.member_count === 1 ? '' : 's'}
                    {c.is_full && <span className="club-card__full"> · cupo lleno</span>}
                  </span>
                  <span className="club-card__actions">
                    {canManage(c) && c.is_active && !closed && !c.is_full && (
                      <button type="button" className="row-action row-action--accent" onClick={() => setEnrolling({ clubId: c.id })} title="Inscribir alumnos" aria-label="Inscribir alumnos">
                        <Icon name="plus" size={15} />
                      </button>
                    )}
                    {can('clubs', 'update') && (
                      <>
                        <button type="button" className="row-action row-action--edit" onClick={() => setEditing(c)} title="Editar" aria-label="Editar">
                          <Icon name="pencil" size={15} />
                        </button>
                        <button type="button" className="row-action row-action--view" onClick={() => toggleActive(c)} title={c.is_active ? 'Desactivar' : 'Activar'} aria-label={c.is_active ? 'Desactivar' : 'Activar'}>
                          <Icon name={c.is_active ? 'lock' : 'checkCircle'} size={15} />
                        </button>
                      </>
                    )}
                    {can('clubs', 'delete') && (
                      <button type="button" className="row-action row-action--delete" onClick={() => remove(c)} title="Eliminar" aria-label="Eliminar">
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </span>
                </div>
                {pct !== null && (
                  <div className="club-card__bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {editing && <ClubFormModal initial={editing} existingNames={(clubs || []).map((c) => c.name)} onClose={() => setEditing(null)} onSaved={refetch} />}
      {enrolling && period && (
        <EnrollModal
          clubs={(clubs || []).filter(canManage)}
          schoolPeriodId={periodId}
          periodName={period.name}
          initialClubId={enrolling.clubId || ''}
          canCreateCustom={can('clubs', 'create')}
          onClose={() => setEnrolling(null)}
          onDone={refetch}
        />
      )}
      {viewing && period && (
        <MembersModal
          club={viewing}
          schoolPeriodId={periodId}
          periodName={period.name}
          canManage={canManage(viewing) && !closed}
          onClose={() => setViewing(null)}
          onAdd={() => {
            setEnrolling({ clubId: viewing.id });
            setViewing(null);
          }}
          onChanged={refetch}
        />
      )}
    </div>
  );
}

export default ClubsPage;
