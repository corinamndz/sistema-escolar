import { useMemo, useState } from 'react';
import recognitionsApi from '../../../api/endpoints/recognitions.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { RECOGNITION_CATEGORIES, RecognitionCelebration } from '../components/RecognitionCard';
import { CertificateModal } from '../components/RecognitionCertificate';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shortDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Reconocimientos a estudiantes: docentes (sus alumnos) y administración
 * registran logros; la familia recibe un aviso con diseño de celebración.
 */
function RecognitionsPage() {
  const { can, user } = useAuth();
  const [category, setCategory] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(() => recognitionsApi.list(category ? { category } : undefined), [category]);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const teacher = Boolean(user?.isRestrictedTeacher);
  // El docente modifica solo lo que otorgó (el backend también lo valida).
  const own = (r) => !teacher || r.awarded_by_user_id === user?.id;

  const counts = useMemo(() => (rows || []).reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] || 0) + 1 }), {}), [rows]);

  const columns = [
    {
      key: 'student',
      header: 'Alumno',
      render: (r) => (
        <div>
          <div className="cell-person__name">{r.student_name}</div>
          <div className="cell-person__sub">{r.grade_name ? `${r.grade_name} ${r.section_name || ''}` : 'Sin inscripción vigente'}</div>
        </div>
      ),
      sortValue: (r) => r.student_name,
    },
    {
      key: 'title',
      header: 'Reconocimiento',
      render: (r) => {
        const meta = RECOGNITION_CATEGORIES[r.category] || RECOGNITION_CATEGORIES.other;
        return (
          <div className="rec-row">
            <span className={`rec-row__icon rec-tone--${meta.tone}`}>
              <Icon name={meta.icon} size={15} />
            </span>
            <div>
              <div className="cell-person__name">{r.title}</div>
              <div className="cell-person__sub">{r.category_label}</div>
            </div>
          </div>
        );
      },
      sortValue: (r) => r.title,
    },
    {
      key: 'awarded_by',
      header: 'Otorgado por',
      render: (r) => (
        <div>
          <div>{r.awarded_by_name}</div>
          {r.awarded_by_role && <div className="cell-person__sub">{r.awarded_by_role}</div>}
        </div>
      ),
      sortValue: (r) => r.awarded_by_name,
    },
    { key: 'awarded_on', header: 'Fecha', render: (r) => shortDate(r.awarded_on), sortValue: (r) => r.awarded_on },
    {
      key: 'notified',
      header: 'Familia',
      render: (r) =>
        r.notified ? (
          <span className="rec-notified">
            <Icon name="bell" size={13} /> Avisada
          </span>
        ) : (
          <span className="cell-person__sub" title="El alumno no tiene representantes registrados o el aviso está desactivado.">
            Sin aviso
          </span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reconocimientos"
        subtitle={
          teacher
            ? 'Reconoce los logros de tus alumnos: su familia recibe un aviso de celebración en el portal.'
            : 'Logros reconocidos a los estudiantes. Cada reconocimiento llega a la familia con un aviso de celebración.'
        }
        actions={
          can('recognitions', 'create') && (
            <Button icon="award" onClick={() => setCreating(true)}>
              Otorgar reconocimiento
            </Button>
          )
        }
      />

      <DataTable
        title="Reconocimientos otorgados"
        columns={columns}
        rows={rows || []}
        loading={loading}
        error={error}
        canCreate={false}
        searchPlaceholder="Buscar por alumno, título o docente…"
        getSearchText={(r) => [r.student_name, r.title, r.category_label, r.awarded_by_name, r.grade_name].join(' ')}
        filters={
          <div className="segmented" role="tablist" aria-label="Categoría">
            <button type="button" role="tab" aria-selected={!category} className={`segmented__item ${!category ? 'segmented__item--active' : ''}`} onClick={() => setCategory('')}>
              Todas
            </button>
            {Object.entries(RECOGNITION_CATEGORIES).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={category === key}
                className={`segmented__item ${category === key ? 'segmented__item--active' : ''}`}
                onClick={() => setCategory(key)}
              >
                {meta.label.split(' ')[0]}
                {!category && counts[key] ? <span className="nd__chip">{counts[key]}</span> : null}
              </button>
            ))}
          </div>
        }
        onRowClick={setViewing}
        onView={setViewing}
        onDelete={(r) => recognitionsApi.remove(r.id)}
        canDelete={(r) => can('recognitions', 'delete') && own(r)}
        deleteConfirm={(r) => ({
          title: `¿Eliminar «${r.title}»?`,
          message: `Se borra el reconocimiento de ${r.student_name} y el aviso de la campana de su familia.`,
          successMessage: 'Reconocimiento eliminado',
        })}
        onDeleted={refetch}
        emptyMessage="Aún no se han otorgado reconocimientos. ¡Celebra el primer logro!"
      />

      {creating && <RecognitionFormDrawer onClose={() => setCreating(false)} onSaved={refetch} />}
      {viewing && (
        <Drawer title="Reconocimiento" icon="award" onClose={() => setViewing(null)}>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Así lo ve la familia en su portal y en la campana.
          </p>
          <RecognitionCelebration recognition={viewing} />
          <div className="form-actions">
            <Button variant="secondary" icon="file" onClick={() => setCertificate(viewing)}>
              Ver certificado · Descargar PDF
            </Button>
          </div>
        </Drawer>
      )}
      {certificate && <CertificateModal recognition={certificate} loadPdf={() => recognitionsApi.certificateBlob(certificate.id)} onClose={() => setCertificate(null)} />}
    </div>
  );
}

