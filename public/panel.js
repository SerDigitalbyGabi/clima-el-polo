/* Panel de administración.
   Regla que se respeta en todo el archivo: nada que haya escrito un
   colaborador se inserta con innerHTML. Los comentarios de la encuesta son
   texto libre de gente real y van siempre por textContent. */

const api = async (ruta, opciones = {}) => {
  const r = await fetch('/api' + ruta, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  if (r.status === 401) { location.href = '/entrar'; throw new Error('sesión vencida'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Algo falló.');
  return d;
};

function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const h of [].concat(hijos)) if (h) n.append(h);
  return n;
}

let toastT;
function toast(msg, mal = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('mal', mal);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

const modal = document.getElementById('modal');
function abrirModal(titulo, contenido) {
  document.getElementById('modalT').textContent = titulo;
  const b = document.getElementById('modalBody');
  b.innerHTML = '';
  b.append(contenido);
  modal.classList.add('on');
}
const cerrarModal = () => modal.classList.remove('on');
document.getElementById('modalX').addEventListener('click', cerrarModal);
modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

const fecha = (f) => f ? new Date(f + 'T12:00:00').toLocaleDateString('es-PE',
  { day: 'numeric', month: 'long' }) : '—';
const pct = (x) => x == null ? '—' : Math.round(x * 100) + '%';
const num = (x) => x == null ? '—' : Number(x).toFixed(1);

/* ---------- navegación ---------- */
const cargadores = {};
let vistaActual = 'inicio';

function ir(id) {
  vistaActual = id;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('on'));
  document.getElementById('v-' + id).classList.add('on');
  document.querySelectorAll('.rail button').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (cargadores[id]) cargadores[id]().catch((e) => toast(e.message, true));
}
document.querySelectorAll('[data-go]').forEach((b) =>
  b.addEventListener('click', () => ir(b.dataset.go)));

document.getElementById('btnSalir').addEventListener('click', async () => {
  await api('/salir', { method: 'POST' });
  location.href = '/entrar';
});

/* ============================================================
   INICIO
   ============================================================ */
cargadores.inicio = async () => {
  const d = await api('/panel');
  document.getElementById('org').textContent = d.organizacion || '—';

  const cont = document.getElementById('inicioBody');
  cont.innerHTML = '';

  if (!d.curso && !d.historico.length) {
    cont.append(el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('h3', { text: 'Todavía no hay ninguna medición' }),
      el('p', { class: 'vacio', text: `Hay ${d.colaboradores} colaboradores cargados. El siguiente paso es crear una medición, elegir las preguntas y enviarla.` }),
      el('button', { class: 'btn', onclick: () => ir(d.colaboradores ? 'medicion' : 'personas'),
        text: d.colaboradores ? 'Crear la primera medición' : 'Cargar colaboradores' }),
    ])));
    return;
  }

  /* --- estado de la campaña en curso --- */
  if (d.curso) {
    const c = d.curso;
    const faltan = c.invitados - c.respondieron;
    cont.append(el('div', { class: 'status' }, [
      el('div', {}, [
        el('h2', { text: c.campana.nombre }),
        el('div', { class: 'sub', text: c.campana.cierra_en ? `Cierra el ${fecha(c.campana.cierra_en)}` : 'Sin fecha de cierre' }),
        el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((c.participacion || 0) * 100)}%` })),
        el('div', { class: 'legend' }, [
          el('span', { html: `<b>${c.respondieron}</b> respondieron` }),
          el('span', { html: `<b>${faltan}</b> pendientes` }),
          el('span', { html: `<b>${c.invitados}</b> invitados` }),
        ]),
        el('div', { class: 'row mt16' }, [
          faltan > 0 ? el('button', { class: 'btn light sm', text: `Recordarles a los ${faltan} que faltan`,
            onclick: () => ir('envio') }) : null,
          el('button', { class: 'btn light sm', text: 'Ver resultados', onclick: () => ir('resultados') }),
        ]),
      ]),
      el('div', { class: 'big' }, [
        el('em', { text: pct(c.participacion) }),
        el('span', { text: 'participación' }),
      ]),
    ]));
  }

  /* --- tiles --- */
  const ult = d.historico[d.historico.length - 1];
  const penult = d.historico[d.historico.length - 2];
  const indiceHoy = d.curso?.indice ?? ult?.indice;
  const indiceAntes = d.curso ? ult?.indice : penult?.indice;
  const delta = indiceHoy != null && indiceAntes != null ? indiceHoy - indiceAntes : null;

  const peor = (d.curso?.areas || ult?.areas || []).filter((a) => a.puntaje != null)[0];

  const tiles = el('div', { class: 'grid g4 mt24' }, [
    el('div', { class: 'tile' }, [
      el('div', { class: 'k', text: num(indiceHoy) }),
      el('div', { class: 'l', text: 'Índice de clima (de 10)' }),
      el('div', { class: 'd ' + (delta == null ? 'flat' : delta >= 0 ? 'up' : 'down'),
        text: delta == null ? 'Primera medición' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} vs. la anterior` }),
    ]),
    el('div', { class: 'tile' }, [
      el('div', { class: 'k', text: pct(d.curso?.participacion ?? ult?.participacion) }),
      el('div', { class: 'l', text: 'Participación' }),
      el('div', { class: 'd flat', text: `${d.colaboradores} colaboradores activos` }),
    ]),
    el('div', { class: 'tile' }, [
      el('div', { class: 'k', text: peor ? num(peor.puntaje) : '—' }),
      el('div', { class: 'l', text: peor ? `Área más baja: ${peor.area}` : 'Sin desglose por área todavía' }),
      el('div', { class: 'd flat', text: peor ? `${peor.n} respuestas` : `Se muestra desde ${d.minimo} respuestas por área` }),
    ]),
    el('div', { class: 'tile', style: 'cursor:pointer', onclick: () => ir('acciones') }, [
      el('div', { class: 'k', text: String(d.acciones?.cerradas || 0) }),
      el('div', { class: 'l', text: 'Acciones de mejora cerradas' }),
      el('div', { class: 'd flat', text: `${d.acciones?.abiertas || 0} sin atender · ${d.acciones?.curso || 0} en curso` }),
    ]),
  ]);
  cont.append(tiles);

  const pendientes = (d.acciones?.abiertas || 0);
  const badge = document.getElementById('railBadge');
  badge.hidden = pendientes === 0;
  badge.textContent = String(pendientes);

  /* --- gráfico + pendientes --- */
  const split = el('div', { class: 'split mt24' });

  const cardG = el('div', { class: 'card' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Cómo viene el clima medición a medición' }),
      el('span', { class: 'note', text: 'Toca un área para compararla' }),
    ]),
    el('div', { class: 'legendrow', id: 'climaLeg' }),
    el('div', { class: 'chartwrap', id: 'climaChart' }),
  ]));
  split.append(cardG);

  const listaPend = el('div', { class: 'arealist' });
  const pend = d.curso?.pendientesPorArea || [];
  if (pend.length) {
    const max = Math.max(...pend.map((p) => p.faltan));
    for (const p of pend) {
      const r = p.faltan / max;
      listaPend.append(el('div', { class: 'arearow' }, [
        el('span', { text: p.area }),
        el('div', { class: 'track' }, el('i', { class: r > .66 ? 'bad' : r > .33 ? 'low' : '',
          style: `width:${Math.round(r * 100)}%` })),
        el('span', { class: 'val', text: String(p.faltan) }),
      ]));
    }
  } else {
    listaPend.append(el('p', { class: 'vacio',
      text: d.curso ? 'Respondieron todos. No falta nadie.' : 'No hay ninguna medición abierta.' }));
  }

  const cardP = el('div', { class: 'card' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, el('h3', { text: 'Quién falta por responder' })),
    listaPend,
    avisoDeArea(d.curso),
  ]));
  split.append(cardP);
  cont.append(split);

  dibujarClima(d.historico, d.curso);
};

