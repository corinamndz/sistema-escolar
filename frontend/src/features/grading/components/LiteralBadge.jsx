/**
 * Literal de la escala cualitativa (A–E) con su color; `showLabel` agrega
 * el concepto ("A · Excelente"). `level` viene de gradingScale.literalFor().
 */
function LiteralBadge({ level, showLabel = false, size }) {
  if (!level) return <span className="text-muted">—</span>;
  return (
    <span className={`literal-badge literal-badge--${level.code} ${size ? `literal-badge--${size}` : ''}`} title={level.label}>
      {level.code}
      {showLabel && <span className="literal-badge__label">{level.label}</span>}
    </span>
  );
}

export default LiteralBadge;
