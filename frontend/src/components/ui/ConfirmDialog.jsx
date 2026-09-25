import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import Icon from './Icon';

/**
 * Reemplazo de `window.confirm` con un modal del sistema de diseño.
 * Devuelve una promesa que resuelve `true` / `false`:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '¿Eliminar actividad?', danger: true }))) return;
 *
 * También acepta un string: `await confirm('¿Continuar?')`.
 */
const ConfirmContext = createContext(null);

function ConfirmProvider({ children }) {
  const [options, setOptions] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((opts) => {
    const normalized = typeof opts === 'string' ? { title: opts } : opts;
    setOptions(normalized);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal onClose={() => close(false)} size="sm" hideHeader>
          <div className="confirm">
            <div className={`confirm__icon ${options.danger ? 'confirm__icon--danger' : ''}`}>
              <Icon name={options.icon || (options.danger ? 'trash' : 'info')} size={24} />
            </div>
            <h3 className="confirm__title">{options.title}</h3>
            {options.message && <p className="confirm__message">{options.message}</p>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => close(false)}>
                {options.cancelLabel || 'Cancelar'}
              </Button>
              <Button
                type="button"
                variant={options.danger ? 'danger-solid' : 'primary'}
                onClick={() => close(true)}
                autoFocus
              >
                {options.confirmLabel || (options.danger ? 'Eliminar' : 'Confirmar')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}

export { ConfirmProvider, useConfirm };