/** Otorgar un reconocimiento: alumno, categoría, título, mensaje y fecha, con la vista previa festiva. */
function RecognitionFormDrawer({ onClose, onSaved }) {
  const toast = useToast();
  const { user } = useAuth();
  const { data: options, loading: loadingOptions, error: optionsError } = useFetch(() => recognitionsApi.options(), []);
  const [form, setForm] = useState({ studentId: '', category: 'excellence', title: '', message: '', awardedOn: localToday() });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation(recognitionsApi.create);
  const student = options?.students.find((s) => s.id === form.studentId);
  const meta = RECOGNITION_CATEGORIES[form.category];

  // Alumnos agrupados por grado y sección para el selector.
  const groups = useMemo(() => {
    const map = new Map();
    (options?.students || []).forEach((s) => {
      const key = `${s.grade_name} · ${s.section_name}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map];
  }, [options]);

  const missing = !form.studentId || form.title.trim().length < 3 || form.message.trim().length < 10;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (missing) return;
    try {
      const saved = await run(form);
      toast.success(
        '¡Reconocimiento otorgado! 🎉',
        saved.notified ? `La familia de ${saved.student_first_name} recibió el aviso.` : `${saved.student_first_name} no tiene representantes con aviso activo: queda registrado.`
      );
      onSaved?.();
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  return (
    <Drawer title="Otorgar reconocimiento" icon="award" size="lg" onClose={onClose}>
      <Alert>{optionsError || error}</Alert>
      <form onSubmit={handleSubmit} className="rec-form">
        <div className="rec-form__fields">
          <Field label="Alumno" error={fieldErrors.studentId} required hint={options && !options.students.length ? 'No tienes alumnos con inscripción activa.' : undefined}>
            <Select value={form.studentId} onChange={set('studentId')} disabled={loadingOptions}>
              <option value="">{loadingOptions ? 'Cargando alumnos…' : 'Selecciona el alumno…'}</option>
              {groups.map(([label, list]) => (
                <optgroup key={label} label={label}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>

          <Field label="Categoría" error={fieldErrors.category} required>
            <div className="rec-categories" role="radiogroup" aria-label="Categoría">
              {Object.entries(RECOGNITION_CATEGORIES).map(([key, c]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={form.category === key}
                  className={`rec-category rec-tone--${c.tone} ${form.category === key ? 'is-active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, category: key }))}
                >
                  <Icon name={c.icon} size={15} /> {c.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Título" error={fieldErrors.title} required>
            <Input value={form.title} onChange={set('title')} maxLength={120} placeholder={meta.suggestions[0]} />
            <div className="rec-suggestions">
              {meta.suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, title: s }))}>
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Mensaje para la familia" error={fieldErrors.message} required hint={`${form.message.trim().length}/800 · cuéntales por qué se lo merece.`}>
            <textarea
              className="input"
              rows={4}
              maxLength={800}
              value={form.message}
              onChange={set('message')}
              placeholder="Ej. Por su dedicación y excelentes resultados en el primer lapso, siendo un ejemplo para sus compañeros."
            />
          </Field>

          <Field label="Fecha" error={fieldErrors.awardedOn} required>
            <Input type="date" value={form.awardedOn} max={localToday()} onChange={set('awardedOn')} />
          </Field>
        </div>

        <aside className="rec-form__preview" aria-label="Vista previa">
          <span className="rec-form__preview-label">
            <Icon name="eye" size={13} /> Así lo verá la familia
          </span>
          <RecognitionCelebration
            recognition={{
              student_name: student?.name || 'Nombre del alumno',
              grade_name: student?.grade_name,
              section_name: student?.section_name,
              category: form.category,
              title: form.title.trim() || meta.suggestions[0],
              message: form.message.trim() || 'Aquí va el mensaje con el motivo del reconocimiento.',
              awarded_by_name: user?.fullName || 'el colegio',
              awarded_on: form.awardedOn,
            }}
          />
        </aside>

        <div className="form-actions rec-form__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="award" loading={loading} loadingText="Otorgando…" disabled={missing}>
            Otorgar y avisar a la familia
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default RecognitionsPage;
