import { getErrorMessage } from '../api/axiosClient';

/** Guarda un Blob como archivo en el equipo del usuario. */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Nombre del archivo que indica el servidor (Content-Disposition), o `fallback`. */
export function fileNameFrom(headers, fallback) {
  const header = headers?.['content-disposition'] || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="([^"]+)"/i.exec(header)?.[1] || fallback;
}

/** Lee el mensaje de error del backend cuando la respuesta pedida era un Blob. */
export async function blobErrorMessage(err) {
  try {
    const text = await err?.response?.data?.text?.();
    if (text) return JSON.parse(text).error?.message || getErrorMessage(err);
  } catch {
    // mensaje genérico
  }
  return getErrorMessage(err);
}
