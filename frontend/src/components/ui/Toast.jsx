import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/**
 * Notificaciones flotantes. Uso:
 *
 *   const toast = useToast();
 *   toast.success('Pago confirmado', 'Se envió el comprobante por correo.');
 *   toast.error('No se pudo guardar');
 *
 * Cada toast se cierra solo tras `duration` ms (0 = permanente).
 */
const ToastContext = createContext(null);

const ICONS = {
  success: 'checkCircle',
  error: 'alertCircle',
  warning: 'alertTriangle',
  info: 'info',
};

const DEFAULT_DURATION = 4500;
const LEAVE_MS = 200;

let nextId = 1;

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    ({ variant = 'info', title, message, duration = DEFAULT_DURATION }) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-4), { id, variant, title, message, duration }]);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (title, message) => show({ variant: 'success', title, message }),
      error: (title, message) => show({ variant: 'error', title, message, duration: 7000 }),
      warning: (title, message) => show({ variant: 'warning', title, message }),
      info: (title, message) => show({ variant: 'info', title, message }),
    }),
    [show, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-label="Notificaciones" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast--${t.variant} ${t.leaving ? 'toast--leaving' : ''}`}
              role={t.variant === 'error' ? 'alert' : 'status'}
            >
              <span className="toast__icon">
                <Icon name={ICONS[t.variant]} size={18} />
              </span>
              <div className="toast__body">
                <div className="toast__title">{t.title}</div>
                {t.message && <p className="toast__message">{t.message}</p>}
              </div>
              <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Cerrar notificación">
                <Icon name="x" size={16} />
              </button>
              {t.duration > 0 && <span className="toast__progress" style={{ animationDuration: `${t.duration}ms` }} />}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}

export { ToastProvider, useToast };
