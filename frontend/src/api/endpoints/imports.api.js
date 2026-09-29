import { axiosClient } from '../axiosClient';

/**
 * Con `responseType: 'blob'` los errores también llegan como Blob: se
 * convierten a JSON para que getErrorMessage lea `{ error: { message } }`.
 */
async function unwrapBlobError(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      err.response.data = JSON.parse(await data.text());
    } catch {
      // no era JSON: queda el mensaje genérico de axios
    }
  }
  throw err;
}

/** Nombre del archivo desde Content-Disposition (si el navegador lo expone). */
function fileNameFrom(headers, fallback) {
  const match = /filename="([^"]+)"/.exec(headers?.['content-disposition'] || '');
  return match ? match[1] : fallback;
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Se libera después: algunos navegadores leen el blob de forma asíncrona.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Sube el archivo como multipart/form-data (campo `file`). Hay que pisar el
 * Content-Type JSON por defecto del cliente o el archivo se pierde.
 * `onProgress(0..100)` informa el avance de la subida.
 */
function upload(url, file, params, onProgress) {
  const form = new FormData();
  form.append('file', file);
  return axiosClient
    .post(url, form, {
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
    })
    .then((r) => r.data);
}

/**
 * Tipos: 'students' | 'staff' | 'subjects' | 'scores' (este último necesita
 * `{ planId }` en params).
 */
const importsApi = {
  downloadTemplate: async (type, params) => {
    const res = await axiosClient.get(`/imports/${type}/template`, { params, responseType: 'blob' }).catch(unwrapBlobError);
    saveBlob(res.data, fileNameFrom(res.headers, `plantilla-${type}.xlsx`));
  },
  /** Solo valida: devuelve el reporte por fila sin guardar nada. */
  validate: (type, file, params, onProgress) => upload(`/imports/${type}/validate`, file, params, onProgress),
  /** Importa las filas válidas y devuelve el reporte final. */
  importFile: (type, file, params, onProgress) => upload(`/imports/${type}`, file, params, onProgress),
};

export { saveBlob };
export default importsApi;
