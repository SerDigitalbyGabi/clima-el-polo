/* Inicio.
   Arriba, siempre, los cinco pasos del proceso. Abajo, una sola tarjeta que
   responde primero "¿cómo vamos?" y después "¿qué hago ahora?", según el
   momento en que esté la empresa. Pasos y tarjeta son siempre los mismos
   elementos: cuando cambia el momento, se transforman.

   Nada se anima la primera vez que se pinta la pantalla. Se anima solo lo
   que cambió respecto de lo último que la persona vio acá. */

const PASOS = [
  { titulo: 'Colaboradores', viene: 'Sube el Excel de tu equipo: nombre, área, celular y fecha de ingreso.' },
  { titulo: 'Nueva medición', viene: 'Eliges las preguntas y la fecha de cierre.' },
  { titulo: 'Enviar la encuesta', viene: 'Cada persona recibe su propio link por WhatsApp.' },
  { titulo: 'Resultados', viene: 'Cómo están, pregunta por pregunta y por área.' },
  { titulo: 'Qué hacer ahora', viene: 'Acciones concretas, cada una con su responsable.' },
];
const MOMENTOS = ['vacio', 'sinMedicion', 'borrador', 'curso', 'cerrada'];

let inicioVisto = null;  // lo último que la persona vio acá, para animar solo los cambios
let sondeo = null;       // mientras hay una encuesta en curso, se consulta cada 30 s
let ultimaCarga = null;  // lo que no entró de la última carga de archivo

/* ---------- en qué momento está la empresa ---------- */
function momento(d) {
  if (!d.colaboradores) return 'vacio';
  if (d.curso) return 'curso';
  if (d.borrador) return 'borrador';
  if (d.ultima?.estado === 'cerrada') return 'cerrada';
  return 'sinMedicion';
}

const estadosDePasos = (m) => {
  const i = MOMENTOS.indexOf(m);
  return PASOS.map((_, k) => (k < i ? 'hecho' : k === i ? 'activo' : 'pendiente'));
};

function cierraEn(iso) {
  if (!iso) return 'sin fecha de cierre';
  const dias = Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(hoyLima() + 'T12:00:00Z')) / 86400e3);
  if (dias <= 0) return 'cierra hoy';
  if (dias === 1) return 'cierra mañana';
  return `cierra en ${dias} días`;
}

// lo que dice cada paso: qué viene, o qué quedó hecho
function lineaDe(k, estado, d) {
  if (estado !== 'hecho') return PASOS[k].viene;
  const res = d.historico[d.historico.length - 1];
  switch (k) {
    case 0: return `${plural(d.colaboradores, 'persona', 'personas')} en ${plural(d.areas, 'área', 'áreas')}`;
    case 1: return d.ultima?.nombre || 'Lista';
    case 2: {
      if (d.curso) return d.curso.campana.cierra_en ? `Abierta hasta el ${fecha(d.curso.campana.cierra_en)}` : 'Abierta';
      // si se cerró a mano antes de la fecha prevista, esa fecha todavía no llegó
      const cierre = d.ultima?.cierra_en;
      return cierre && cierre <= hoyLima() ? `Cerró el ${fecha(cierre)}` : 'Cerrada';
    }
    case 3: return res && res.id === d.ultima?.id ? `Resultado general ${num(res.indice)}` : 'Con pocas respuestas';
    default: return PASOS[k].viene;
  }
}

/* ============================================================
   Los cinco pasos
   ============================================================ */
