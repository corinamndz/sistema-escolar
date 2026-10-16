/** Evento para pedir a la campana que se actualice ya (p. ej. tras simular un aviso de tasa). */
export const NOTIFICATIONS_REFRESH = 'notifications:refresh';
export const refreshNotifications = () => window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH));
