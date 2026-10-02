/* Resultados.
   Primero "¿cómo vamos?" (resumen, evolución, cada pregunta, las áreas, lo
   que escribieron) y al final "¿qué hago ahora?" (las sugerencias).
   La explicación del anonimato vive en la fila del área oculta, que es donde
   alguien la necesita, y no en el encabezado.
   Los gráficos se dibujan animados solo la primera vez que se abre cada
   medición; después aparecen directo. */

let campanaElegida = null;
const dibujadas = new Set(); // mediciones cuyos gráficos ya se dibujaron en esta sesión

cargadores.resultados = async () => {
  const [camps, a] = await Promise.all([api('/campanas'), api('/ajustes')]);
  const minimo = Number(a.minimo_anonimato || 4);
  const conDatos = camps.filter((c) => c.estado !== 'borrador' && c.respondieron >= minimo);
  const fila = document.getElementById('selFila');
  const sel = document.getElementById('selCamp');
  const cuerpo = document.getElementById('resBody');

  if (!conDatos.length) {
    fila.hidden = true; // sin datos, no hay nada que elegir
    cuerpo.replaceChildren(vacioResultados(camps, minimo));
    return;
  }

  fila.hidden = false;
  sel.replaceChildren(...conDatos.map((c) => el('option', { value: c.id, text: c.nombre })));
  sel.value = conDatos.some((c) => c.id === campanaElegida) ? campanaElegida : conDatos[0].id;
  campanaElegida = Number(sel.value);
  await pintarResultados();
};

document.getElementById('selCamp').addEventListener('change', (e) => {
  campanaElegida = Number(e.target.value);
  pintarResultados().catch((err) => toast(err.message, true));
});

/* ---------- sin resultados todavía: el siguiente paso, con su botón ---------- */
function vacioResultados(camps, minimo) {
  const caja = (titulo, texto, boton) => el('div', { class: 'card principal' }, el('div', { class: 'pad' }, [
    el('h2', { text: titulo }),
    texto ? el('p', { class: 'muted mt8', text: texto }) : null,
    boton,
  ]));
  const abierta = camps.find((c) => c.estado === 'abierta');
  const borrador = camps.find((c) => c.estado === 'borrador');
  const cerrada = camps.find((c) => c.estado === 'cerrada');

  if (abierta) {
    return caja(
      `Van ${abierta.respondieron} de ${abierta.invitados} respuestas, los resultados aparecen al llegar al mínimo`,
      null,
      el('button', { type: 'button', class: 'btn mt16', text: 'Enviar recordatorio a quienes faltan',
        onclick: (e) => mandar(abierta.id, false, e.currentTarget) }));
  }
  if (borrador) {
    return caja('Envía la encuesta',
      `«${borrador.nombre}» está en borrador. Cuando la gente responda, los resultados aparecen acá.`,
      el('button', { type: 'button', class: 'btn mt16', text: 'Enviar la encuesta', onclick: () => ir('envio') }));
  }
  if (cerrada) {
    return caja(`«${cerrada.nombre}» cerró con ${cerrada.respondieron} de ${cerrada.invitados} respuestas`,
      `Hacen falta al menos ${minimo} para mostrar resultados sin dejar ver lo que respondió cada persona.`,
      el('button', { type: 'button', class: 'btn mt16', text: 'Crear una nueva medición', onclick: () => ir('medicion') }));
  }
  return caja('Crea tu primera medición',
    'Los resultados aparecen acá cuando la gente empieza a responder.',
    el('button', { type: 'button', class: 'btn mt16', text: 'Crear la medición', onclick: () => ir('medicion') }));
}

/* ============================================================
   Con datos
   ============================================================ */