function pintarPasos(estados, d, previos, m) {
  const ol = document.getElementById('pasos');
  if (!ol.children.length) {
    PASOS.forEach((p, k) => ol.append(el('li', { class: 'paso' }, [
      el('div', { class: 'cabeza' }, [
        el('span', { class: 'circulo', 'aria-hidden': 'true' }),
        el('span', { class: 'union', 'aria-hidden': 'true' }, el('i')),
      ]),
      el('div', { class: 'texto' }, [
        el('span', { class: 'titulo', text: p.titulo }),
        el('span', { class: 'sr' }),
        el('span', { class: 'linea' }),
        el('div', { class: 'accionPaso' }),
      ]),
    ])));
  }

  PASOS.forEach((p, k) => {
    const li = ol.children[k];
    const est = estados[k];
    const antes = previos?.[k];
    const cambio = antes != null && antes !== est;

    li.dataset.estado = est;
    if (est === 'activo') li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    li.querySelector('.sr').textContent = est === 'hecho' ? ' (listo)' : est === 'activo' ? ' (ahora)' : ' (después)';

    const circ = li.querySelector('.circulo');
    circ.replaceChildren(est === 'hecho' ? check() : document.createTextNode(String(k + 1)));
    if (cambio && est === 'hecho') Movimiento.animar(circ.firstChild, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 'firme');
    if (cambio && est === 'activo') Movimiento.animar(circ, [{ transform: 'scale(.85)' }, { transform: 'scale(1)' }], 'firme');

    const linea = li.querySelector('.linea');
    const texto = lineaDe(k, est, d);
    if (linea.textContent !== texto) {
      if (cambio) Movimiento.reemplazar(linea, document.createTextNode(texto));
      else linea.textContent = texto;
    }

    // el único paso con botón propio: cargar el equipo cuando todavía no hay nadie
    const slot = li.querySelector('.accionPaso');
    const lleva = k === 0 && m === 'vacio';
    if (lleva && !slot.firstChild) slot.append(controlCarga());
    if (!lleva && slot.firstChild) {
      if (inicioVisto) Movimiento.reemplazar(slot, []);
      else slot.replaceChildren();
    }
  });
}

/* ============================================================
   Cargar el equipo: el botón se vuelve barra de progreso y termina en check
   ============================================================ */
function controlCarga() {
  const input = el('input', { type: 'file', accept: '.xlsx,.csv,.txt', hidden: true });
  const boton = el('button', { type: 'button', class: 'btn sm carga', text: 'Cargar colaboradores' });
  boton.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (f) subirEquipo(f, boton);
  });
  return el('div', {}, [boton, input]);
}