function avisoDeArea(curso) {
  if (!curso) return null;
  const peor = (curso.areas || []).filter((a) => a.puntaje != null)[0];
  if (!peor || peor.puntaje >= 7) return null;
  const dim = (curso.dimensiones || []).filter((x) => x.puntaje != null)[0];
  return el('div', { class: 'flag ' + (peor.puntaje < 6 ? 'grave' : '') + ' mt16' }, [
    el('span', { class: 'dot' }),
    el('p', {}, [
      el('b', { text: `${peor.area} necesita una mirada. ` }),
      document.createTextNode(
        `Promedia ${num(peor.puntaje)} sobre ${peor.n} respuestas` +
        (dim ? `, y lo más bajo de toda la medición es "${dim.etiqueta}" con ${num(dim.puntaje)}.` : '.')
      ),
    ]),
  ]);
}

/* ---------- gráfico de líneas ---------- */
const COLORES = ['#22306E', '#4F6BE8', '#1FA97A', '#E0A32E', '#D9534F', '#7E97F5', '#8E6BC9'];
let series = [];

function dibujarClima(historico, curso) {
  const puntos = [...historico];
  if (curso && curso.indice != null) {
    puntos.push({ periodo: (curso.campana.periodo || curso.campana.nombre) + ' (en curso)',
      indice: curso.indice, areas: curso.areas });
  }
  const contenedor = document.getElementById('climaChart');
  const leyenda = document.getElementById('climaLeg');
  if (!contenedor) return;

  if (puntos.length < 2) {
    contenedor.innerHTML = '';
    contenedor.append(el('p', { class: 'vacio',
      text: 'Con una sola medición todavía no hay tendencia que mostrar. Desde la segunda aparece la línea.' }));
    return;
  }

  if (!series.length) {
    const areas = [...new Set(puntos.flatMap((p) => (p.areas || []).map((a) => a.area)))];
    series = [
      { n: 'General', c: COLORES[0], on: true, v: puntos.map((p) => p.indice) },
      ...areas.map((a, i) => ({
        n: a, c: COLORES[(i + 1) % COLORES.length], on: false,
        v: puntos.map((p) => (p.areas || []).find((x) => x.area === a)?.puntaje ?? null),
      })),
    ];
  }

  const W = 660, H = 222, X0 = 34, X1 = 606, Y0 = 22, Y1 = 178;
  const px = (i) => X0 + (i * (X1 - X0)) / Math.max(1, puntos.length - 1);
  const py = (v) => Y1 - ((v - 4) / 6) * (Y1 - Y0); // escala 4..10

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  const visibles = series.filter((s) => s.on).map((s) => s.n).join(', ') || 'ninguna';
  svg.setAttribute('aria-label', `Clima por medición. Series visibles: ${visibles}`);

  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  for (let v = 4; v <= 10; v += 2) {
    svg.append(mk('line', { x1: X0, x2: X1, y1: py(v), y2: py(v), class: 'grid-l', 'stroke-width': 1 }));
    const t = mk('text', { x: 4, y: py(v) + 4, class: 'lbl', fill: '#6B7290' });
    t.textContent = v;
    svg.append(t);
  }
  puntos.forEach((p, i) => {
    const t = mk('text', { x: px(i), y: H - 6, class: 'lbl', fill: '#6B7290', 'text-anchor': 'middle' });
    t.textContent = p.periodo;
    svg.append(t);
  });

  for (const s of series) {
    if (!s.on) continue;
    const trazo = s.v.map((v, i) => v == null ? null : `${px(i)},${py(v)}`).filter(Boolean);
    if (trazo.length > 1) {
      svg.append(mk('polyline', { points: trazo.join(' '), fill: 'none', stroke: s.c,
        'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    s.v.forEach((v, i) => { if (v != null) svg.append(mk('circle', { cx: px(i), cy: py(v), r: 3.6, fill: s.c })); });
    const ultimo = [...s.v].reverse().find((v) => v != null);
    if (ultimo != null) {
      const t = mk('text', { x: X1 + 8, y: py(ultimo) + 4, class: 'lbl', fill: s.c });
      t.textContent = ultimo.toFixed(1);
      svg.append(t);
    }
  }

  contenedor.innerHTML = '';
  contenedor.append(svg);

  leyenda.innerHTML = '';
  series.forEach((s, i) => {
    leyenda.append(el('button', {
      type: 'button', class: s.on ? 'on' : '', style: `color:${s.c}`,
      onclick: () => { series[i].on = !series[i].on; dibujarClima(historico, curso); },
    }, [el('span', { class: 'sw' }), document.createTextNode(s.n)]));
  });
  const todas = series.every((s) => s.on);
  leyenda.append(el('button', {
    type: 'button', class: 'all', text: todas ? 'Ver solo el general' : 'Ver todas',
    onclick: () => { series.forEach((s, i) => { s.on = todas ? i === 0 : true; }); dibujarClima(historico, curso); },
  }));
}

/* ============================================================
   COLABORADORES
   ============================================================ */
let areasCache = [];

cargadores.personas = async () => {
  areasCache = await api('/areas');
  const sel = document.getElementById('fArea');
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todas las áreas</option>';
  for (const a of areasCache) sel.append(el('option', { value: a.nombre, text: `${a.nombre} (${a.gente})` }));
  sel.value = actual;
  await pintarPersonas();
};

async function pintarPersonas() {
  const area = document.getElementById('fArea').value;
  const gente = await api('/colaboradores' + (area ? `?area=${encodeURIComponent(area)}` : ''));
  const tb = document.getElementById('tbody');
  tb.innerHTML = '';

  document.getElementById('countTxt').textContent = area
    ? `${gente.length} en ${area}`
    : `${gente.length} colaboradores activos`;

  if (!gente.length) {
    tb.append(el('tr', {}, el('td', { colspan: 5, class: 'muted', style: 'padding:24px 10px',
      text: 'No hay nadie cargado acá todavía. Agrega la primera persona para incluirla en la próxima medición.' })));
    return;
  }

  for (const p of gente) {
    tb.append(el('tr', {}, [
      el('td', { class: 'name', text: p.nombre }),
      el('td', { text: p.area }),
      el('td', { class: 'muted', text: p.telefono || '—' }),
      el('td', { class: 'muted', text: p.antiguedad }),
      el('td', {}, el('button', {
        class: 'btn ghost sm', text: 'Dar de baja',
        onclick: async () => {
          if (!confirm(`¿Dar de baja a ${p.nombre}? Deja de recibir las mediciones, pero el historial se mantiene.`)) return;
          await api(`/colaboradores/${p.id}`, { method: 'DELETE' });
          toast(`${p.nombre} quedó dado de baja`);
          cargadores.personas();
        },
      })),
    ]));
  }
}
document.getElementById('fArea').addEventListener('change', () => pintarPersonas().catch((e) => toast(e.message, true)));

document.getElementById('btnNuevo').addEventListener('click', () => {
  // sin áreas no hay dónde ubicar a nadie (pasa después de borrar los datos
  // de ejemplo): la lista completa es la que las crea
  if (!areasCache.length) {
    abrirModal('Agregar persona', el('div', {}, [
      el('p', { class: 'muted', text: 'Todavía no hay áreas. La forma más rápida de empezar es cargar la lista completa del equipo: las áreas se crean solas.' }),
      el('button', { class: 'btn mt16', text: 'Pegar una lista',
        onclick: () => { cerrarModal(); document.getElementById('btnImportar').click(); } }),
    ]));
    return;
  }
  const f = el('form', {});
  const sel = el('select', { id: 'nArea', required: true });
  for (const a of areasCache) sel.append(el('option', { value: a.id, text: a.nombre }));

  f.append(
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Nombre completo' }),
      el('input', { id: 'nNombre', type: 'text', required: true })]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Área' }), sel]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Teléfono con WhatsApp' }),
      el('input', { id: 'nTel', type: 'tel', placeholder: '999 888 777' })]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Fecha de ingreso' }),
      el('input', { id: 'nIng', type: 'date' })]),
    el('button', { class: 'btn', type: 'submit', text: 'Agregar' })
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/colaboradores', { method: 'POST', body: {
        nombre: document.getElementById('nNombre').value,
        area_id: Number(document.getElementById('nArea').value),
        telefono: document.getElementById('nTel').value,
        ingreso: document.getElementById('nIng').value,
      } });
      cerrarModal();
      toast('Persona agregada');
      cargadores.personas();
    } catch (e2) { toast(e2.message, true); }
  });

  abrirModal('Agregar persona', f);
});

