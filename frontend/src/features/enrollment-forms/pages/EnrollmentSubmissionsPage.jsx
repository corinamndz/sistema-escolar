import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { useFetch } from '../../../hooks/useFetch';
import { useAcademicYear } from '../../../context/AcademicYearContext';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import RowMenu from '../../../components/ui/RowMenu';
import { useAuth } from '../../../context/AuthContext';
import { SubmissionDrawer, useDeleteSubmission } from '../components/SubmissionsPanel';
import { SUBMISSION_STATUS } from '../fieldTypes';

const when = (iso) => new Date(iso).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const TABS = [['submitted'], ['changes_requested'], ['approved'], ['rejected'], ['pending'], ['', 'Todas']];

/**
 * Administración → Planillas recibidas: bandeja de las planillas de todas las
 * convocatorias. Se filtra por estado, planilla, tipo (aspirante nuevo /
 * renovación) y se busca por nombre o cédula. Aprobar da de alta al alumno,
 * a sus representantes y lo matricula (ApprovalPanel).
 */
function EnrollmentSubmissionsPage() {
  const [status, setStatus] = useState('submitted');
  const [formId, setFormId] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const { user } = useAuth();
  const remove = useDeleteSubmission();
  // Año escolar global (barra superior); «Todos los años» lo ignora solo en esta bandeja.
  const { periodId: yearId, period: year } = useAcademicYear();
  const [allYears, setAllYears] = useState(false);
  const periodFilter = allYears ? null : yearId || null;

  // Búsqueda con una pausa corta: no consulta en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = { ...(status && { status }), ...(formId && { formId }), ...(kind && { kind }), ...(q && { q }), ...(periodFilter && { schoolPeriodId: periodFilter }) };
  const { data, loading, error, refetch } = useFetch(() => enrollmentFormsApi.inbox(params), [status, formId, kind, q, periodFilter]);
  // Una planilla de otro año elegida antes deja de aplicar al cambiar de año.
  useEffect(() => {
    if (formId && data?.forms && periodFilter && !data.forms.some((f) => f.id === formId && f.school_period_id === periodFilter)) setFormId('');
  }, [periodFilter, data, formId]);
  const formOptions = (data?.forms || []).filter((f) => !periodFilter || f.school_period_id === periodFilter);
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  const filtered = Boolean(formId || kind || q);

  return (
    <div>
      <PageHeader
        title="Planillas recibidas"
        subtitle="Revisa las planillas que envían las familias. Al aprobar, el alumno queda registrado, con sus representantes y matriculado en su sección."
        actions={
          <Link to="/enrollment-forms" className="btn btn--secondary">
            <Icon name="clipboard" size={16} /> Diseño de planillas
          </Link>
        }
      />

      <div className="card es-inbox">
        <div className="es-toolbar">
          <div className="level-filter" role="group" aria-label="Filtrar por estado">
            {TABS.map(([k, label]) => (
              <button key={k || 'all'} type="button" className={`level-filter__item ${status === k ? 'level-filter__item--active' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>
                {label || SUBMISSION_STATUS[k].label}
                <span className="level-filter__count">{k ? counts[k] || 0 : total}</span>
              </button>
            ))}
          </div>
          <div className="es-filters">
            <div className="es-search">
              <Icon name="search" size={16} />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar alumno, representante o cédula" aria-label="Buscar" />
            </div>
            <Select value={formId} onChange={(e) => setFormId(e.target.value)} aria-label="Planilla">
              <option value="">Todas las planillas</option>
              {formOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </Select>
            <Select value={allYears ? 'all' : 'year'} onChange={(e) => setAllYears(e.target.value === 'all')} aria-label="Año escolar">
              <option value="year">{year ? `Año escolar ${year.name}` : 'Año escolar elegido'}</option>
              <option value="all">Todos los años</option>
            </Select>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
              <option value="">Nuevos y renovaciones</option>
              <option value="new">Solo aspirantes nuevos</option>
              <option value="renewal">Solo renovaciones</option>
            </Select>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => (setFormId(''), setKind(''), setSearch(''))}>
                Limpiar
              </Button>
            )}
          </div>
        </div>

        <Alert>{error}</Alert>
        {loading && !data ? (
          <Spinner />
        ) : !data.rows.length ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="inbox" size={24} />
            </div>
            <div className="empty-state__title">{status === 'submitted' && !filtered ? 'No hay planillas por revisar' : 'Ninguna planilla coincide'}</div>
            <div className="text-sm">{status === 'submitted' && !filtered ? 'Cuando una familia envíe su planilla, aparecerá aquí.' : 'Prueba con otro estado o quita los filtros.'}</div>
          </div>
        ) : (
          <ul className="ef-subs es-list" aria-busy={loading || undefined}>
            {data.rows.map((s) => (
              <li key={s.id} className="ef-sub-row">
                <button type="button" className="ef-sub" onClick={() => setOpenId(s.id)}>
                  <span className="avatar avatar--sm">{initials(s.student_name)}</span>
                  <span className="ef-sub__main">
                    <strong>
                      {s.student_name}
                      {s.student_id ? <span className="es-kind">Renovación</span> : <span className="ef-sub__new">Aspirante nuevo</span>}
                    </strong>
                    <span>
                      {s.form_title} · Representante: {s.guardian_name} · {when(s.submitted_at)}
                    </span>
                  </span>
                  <Badge variant={SUBMISSION_STATUS[s.status].variant}>{SUBMISSION_STATUS[s.status].label}</Badge>
                  <Icon name="chevronRight" size={16} />
                </button>
                {/* Acciones rápidas: solo el Administrador puede eliminar (también aprobadas). */}
                {user?.isAdmin && (
                  <RowMenu
                    label={`Acciones de la planilla de ${s.student_name}`}
                    items={[
                      { key: 'open', label: 'Ver planilla', icon: 'eye', onClick: () => setOpenId(s.id) },
                      { key: 'delete', label: 'Eliminar planilla', icon: 'trash', danger: true, onClick: async () => (await remove(s)) && refetch() },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {openId && (
        <SubmissionDrawer
          id={openId}
          canReview
          onClose={() => setOpenId(null)}
          onReviewed={() => {
            setOpenId(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

export default EnrollmentSubmissionsPage;
