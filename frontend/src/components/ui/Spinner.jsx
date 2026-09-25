function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <div className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export default Spinner;
