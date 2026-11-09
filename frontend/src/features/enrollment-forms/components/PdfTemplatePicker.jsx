import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import Icon from '../../../components/ui/Icon';
import FormPdfButton from './FormPdfButton';

/**
 * Plantillas de diseño del PDF de la planilla. El diseño real está en el servidor
 * (services/pdf/enrollmentFormGenerator.js); estas miniaturas lo representan, y
 * «Ver ejemplo» genera el PDF de verdad con datos ficticios.
 */
export const PDF_TEMPLATES = [
  { key: 'classic', label: 'Clásica', tag: 'Ejecutiva', text: 'Membrete centrado, datos en tabla formal a doble columna y secciones con borde.' },
  { key: 'modern', label: 'Moderna', tag: 'Bloques', text: 'Banda con el color del colegio y bloques sombreados para cada sección.' },
  { key: 'compact', label: 'Compacta', tag: 'Una sola hoja', text: 'Letra más pequeña y tres columnas, para que quepa en una hoja y ahorrar papel.' },
  { key: 'institutional', label: 'Institucional', tag: 'Formal', text: 'Secciones numeradas, tipografía clásica y firmas con sellos a los laterales.' },
  { key: 'minimal', label: 'Minimalista', tag: 'Limpia', text: 'Sin líneas ni color: tipografía moderna y separación con espacios en blanco.' },
];

const INK = '#334155';
const FAINT = '#cbd5e1';
const CARD = '#eef2f7';
const BRAND = 'var(--color-primary)';

/** Renglón simulado de texto. */
const L = ({ x, y, w, h = 1.6, c = FAINT }) => <rect x={x} y={y} width={w} height={h} rx={0.5} fill={c} />;

/** Celda: etiqueta y valor simulados. */
const Cell = ({ x, y, w }) => (
  <>
    <L x={x} y={y} w={w * 0.5} h={1.1} />
    <L x={x} y={y + 2.4} w={w * 0.8} h={1.6} c={INK} />
  </>
);

function ClassicThumb() {
  const row = (y, h = 8) => (
    <>
      <rect x={10} y={y} width={100} height={h} fill="none" stroke="#94a3b8" strokeWidth={0.5} />
      <line x1={60} y1={y} x2={60} y2={y + h} stroke="#94a3b8" strokeWidth={0.5} />
      <Cell x={12} y={y + 1.6} w={44} />
      <Cell x={62} y={y + 1.6} w={44} />
    </>
  );
  const bar = (y) => (
    <>
      <rect x={10} y={y} width={100} height={5} fill={CARD} stroke="#94a3b8" strokeWidth={0.5} />
      <L x={13} y={y + 1.7} w={30} c={INK} />
    </>
  );
  return (
    <>
      <circle cx={60} cy={11} r={4.5} fill={BRAND} />
      <L x={40} y={18} w={40} h={2.4} c={INK} />
      <L x={46} y={22} w={28} />
      <L x={36} y={25.5} w={48} h={1.2} c={INK} />
      <line x1={10} y1={29} x2={110} y2={29} stroke={INK} strokeWidth={0.7} />
      {row(33)}
      {row(41)}
      {bar(53)}
      {row(58)}
      {row(66)}
      {bar(78)}
      {row(83)}
      {row(91)}
      {bar(103)}
      {row(108)}
      <rect x={10} y={132} width={48} height={18} fill="none" stroke="#94a3b8" strokeWidth={0.5} />
      <rect x={62} y={132} width={48} height={18} fill="none" stroke="#94a3b8" strokeWidth={0.5} />
      <L x={15} y={144} w={38} h={0.8} c={INK} />
      <L x={66} y={144} w={26} h={0.8} c={INK} />
      <rect x={96} y={136} width={11} height={11} fill="none" stroke={FAINT} strokeWidth={0.6} strokeDasharray="1.5 1" />
    </>
  );
}