async function subirEquipo(archivo, boton) {
  let leido;
  try {
    leido = await Archivo.leerColaboradores(archivo);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  if (!leido.filas.length) {
    toast(leido.problemas.length
      ? 'Ninguna fila tiene nombre y área. Revisa el archivo.'
      : 'No encontramos colaboradores en ese archivo. Necesita una columna con el nombre y otra con el área.', true);
    return;
  }

  const total = leido.filas.length;
  const relleno = el('i');
  const barra = el('span', { class: 'barrita', role: 'progressbar', 'aria-label': 'Carga del equipo',
    'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': 0 }, relleno);
  const leyenda = el('span', { text: `Cargando 0 de ${total}…` });
  Movimiento.ancho(boton, () => {
    boton.disabled = true;
    boton.classList.add('cargando');
    boton.replaceChildren(barra, leyenda);
  });

  let agregados = 0;
  let yaEstaban = 0;
  const problemas = [...leido.problemas];
  try {
    // en tandas: la barra avanza con lo que de verdad ya se guardó
    for (let i = 0; i < total; i += 12) {
      const tanda = leido.filas.slice(i, i + 12);
      const r = await api('/colaboradores/importar', { method: 'POST', body: { filas: tanda } });
      agregados += r.agregados;
      yaEstaban += r.yaEstaban;
      problemas.push(...r.problemas);
      const listos = Math.min(total, i + tanda.length);
      relleno.style.width = `${Math.round((listos / total) * 100)}%`;
      barra.setAttribute('aria-valuenow', String(listos));
      leyenda.textContent = `Cargando ${listos} de ${total}…`;
    }
  } catch (e) {
    toast(`${e.message} Se cargaron ${agregados} de ${total}. Vuelve a subir el mismo archivo: los que ya entraron no se duplican.`, true);
    Movimiento.ancho(boton, () => {
      boton.disabled = false;
      boton.classList.remove('cargando');
      boton.replaceChildren('Cargar colaboradores');
    });
    return;
  }

  Movimiento.ancho(boton, () => {
    boton.classList.remove('cargando');
    boton.classList.add('hecho');
    boton.replaceChildren(check(), el('span', { text: plural(agregados, 'colaborador cargado', 'colaboradores cargados') }));
  });
  Movimiento.animar(boton.firstChild, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 'firme');

  ultimaCarga = { problemas, yaEstaban };
  // un momento para que se lea el resultado, y el Inicio pasa al paso siguiente
  setTimeout(() => cargadores.inicio().catch((e) => toast(e.message, true)), 1300);
}

/* ============================================================
   La tarjeta de cada momento
   ============================================================ */
function tarjetaSinMedicion(d) {
  const avisos = [];
  if (ultimaCarga?.problemas.length) {
    const lista = ultimaCarga.problemas;
    avisos.push(el('div', { class: 'flag mt16' }, [
      el('span', { class: 'dot' }),
      el('p', {}, [
        document.createTextNode(`${plural(lista.length, 'fila del archivo no entró', 'filas del archivo no entraron')}. `),
        el('button', { type: 'button', class: 'enlace', text: 'Ver cuáles',
          onclick: () => abrirModal('Filas que no entraron', el('div', {}, lista.map((p) => el('p', { class: 'muted', text: p })))) }),
      ]),
    ]));
  }
  return el('div', { class: 'card principal' }, el('div', { class: 'pad' }, [
    el('h2', { text: `Tienes ${plural(d.colaboradores, 'colaborador', 'colaboradores')} en ${plural(d.areas, 'área', 'áreas')}.` }),
    el('p', { class: 'muted mt8', text: 'Crea tu primera medición.' }),
    ...avisos,
    el('button', { type: 'button', class: 'btn mt16', text: 'Crear la medición', onclick: () => ir('medicion') }),
  ]));
}

function tarjetaBorrador(d) {
  const b = d.borrador;
  return el('div', { class: 'card principal' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: b.nombre }),
      el('span', { class: 'pill info', text: 'Borrador' }),
    ]),
    el('p', { class: 'muted', text: `${plural(b.n_preguntas, 'pregunta', 'preguntas')} · ${b.cierra_en ? `cierra el ${fecha(b.cierra_en)}` : 'sin fecha de cierre'}` }),
    el('button', { type: 'button', class: 'btn mt16', text: 'Enviar la encuesta', onclick: () => ir('envio') }),
  ]));
}

function filaArea(a) {
  return el('div', { class: 'arearow conteo', 'data-area': a.area }, [
    el('span', { text: a.area }),
    el('div', { class: 'track' }, el('i', { style: `width:${Math.round((a.respondieron / a.invitados) * 100)}%` })),
    el('span', { class: 'val', text: `${a.respondieron} de ${a.invitados}` }),
  ]);
}

function pieCurso(c) {
  const faltan = c.invitados - c.respondieron;
  return faltan > 0
    ? el('button', { type: 'button', class: 'btn', text: 'Enviar recordatorio a quienes faltan',
        onclick: (e) => mandar(c.campana.id, false, e.currentTarget) })
    : el('p', { class: 'muted', text: 'Respondieron todos. No falta nadie.' });
}

function tarjetaCurso(d) {
  const c = d.curso;
  const pct = Math.round((c.participacion || 0) * 100);
  return el('div', { class: 'card principal', 'data-campana': c.campana.id }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: c.campana.nombre }),
      el('span', { class: 'pill wait', text: 'En curso' }),
    ]),
    el('p', { class: 'tasa' }, [
      el('b', { class: 'cuenta', text: String(c.respondieron) }),
      el('span', { class: 'resto', text: ` de ${c.invitados} respondieron · ${cierraEn(c.campana.cierra_en)}` }),
    ]),
    el('div', { class: 'track grande', role: 'progressbar', 'aria-label': 'Respuestas recibidas',
      'aria-valuemin': 0, 'aria-valuemax': c.invitados, 'aria-valuenow': c.respondieron },
      el('i', { style: `width:${pct}%` })),
    el('div', { class: 'arealist mt16 areas' }, c.porArea.map(filaArea)),
    el('div', { class: 'pie mt16' }, pieCurso(c)),
  ]));
}