document.getElementById('btnImportar').addEventListener('click', () => {
  const f = el('form', {});
  f.append(
    el('p', { class: 'muted', style: 'font-size:13.5px;margin-bottom:12px',
      text: 'Pega una fila por persona, separando con comas o tabulaciones: nombre, área, teléfono, fecha de ingreso. Si el área no existe, se crea sola.' }),
    el('textarea', { id: 'impTexto', rows: 10, required: true,
      placeholder: 'Rosa Quispe Mamani, Limpieza, 999888412, 2023-03-15\nJulio Ramírez Soto, Mantenimiento, 999888087, 2026-02-01' }),
    el('button', { class: 'btn mt16', type: 'submit', text: 'Importar' })
  );
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/colaboradores/importar', { method: 'POST',
        body: { texto: document.getElementById('impTexto').value } });
      cerrarModal();
      toast(`${r.agregados} personas agregadas`
        + (r.yaEstaban ? ` · ${r.yaEstaban} ya estaban` : '')
        + (r.problemas.length ? ` · ${r.problemas.length} filas con problemas` : ''));
      if (r.problemas.length) {
        const ul = el('div', {});
        for (const p of r.problemas) ul.append(el('p', { class: 'muted', text: p }));
        abrirModal('Filas que no entraron', ul);
      }
      cargadores.personas();
    } catch (e2) { toast(e2.message, true); }
  });
  abrirModal('Pegar una lista', f);
});

