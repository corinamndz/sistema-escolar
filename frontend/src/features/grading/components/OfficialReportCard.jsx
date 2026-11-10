import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import { useFetch } from '../../../hooks/useFetch';
import { useTenant } from '../../../context/TenantContext';
import Button from '../../../components/ui/Button';
import { DEFAULT_SCHOOL_LOGO } from '../../../components/ui/SchoolLogo';
import { isQualitative, literalFor } from '../gradingScale';
import { anyProvisional, anyRank, rankText } from '../sectionRank';
import { averageRuleText } from '../averageRule';
import { recoveryText } from '../../carryovers/recovery';

const fmt = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const today = () => new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Nota de una materia en un período para la boleta: la definitiva si el plan ya
 * se evaluó completo; si no, lo acumulado a la fecha (marcado como parcial).
 */
function termGrade(cell) {
  if (!cell || cell.accumulated === null) return null;
  // adjusted: definitiva ajustada por la dirección (migración 084).
  return cell.final !== null && cell.final !== undefined ? { value: cell.final, partial: false, adjusted: Boolean(cell.adjustment) } : { value: cell.accumulated, partial: true };
}

/** Puesto en la boleta: "3 de 28" con sus marcas de empate y provisional. */
function RankMark({ rank }) {
  if (!rank) return '—';
  return (
    <>
      {rankText(rank)}
      {rank.tied && <sup>(e)</sup>}
      {rank.provisional && <sup>(p)</sup>}
    </>
  );
}

/**
 * Boleta oficial de calificaciones de un alumno, lista para imprimir o guardar
 * como PDF desde el navegador. Se muestra a pantalla completa (vista previa en
 * hoja A4) y, al imprimir, `@media print` deja SOLO la hoja: oculta el menú,
 * los botones y el resto del panel (ver .boleta-print en index.css).
 *
 *   student  alumno del resumen (/grading/summary): sección, materias y períodos
 *   terms    períodos del año · schoolPeriod { name } · scale · passing
 *   rules    normativa del año (cómo se promedian los períodos)
 * Los promedios vienen calculados del servidor (student.report y student.overall):
 * son los mismos del detalle, el puesto y la promoción.
 */
function OfficialReportCard({ student, terms, schoolPeriod, scale, passing, rules, onClose }) {
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
    const annual = student.report?.subjects?.[sub.key];
    return { sub, grades: terms.map((t) => termGrade(sub.terms[t.id])), average: annual?.definitive ?? null, averagePartial: Boolean(annual?.partial && annual?.definitive !== null) };
  });
  const termAverages = terms.map((t) => student.report?.term_averages?.[t.id]?.value ?? null);
  const overall = student.overall ?? null;
  const anyPartial = rows.some((r) => r.averagePartial || r.grades.some((g) => g?.partial));
  const averageRule = averageRuleText(rules);
  const anyAdjusted = rows.some((r) => r.grades.some((g) => g?.adjusted));
  // Materias pendientes de este año: la nota original queda; la recuperación se anota (r).
  const recoveries = student.subjects.filter((sub) => sub.recovery);
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
          <div className="boleta-student__name">
            <dt>Alumno(a)</dt>
            <dd>
              {student.last_name}, {student.first_name}
            </dd>
          </div>
          {/* Puesto anual en la sección; el de cada período está al pie de la tabla. */}
          <div className="boleta-student__rank">
            <dt>Puesto en sección</dt>
            <dd>{student.ranks?.annual ? <RankMark rank={student.ranks.annual} /> : <span className="boleta-student__norank">Aún sin calificaciones</span>}</dd>
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
          <table className={`boleta-table ${terms.length > 8 ? 'boleta-table--tight' : terms.length > 4 ? 'boleta-table--dense' : ''}`}>
            <thead>
              <tr>
                <th className="boleta-table__subject">Asignatura / área de formación</th>
                {terms.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
                <th>{terms.length > 8 ? 'Prom.' : 'Promedio'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sub, grades, average, averagePartial }) => (
                <tr key={sub.key}>
                  <td className="boleta-table__subject">
                    {sub.name}
                    {sub.recovery && <sup>(r)</sup>}
                  </td>
                  {grades.map((g, i) => (
                    <td key={terms[i].id} className={g && !qualitative && g.value < passing ? 'is-low' : undefined}>
                      {g ? show(g.value) : '—'}
                      {g?.partial && <sup>*</sup>}
                      {g?.adjusted && <sup>(a)</sup>}
                    </td>
                  ))}
                  <td className={`boleta-table__avg ${average !== null && !qualitative && average < passing ? 'is-low' : ''}`}>
                    {show(average)}
                    {averagePartial && <sup>*</sup>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="boleta-table__subject">Promedio del período</td>
                {termAverages.map((v, i) => (
                  <td key={terms[i].id}>{show(v)}</td>
                ))}
                <td className="boleta-table__avg">
                  {show(overall)}
                  {student.overall_recalculated && <sup>(r)</sup>}
                </td>
              </tr>
              {/* Puesto en la sección, por período y anual (e: empate, p: provisional). */}
              {anyRank(student.ranks) && (
                <tr className="boleta-table__rank">
                  <td className="boleta-table__subject">Puesto en la sección</td>
                  {terms.map((t) => (
                    <td key={t.id}>
                      <RankMark rank={student.ranks.terms?.[t.id]} />
                    </td>
                  ))}
                  <td className="boleta-table__avg">
                    <RankMark rank={student.ranks.annual} />
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        )}

        <div className="boleta-notes">
          <p>
            {qualitative
              ? 'Escala cualitativa (literales). '
              : `Escala de calificación: 0 a ${scale} puntos. Nota mínima aprobatoria: ${passing} puntos. `}
            {averageRule && `${averageRule} `}
            {anyPartial && '(*) Calificación parcial: lo acumulado a la fecha de emisión; aún falta evaluar por completo el período o, en el promedio, alguno de los períodos. '}
            {anyRank(student.ranks) && 'Puesto: por promedio entre los alumnos de la sección con notas; (e) empate: el mismo promedio comparte puesto. '}
            {anyProvisional(student.ranks) && '(p) Puesto provisional: puede cambiar porque el período no está cerrado o faltan notas. '}
            {anyAdjusted && '(a) Calificación definitiva ajustada por la dirección del plantel, con constancia en el historial de ajustes.'}
          </p>
          {recoveries.length > 0 && (
            <p className="boleta-notes__recovery">
              <strong>(r) Materias pendientes:</strong>{' '}
              {recoveries.map((sub) => `${sub.name}: ${recoveryText(sub)}.`).join(' ')}{' '}
              Se conserva la nota original del año.
              {student.overall_recalculated && ` El promedio del año incluye la nota de recuperación (promedio original: ${show(student.overall_original)}).`}
            </p>
          )}
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
