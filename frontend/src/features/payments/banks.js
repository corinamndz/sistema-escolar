/**
 * Bancos de Venezuela con su código (los 4 primeros dígitos de la cuenta y el
 * que piden las apps para el pago móvil). Para un banco que no esté en la
 * lista, el formulario permite escribir el nombre a mano.
 */
export const BANKS = [
  { code: '0102', name: 'Banco de Venezuela' },
  { code: '0104', name: 'Venezolano de Crédito' },
  { code: '0105', name: 'Mercantil' },
  { code: '0108', name: 'Provincial (BBVA)' },
  { code: '0114', name: 'Bancaribe' },
  { code: '0115', name: 'Exterior' },
  { code: '0128', name: 'Banco Caroní' },
  { code: '0134', name: 'Banesco' },
  { code: '0137', name: 'Sofitasa' },
  { code: '0138', name: 'Banco Plaza' },
  { code: '0146', name: 'Bangente' },
  { code: '0151', name: 'BFC Banco Fondo Común' },
  { code: '0156', name: '100% Banco' },
  { code: '0157', name: 'DelSur' },
  { code: '0163', name: 'Banco del Tesoro' },
  { code: '0166', name: 'Banco Agrícola de Venezuela' },
  { code: '0168', name: 'Bancrecer' },
  { code: '0169', name: 'Mi Banco' },
  { code: '0171', name: 'Banco Activo' },
  { code: '0172', name: 'Bancamiga' },
  { code: '0174', name: 'Banplus' },
  { code: '0175', name: 'Banco Bicentenario' },
  { code: '0177', name: 'BANFANB' },
  { code: '0191', name: 'BNC Nacional de Crédito' },
];

export const bankByCode = (code) => BANKS.find((b) => b.code === code) || null;

/** "0102 · Banco de Venezuela" o solo el nombre si no hay código. */
export const bankLabel = (account) => (account.bank_code ? `${account.bank_code} · ${account.bank_name}` : account.bank_name);

/** Qué datos de pago corresponden a cada método del reporte. */
export const ACCOUNTS_FOR_METHOD = {
  mobile_payment: 'mobile_payment',
  transfer: 'transfer',
  deposit: 'transfer',
};

export const ACCOUNT_METHODS = {
  mobile_payment: { label: 'Pago móvil', icon: 'phone' },
  transfer: { label: 'Transferencia bancaria', icon: 'building' },
};

/** "01020123456789012345" → "0102 0123 4567 8901 2345" (más fácil de leer y dictar). */
export const groupAccount = (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