document.getElementById('btnExportar').addEventListener('click', async () => {
  const gente = await api('/colaboradores');
  const csv = ['Nombre,Área,Teléfono,Ingreso,Antigüedad',
    ...gente.map((p) => [p.nombre, p.area, p.telefono || '', p.ingreso || '', p.antiguedad]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  bajar('colaboradores.csv', csv);
});

function bajar(nombre, texto) {
  const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + texto, ], { type: 'text/csv;charset=utf-8' })), download: nombre });
  document.body.append(a); a.click(); a.remove();
}

/* ============================================================
   NUEVA MEDICIÓN
   ============================================================ */
let preguntasCache = [];

cargadores.medicion = async () => {
  preguntasCache = await api('/preguntas');
  const lista = document.getElementById('qlist');
  lista.innerHTML = '';

  for (const p of preguntasCache) {
    const chk = el('input', { type: 'checkbox', value: p.id, checked: p.orden <= 7 });
    const fila = el('label', { class: 'q' + (p.orden <= 7 ? ' sel' : '') }, [
      chk,
      el('div', {}, [
        el('div', { class: 'qt', text: p.texto }),
        el('div', { class: 'qd', text: p.tipo === 'texto' ? 'Respuesta escrita' : p.opciones.join(' · ') }),
      ]),
    ]);
    chk.addEventListener('change', () => { fila.classList.toggle('sel', chk.checked); contarQ(); });
    lista.append(fila);
  }
  contarQ();
  await pintarCampanas();
};

const elegidas = () => [...document.querySelectorAll('#qlist input:checked')].map((i) => Number(i.value));
const contarQ = () => { document.getElementById('qCount').textContent = `${elegidas().length} elegidas`; };

document.getElementById('btnCrear').addEventListener('click', async () => {
  try {
    const r = await api('/campanas', { method: 'POST', body: {
      nombre: document.getElementById('mName').value,
      periodo: document.getElementById('mPer').value,
      cierra_en: document.getElementById('mCierra').value,
      preguntas: elegidas(),
    } });
    toast('Medición creada en borrador');
    document.getElementById('mName').value = '';
    document.getElementById('mPer').value = '';
    await pintarCampanas();
    ir('envio');
  } catch (e) { toast(e.message, true); }
});

