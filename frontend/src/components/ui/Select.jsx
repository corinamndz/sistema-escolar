function Select({ error, className = '', children, ...props }) {
  return (
    <select className={`input ${error ? 'input--error' : ''} ${className}`} {...props}>
      {children}
    </select>
  );
}

export default Select;
