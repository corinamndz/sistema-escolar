import { useEffect, useRef } from 'react';
import { RATES_CHANGED } from '../../lib/notificationEvents';

/**
 * Las tasas rigen por "fecha valor" en hora de Venezuela (UTC-4 todo el año,
 * sin horario de verano): la del BCV publicada hoy en la tarde rige desde la
 * medianoche del próximo día hábil.
 */
const CARACAS_OFFSET = '-04:00';
const caracasToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());

/** ¿La tasa con esa fecha valor ya rige hoy (en Caracas)? */
export const isEffective = (rateDate) => Boolean(rateDate) && String(rateDate).slice(0, 10) <= caracasToday();

const MAX_TIMEOUT = 2 ** 31 - 1; // límite de setTimeout (~24,8 días)

/**
 * Mantiene al día una pantalla con tasas sin recargar el navegador:
 *   - cuando la campana detecta una tasa BCV nueva (evento RATES_CHANGED);
 *   - a la medianoche (Caracas) del día en que empieza a regir la próxima tasa
 *     ya publicada (`status.next`, o la de cualquier moneda), que pasa a ser la vigente;
 *   - al volver a la pestaña si cambió el día desde la última carga.
 * `status`: respuesta de /payments/exchange-rates/current (today, next, currencies[].next).
 */
export function useRateAutoRefresh(status, reload) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const onChanged = () => reloadRef.current();
    window.addEventListener(RATES_CHANGED, onChanged);
    return () => window.removeEventListener(RATES_CHANGED, onChanged);
  }, []);

  const nextDates = [status?.next?.rate_date, ...(status?.currencies || []).map((c) => c.next?.rate_date)].filter(Boolean).map((d) => String(d).slice(0, 10));
  const nextDate = nextDates.sort()[0] || null;
  const loadedOn = status?.today || null;

  useEffect(() => {
    if (!nextDate) return undefined;
    const ms = Date.parse(`${nextDate}T00:00:05${CARACAS_OFFSET}`) - Date.now();
    // Ya pasó (pestaña dormida, reloj atrasado): recarga ahora.
    if (ms <= 0) {
      reloadRef.current();
      return undefined;
    }
    const timer = setTimeout(() => reloadRef.current(), Math.min(ms, MAX_TIMEOUT));
    return () => clearTimeout(timer);
  }, [nextDate]);

  useEffect(() => {
    if (!loadedOn) return undefined;
    const onVisible = () => document.visibilityState === 'visible' && caracasToday() !== loadedOn && reloadRef.current();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadedOn]);
}