async function pintarCampanas() {
  const camps = await api('/campanas');
  const tb = document.getElementById('campTbody');
  tb.innerHTML = '';
  if (!camps.length) {
    tb.append(el('tr', {}, el('td', { colspan: 4, class: 'muted', style: 'padding:20px 10px',
      text: 'Todavía no hay mediciones.' })));
    return;
  }
  const pill = { borrador: 'info', abierta: 'wait', cerrada: 'ok' };
  for (const c of camps) {
    tb.append(el('tr', {}, [
      el('td', { class: 'name', text: c.nombre }),
      el('td', {}, el('span', { class: 'pill ' + pill[c.estado], text: c.estado })),
      el('td', { text: c.invitados ? `${c.respondieron} de ${c.invitados}` : '—' }),
      el('td', {}, el('div', { class: 'row' }, [
        c.estado === 'abierta' ? el('button', { class: 'btn ghost sm', text: 'Cerrar',
          onclick: async () => {
            if (!confirm(`¿Cerrar "${c.nombre}"? Deja de aceptar respuestas nuevas.`)) return;
            await api(`/campanas/${c.id}/cerrar`, { method: 'POST' });
            toast('Medición cerrada'); pintarCampanas();
          } }) : null,
        el('button', { class: 'btn ghost sm', text: 'Resultados',
          onclick: () => { campanaElegida = c.id; ir('resultados'); } }),
      ])),
    ]));
  }
}

/* ============================================================
   ENVÍO
   ============================================================ */
cargadores.envio = async () => {
  const cont = document.getElementById('envioBody');
  cont.innerHTML = '';
  const camps = await api('/campanas');
  const viva = camps.find((c) => c.estado === 'abierta') || camps.find((c) => c.estado === 'borrador');

  if (!viva) {
    cont.append(el('p', { class: 'vacio', text: 'No hay ninguna medición abierta ni en borrador. Crea una primero.' }));
    return;
  }

  if (viva.estado === 'borrador') {
    cont.append(el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('h3', { text: viva.nombre }),
      el('p', { class: 'vacio', text: 'Está en borrador. Al abrirla se genera un link único por cada colaborador activo. Todavía no se envía nada.' }),
      el('button', { class: 'btn', text: 'Abrir la medición y generar los links',
        onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await api(`/campanas/${viva.id}/abrir`, { method: 'POST' });
            toast(`Listo: ${r.invitados} links generados`);
            cargadores.envio();
          } catch (e2) { toast(e2.message, true); e.target.disabled = false; }
        } }),
    ])));
    return;
  }

  const yo = await api('/yo');
  const invs = await api(`/campanas/${viva.id}/invitaciones`);
  const pendientes = invs.filter((i) => !i.respondida_en);

  cont.append(el('div', { class: 'card' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: viva.nombre }),
      el('span', { class: 'note', text: `${invs.length - pendientes.length} de ${invs.length} respondieron` }),
    ]),
    el('div', { class: 'flag' }, [
      el('span', { class: 'dot' }),
      el('p', { text: yo.canal === 'manual'
        ? 'Canal actual: envío a mano. La plataforma arma el mensaje y tú lo pegas en tu propio WhatsApp. No hace falta ningún trámite con Meta.'
        : `Canal actual: ${yo.canal}. Los mensajes salen automáticamente.` }),
    ]),
    el('div', { class: 'row mt16' }, [
      el('button', { class: 'btn', text: yo.canal === 'manual' ? 'Armar los mensajes' : 'Enviar a los pendientes',
        onclick: (e) => mandar(viva.id, false, e.target) }),
      el('button', { class: 'btn ghost', text: 'Descargar los links en CSV',
        onclick: () => {
          const csv = ['Nombre,Área,Teléfono,Link,Estado',
            ...invs.map((i) => [i.nombre, i.area, i.telefono || '', i.enlace,
              i.respondida_en ? 'respondió' : 'pendiente']
              .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
          bajar(`links-${viva.id}.csv`, csv);
        } }),
    ]),
  ])));

  const lista = el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Links por persona' }),
      el('span', { class: 'note', text: 'Cada link se responde una sola vez' }),
    ]),
    ...invs.map((i) => el('div', { class: 'linkrow' }, [
      el('div', {}, [
        el('div', { text: `${i.nombre} · ${i.area}` }),
        el('code', { text: i.enlace }),
      ]),
      el('span', { class: 'pill ' + (i.respondida_en ? 'ok' : i.recordada_en ? 'wait' : 'no'),
        text: i.respondida_en ? 'Respondió' : i.recordada_en ? 'Recordado' : 'Pendiente' }),
      i.respondida_en ? el('span', {}) : el('button', {
        class: 'btn ghost sm', text: 'Copiar',
        onclick: async (e) => {
          await navigator.clipboard.writeText(i.enlace);
          e.target.textContent = 'Copiado';
          setTimeout(() => { e.target.textContent = 'Copiar'; }, 1600);
        } }),
    ])),
  ]));
  cont.append(lista);
};

