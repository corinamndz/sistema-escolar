import { useState } from 'react';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Moneda en que el usuario quiere ver los montos, recordada en el navegador
 * (`storageKey`). Si la guardada ya no está activa en el colegio (o nunca se
 * eligió), se usa la predeterminada de `status` (GET /exchange-rates/current).
 * Devuelve [código | null, setter]; null mientras no cargan las tasas: el
 * backend aplica entonces su predeterminada.
 */
export function useViewCurrency(storageKey, status) {
  const [chosen, setChosen] = useState(() => read(storageKey));
  const available = new Set(['USD', ...(status?.currencies || []).map((c) => c.code)]);
  const value = status ? (chosen && available.has(chosen) ? chosen : status.default_currency) : null;

  const set = (code) => {
    setChosen(code);
    try {
      localStorage.setItem(storageKey, code);
    } catch {
      // preferencia no persistente
    }
  };
  return [value, set];
}
