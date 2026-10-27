import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTenant } from '../../../context/TenantContext';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import SchoolLogo from '../../../components/ui/SchoolLogo';
import { useToast } from '../../../components/ui/Toast';
import { RECOGNITION_CATEGORIES } from './RecognitionCard';

const longDate = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/** "Lucas García Castillo" + fecha → "reconocimiento-lucas-garcia-castillo-2026-10-26.pdf" */
export const certificateFilename = (r) =>
  `reconocimiento-${(r.student_name || 'alumno')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}-${String(r.awarded_on || '').slice(0, 10)}.pdf`;

/**
 * El diploma en HTML (proporción A4 horizontal): logo del colegio, título,
 * alumno, categoría, mensaje, fecha y quien lo otorga. Es la vista en
 * pantalla y lo que se imprime; el PDF descargable lo genera el servidor con
 * el mismo diseño (services/pdf/recognitionCertificate.js).
 */
export function CertificateSheet({ recognition: r }) {
  const { settings } = useTenant();
  const meta = RECOGNITION_CATEGORIES[r.category] || RECOGNITION_CATEGORIES.other;
  const course = [r.grade_name && `${r.grade_name}${r.section_name ? ` · Sección ${r.section_name}` : ''}`, r.school_period_name && `Año escolar ${r.school_period_name}`]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <div className={`cert rec-tone--${meta.tone}`}>
      <div className="cert__frame">
        <span className="cert__corner cert__corner--tl" aria-hidden="true" />
        <span className="cert__corner cert__corner--tr" aria-hidden="true" />
        <span className="cert__corner cert__corner--bl" aria-hidden="true" />
        <span className="cert__corner cert__corner--br" aria-hidden="true" />
        <span className="cert__confetti" aria-hidden="true" />

        <header className="cert__school">
          <SchoolLogo src={settings.logoUrl} name={settings.name} variant="full" className="cert__logo" />
          <div className="cert__school-name">{settings.name}</div>
          {settings.rif && <div className="cert__rif">RIF {settings.rif}</div>}
        </header>

        <h2 className="cert__heading">Certificado de reconocimiento</h2>
        <div className="cert__rule" aria-hidden="true">
          <span>★</span>
        </div>
        <p className="cert__lead">Se otorga con orgullo a</p>
        <p className="cert__student">{r.student_name}</p>
        {course && <p className="cert__course">{course}</p>}
        <p className="cert__por">por</p>
        <p className="cert__title">«{r.title}»</p>
        <span className="cert__category">{r.category_label || meta.label}</span>
        <p className="cert__message">“{r.message}”</p>

        <footer className="cert__footer">
          <div className="cert__sign">
            <strong>{longDate(r.awarded_on)}</strong>
            <span>Fecha</span>
          </div>
          <div className="cert__seal" aria-hidden="true">
            <span className="cert__seal-disc">
              <Icon name="star" size={26} />
            </span>
            <span className="cert__seal-ribbons">
              <span />
              <span />
            </span>
          </div>
          <div className="cert__sign">
            <strong className="cert__signer">{r.awarded_by_name}</strong>
            <span>Otorgado por{r.awarded_by_role ? ` · ${r.awarded_by_role}` : ''}</span>
          </div>
        </footer>
        {r.id && (
          <div className="cert__code">
            Certificado N° {String(r.id).slice(0, 8).toUpperCase()} · {settings.name}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Imprime SOLO el certificado: lo monta en una capa propia (fuera de la app),
 * fija la página en A4 horizontal sin márgenes mientras dura la impresión y
 * espera a que cargue el logo antes de abrir el diálogo del navegador.
 */
function PrintLayer({ recognition, onDone }) {
  const ref = useRef(null);
  // Una sola impresión por montaje, aunque el padre vuelva a renderizar.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const page = document.createElement('style');
    page.textContent = '@page { size: A4 landscape; margin: 0; }';
    document.head.appendChild(page);
    document.body.classList.add('printing-certificate');
    const finish = () => {
      document.body.classList.remove('printing-certificate');
      page.remove();
      done.current();
    };
    window.addEventListener('afterprint', finish, { once: true });
    const images = [...(ref.current?.querySelectorAll('img') || [])];
    Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => null)))).then(() => window.print());
    return () => window.removeEventListener('afterprint', finish);
  }, []);
  return createPortal(
    <div className="cert-print-root" ref={ref}>
      <CertificateSheet recognition={recognition} />
    </div>,
    document.body
  );
}

/**
 * Vista de certificado (modal): el diploma con "Descargar PDF" e "Imprimir".
 * `loadPdf()` → Blob del PDF del servidor (portal o personal, según quién mira).
 */
export function CertificateModal({ recognition, loadPdf, onClose }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await loadPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = certificateFilename(recognition);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success('Certificado descargado', a.download);
    } catch (err) {
      toast.error('No se pudo descargar el certificado', getErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal title="Certificado de reconocimiento" size="lg" onClose={onClose} className="cert-modal">
      <div className="cert-modal__sheet">
        <CertificateSheet recognition={recognition} />
      </div>
      <div className="form-actions cert-modal__actions">
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        <Button variant="secondary" icon="file" onClick={() => setPrinting(true)} disabled={printing}>
          Imprimir
        </Button>
        <Button icon="download" loading={downloading} loadingText="Generando PDF…" onClick={download}>
          Descargar certificado en PDF
        </Button>
      </div>
      {printing && <PrintLayer recognition={recognition} onDone={() => setPrinting(false)} />}
    </Modal>
  );
}

export default CertificateModal;