async function mandar(campanaId, recordatorio, boton) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Procesando…';
  try {
    let total = 0;
    let manuales = [];
    for (;;) {
      const r = await api(`/campanas/${campanaId}/enviar`, { method: 'POST', body: { recordatorio } });
      total += r.procesados;
      if (r.canal === 'manual') manuales = r.resultados;
      if (r.canal === 'manual' || r.restantes === 0 || r.procesados === 0) break;
      boton.textContent = `Enviando… ${total}`;
    }

    if (manuales.length) {
      mostrarManuales(manuales);
    } else {
      toast(`${total} mensajes enviados`);
      cargadores.envio();
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

function mostrarManuales(lista) {
  const cont = el('div', {});
  cont.append(el('p', { class: 'muted', style: 'font-size:13.5px;margin-bottom:14px',
    text: 'Cada botón abre WhatsApp con el mensaje ya escrito y el link personal de esa persona. Solo queda darle enviar.' }));
  for (const m of lista) {
    cont.append(el('div', { class: 'linkrow' }, [
      el('div', {}, [el('div', { text: m.nombre }), el('code', { text: m.telefono || 'sin teléfono' })]),
      el('span', {}),
      m.wa && m.telefono
        ? el('a', { class: 'btn sm', href: m.wa, target: '_blank', rel: 'noopener', text: 'Abrir WhatsApp' })
        : el('button', { class: 'btn ghost sm', text: 'Copiar mensaje',
            onclick: async (e) => {
              await navigator.clipboard.writeText(m.texto);
              e.target.textContent = 'Copiado';
            } }),
    ]));
  }
  abrirModal('Mensajes listos para enviar', cont);
}

/* ============================================================
   RESULTADOS
   ============================================================ */
let campanaElegida = null;

cargadores.resultados = async () => {
  const camps = await api('/campanas');
  const sel = document.getElementById('selCamp');
  sel.innerHTML = '';
  const conDatos = camps.filter((c) => c.estado !== 'borrador');

  if (!conDatos.length) {
    document.getElementById('resBody').innerHTML = '';
    document.getElementById('resBody').append(
      el('p', { class: 'vacio', text: 'Todavía no hay ninguna medición con respuestas.' }));
    return;
  }
  for (const c of conDatos) sel.append(el('option', { value: c.id, text: c.nombre }));
  if (campanaElegida && conDatos.some((c) => c.id === campanaElegida)) sel.value = campanaElegida;
  campanaElegida = Number(sel.value);
  await pintarResultados();
};

document.getElementById('selCamp').addEventListener('change', (e) => {
  campanaElegida = Number(e.target.value);
  pintarResultados().catch((err) => toast(err.message, true));
});

async function pintarResultados() {
  const d = await api(`/campanas/${campanaElegida}/resultados`);
  const cont = document.getElementById('resBody');
  cont.innerHTML = '';

  if (!d.respondieron) {
    cont.append(el('p', { class: 'vacio', text: 'Esta medición todavía no tiene respuestas.' }));
    return;
  }

  cont.append(el('div', { class: 'grid g4' }, [
    tile(num(d.indice), 'Índice de clima (de 10)',
      d.anterior?.indice != null ? `${d.indice >= d.anterior.indice ? '▲' : '▼'} ${Math.abs(d.indice - d.anterior.indice).toFixed(1)} vs. la anterior` : 'Primera medición',
      d.anterior?.indice == null ? 'flat' : d.indice >= d.anterior.indice ? 'up' : 'down'),
    tile(pct(d.participacion), 'Participación', `${d.respondieron} de ${d.invitados}`, 'flat'),
    tile(String(d.comentarios.length), 'Comentarios escritos', 'Respuestas de texto libre', 'flat'),
    tile(String(d.sugerencias.length), 'Acciones sugeridas', 'Salen de estos mismos números', 'flat'),
  ]));

  /* --- por pregunta --- */
  cont.append(el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Pregunta por pregunta' }),
      el('span', { class: 'note', text: 'De la más baja a la más alta' }),
    ]),
    el('div', { class: 'arealist' }, d.dimensiones.map((x) => barra(x.etiqueta, x.puntaje, x.n))),
  ])));

  /* --- por área y antigüedad --- */
  cont.append(el('div', { class: 'split mt24' }, [
    el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, [
        el('h3', { text: 'Por área' }),
        el('span', { class: 'note', text: `Desde ${d.minimo} respuestas` }),
      ]),
      el('div', { class: 'arealist' }, d.areas.map((x) => barra(x.area, x.puntaje, x.n, x.motivo))),
    ])),
    el('div', { class: 'card' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, el('h3', { text: 'Por antigüedad' })),
      el('div', { class: 'arealist' }, d.antiguedad.map((x) => barra(x.area, x.puntaje, x.n, x.motivo))),
    ])),
  ]));

  /* --- temas y comentarios --- */
  if (d.temas.length) {
    cont.append(el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
      el('div', { class: 'card-title' }, [
        el('h3', { text: 'Lo que más se repite' }),
        el('span', { class: 'note', text: 'Recuento de palabras, no reemplaza leer los comentarios' }),
      ]),
      el('div', { class: 'row' }, d.temas.map((t) =>
        el('span', { class: 'pill info', text: `${t.frase} · ${t.veces}` }))),
    ])));
  }

  const coments = el('div', {});
  for (const c of d.comentarios) {
    coments.append(el('div', { style: 'padding:13px 0;border-bottom:1px solid var(--line)' }, [
      el('p', { text: c.texto }),
      el('p', { class: 'muted', style: 'font-size:12px;margin-top:5px',
        text: c.area ? `${c.area} · ${c.dimension === 'propuesta' ? 'propuesta de mejora' : 'comentario libre'}`
                     : (c.dimension === 'propuesta' ? 'propuesta de mejora' : 'comentario libre') }),
    ]));
  }
  cont.append(el('div', { class: 'card mt24' }, el('div', { class: 'pad' }, [
    el('div', { class: 'card-title' }, [
      el('h3', { text: 'Lo que escribieron' }),
      el('span', { class: 'note', text: 'Sin nombres. El área sale solo si es lo bastante grande.' }),
    ]),
    d.comentarios.length ? coments : el('p', { class: 'vacio', text: 'Nadie escribió comentarios en esta medición.' }),
  ])));

  /* --- sugerencias --- */
  if (d.sugerencias.length) {
    const caja = el('div', {});
    for (const s of d.sugerencias) caja.append(tarjetaSugerencia(s, d.campana));
    cont.append(el('div', { class: 'mt24' }, [
      el('div', { class: 'card-title' }, [
        el('h3', { text: 'Qué haría falta hacer' }),
        el('span', { class: 'note', text: 'Guárdalas para llevarles seguimiento' }),
      ]),
      caja,
    ]));
  }
}

