import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../api/axiosClient';

/**
 * Hook simple para GETs: corre `fetcher()` cuando cambian `deps`, expone
 * data/loading/error y un `refetch` manual (útil después de crear/editar
 * algo en un modal). No es una librería de cache — para este scaffold no
 * hace falta más que esto.
 */
function useFetch(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => load(), [load]);

  return { data, setData, loading, error, refetch: load };
}

export { useFetch };