async function pintarResultados() {
  const id = campanaElegida;
  const [d, serie] = await Promise.all([api(`/campanas/${id}/resultados`), api('/evolucion')]);
  if (id !== campanaElegida) return; // la persona eligió otra mientras cargaba
  const cuerpo = document.getElementById('resBody');
  if (d.insuficiente) { cuerpo.replaceChildren(vacioResultados([d.campana], d.minimo)); return; }

  const primeraVez = !dibujadas.has(id);
  dibujadas.add(id);

  const delta = d.anterior?.indice != null ? Math.round((d.indice - d.anterior.indice) * 10) / 10 : null;
  const resumen = el('div', { class: 'grid g3' }, [
    tile(num(d.indice), 'Resultado general (de 10)', d.campana.periodo || d.campana.nombre, 'flat'),
    tile(pct(d.participacion), 'Tasa de respuesta', `${d.respondieron} de ${d.invitados}`, 'flat'),
    tile(delta == null ? '—' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}`,
      'Frente a la medición anterior',
      d.anterior ? `${d.anterior.periodo}: ${num(d.anterior.indice)}` : 'Es la primera medición',
      delta == null ? 'flat' : delta >= 0 ? 'up' : 'down'),
  ]);

  const evolucion = serie.length >= 2 ? el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Cómo viene, medición a medición' }),
      el('span', { class: 'note', text: 'Toca un área para compararla' }),
    ]),
    el('div', { class: 'legendrow', id: 'climaLeg' }),
    el('div', { class: 'chartwrap', id: 'climaChart' }),
  ])) : null;

  const porPregunta = el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Pregunta por pregunta' }),
      el('span', { class: 'note', text: 'Favorable: la mitad de arriba de la escala' }),
    ]),
    el('div', { class: 'bloques' }, d.preguntas.filter((p) => p.n).map(bloquePregunta)),
  ]));

  const desglose = el('div', { class: 'split mt24' }, [
    el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, el('h3', { text: 'Por área' })),
      tablaDesglose('Área', d.areas),
    ])),
    el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, el('h3', { text: 'Por antigüedad' })),
      tablaDesglose('Antigüedad', d.antiguedad),
    ])),
  ]);

  const escrito = el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Lo que escribieron' }),
      el('span', { class: 'note', text: 'Sin nombre ni área. Agrupado por las palabras que más se repiten.' }),
    ]),
    d.comentarios.length
      ? el('div', { class: 'temas' }, agruparPorTema(d.comentarios, d.temas).map(grupoTema))
      : el('p', { class: 'vacio', text: 'Nadie escribió comentarios en esta medición.' }),
  ]));

  const queHacer = d.sugerencias.length ? el('div', { class: 'mt24' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Qué haría falta hacer' }),
      el('span', { class: 'note', text: 'Guárdalas en el plan para llevarles seguimiento' }),
    ]),
    ...d.sugerencias.map((s) => tarjetaSugerencia(s, d.campana)),
  ]) : null;

  cuerpo.replaceChildren(...[resumen, evolucion, porPregunta, desglose, escrito, queHacer].filter(Boolean));
  if (evolucion) dibujarEvolucion(serie, id, primeraVez);

  if (primeraVez) {
    // las barras crecen desde la izquierda, todas juntas: es una sola cosa que se dibuja
    for (const b of cuerpo.querySelectorAll('.dist, .desglose .track i')) {
      Movimiento.animar(b, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 'suave');
    }
  }
}

const tile = (k, l, d, cls) => el('div', { class: 'tile' }, [
  el('div', { class: 'k ' + (cls === 'up' || cls === 'down' ? cls : ''), text: k }),
  el('div', { class: 'l', text: l }),
  el('div', { class: 'd ' + cls, text: d }),
]);

/* ---------- una pregunta: cómo se repartieron las respuestas ---------- */
// de la mejor respuesta a la peor, con los colores que ya usa el panel
const TONOS = {
  2: ['var(--ok)', 'var(--alert)'],
  3: ['var(--ok)', 'var(--warn)', 'var(--alert)'],
  4: ['var(--ok)', 'var(--blue-soft)', 'var(--warn)', 'var(--alert)'],
  5: ['var(--ok)', 'var(--blue-soft)', 'var(--tint-line)', 'var(--warn)', 'var(--alert)'],
};
const tonos = (k) => TONOS[k] || Array.from({ length: k }, (_, i) => TONOS[5][Math.round((i / (k - 1)) * 4)]);

function bloquePregunta(p) {
  const colores = tonos(p.opciones.length);
  const partes = p.opciones.map((o, i) => ({ o, n: p.conteo[i], c: colores[i] })).filter((x) => x.n);
  const resumen = partes.map((x) => `${x.o}: ${x.n}`).join(', ');
  return el('div', { class: 'bloque' }, [
    el('div', { class: 'pq' }, [
      el('span', { class: 'ptexto', text: p.texto }),
      el('span', { class: 'pfav' }, [el('b', { text: pct(p.favorable) }), document.createTextNode(' favorable')]),
    ]),
    el('div', { class: 'dist', role: 'img', 'aria-label': `${p.texto} ${resumen}` },
      partes.map((x) => el('i', { style: `width:${(x.n / p.n) * 100}%;background:${x.c}`,
        title: `${x.o}: ${x.n} (${Math.round((x.n / p.n) * 100)}%)` }))),
    el('div', { class: 'leyenda' }, p.opciones.map((o, i) =>
      el('span', {}, [el('i', { class: 'sw', style: `background:${colores[i]}` }), document.createTextNode(`${o} ${p.conteo[i]}`)]))),
  ]);
}

/* ---------- desglose: las áreas bajo el umbral, atenuadas y explicadas ---------- */
function tablaDesglose(titulo, grupos) {
  const visibles = grupos.filter((g) => !g.oculto).sort((a, b) => b.puntaje - a.puntaje);
  const ocultos = grupos.filter((g) => g.oculto);
  return el('div', { style: 'overflow-x:auto' }, el('table', { class: 'desglose' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: titulo }), el('th', { text: 'Resultado', colspan: 2 }), el('th', { text: 'Respuestas' }),
    ])),
    el('tbody', {}, [
      ...visibles.map((g) => el('tr', {}, [
        el('td', { text: g.area }),
        el('td', { class: 'barra' }, el('div', { class: 'track' }, el('i', {
          class: g.puntaje < 6 ? 'bad' : g.puntaje < 7.5 ? 'low' : '', style: `width:${g.puntaje * 10}%` }))),
        el('td', { class: 'val', text: num(g.puntaje) }),
        el('td', { class: 'muted', text: String(g.n) }),
      ])),
      ...ocultos.map((g) => el('tr', { class: 'oculta' }, [
        el('td', { text: g.area }),
        el('td', { colspan: 3, text: 'Oculto para proteger a quienes respondieron' }),
      ])),
    ]),
  ]));
}

/* ---------- lo que escribieron, agrupado por tema ---------- */
const normal = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);

function agruparPorTema(comentarios, temas) {
  const grupos = temas.map((t) => ({ palabras: t.frase.split(' '), comentarios: [] }));
  const otros = [];
  for (const c of comentarios) {
    const palabras = new Set(normal(c.texto));
    const g = grupos.find((x) => x.palabras.every((p) => palabras.has(p)));
    (g ? g.comentarios : otros).push(c);
  }
  // el título con las tildes como las escribieron, no como quedan al normalizar
  const conTildes = (palabra, lista) => {
    for (const c of lista) {
      const original = c.texto.split(/[^\p{L}\p{N}]+/u).find((w) => normal(w)[0] === palabra);
      if (original) return original.toLowerCase();
    }
    return palabra;
  };
  const salida = grupos.filter((g) => g.comentarios.length).map((g) => {
    const t = g.palabras.map((p) => conTildes(p, g.comentarios)).join(' ');
    return { titulo: t.charAt(0).toUpperCase() + t.slice(1), comentarios: g.comentarios };
  }).sort((a, b) => b.comentarios.length - a.comentarios.length);
  if (otros.length) salida.push({ titulo: salida.length ? 'Otros comentarios' : 'Comentarios', comentarios: otros });
  return salida;
}

function grupoTema(g) {
  return el('div', { class: 'tema' }, [
    el('h4', {}, [document.createTextNode(g.titulo), el('span', { class: 'muted', text: ` · ${plural(g.comentarios.length, 'comentario', 'comentarios')}` })]),
    // texto de gente real: siempre por textContent
    ...g.comentarios.map((c) => el('p', { class: 'cita', text: c.texto })),
  ]);
}

/* ---------- sugerencias ---------- */
function tarjetaSugerencia(s, campana) {
  return el('div', { class: 'accion' }, [
    el('span', { class: 'pri ' + s.prioridad, text: s.prioridad }),
    el('h3', { text: s.titulo }),
    el('div', { class: 'ev', text: s.evidencia }),
    el('div', { class: 'de', text: s.detalle }),
    el('div', { class: 'meta' }, [
      el('span', { html: `A cargo de <b>${escapar(s.responsable)}</b>` }),
      el('span', { html: `Esfuerzo: <b>${escapar(s.esfuerzo)}</b>` }),
      el('span', { html: `Se mide en: <b>${escapar(s.indicador)}</b>` }),
    ]),
    el('button', { type: 'button', class: 'btn sm', text: 'Guardar en el plan',
      onclick: async (e) => {
        const boton = e.currentTarget;
        boton.disabled = true;
        try {
          await api('/acciones', { method: 'POST', body: { ...s, campana_id: campana.id } });
          Movimiento.ancho(boton, () => {
            boton.classList.add('hecho');
            boton.replaceChildren(check(), el('span', { text: 'Guardada en el plan' }));
          });
          cargadores.inicio(); // la insignia cuenta una más
        } catch (e2) { toast(e2.message, true); boton.disabled = false; }
      } }),
  ]);
}

/* ============================================================
   Gráfico de evolución
   ============================================================ */
const COLORES = ['#22306E', '#4F6BE8', '#1FA97A', '#E0A32E', '#D9534F', '#7E97F5', '#8E6BC9'];
const encendidas = new Set(['General']); // qué series quiere ver la persona, entre una medición y otra

function dibujarEvolucion(serie, elegida, animar) {
  const contenedor = document.getElementById('climaChart');
  const leyenda = document.getElementById('climaLeg');
  if (!contenedor) return;

  // un área que quedó oculta en todas las mediciones no tiene nada que dibujar:
  // ofrecerla en la leyenda sería un botón que no hace nada
  const areas = [...new Set(serie.flatMap((p) => p.areas.filter((a) => a.puntaje != null).map((a) => a.area)))];
  const series = [
    { n: 'General', c: COLORES[0], v: serie.map((p) => p.indice) },
    ...areas.map((a, i) => ({ n: a, c: COLORES[(i + 1) % COLORES.length],
      v: serie.map((p) => p.areas.find((x) => x.area === a)?.puntaje ?? null) })),
  ];

  // la escala baja lo que haga falta: un 3.8 no puede quedar fuera del gráfico
  const valores = series.flatMap((s) => s.v).filter((v) => v != null);
  const piso = Math.min(4, Math.floor(Math.min(...valores) / 2) * 2);
  const W = 660, H = 222, X0 = 34, X1 = 606, Y0 = 22, Y1 = 178;
  const px = (i) => X0 + (i * (X1 - X0)) / Math.max(1, serie.length - 1);
  const py = (v) => Y1 - ((v - piso) / (10 - piso)) * (Y1 - Y0);

  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS_SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': `Resultado por medición. Se ven: ${series.filter((s) => encendidas.has(s.n)).map((s) => s.n).join(', ') || 'ninguna'}` });

  for (let v = piso; v <= 10; v += 2) {
    svg.append(mk('line', { x1: X0, x2: X1, y1: py(v), y2: py(v), class: 'grid-l', 'stroke-width': 1 }));
    const t = mk('text', { x: 4, y: py(v) + 4, class: 'lbl', fill: '#6B7290' });
    t.textContent = v;
    svg.append(t);
  }
  serie.forEach((p, i) => {
    const t = mk('text', { x: px(i), y: H - 6, class: 'lbl', fill: p.id === elegida ? '#22306E' : '#6B7290',
      'text-anchor': 'middle', 'font-weight': p.id === elegida ? 600 : 400 });
    t.textContent = p.periodo + (p.estado === 'abierta' ? ' (en curso)' : '');
    svg.append(t);
  });

  const lineas = [];
  for (const s of series) {
    if (!encendidas.has(s.n)) continue;
    const trazo = s.v.map((v, i) => (v == null ? null : `${px(i)},${py(v)}`)).filter(Boolean);
    if (trazo.length > 1) {
      const l = mk('polyline', { points: trazo.join(' '), fill: 'none', stroke: s.c,
        'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      svg.append(l);
      lineas.push(l);
    }
    s.v.forEach((v, i) => {
      if (v == null) return;
      // la medición que se está mirando, un poco más marcada
      svg.append(mk('circle', { cx: px(i), cy: py(v), r: serie[i].id === elegida ? 5.2 : 3.6, fill: s.c }));
    });
    const ultimo = [...s.v].reverse().find((v) => v != null);
    if (ultimo != null) {
      const t = mk('text', { x: X1 + 8, y: py(ultimo) + 4, class: 'lbl', fill: s.c });
      t.textContent = ultimo.toFixed(1);
      svg.append(t);
    }
  }
  contenedor.replaceChildren(svg);

  if (animar) {
    // la línea se traza de izquierda a derecha, una sola vez por medición
    for (const l of lineas) {
      const largo = l.getTotalLength();
      l.style.strokeDasharray = String(largo);
      Movimiento.animar(l, [{ strokeDashoffset: largo }, { strokeDashoffset: 0 }], 'suave')
        .then(() => { l.style.strokeDasharray = ''; });
    }
  }

  leyenda.replaceChildren(...series.map((s) => el('button', {
    type: 'button', class: encendidas.has(s.n) ? 'on' : '', style: `color:${s.c}`, 'aria-pressed': String(encendidas.has(s.n)),
    onclick: () => {
      if (encendidas.has(s.n)) encendidas.delete(s.n); else encendidas.add(s.n);
      dibujarEvolucion(serie, elegida, false);
    },
  }, [el('span', { class: 'sw' }), document.createTextNode(s.n)])));
  const todas = series.every((s) => encendidas.has(s.n));
  leyenda.append(el('button', {
    type: 'button', class: 'all', text: todas ? 'Ver solo el general' : 'Ver todas',
    onclick: () => {
      encendidas.clear();
      if (todas) encendidas.add('General'); else series.forEach((s) => encendidas.add(s.n));
      dibujarEvolucion(serie, elegida, false);
    },
  }));
}