const tile = (k, l, d, cls) => el('div', { class: 'tile' }, [
  el('div', { class: 'k', text: k }),
  el('div', { class: 'l', text: l }),
  el('div', { class: 'd ' + cls, text: d }),
]);

function barra(nombre, puntaje, n, motivo) {
  if (puntaje == null) {
    return el('div', { class: 'arearow oculta' }, [
      el('span', { text: nombre }),
      el('span', { class: 'muted', style: 'grid-column:2/4;font-size:12.5px;text-align:right',
        text: motivo || 'Sin datos' }),
    ]);
  }
  const r = puntaje / 10;
  return el('div', { class: 'arearow' }, [
    el('span', { text: `${nombre}  ` , title: `${n} respuestas` }),
    el('div', { class: 'track' }, el('i', {
      class: puntaje < 6 ? 'bad' : puntaje < 7.5 ? 'low' : '',
      style: `width:${Math.round(r * 100)}%` })),
    el('span', { class: 'val', text: num(puntaje) }),
  ]);
}

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
    el('button', { class: 'btn sm', text: 'Guardar en el plan',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await api('/acciones', { method: 'POST', body: { ...s, campana_id: campana.id } });
          e.target.textContent = 'Guardada';
          toast('Guardada en "Qué hacer ahora"');
        } catch (e2) { toast(e2.message, true); e.target.disabled = false; }
      } }),
  ]);
}

const escapar = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================================================
   ACCIONES
   ============================================================ */
cargadores.acciones = async () => {
  const acc = await api('/acciones');
  const yo = await api('/yo');
  const cont = document.getElementById('accBody');
  cont.innerHTML = '';

  if (!acc.length) {
    cont.append(el('p', { class: 'vacio',
      text: 'Todavía no guardaste ninguna acción. Las sugerencias salen al pie de cada medición, en Resultados.' }));
    return;
  }

  const estados = { sugerida: 'Sin atender', curso: 'En curso', cerrada: 'Cerrada', descartada: 'Descartada' };

  for (const a of acc) {
    const tarjeta = el('div', { class: 'accion' + (a.estado === 'cerrada' || a.estado === 'descartada' ? ' cerrada' : '') }, [
      el('div', { class: 'row', style: 'margin-bottom:4px' }, [
        el('span', { class: 'pri ' + a.prioridad, text: a.prioridad }),
        el('span', { class: 'pill ' + (a.estado === 'cerrada' ? 'ok' : a.estado === 'curso' ? 'wait' : 'info'),
          text: estados[a.estado] }),
      ]),
      el('h3', { text: a.titulo }),
      a.evidencia ? el('div', { class: 'ev', text: a.evidencia }) : null,
      a.detalle ? el('div', { class: 'de', text: a.detalle }) : null,
      el('div', { class: 'meta' }, [
        el('span', { html: `A cargo de <b>${escapar(a.responsable || '—')}</b>` }),
        el('span', { html: `Esfuerzo: <b>${escapar(a.esfuerzo || '—')}</b>` }),
        el('span', { html: `Se mide en: <b>${escapar(a.indicador || '—')}</b>` }),
      ]),
      el('div', { class: 'row' }, [
        a.estado !== 'cerrada' ? el('button', { class: 'btn sm', text: 'Marcar como cerrada',
          onclick: () => cambiarEstado(a.id, 'cerrada') }) : null,
        a.estado === 'sugerida' ? el('button', { class: 'btn ghost sm', text: 'Ponerla en curso',
          onclick: () => cambiarEstado(a.id, 'curso') }) : null,
        yo.correoListo ? el('button', { class: 'btn ghost sm', text: 'Enviar al responsable',
          onclick: () => modalCorreo(a) }) : null,
        el('button', { class: 'btn ghost sm', text: 'Descartar',
          onclick: () => cambiarEstado(a.id, 'descartada') }),
      ]),
    ]);
    cont.append(tarjeta);
  }
};

async function cambiarEstado(id, estado) {
  try {
    await api(`/acciones/${id}`, { method: 'PATCH', body: { estado } });
    toast('Actualizada');
    cargadores.acciones();
    cargadores.inicio();
  } catch (e) { toast(e.message, true); }
}

