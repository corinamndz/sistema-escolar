import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useTenant } from '../../../context/TenantContext';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import ExportButton from '../../../components/ui/ExportButton';
import AcademicHistory from './AcademicHistory';

const fmt = (n) => (n === null || n === undefined ? '' : Number(n));

/**
 * Una fila por materia y año, con la nota de cada período (para Excel). Los años
 * sin notas quedan con una fila que dice el resultado del año.
 */
function exportRows(data) {
  return data.years.flatMap((y) => {
    const base = {
      period: y.school_period.name,
      grade: y.grade_name,
      section: y.section_name,
      status: y.status_label,
      average: fmt(y.final_average),
      frozen: y.frozen ? 'Cerrada' : 'En curso',
    };
    if (!y.subjects.length) return [{ ...base, subject: '(sin calificaciones)' }];
    return y.subjects.map((s) => {
      return {
        ...base,
        subject: s.subject_name,
        byTerm: Object.fromEntries(s.terms.map((t) => [t.term_number, fmt(t.grade)])),
        final: fmt(s.final_grade),
        result: s.passed === null ? 'Sin notas' : s.passed ? 'Aprobada' : 'Reprobada',
      };
    });
  });
}

/**
 * Una columna por posición de período. El título es su nombre si todos los años
 * lo llaman igual; si difiere entre años, «Período N».
 */
function termColumns(data) {
  const names = new Map();
  (data?.years || []).forEach((y) => y.subjects.forEach((s) => s.terms.forEach((t) => {
    if (!t.term_number) return;
    if (!names.has(t.term_number)) names.set(t.term_number, new Set());
    names.get(t.term_number).add(t.term_name);
  })));
  return [...names.keys()].sort((a, b) => a - b).map((n) => ({
    header: names.get(n).size === 1 ? [...names.get(n)][0] : `Período ${n}`,
    value: (r) => r.byTerm?.[n] ?? '',
    width: 11,
  }));
}

const exportColumns = (data) => [
  { header: 'Año escolar', value: (r) => r.period, width: 12 },
  { header: 'Grado', value: (r) => r.grade, width: 16 },
  { header: 'Sección', value: (r) => r.section, width: 9 },
  { header: 'Resultado del año', value: (r) => r.status, width: 16 },
  { header: 'Promedio del año', value: (r) => r.average, width: 14 },
  { header: 'Boleta', value: (r) => r.frozen, width: 10 },
  { header: 'Materia', value: (r) => r.subject, width: 28 },
  ...termColumns(data),
  { header: 'Nota final', value: (r) => r.final ?? '', width: 10 },
  { header: 'Estado', value: (r) => r.result ?? '', width: 12 },
];

/**
 * "Historial académico" desde la lista de Alumnos: el recorrido del alumno por
 * año escolar (grado, sección, resultado, promedio y la boleta por materia y
 * período). Los años cerrados muestran la boleta congelada al promover: las
 * notas de años anteriores no se pierden ni cambian. Se puede exportar a Excel
 * o imprimir (todos los años desplegados, con el encabezado del colegio).
 */
function AcademicHistoryDrawer({ student, onClose }) {
  const { settings } = useTenant();
  const { data, loading, error } = useFetch(() => studentsApi.academicHistory(student.id), [student.id]);
  const [expandAll, setExpandAll] = useState(false);
  const [version, setVersion] = useState(0); // remonta el historial al expandir/contraer todo
  const [printing, setPrinting] = useState(false);
  const name = `${student.first_name} ${student.last_name}`;

  // Imprimir: solo la copia de impresión (portal), con todos los años abiertos.
  useEffect(() => {
    if (!printing) return undefined;
    document.body.classList.add('printing-history');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('printing-history');
    };
  }, [printing]);

  const years = data?.years || [];
  const toggleAll = () => {
    setExpandAll((v) => !v);
    setVersion((v) => v + 1);
  };

  return (
    <Drawer title="Historial académico" subtitle={name} icon="book" size="lg" onClose={onClose}>
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Cargando historial…" />
      ) : (
        data && (
          <>
            <div className="history-toolbar">
              <span className="text-sm text-muted">
                {years.length} {years.length === 1 ? 'año escolar' : 'años escolares'} · los años cerrados conservan su boleta congelada al promover.
              </span>
              <div className="history-toolbar__actions">
                {years.length > 0 && (
                  <>
                    <Button size="sm" variant="ghost" icon={expandAll ? 'chevronLeft' : 'chevronDown'} onClick={toggleAll}>
                      {expandAll ? 'Contraer todo' : 'Expandir todo'}
                    </Button>
                    <ExportButton size="sm" filename={`historial-academico-${name}`} columns={exportColumns(data)} rows={exportRows(data)} />
                    <Button size="sm" variant="secondary" icon="file" onClick={() => setPrinting(true)}>
                      Imprimir
                    </Button>
                  </>
                )}
                <Link to={`/students/${student.id}`} className="btn btn--ghost btn--sm" onClick={onClose}>
                  Ver ficha
                </Link>
              </div>
            </div>
            <AcademicHistory key={version} data={data} initiallyOpen={expandAll} />
          </>
        )
      )}

      {printing &&
        data &&
        createPortal(
          <div className="history-print-root">
            <header className="history-print__head">
              <div>
                <strong>{settings.name}</strong>
                <h1>Historial académico</h1>
                <p>
                  {name}
                  {student.national_id ? ` · C.I. ${student.national_id}` : ''}
                </p>
              </div>
              <span>Emitido el {new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </header>
            <AcademicHistory data={data} initiallyOpen />
          </div>,
          document.body
        )}
    </Drawer>
  );
}

export default AcademicHistoryDrawer;
