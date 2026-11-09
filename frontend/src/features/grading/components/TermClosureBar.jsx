import { useState } from 'react';
import gradingApi from '../../../api/endpoints/grading.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';

const day = (d) => new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Períodos del año en Resumen de calificaciones, con su estado. El Administrador
 * los cierra o reabre (canManage); cerrar habilita el ajuste directivo de
 * definitivas. Si el período cerró por su fecha de fin, se reabre cambiando la fecha.
 */
function TermClosureBar({ terms, canManage, yearClosed, onChanged }) {
  const [busy, setBusy] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();

  const change = async (term, close) => {
    const ok = await confirm(
      close
        ? {
            title: `¿Cerrar ${term.name}?`,
            message: 'Se cierra para todo el colegio y el Administrador y los Coordinadores podrán ajustar las definitivas de sus materias. Los docentes podrán seguir cargando notas. Puedes reabrirlo después.',
            confirmLabel: 'Cerrar período',
            icon: 'lock',
          }
        : {
            title: `¿Reabrir ${term.name}?`,
            message: 'Solo se podrán ajustar las materias que ya tengan su definitiva. Los ajustes ya hechos se mantienen.',
            confirmLabel: 'Reabrir período',
            icon: 'refresh',
          }
    );
    if (!ok) return;
    setBusy(term.id);
    try {
      await (close ? gradingApi.closeTerm(term.id) : gradingApi.reopenTerm(term.id));
      toast.success(close ? 'Período cerrado' : 'Período reabierto', term.name);
      onChanged();
    } catch (err) {
      toast.error(close ? 'No se pudo cerrar el período' : 'No se pudo reabrir el período', getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!terms.length) return null;
  return (
    <section className="card term-close" aria-label="Estado de los períodos">
      {terms.map((t) => {
        const manual = Boolean(t.closed_at);
        return (
          <div key={t.id} className={`term-close__item ${t.ended ? 'is-closed' : ''}`}>
            <Icon name={t.ended ? 'lock' : 'clock'} size={16} />
            <span className="term-close__text">
              <strong>{t.name}</strong>
              <span>
                {!t.ended
                  ? 'Abierto'
                  : manual
                    ? `Cerrado el ${day(t.closed_at)}${t.closed_by_name ? ` · ${t.closed_by_name}` : ''}`
                    : 'Cerrado por su fecha de fin'}
              </span>
            </span>
            {canManage && !yearClosed && !t.ended && (
              <Button size="sm" variant="secondary" icon="lock" loading={busy === t.id} disabled={Boolean(busy)} onClick={() => change(t, true)}>
                Cerrar período
              </Button>
            )}
            {canManage && !yearClosed && manual && (
              <Button size="sm" variant="ghost" icon="refresh" loading={busy === t.id} disabled={Boolean(busy)} onClick={() => change(t, false)}>
                Reabrir
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default TermClosureBar;
