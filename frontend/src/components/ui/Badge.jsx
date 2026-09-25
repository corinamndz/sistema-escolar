/** `variant`: success | warning | danger | info | neutral | primary. */
function Badge({ variant = 'neutral', children }) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

export default Badge;