/* Llegaron respuestas nuevas: la misma tarjeta se actualiza. Los números
   cuentan, las barras se llenan; nada se vuelve a dibujar. */
function actualizarCurso(d, previo) {
  const c = d.curso;
  const tarjeta = document.querySelector('#inicioPrincipal .principal');
  if (!tarjeta) return;
  Movimiento.contar(tarjeta.querySelector('.cuenta'), previo.respondieron, c.respondieron);
  tarjeta.querySelector('.resto').textContent = ` de ${c.invitados} respondieron · ${cierraEn(c.campana.cierra_en)}`;
  const barra = tarjeta.querySelector('.track.grande');
  barra.setAttribute('aria-valuenow', String(c.respondieron));
  barra.firstChild.style.width = `${Math.round((c.participacion || 0) * 100)}%`;
  for (const a of c.porArea) {
    const fila = [...tarjeta.querySelectorAll('.arearow')].find((f) => f.dataset.area === a.area);
    if (!fila) continue;
    fila.querySelector('.track i').style.width = `${Math.round((a.respondieron / a.invitados) * 100)}%`;
    fila.querySelector('.val').textContent = `${a.respondieron} de ${a.invitados}`;
  }
  const pie = tarjeta.querySelector('.pie');
  const faltabanAntes = previo.invitados - previo.respondieron;
  if ((faltabanAntes > 0) !== (c.invitados - c.respondieron > 0)) Movimiento.reemplazar(pie, pieCurso(c));
}

