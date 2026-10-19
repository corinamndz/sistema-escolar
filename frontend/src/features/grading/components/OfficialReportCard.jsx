import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import { useTenant } from '../../../context/TenantContext';
import Button from '../../../components/ui/Button';
import { DEFAULT_SCHOOL_LOGO } from '../../../components/ui/SchoolLogo';
import { isQualitative, literalFor } from '../gradingScale';

const fmt = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const mean = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const today = () => new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Nota de una materia en un lapso para la boleta: la definitiva si el plan ya
 * se evaluó completo; si no, lo acumulado a la fecha (marcado como parcial).
 */
function termGrade(cell) {
  if (!cell || cell.accumulated === null) return null;
  return cell.final !== null && cell.final !== undefined ? { value: cell.final, partial: false } : { value: cell.accumulated, partial: true };
}

/**
 * Boleta oficial de calificaciones de un alumno, lista para imprimir o guardar
 * como PDF desde el navegador. Se muestra a pantalla completa (vista previa en
 * hoja A4) y, al imprimir, `@media print` deja SOLO la hoja: oculta el menú,
 * los botones y el resto del panel (ver .boleta-print en index.css).
 *
 *   student  alumno del resumen (/grading/summary): sección, materias y lapsos
 *   terms    lapsos del año · schoolPeriod { name } · scale · passing
 */
function OfficialReportCard({ student, terms, schoolPeriod, scale, passing, onClose }) {
  const { settings } = useTenant();
  // Docente titular (Inicial/Primaria) o guía (Secundaria) de la sección, para la firma.
  const { data: staff } = useFetch(
    () => (student.section_id ? academicsApi.getSectionTeachers(student.section_id).catch(() => null) : Promise.resolve(null)),
    [student.section_id]
  );
  const guideTeacher = staff?.guide?.name || staff?.homeroom?.lead?.name || null;
  const qualitative = isQualitative(student.grading_scale);

  // Mientras la boleta está abierta, el cuerpo de la página se marca para la impresión.
  useEffect(() => {
    document.body.classList.add('is-printing-boleta');
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('is-printing-boleta');
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const show = (value) => {
    if (value === null || value === undefined) return '—';
    if (qualitative) return literalFor(value)?.code || '—';
    return fmt(value);
  };
  const rows = student.subjects.map((sub) => {
    const grades = terms.map((t) => termGrade(sub.terms[t.id]));
    return { sub, grades, average: mean(grades.map((g) => g?.value ?? null)) };
  });
  const termAverages = terms.map((t, i) => mean(rows.map((r) => r.grades[i]?.value ?? null)));
  const overall = mean(rows.map((r) => r.average));
  const anyPartial = rows.some((r) => r.grades.some((g) => g?.partial));
  const contact = [settings.contactPhone, settings.contactEmail].filter(Boolean).join(' · ');
  const issuedAt = today();
  const sectionLabel = student.section_id ? `${student.grade_name} · Sección ${student.section_name}` : 'Sin inscripción en el año';

  return createPortal(
    <div className="boleta-print" role="dialog" aria-modal="true" aria-label={`Boleta de ${student.first_name} ${student.last_name}`}>
      <div className="boleta-toolbar">
        <div>
          <strong>Boleta oficial de calificaciones</strong>
          <span className="text-sm text-muted"> · Vista previa (hoja A4). Usa «Imprimir» o guárdala como PDF desde el diálogo de impresión.</span>
        </div>
        <div className="boleta-toolbar__actions">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button icon="file" onClick={() => window.print()}>
            Imprimir boleta
          </Button>
        </div>
      </div>

      <article className="boleta-sheet">
        <header className="boleta-header">
          <img className="boleta-header__logo" src={settings.logoUrl || DEFAULT_SCHOOL_LOGO.compact} alt="" />
          <div className="boleta-header__school">
            <h1>{settings.name}</h1>
            {settings.rif && <p className="boleta-header__rif">RIF {settings.rif}</p>}
            {contact && <p>{contact}</p>}
          </div>
          <div className="boleta-header__doc">
            <span>Año escolar</span>
            <strong>{schoolPeriod?.name}</strong>
          </div>
        </header>

        <h2 className="boleta-title">Boleta de calificaciones</h2>

        <dl className="boleta-student">
          <div className="boleta-student__wide">
            <dt>Alumno(a)</dt>
            <dd>
              {student.last_name}, {student.first_name}
            </dd>
          </div>
          <div>
            <dt>Cédula / documento</dt>
            <dd>{student.national_id || '—'}</dd>
          </div>
          <div>
            <dt>Año / grado y sección</dt>
            <dd>{sectionLabel}</dd>
          </div>
          <div>
            <dt>Fecha de emisión</dt>
            <dd>{issuedAt}</dd>
          </div>
        </dl>

        {rows.length === 0 ? (
          <p className="boleta-empty">El alumno aún no tiene calificaciones registradas en este año escolar.</p>
        ) : (
          <table className="boleta-table">
            <thead>
              <tr>
                <th className="boleta-table__subject">Asignatura / área de formación</th>
                {terms.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
                <th>Promedio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sub, grades, average }) => (
                <tr key={sub.key}>
                  <td className="boleta-table__subject">{sub.name}</td>
                  {grades.map((g, i) => (
                    <td key={terms[i].id} className={g && !qualitative && g.value < passing ? 'is-low' : undefined}>
                      {g ? show(g.value) : '—'}
                      {g?.partial && <sup>*</sup>}
                    </td>
                  ))}
                  <td className={`boleta-table__avg ${average !== null && !qualitative && average < passing ? 'is-low' : ''}`}>{show(average)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="boleta-table__subject">Promedio del lapso</td>
                {termAverages.map((v, i) => (
                  <td key={terms[i].id}>{show(v)}</td>
                ))}
                <td className="boleta-table__avg">{show(overall)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        <div className="boleta-notes">
          <p>
            {qualitative
              ? 'Escala cualitativa (literales). '
              : `Escala de calificación: 0 a ${scale} puntos. Nota mínima aprobatoria: ${passing} puntos. `}
            {anyPartial && '(*) Calificación parcial: lo acumulado a la fecha de emisión; el lapso aún no se ha evaluado completo.'}
          </p>
        </div>

        <footer className="boleta-signatures">
          <div className="boleta-sign">
            <span className="boleta-sign__line" />
            <strong>Director(a)</strong>
          </div>
          <div className="boleta-sign">
            <span className="boleta-sign__line" />
            <strong>{guideTeacher || 'Docente guía'}</strong>
            {guideTeacher && <span>Docente guía</span>}
          </div>
          <div className="boleta-sign boleta-sign--seal">
            <span className="boleta-seal">Sello del plantel</span>
          </div>
        </footer>

        <p className="boleta-footnote">Documento emitido por {settings.name} el {issuedAt}.</p>
      </article>
    </div>,
    document.body
  );
}

export default OfficialReportCard;