function ModernThumb() {
  const block = (y, h, rows) => (
    <>
      <rect x={8} y={y} width={104} height={h} fill={CARD} />
      <rect x={8} y={y} width={1.8} height={h} fill={BRAND} />
      <L x={13} y={y + 2.4} w={32} h={2.2} c={BRAND} />
      {Array.from({ length: rows }, (_, i) => (
        <g key={i}>
          <Cell x={13} y={y + 7.5 + i * 7.5} w={44} />
          <Cell x={62} y={y + 7.5 + i * 7.5} w={44} />
        </g>
      ))}
    </>
  );
  return (
    <>
      <rect x={0} y={0} width={120} height={25} fill={BRAND} />
      <rect x={8} y={6} width={13} height={13} rx={2} fill="#fff" />
      <L x={25} y={8} w={36} h={2.6} c="#fff" />
      <L x={25} y={13} w={26} h={1.2} c="#fff" />
      <L x={25} y={16} w={30} h={1.2} c="#fff" />
      <rect x={97} y={5} width={15} height={15} rx={1} fill="none" stroke="#fff" strokeWidth={0.5} strokeDasharray="1.5 1" />
      <L x={8} y={30} w={44} h={2.6} c={INK} />
      {block(36, 22, 2)}
      {block(61, 29, 3)}
      {block(93, 22, 2)}
      <L x={8} y={136} w={46} h={0.8} c={INK} />
      <L x={62} y={136} w={36} h={0.8} c={INK} />
      <L x={18} y={139} w={26} h={1.1} />
      <L x={68} y={139} w={24} h={1.1} />
      <rect x={101} y={125} width={11} height={11} rx={1.5} fill="none" stroke={FAINT} strokeWidth={0.6} strokeDasharray="1.5 1" />
    </>
  );
}

function CompactThumb() {
  const rows = [];
  let y = 25;
  [4, 5, 4, 6].forEach((count, s) => {
    rows.push(
      <g key={`s${s}`}>
        <L x={6} y={y} w={26} h={1.4} c={BRAND} />
        <line x1={6} y1={y + 2.2} x2={114} y2={y + 2.2} stroke={BRAND} strokeWidth={0.4} />
      </g>
    );
    y += 3.6;
    for (let i = 0; i < count; i += 1) {
      rows.push(
        <g key={`${s}-${i}`}>
          {[6, 43, 80].map((x) => (
            <g key={x}>
              <L x={x} y={y} w={15} h={0.8} />
              <L x={x} y={y + 1.5} w={28} h={1.1} c={INK} />
            </g>
          ))}
          <line x1={6} y1={y + 3.6} x2={114} y2={y + 3.6} stroke="#e2e8f0" strokeWidth={0.3} />
        </g>
      );
      y += 4.5;
    }
    y += 1.6;
  });
  return (
    <>
      <rect x={0} y={0} width={120} height={1.6} fill={BRAND} />
      <rect x={6} y={5} width={9} height={9} rx={1} fill={BRAND} />
      <L x={18} y={6} w={30} h={2} c={INK} />
      <L x={18} y={10} w={24} h={1.1} />
      <L x={74} y={6} w={22} h={1.8} c={INK} />
      <rect x={101} y={4} width={13} height={15} rx={1} fill="none" stroke={FAINT} strokeWidth={0.5} strokeDasharray="1.5 1" />
      <line x1={6} y1={21} x2={98} y2={21} stroke={BRAND} strokeWidth={0.6} />
      {rows}
      <L x={6} y={146} w={44} h={0.7} c={INK} />
      <L x={62} y={146} w={38} h={0.7} c={INK} />
      <rect x={103} y={138} width={9} height={9} rx={1} fill="none" stroke={FAINT} strokeWidth={0.5} strokeDasharray="1.5 1" />
    </>
  );
}

function InstitutionalThumb() {
  const section = (y, n) => (
    <>
      <L x={10} y={y} w={34} h={2} c={INK} />
      <line x1={10} y1={y + 3.2} x2={110} y2={y + 3.2} stroke={INK} strokeWidth={0.5} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <Cell x={10} y={y + 5.4 + i * 7} w={46} />
          <Cell x={62} y={y + 5.4 + i * 7} w={46} />
          <line x1={10} y1={y + 11 + i * 7} x2={110} y2={y + 11 + i * 7} stroke="#e2e8f0" strokeWidth={0.3} />
        </g>
      ))}
    </>
  );
  return (
    <>
      <circle cx={17} cy={13} r={7} fill={BRAND} />
      <L x={36} y={7} w={48} h={2.6} c={INK} />
      <L x={44} y={12} w={32} h={1.2} />
      <L x={40} y={15} w={40} h={1.2} />
      <L x={42} y={19} w={36} h={1.5} c={INK} />
      <rect x={97} y={6} width={13} height={16} fill="none" stroke={FAINT} strokeWidth={0.5} strokeDasharray="1.5 1" />
      <line x1={10} y1={25.5} x2={110} y2={25.5} stroke={INK} strokeWidth={0.9} />
      <line x1={10} y1={27} x2={110} y2={27} stroke={INK} strokeWidth={0.3} />
      {section(32, 2)}
      {section(55, 3)}
      {section(85, 2)}
      <circle cx={18} cy={132} r={8} fill="none" stroke="#94a3b8" strokeWidth={0.6} strokeDasharray="1.5 1" />
      <circle cx={102} cy={132} r={8} fill="none" stroke="#94a3b8" strokeWidth={0.6} strokeDasharray="1.5 1" />
      <L x={31} y={135} w={26} h={0.8} c={INK} />
      <L x={63} y={135} w={26} h={0.8} c={INK} />
      <L x={36} y={138} w={16} h={1.1} />
      <L x={68} y={138} w={16} h={1.1} />
    </>
  );
}

