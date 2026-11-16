import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import websiteApi from '../../../api/endpoints/website.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Spinner from '../../../components/ui/Spinner';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import DynamicForm from '../../enrollment-forms/components/DynamicForm';
import { assetUrl } from '../components/SchoolSite';

/**
 * /colegio/:slug/solicitud — Solicitud de cupo pública, SIN cuenta. Es la planilla
 * de inscripción que el colegio habilitó en Diseño de planillas, más los datos
 * de contacto de quien la pide (para que el colegio le responda). Llega a
 * «Planillas recibidas» con origen «Página web».
 */
function PublicIntakePage() {
  const { slug } = useParams();
  const { data: site } = useFetch(() => websiteApi.getPublic(slug).catch(() => null), [slug]);
  const { data: form, loading, error } = useFetch(() => websiteApi.getIntake(slug), [slug]);
  const [applicant, setApplicant] = useState('');
  const [answers, setAnswers] = useState({});
  const [contact, setContact] = useState({ name: '', national_id: '', phone: '', email: '' });
  const [trap, setTrap] = useState(''); // campo trampa: invisible para las personas
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const startedAt = useRef(Date.now());
  const topRef = useRef(null);

  useEffect(() => {
    if (form?.title) document.title = `${form.title}${site?.school?.name ? ` · ${site.school.name}` : ''}`;
  }, [form, site]);

  // Qué pide la página además de la planilla (el servidor detecta lo que ya pregunta).
  const asks = form?.asks || { applicant: true, contact: { name: true, national_id: true, phone: true, email: true } };
  const brand = site?.site || {};
  const style = { '--site-primary': brand.primary_color || '#2563EB', '--site-secondary': brand.secondary_color || '#1E293B' };
  const school = site?.school;
  const logo = assetUrl(school?.logo_url);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setErrors({});
    setFormError(null);
    try {
      const r = await websiteApi.submitIntake(slug, { applicantName: applicant, answers, contact, website: trap, elapsed_ms: Date.now() - startedAt.current });
      // Lo que el colegio entendió (nombre y contacto pueden venir de la planilla misma).
      setDone({ name: r.applicant_name || applicant, phone: r.contact?.phone || contact.phone, email: r.contact?.email || contact.email });
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      const fe = getFieldErrors(err);
      // answers.<id> → el campo de la planilla; contact.<x> y applicantName → los de contacto.
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^answers\./, ''), v])));
      setFormError(getErrorMessage(err));
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="site-public intake" style={style} ref={topRef}>
      <header className="intake__bar">
        <Link to={`/colegio/${slug}`} className="intake__brand">
          {logo ? <img src={logo} alt="" /> : <span className="intake__mark">{(school?.name || 'C').slice(0, 1)}</span>}
          <span>{school?.name || 'Volver al sitio'}</span>
        </Link>
        <Link to={`/colegio/${slug}`} className="intake__back">
          <Icon name="arrowLeft" size={15} /> Volver al sitio
        </Link>
      </header>

      <main className="intake__main">
        {loading ? (
          <Spinner label="Cargando la solicitud…" />
        ) : error || !form ? (
          <div className="site-missing">
            <h1>Solicitud no disponible</h1>
            <p>{error || 'La solicitud de cupo no está disponible en este momento.'}</p>
          </div>
        ) : done ? (
          <div className="intake__done">
            <span className="intake__done-icon">
              <Icon name="checkCircle" size={36} />
            </span>
            <h1>¡Solicitud enviada!</h1>
            <p>
              Recibimos la solicitud de cupo{done.name ? (
                <>
                  {' '}
                  de <strong>{done.name}</strong>
                </>
              ) : null}
              . El colegio la revisará y se comunicará contigo{done.phone ? ` al ${done.phone}` : ''}
              {done.email ? ` o al correo ${done.email}` : ''}.
            </p>
            <Link to={`/colegio/${slug}`} className="btn btn--secondary">
              Volver al sitio
            </Link>
          </div>
        ) : (
          <form className="intake__form" onSubmit={submit} noValidate>
            <div className="intake__head">
              <span className="intake__eyebrow">Solicitud de cupo · {form.school_period_name}</span>
              <h1>{form.title}</h1>
              {form.description && <p>{form.description}</p>}
            </div>
            <Alert>{formError}</Alert>

            {/* Solo lo que la planilla NO pregunta (asks): el resto se toma de sus respuestas. */}
            {Object.values(asks.contact).some(Boolean) && (
              <section className="card intake__card">
                <h2>{asks.contact.name ? 'Datos de contacto' : 'Para responderte'}</h2>
                <p className="text-sm text-muted">De quien solicita el cupo (madre, padre o representante). El colegio se comunicará contigo por aquí.</p>
                <div className="intake__grid">
                  {asks.contact.name && (
                    <Field label="Nombre y apellido" required error={errors['contact.name']}>
                      <Input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} maxLength={150} autoComplete="name" />
                    </Field>
                  )}
                  {asks.contact.national_id && (
                    <Field label="Cédula" error={errors['contact.national_id']}>
                      <Input value={contact.national_id} onChange={(e) => setContact((c) => ({ ...c, national_id: e.target.value }))} maxLength={30} placeholder="V-12345678" />
                    </Field>
                  )}
                  {asks.contact.phone && (
                    <Field label="Teléfono" required error={errors['contact.phone']}>
                      <Input type="tel" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} maxLength={25} autoComplete="tel" placeholder="0414-1234567" />
                    </Field>
                  )}
                  {asks.contact.email && (
                    <Field label="Correo electrónico" error={errors['contact.email']}>
                      <Input type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} maxLength={150} autoComplete="email" />
                    </Field>
                  )}
                </div>
              </section>
            )}

            <section className="card intake__card">
              <h2>Planilla</h2>
              {asks.applicant && (
                <Field label="Nombre completo del aspirante" required error={errors.applicantName}>
                  <Input value={applicant} onChange={(e) => setApplicant(e.target.value)} maxLength={150} placeholder="Nombres y apellidos" />
                </Field>
              )}
              {/* Si el nombre del aspirante lo da la planilla, su error se muestra aquí arriba. */}
              {!asks.applicant && errors.applicantName && <Alert>{errors.applicantName}</Alert>}
              <DynamicForm fields={form.fields} values={answers} onChange={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} errors={errors} />
            </section>

            {/* Campo trampa: oculto para las personas; si se llena, es un robot. */}
            <label className="intake__trap" aria-hidden="true">
              Sitio web
              <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
            </label>

            <p className="text-sm text-muted">Al enviar, autorizas al colegio a usar estos datos para tramitar la solicitud de cupo y comunicarse contigo.</p>
            <div className="intake__actions">
              <Button type="submit" icon="send" loading={sending} loadingText="Enviando…">
                Enviar solicitud
              </Button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

export default PublicIntakePage;
