/* Movimiento.
   Las reglas, tal como están en la dirección de diseño:
   - Solo se anima en respuesta a una acción o a un dato que cambió. Nunca al
     cargar una pantalla.
   - Un mismo elemento se transforma; no aparece ni desaparece de golpe.
   - Resortes con rebote mínimo. Nada dura más de 400 ms, ni siquiera sumando
     los pasos de una misma transición.
   - Con prefers-reduced-motion, todo es instantáneo.
   Los resortes se definen una sola vez acá. También quedan disponibles para
   el CSS como variables: --resorte-suave, --dur-suave, etc. */

const Movimiento = (() => {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)');
  const quieto = () => reducido.matches;

  /* Posición de un resorte amortiguado en el tiempo t (0..1 de la duración).
     zeta < 1 rebota un poco; zeta = 1 llega sin pasarse. La rigidez se elige
     para que esté asentado (99,9%) justo al terminar la duración. */
  function posicion(zeta, t) {
    if (t >= 1) return 1;
    if (zeta >= 1) {
      const w = 9.23; // ln(1000) + 2: asentado al 0,1% en t = 1
      return 1 - Math.exp(-w * t) * (1 + w * t);
    }
    const w = 6.91 / zeta; // ln(1000) / zeta
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t));
  }

  function resorte(zeta, duracion, respaldo) {
    const puntos = Array.from({ length: 41 }, (_, i) => +posicion(zeta, i / 40).toFixed(4));
    puntos[40] = 1;
    const lineal = `linear(${puntos.join(', ')})`;
    const sirve = typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', lineal);
    return { zeta, duracion, easing: sirve ? lineal : respaldo };
  }

  const RESORTES = {
    // cambios de tamaño, barras que se llenan, cosas que se transforman
    suave: resorte(0.85, 380, 'cubic-bezier(.2,.9,.25,1)'), // sobrepasa ~0,6%: casi nada
    // cambios chicos: un círculo que se marca, un texto que entra
    firme: resorte(1, 240, 'cubic-bezier(.3,.8,.3,1)'),
    // lo que se va: siempre más rápido que lo que llega
    rapido: resorte(1, 140, 'cubic-bezier(.4,0,1,1)'),
  };

  const raiz = document.documentElement.style;
  for (const [nombre, r] of Object.entries(RESORTES)) {
    raiz.setProperty(`--resorte-${nombre}`, r.easing);
    raiz.setProperty(`--dur-${nombre}`, `${r.duracion}ms`);
  }

  function animar(el, keyframes, nombre = 'suave', extra = {}) {
    const r = RESORTES[nombre];
    if (quieto() || !el || !el.animate) return Promise.resolve();
    return el.animate(keyframes, { duration: r.duracion, easing: r.easing, ...extra })
      .finished.catch(() => {}); // si la anima otra cosa encima, no es un error
  }

  /* El contenedor se estira o encoge hasta su nuevo contenido. `cambio`
     modifica el contenido; la altura acompaña con el resorte suave. */
  async function altura(el, cambio, nombre = 'suave') {
    const antes = el.getBoundingClientRect().height;
    cambio();
    if (quieto()) return;
    const despues = el.getBoundingClientRect().height;
    if (Math.abs(antes - despues) < 1) return;
    const overflow = el.style.overflow;
    el.style.overflow = 'hidden';
    await animar(el, [{ height: `${antes}px` }, { height: `${despues}px` }], nombre);
    el.style.overflow = overflow;
  }

  /* El mismo contenedor pasa a mostrar otra cosa: lo viejo se va rápido
     (140 ms), lo nuevo entra mientras la altura se acomoda (240 ms).
     380 ms en total. */
  async function reemplazar(el, nuevo) {
    const hijos = [].concat(nuevo).filter(Boolean);
    if (quieto() || !el.firstChild) { el.replaceChildren(...hijos); return; }
    await animar(el, [{ opacity: 1 }, { opacity: 0 }], 'rapido', { fill: 'forwards' });
    const antes = el.getBoundingClientRect().height;
    el.replaceChildren(...hijos);
    el.getAnimations().forEach((a) => a.cancel());
    const despues = el.getBoundingClientRect().height;
    const overflow = el.style.overflow;
    el.style.overflow = 'hidden';
    await Promise.all([
      animar(el, [{ opacity: 0 }, { opacity: 1 }], 'firme'),
      Math.abs(antes - despues) >= 1
        ? animar(el, [{ height: `${antes}px` }, { height: `${despues}px` }], 'firme')
        : null,
    ]);
    el.style.overflow = overflow;
  }

  /* Un número cuenta desde el valor anterior hasta el nuevo. */
  function contar(el, desde, hasta, formato = (x) => String(Math.round(x))) {
    if (quieto() || desde === hasta || desde == null) { el.textContent = formato(hasta); return; }
    const r = RESORTES.suave;
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / r.duracion);
      el.textContent = formato(desde + (hasta - desde) * posicion(r.zeta, t));
      if (t < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  return { RESORTES, quieto, animar, altura, reemplazar, contar };
})();
