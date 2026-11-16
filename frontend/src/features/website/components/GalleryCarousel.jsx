import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../components/ui/Icon';

const AUTOPLAY_MS = 5000;

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Carrusel de la galería del sitio web (sin dependencias).
 *
 * El desplazamiento es el nativo del navegador con scroll-snap: en móvil y
 * tablet se desliza con el dedo, en computadora con flechas, puntos o teclado
 * (← →). Cuántas fotos se ven a la vez lo decide el CSS según el ancho del
 * CONTENEDOR del sitio (container queries: 3 en escritorio, 2 en tablet, 1 en
 * teléfono; la plantilla Minimalista muestra 4), así que la vista previa del
 * editor se comporta igual que la página real. Aquí solo se mide el resultado.
 *
 * autoplay (opcional, school_websites.gallery_autoplay): avanza cada 5 s y
 * vuelve al inicio al llegar al final. Se detiene con el mouse encima, con el
 * foco dentro (teclado), con la pestaña oculta, fuera de pantalla, con el botón
 * de pausa y siempre si el visitante pidió reducir el movimiento.
 *
 *   images   [{ url, caption, alt? }] con la url ya resuelta (assetUrl)
 *   label    nombre accesible del carrusel
 */
function GalleryCarousel({ images, autoplay = false, label = 'Galería de fotos' }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0); // primera foto visible
  const [positions, setPositions] = useState(1); // paradas posibles (fotos − visibles + 1)
  const [paused, setPaused] = useState(false); // pausa elegida por el visitante
  const [hold, setHold] = useState(false); // mouse encima o foco dentro
  const [visible, setVisible] = useState(true); // en pantalla y con la pestaña activa
  const reduced = prefersReducedMotion();

  /** Distancia entre el inicio de dos fotos consecutivas (ancho + separación). */
  const step = useCallback(() => {
    const track = trackRef.current;
    const [a, b] = track?.children || [];
    if (!a) return 1;
    return b ? b.offsetLeft - a.offsetLeft : a.offsetWidth;
  }, []);

  // Cuántas paradas hay: depende de cuántas fotos caben (CSS) y cambia con el ancho.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => {
      const perView = Math.max(1, Math.round((track.clientWidth + 1) / step()));
      const total = Math.max(1, images.length - perView + 1);
      setPositions(total);
      setIndex((i) => Math.min(i, total - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [images.length, step]);

  // La posición sigue al desplazamiento (dedo, rueda o botones).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
        setIndex(atEnd ? positions - 1 : Math.round(track.scrollLeft / step()));
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener('scroll', onScroll);
    };
  }, [positions, step]);

  const goTo = useCallback(
    (i) => {
      const track = trackRef.current;
      if (!track) return;
      const target = (i + positions) % positions; // da la vuelta en los extremos
      track.scrollTo({ left: target * step(), behavior: reduced ? 'auto' : 'smooth' });
      setIndex(target);
    },
    [positions, step, reduced]
  );

  // Solo avanza mientras se ve: fuera de pantalla o con la pestaña oculta, quieto.
  useEffect(() => {
    const track = trackRef.current;
    if (!autoplay || !track) return undefined;
    let inView = true;
    const update = () => setVisible(inView && document.visibilityState === 'visible');
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    io.observe(track);
    document.addEventListener('visibilitychange', update);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [autoplay]);

  const running = autoplay && !reduced && positions > 1 && !paused && !hold && visible;
  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => goTo(index + 1), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [running, index, goTo]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(index + 1);
    }
  };

  const controls = positions > 1;

  return (
    <div
      className="site__carousel"
      role="region"
      aria-roledescription="carrusel"
      aria-label={label}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHold(false)}
      onKeyDown={onKeyDown}
    >
      <div className="site__carousel-viewport">
        {/* tabIndex: con teclado se puede enfocar y mover con ← → */}
        <ul ref={trackRef} className="site__carousel-track" tabIndex={0} aria-live={running ? 'off' : 'polite'}>
          {images.map((g, i) => (
            <li key={`${g.url}-${i}`} className="site__slide" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${images.length}`}>
              <figure>
                <img src={g.url} alt={g.caption || g.alt || `Foto ${i + 1}`} loading={i < 4 ? 'eager' : 'lazy'} draggable={false} />
                {g.caption && <figcaption>{g.caption}</figcaption>}
              </figure>
            </li>
          ))}
        </ul>
        {controls && (
          <>
            <button type="button" className="site__carousel-arrow is-prev" onClick={() => goTo(index - 1)} aria-label="Foto anterior">
              <Icon name="chevronLeft" size={22} />
            </button>
            <button type="button" className="site__carousel-arrow is-next" onClick={() => goTo(index + 1)} aria-label="Foto siguiente">
              <Icon name="chevronRight" size={22} />
            </button>
          </>
        )}
      </div>
      {controls && (
        <div className="site__carousel-bar">
          <div className="site__carousel-dots" role="group" aria-label="Elegir posición">
            {Array.from({ length: positions }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`site__carousel-dot ${i === index ? 'is-active' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Ir a la posición ${i + 1} de ${positions}`}
                aria-current={i === index ? 'true' : undefined}
              />
            ))}
          </div>
          {autoplay && !reduced && (
            <button type="button" className="site__carousel-play" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Reanudar el carrusel' : 'Pausar el carrusel'}>
              <Icon name={paused ? 'play' : 'pause'} size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default GalleryCarousel;
