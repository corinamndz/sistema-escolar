import { useMemo, useState } from 'react';
import clubsApi from '../../../api/endpoints/clubs.api';
import staffApi from '../../../api/endpoints/staff.api';
import studentsApi from '../../../api/endpoints/students.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import MultiDatePicker from '../../../components/ui/MultiDatePicker';
import { CLUB_CATEGORIES, CLUB_SUGGESTIONS, OTHER, sessionLabel, sessionSummary } from '../clubCatalog';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Fechas de sesión de solo lectura (las pasadas, atenuadas). */
export function SessionChips({ dates }) {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return (
    <div className="chip-list club-sessions">
      {dates.map((d) => (
        <span key={d} className={`mdp__chip ${d < today ? 'is-past' : ''}`}>
          {sessionLabel(d)}
        </span>
      ))}
    </div>
  );
}

/**
 * Alta / edición de un club. Al crear, el nombre se elige de las actividades
 * sugeridas o con "OTRO", que despliega un campo para escribir una actividad
 * nueva (queda marcada como personalizada).
 */
export function ClubFormModal({ initial = {}, existingNames = [], onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const toast = useToast();
  const { data: staff } = useFetch(() => staffApi.list(), []);
  const teachers = (staff || []).filter((s) => s.status !== 'inactive');
  const taken = new Set(existingNames.map(norm));
  const suggestions = CLUB_SUGGESTIONS.filter((s) => !taken.has(norm(s.name)));
  const [choice, setChoice] = useState(isEdit ? OTHER : '');
  const [form, setForm] = useState({
    name: initial.name || '',
    category: initial.category || 'otro',
    description: initial.description || '',
    coordinatorId: initial.coordinator_id || '',
    sessionDates: initial.session_dates || [],
    startTime: initial.start_time || '',
    endTime: initial.end_time || '',
    capacity: initial.capacity || '',
  });
  const timeError = form.startTime && form.endTime && form.endTime <= form.startTime ? 'La hora de fin debe ser posterior a la de inicio.' : null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) => (isEdit ? clubsApi.update(initial.id, data) : clubsApi.create(data)));

  const pick = (e) => {
    const value = e.target.value;
    setChoice(value);
    const s = CLUB_SUGGESTIONS.find((x) => x.name === value);
    setForm((f) => ({ ...f, name: s ? s.name : '', category: s ? s.category : 'otro' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const club = await run({
        name: form.name,
        category: form.category,
        description: form.description,
        coordinatorId: form.coordinatorId || null,
        sessionDates: form.sessionDates,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        capacity: form.capacity === '' ? null : Number(form.capacity),
        ...(isEdit ? {} : { isCustom: choice === OTHER }),
      });
      toast.success(isEdit ? 'Club actualizado' : 'Club creado', club.name);
      onSaved(club);
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? `Editar ${initial.name}` : 'Nuevo club o actividad'} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      <form onSubmit={submit}>
        <div className="form-grid">
          {!isEdit && (
            <Field label="Actividad" full required hint="Elige una sugerida o «OTRO» para escribir una actividad nueva.">
              <Select value={choice} onChange={pick} required>
                <option value="">Selecciona…</option>
                {Object.entries(CLUB_CATEGORIES)
                  .filter(([key]) => suggestions.some((s) => s.category === key))
                  .map(([key, cat]) => (
                    <optgroup key={key} label={cat.label}>
                      {suggestions
                        .filter((s) => s.category === key)
                        .map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                <option value={OTHER}>OTRO (escribir una actividad nueva)…</option>
              </Select>
            </Field>
          )}
          {(isEdit || choice === OTHER) && (
            <Field label={isEdit ? 'Nombre' : 'Nombre de la nueva actividad'} error={fieldErrors.name} full required>
              <Input value={form.name} onChange={set('name')} maxLength={100} required autoFocus placeholder="Ej.: Club de Astronomía" />
            </Field>
          )}
          {(isEdit || choice === OTHER) && (
            <Field label="Categoría" error={fieldErrors.category}>
              <Select value={form.category} onChange={set('category')}>
                {Object.entries(CLUB_CATEGORIES).map(([key, cat]) => (
                  <option key={key} value={key}>
                    {cat.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Coordinador (opcional)" error={fieldErrors.coordinatorId} hint="Podrá inscribir y retirar alumnos en este club.">
            <Select sorted value={form.coordinatorId} onChange={set('coordinatorId')}>
              <option value="">Sin coordinador</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.first_name} {t.last_name}
                </option>
              ))}
            </Select>
          </Field>
          {/* Coordinador y cupo en una fila; las dos horas en la siguiente. */}
          <Field label="Cupo por año (opcional)" error={fieldErrors.capacity} hint="Vacío = sin límite.">
            <Input type="number" min="1" value={form.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Hora de inicio (opcional)" error={fieldErrors.startTime}>
            <Input type="time" value={form.startTime} onChange={set('startTime')} />
          </Field>
          <Field label="Hora de fin (opcional)" error={fieldErrors.endTime || timeError}>
            <Input type="time" value={form.endTime} min={form.startTime || undefined} onChange={set('endTime')} />
          </Field>
          <Field
            label="Fechas de las sesiones (opcional)"
            error={fieldErrors.sessionDates}
            full
            hint={initial.schedule_text && !form.sessionDates.length ? `Horario anterior (texto): «${initial.schedule_text}». Elige las fechas para reemplazarlo.` : undefined}
          >
            <MultiDatePicker value={form.sessionDates} onChange={(sessionDates) => setForm((f) => ({ ...f, sessionDates }))} />
          </Field>
          <Field label="Descripción (opcional)" error={fieldErrors.description} full>
            <textarea className="input" rows={2} maxLength={500} value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={(!isEdit && !form.name.trim()) || Boolean(timeError)}>
            {isEdit ? 'Guardar cambios' : 'Crear club'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Inscripción individual o masiva: se elige el club (del catálogo o "OTRO"
 * con un nombre nuevo) y los alumnos, buscándolos por nombre/cédula o
 * filtrando por grado y sección para marcar una sección completa.
 */
export function EnrollModal({ clubs, schoolPeriodId, periodName, initialClubId = '', canCreateCustom, onClose, onDone }) {
  const toast = useToast();
  const { data: students, loading: loadingStudents } = useFetch(() => studentsApi.list({ status: 'active' }), []);
  const [clubChoice, setClubChoice] = useState(initialClubId);
  const [customName, setCustomName] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [course, setCourse] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const activeClubs = clubs.filter((c) => c.is_active);
  const club = activeClubs.find((c) => c.id === clubChoice);
  const free = club?.capacity ? Math.max(0, club.capacity - club.member_count) : null;

  const courses = useMemo(() => {
    const set = new Map();
    (students || []).forEach((s) => s.grade_name && set.set(`${s.grade_name}|${s.section_name}`, `${s.grade_name} ${s.section_name}`));
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }));
  }, [students]);
  const visible = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return (students || [])
      .filter((s) => !course || `${s.grade_name}|${s.section_name}` === course)
      .filter((s) => !words.length || words.every((w) => norm(`${s.first_name} ${s.last_name} ${s.national_id || ''}`).includes(w)))
      .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'es'));
  }, [students, q, course]);
  const allVisible = visible.length > 0 && visible.every((s) => selected.has(s.id));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((s) => (allVisible ? next.delete(s.id) : next.add(s.id)));
      return next;
    });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await clubsApi.enroll({
        ...(clubChoice === OTHER ? { customName } : { clubId: clubChoice }),
        studentIds: [...selected],
        schoolPeriodId,
      });
      toast.success(
        `${res.added} alumno${res.added === 1 ? '' : 's'} inscrito${res.added === 1 ? '' : 's'} en ${res.club.name}`,
        res.already.length ? `Ya estaban inscritos: ${res.already.join(', ')}.` : undefined,
      );
      onDone(res);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Inscribir alumnos · ${periodName}`} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      <form onSubmit={submit} className="club-enroll">
        <div className="form-grid">
          <Field label="Club o actividad" required full={clubChoice !== OTHER}>
            <Select sorted value={clubChoice} onChange={(e) => setClubChoice(e.target.value)} required>
              <option value="">Selecciona…</option>
              {activeClubs.map((c) => (
                <option key={c.id} value={c.id} disabled={c.is_full}>
                  {c.name}
                  {c.capacity ? ` (${c.member_count}/${c.capacity})` : ''}
                  {c.is_full ? ' · cupo lleno' : ''}
                </option>
              ))}
              {canCreateCustom && <option value={OTHER}>OTRO (escribir una actividad nueva)…</option>}
            </Select>
          </Field>
          {clubChoice === OTHER && (
            <Field label="Nombre de la actividad" required hint="Se crea en el catálogo como actividad personalizada.">
              <Input value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={100} required autoFocus placeholder="Ej.: Club de Astronomía" />
            </Field>
          )}
        </div>
        {free !== null && (
          <p className={`form-hint ${selected.size > free ? 'club-enroll__over' : ''}`}>
            Cupo disponible: {free} lugar{free === 1 ? '' : 'es'}
            {selected.size > free ? ` · seleccionaste ${selected.size}` : ''}
          </p>
        )}

        <div className="club-enroll__filters">
          <div className="input-group">
            <Icon name="search" size={16} className="input-group__icon" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o cédula…" aria-label="Buscar alumno" />
          </div>
          <Select value={course} onChange={(e) => setCourse(e.target.value)} aria-label="Grado y sección">
            <option value="">Todos los grados y secciones</option>
            {courses.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {loadingStudents ? (
          <Spinner />
        ) : (
          <div className="club-enroll__list" role="group" aria-label="Alumnos">
            <label className="club-enroll__all">
              <input type="checkbox" checked={allVisible} onChange={toggleVisible} disabled={!visible.length} />
              {course ? 'Seleccionar toda la sección' : 'Seleccionar todos los de la lista'} ({visible.length})
            </label>
            {visible.map((s) => (
              <label key={s.id} className={`club-enroll__row ${selected.has(s.id) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="club-enroll__name">
                  {s.last_name}, {s.first_name}
                </span>
                <span className="text-sm text-muted">
                  {s.grade_name ? `${s.grade_name} ${s.section_name}` : 'Sin sección'}
                  {s.national_id ? ` · ${s.national_id}` : ''}
                </span>
              </label>
            ))}
            {!visible.length && <p className="text-muted text-sm">Ningún alumno coincide con la búsqueda.</p>}
          </div>
        )}

        <div className="form-actions">
          <span className="club-enroll__count">
            {selected.size} alumno{selected.size === 1 ? '' : 's'} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="plus" loading={saving} loadingText="Inscribiendo…" disabled={!selected.size || !clubChoice || (clubChoice === OTHER && !customName.trim())}>
            Inscribir
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Alumnos de un club en el año, con opción de retirarlos. */
export function MembersModal({ club, schoolPeriodId, periodName, canManage, onClose, onAdd, onChanged }) {
  const toast = useToast();
  const { data, loading, error, refetch } = useFetch(() => clubsApi.members(club.id, schoolPeriodId), [club.id, schoolPeriodId]);
  const withdraw = async (m) => {
    try {
      await clubsApi.withdraw(m.id);
      toast.success('Alumno retirado del club', `${m.first_name} ${m.last_name}`);
      refetch();
      onChanged();
    } catch (err) {
      toast.error('No se pudo retirar', getErrorMessage(err));
    }
  };
  return (
    <Modal title={`${club.name} · ${periodName}`} onClose={onClose} size="lg">
      <div className="club-members__head">
        <span className="text-sm text-muted">
          {club.coordinator_name ? `Coordina: Prof. ${club.coordinator_name}` : 'Sin coordinador'}
          {sessionSummary(club) ? ` · ${sessionSummary(club)}` : ''}
          {club.capacity ? ` · Cupo ${club.capacity}` : ''}
        </span>
        {canManage && (
          <Button size="sm" icon="plus" onClick={onAdd}>
            Inscribir alumnos
          </Button>
        )}
      </div>
      {club.session_dates?.length > 0 && <SessionChips dates={club.session_dates} />}
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <p className="text-muted">Aún no hay alumnos inscritos en {periodName}.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Alumno</th>
                <th>Grado y sección</th>
                <th>Desde</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>
                      {m.last_name}, {m.first_name}
                    </strong>
                    {m.national_id && <div className="cell-person__sub">{m.national_id}</div>}
                  </td>
                  <td>{m.grade_name ? `${m.grade_name} ${m.section_name}` : <span className="text-muted">Sin sección</span>}</td>
                  <td>{String(m.joined_on).slice(0, 10).split('-').reverse().join('/')}</td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="row-action row-action--delete" onClick={() => withdraw(m)} title="Retirar del club" aria-label="Retirar del club">
                        <Icon name="x" size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