function tarjetaCerrada(d) {
  const u = d.ultima;
  const res = d.historico[d.historico.length - 1];

  if (!res || res.id !== u.id) {
    return el('div', { class: 'card principal' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, [el('h2', { text: u.nombre }), el('span', { class: 'pill ok', text: 'Cerrada' })]),
      el('p', { text: `Cerró con ${u.respondieron} de ${u.invitados} respuestas. Con tan pocas, el resultado dejaría ver lo que respondió cada persona, así que no se muestra.` }),
      el('button', { type: 'button', class: 'btn mt16', text: 'Crear una nueva medición', onclick: () => ir('medicion') }),
    ]));
  }

  const ant = d.historico.length > 1 ? d.historico[d.historico.length - 2] : null;
  const delta = ant ? Math.round((res.indice - ant.indice) * 10) / 10 : null;
  const visibles = res.areas.filter((a) => a.puntaje != null).sort((a, b) => b.puntaje - a.puntaje);
  const altas = visibles.slice(0, 2);
  const bajas = visibles.slice(2).slice(-2).reverse();

  const listaAreas = (titulo, areas) => el('div', {}, [
    el('div', { class: 'etq', text: titulo }),
    el('div', { class: 'arealist' }, areas.map((a) => el('div', { class: 'arearow' }, [
      el('span', { text: a.area }),
      el('div', { class: 'track' }, el('i', { class: a.puntaje < 6 ? 'bad' : a.puntaje < 7.5 ? 'low' : '', style: `width:${a.puntaje * 10}%` })),
      el('span', { class: 'val', text: num(a.puntaje) }),
    ]))),
  ]);

  const proximas = d.proximas.length
    ? [
        el('div', { class: 'proximas' }, d.proximas.map((a) => el('div', { class: 'proxima' }, [
          el('span', { class: 'pri ' + a.prioridad, text: a.prioridad }),
          el('div', {}, [
            el('div', { class: 'tit', text: a.titulo }),
            a.responsable ? el('div', { class: 'muted', text: a.responsable }) : null,
          ]),
        ]))),
        el('button', { type: 'button', class: 'enlace mt8', onclick: () => ir('acciones'),
          text: d.acciones.pendientes > 3 ? `Ver las ${d.acciones.pendientes} acciones →` : 'Ir a Qué hacer ahora →' }),
      ]
    : [
        el('p', { class: 'muted', text: 'Todavía no hay acciones en el plan. Las sugerencias están al final de los resultados.' }),
        el('button', { type: 'button', class: 'btn ghost sm mt8', text: 'Ver los resultados', onclick: () => ir('resultados') }),
      ];

  return el('div', { class: 'card principal' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [el('h2', { text: u.nombre }), el('span', { class: 'pill ok', text: 'Cerrada' })]),
    el('div', { class: 'cierre' }, [
      el('div', {}, [
        el('div', { class: 'cifra' }, [el('span', { text: num(res.indice) }), el('small', { text: 'de 10' })]),
        el('div', { class: 'd ' + (delta == null ? 'flat' : delta >= 0 ? 'up' : 'down'),
          text: delta == null ? 'Primera medición' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} frente a ${ant.periodo}` }),
        el('button', { type: 'button', class: 'enlace mt8', text: 'Ver los resultados →', onclick: () => ir('resultados') }),
      ]),
      altas.length ? listaAreas('Las más altas', altas) : null,
      bajas.length ? listaAreas('Las más bajas', bajas) : null,
    ]),
    el('div', { class: 'separa' }),
    el('h3', { text: 'Qué hacer ahora' }),
    ...proximas,
  ]));
}

function tarjeta(m, d) {
  if (m === 'sinMedicion') return tarjetaSinMedicion(d);
  if (m === 'borrador') return tarjetaBorrador(d);
  if (m === 'curso') return tarjetaCurso(d);
  if (m === 'cerrada') return tarjetaCerrada(d);
  return null; // vacío: el paso 1 ya trae su botón
}

/* ============================================================
   Pintar
   ============================================================ */
function pintarInsignia(d) {
  // la insignia no se anima (es la barra lateral) y con 0 no aparece
  const n = d.acciones?.pendientes || 0;
  const b = document.getElementById('railBadge');
  b.hidden = n === 0;
  b.textContent = String(n);
}

async function pintarInicio(d) {
  const m = momento(d);
  const estados = estadosDePasos(m);
  const previo = inicioVisto;

  document.getElementById('org').textContent = d.organizacion || '—';
  document.getElementById('inicioSub').textContent = m === 'vacio'
    ? 'Empecemos por cargar a tu equipo.'
    : 'Esto es todo lo que necesitas revisar hoy.';

  pintarPasos(estados, d, previo?.estados, m);

  const principal = document.getElementById('inicioPrincipal');
  const mismaEncuesta = previo?.momento === 'curso' && m === 'curso'
    && previo.curso?.campana.id === d.curso.campana.id;
  if (mismaEncuesta) {
    actualizarCurso(d, previo.curso);
  } else {
    const nodo = tarjeta(m, d);
    if (previo && previo.momento !== m) await Movimiento.reemplazar(principal, nodo ? [nodo] : []);
    else principal.replaceChildren(...(nodo ? [nodo] : []));
  }

  inicioVisto = { momento: m, estados, curso: d.curso };
  vigilar(m === 'curso');
}

function vigilar(activo) {
  if (!activo) { clearInterval(sondeo); sondeo = null; return; }
  if (sondeo) return;
  sondeo = setInterval(async () => {
    if (vistaActual !== 'inicio' || document.hidden) return;
    try { await pintarInicio(await api('/panel')); } catch { /* lo intenta de nuevo en 30 s */ }
  }, 30000);
}

cargadores.inicio = async () => {
  const d = await api('/panel');
  pintarInsignia(d);
  // Si la persona está en otra pantalla, solo se actualiza la insignia. El
  // Inicio se pinta cuando se ve: así el cambio se anima frente a sus ojos.
  if (vistaActual === 'inicio') await pintarInicio(d);
};
