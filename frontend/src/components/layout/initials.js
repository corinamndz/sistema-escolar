/** "María José Pérez" → "MJ". Usado por los avatares del Sidebar y el Topbar. */
function initials(name = '') {
  return (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
}

export { initials };