function MinimalThumb() {
  const section = (y, n) => (
    <>
      <L x={13} y={y} w={26} h={2} c={INK} />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <Cell x={13} y={y + 6 + i * 9} w={40} />
          <Cell x={64} y={y + 6 + i * 9} w={40} />
        </g>
      ))}
    </>
  );
  return (
    <>
      <circle cx={16} cy={12} r={3.5} fill={FAINT} />
      <L x={23} y={10} w={24} h={1.8} c={INK} />
      <L x={23} y={13.5} w={18} h={1} />
      <L x={13} y={25} w={56} h={3} c={INK} />
      {section(36, 2)}
      {section(66, 2)}
      {section(96, 1)}
      <L x={13} y={136} w={42} h={0.4} c="#94a3b8" />
      <L x={64} y={136} w={42} h={0.4} c="#94a3b8" />
      <L x={13} y={138.5} w={20} h={1} />
      <L x={64} y={138.5} w={20} h={1} />
    </>
  );
}

const THUMBS = { classic: ClassicThumb, modern: ModernThumb, compact: CompactThumb, institutional: InstitutionalThumb, minimal: MinimalThumb };

/** Miniatura de una plantilla: una hoja A4 con su distribución. */
function TemplateThumb({ style }) {
  const Thumb = THUMBS[style];
  return (
    <svg className="pdft__sheet" viewBox="0 0 120 160" role="img" aria-hidden="true">
      <rect width={120} height={160} fill="#fff" />
      <Thumb />
    </svg>
  );
}

/**
 * Selector de la plantilla del PDF. Elegir cambia el borrador del diseñador: se
 * aplica al pulsar «Guardar», como el resto de la planilla.
 */
function PdfTemplatePicker({ formId, value, saved, onChange, disabled, fieldsDirty }) {
  return (
    <section className="pdft" aria-label="Plantilla del PDF">
      <div className="pdft__head">
        <h3 className="card__title">Diseño del PDF de la planilla</h3>
        <p className="text-sm text-muted">
          Es el documento que se imprime o descarga al abrir una planilla recibida. Cambia la distribución, no la información.
          {fieldsDirty && ' «Ver ejemplo» usa las preguntas ya guardadas.'}
        </p>
      </div>
      <div className="pdft__grid" role="radiogroup" aria-label="Plantillas disponibles">
        {PDF_TEMPLATES.map((t) => {
          const active = value === t.key;
          return (
            <div key={t.key} className={`pdft__card ${active ? 'is-active' : ''}`}>
              <label className="pdft__option">
                <input type="radio" name="pdf-template" className="pdft__radio" value={t.key} checked={active} onChange={() => onChange(t.key)} disabled={disabled} />
                <TemplateThumb style={t.key} />
                <span className="pdft__name">
                  <strong>{t.label}</strong>
                  <span className="pdft__tag">{t.tag}</span>
                  {active && (
                    <span className="pdft__check" title="Plantilla elegida">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </span>
                <span className="pdft__text">{t.text}</span>
                {saved === t.key && !active && <span className="pdft__saved">Guardada actualmente</span>}
              </label>
              <FormPdfButton load={() => enrollmentFormsApi.formPdfPreview(formId, t.key)} fileName={`ejemplo-planilla-${t.key}.pdf`} label="Ver ejemplo" variant="ghost" />
            </div>
          );
        })}
      </div>
      <p className="pdft__note">
        <Icon name="info" size={14} /> La plantilla guardada se aplica a todos los PDF de esta planilla, también a los de las planillas ya recibidas o aprobadas cuando se vuelvan a abrir. Sus datos no cambian.
      </p>
    </section>
  );
}

export default PdfTemplatePicker;
