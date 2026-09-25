import { useState } from 'react';
import { getErrorMessage, getFieldErrors } from '../api/axiosClient';

/**
 * Envuelve una llamada de escritura (POST/PUT/DELETE) con estados de
 * loading/error/fieldErrors, para que los formularios no repitan try/catch.
 *
 * Uso:
 *   const { run, loading, error, fieldErrors } = useMutation(staffApi.create);
 *   await run(formData); // lanza si falla, ya seteó error/fieldErrors
 */
function useMutation(mutationFn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const run = async (...args) => {
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await mutationFn(...args);
      return result;
    } catch (err) {
      setError(getErrorMessage(err));
      setFieldErrors(getFieldErrors(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { run, loading, error, fieldErrors, setError };
}

export { useMutation };
