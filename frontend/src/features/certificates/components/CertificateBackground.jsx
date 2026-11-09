import { useEffect, useRef, useState } from 'react';
import Spinner from '../../../components/ui/Spinner';
import Alert from '../../../components/ui/Alert';

/**
 * Pinta el fondo del certificado a todo el ancho del lienzo. Si es un PDF, dibuja
 * su primera página con pdf.js, que solo se descarga cuando hace falta.
 *   blob, type ('png' | 'jpg' | 'pdf')
 */
function CertificateBackground({ blob, type }) {
  const canvasRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    if (!blob || type === 'pdf') {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    setState('ready');
    return () => URL.revokeObjectURL(next);
  }, [blob, type]);

  useEffect(() => {
    if (!blob || type !== 'pdf') return undefined;
    let cancelled = false;
    let task = null;
    setState('loading');
    (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const page = await pdf.getPage(1);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale: 2 }); // nítido también en pantallas de alta densidad
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await task.promise;
        if (!cancelled) setState('ready');
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') setState('error');
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [blob, type]);

  if (state === 'error') return <Alert>No se pudo mostrar el PDF de fondo en el editor.</Alert>;
  return (
    <>
      {type === 'pdf' ? <canvas ref={canvasRef} className="cert-bg" aria-hidden="true" /> : url && <img src={url} className="cert-bg" alt="" draggable={false} />}
      {state === 'loading' && (
        <div className="cert-bg__loading">
          <Spinner />
        </div>
      )}
    </>
  );
}

export default CertificateBackground;