function modalCorreo(a) {
  const f = el('form', {});
  const para = el('input', { type: 'email', value: a.correo || '', required: true, placeholder: 'jefe@ccelpolo.pe' });
  const asunto = el('input', { type: 'text', value: `Acción a tu cargo · ${a.titulo}` });
  const texto = el('textarea', { rows: 12 });
  texto.value = [
    'Hola:', '',
    'En la última medición salió esto:', '',
    a.evidencia || '', '',
    'Lo que proponemos hacer:',
    a.detalle || '', '',
    `Dónde se va a notar si funcionó: ${a.indicador || '—'}`,
    `Esfuerzo estimado: ${a.esfuerzo || '—'}`, '',
    'Cuando esté hecho, responde este correo y lo marcamos como cerrado en la plataforma. Si crees que no aplica o hace falta presupuesto, avísanos también.', '',
    'Gracias.',
  ].join('\n');

  f.append(
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Para' }), para]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Asunto' }), asunto]),
    el('div', { class: 'field' }, [el('label', { class: 'f', text: 'Mensaje' }), texto]),
    el('button', { class: 'btn', type: 'submit', text: 'Enviar' })
  );

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      await api(`/acciones/${a.id}/enviar`, { method: 'POST',
        body: { correo: para.value, asunto: asunto.value, texto: texto.value } });
      cerrarModal();
      toast('Correo enviado · la acción quedó en curso');
      cargadores.acciones();
    } catch (e2) {
      toast(e2.message, true);
      btn.disabled = false; btn.textContent = 'Enviar';
    }
  });

  abrirModal('Enviar la acción', f);
}

/* ============================================================
   AJUSTES
   ============================================================ */
cargadores.ajustes = async () => {
  const [a, yo] = await Promise.all([api('/ajustes'), api('/yo')]);
  document.getElementById('aOrg').value = a.organizacion || '';
  document.getElementById('aRem').value = a.remitente || '';
  document.getElementById('aMin').value = a.minimo_anonimato || 4;

  const cont = document.getElementById('canales');
  cont.innerHTML = '';
  const desc = {
    manual: 'Envío a mano. La plataforma arma el mensaje con el link personal y tú lo pegas en tu WhatsApp. No hace falta ningún trámite.',
    meta: 'WhatsApp Cloud API de Meta. Los mensajes salen solos con una plantilla aprobada.',
    twilio: 'Twilio como intermediario de WhatsApp.',
  };

  for (const canal of ['manual', 'meta', 'twilio']) {
    const listo = yo.canales[canal];
    const fila = el('label', { class: 'q' + (a.canal_envio === canal ? ' sel' : '') }, [
      el('input', { type: 'radio', name: 'canal', value: canal,
        checked: a.canal_envio === canal, disabled: !listo }),
      el('div', {}, [
        el('div', { class: 'qt', text: canal === 'manual' ? 'A mano' : canal === 'meta' ? 'Meta Cloud API' : 'Twilio' }),
        el('div', { class: 'qd', text: desc[canal] + (listo ? '' : ' · faltan las credenciales') }),
      ]),
    ]);
    fila.querySelector('input').addEventListener('change', async () => {
      await api('/ajustes', { method: 'PATCH', body: { canal_envio: canal } });
      toast('Canal cambiado');
      cargadores.ajustes();
    });
    cont.append(fila);
  }

  document.getElementById('canalNota').textContent = yo.correoListo
    ? 'Resend está configurado: los correos a los jefes de área salen desde la plataforma.'
    : 'Resend todavía no está configurado. Sin él, el botón de enviar la acción por correo no aparece.';
};

document.getElementById('btnAjustes').addEventListener('click', async () => {
  try {
    await api('/ajustes', { method: 'PATCH', body: {
      organizacion: document.getElementById('aOrg').value,
      remitente: document.getElementById('aRem').value,
      minimo_anonimato: document.getElementById('aMin').value,
    } });
    toast('Ajustes guardados');
    document.getElementById('org').textContent = document.getElementById('aOrg').value;
  } catch (e) { toast(e.message, true); }
});

/* ---------- datos de ejemplo ---------- */
document.getElementById('btnBorrarEjemplo').addEventListener('click', async (e) => {
  if (!confirm('Se borran todos los datos de ejemplo: colaboradores, mediciones, respuestas y acciones. La plataforma queda vacía para cargar a tu equipo. ¿Seguimos?')) return;
  const boton = e.currentTarget;
  boton.disabled = true;
  try {
    await api('/ejemplo/borrar', { method: 'POST' });
    location.reload();
  } catch (e2) {
    toast(e2.message, true);
    boton.disabled = false;
  }
});

/* ---------- arranque ---------- */
(async () => {
  try {
    const yo = await api('/yo');
    document.getElementById('ejemplo').hidden = !yo.datosEjemplo;
    document.getElementById('quienSoy').textContent = yo.nombre;
    document.getElementById('org').textContent = yo.organizacion || '—';
    const hora = new Date().getHours();
    document.getElementById('saludo').textContent =
      `${hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'}, ${yo.nombre.split(' ')[0]}`;
    await cargadores.inicio();
  } catch (e) {
    toast(e.message, true);
  }
})();
