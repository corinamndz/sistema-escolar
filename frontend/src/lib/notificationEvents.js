/** Evento para pedir a la campana que se actualice ya (p. ej. tras simular un aviso de tasa). */
export const NOTIFICATIONS_REFRESH = 'notifications:refresh';
export const refreshNotifications = () => window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH));

/** Pedir a la campana que abra su desplegable (p. ej. desde el aviso al iniciar sesión). */
export const NOTIFICATIONS_OPEN = 'notifications:open';
export const openNotifications = () => window.dispatchEvent(new Event(NOTIFICATIONS_OPEN));

/** La campana detectó un aviso de tasa BCV nuevo: las pantallas con tasas se recargan. */
export const RATES_CHANGED = 'rates:changed';
export const notifyRatesChanged = () => window.dispatchEvent(new Event(RATES_CHANGED));
