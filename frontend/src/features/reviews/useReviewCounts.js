import { useCallback, useEffect, useState } from 'react';
import reviewsApi from '../../api/endpoints/reviews.api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

/**
 * Pendientes de revisión del usuario, por tipo, para las insignias del menú:
 * { plan: n, content: n }. Solo consulta si el usuario puede revisar
 * (coordinador o Director); para el resto devuelve ceros sin pedir nada.
 */
export function useReviewCounts({ can, user }) {
  const enabled = Boolean(user) && can('evaluation_plans', 'read') && Boolean(user.coordinator || user.isAdmin || can('roles', 'update'));
  const [counts, setCounts] = useState({ plan: 0, content: 0 });

  const load = useCallback(() => {
    if (!enabled) return;
    reviewsApi
      .inbox()
      .then((data) => {
        const items = data?.reviewer ? data.items : [];
        setCounts({ plan: items.filter((i) => i.type === 'plan').length, content: items.filter((i) => i.type === 'content').length });
      })
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 60000, enabled);
  return counts;
}
