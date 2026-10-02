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
const escapar = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
// hoy en Lima (UTC-5, sin horario de verano), como lo calcula el servidor
const hoyLima = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

const NS_SVG = 'http://www.w3.org/2000/svg';
function check() {
  const s = document.createElementNS(NS_SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('width', '14');
  s.setAttribute('height', '14');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('check');
  const p = document.createElementNS(NS_SVG, 'polyline');
  p.setAttribute('points', '3.5,8.5 6.5,11.5 12.5,4.5');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.append(p);
  return s;
}

/* ---------- navegación ---------- */
const cargadores = {};
let vistaActual = 'inicio';

function ir(id) {
  vistaActual = id;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('on'));
  document.getElementById('v-' + id).classList.add('on');
  document.querySelectorAll('.rail button').forEach((b) => b.classList.toggle('on', b.dataset.go === id));
  // el scroll suave del navegador puede pasar de los 400 ms: va directo
  window.scrollTo({ top: 0 });
  if (cargadores[id]) cargadores[id]().catch((e) => toast(e.message, true));
}
document.querySelectorAll('[data-go]').forEach((b) =>
  b.addEventListener('click', () => ir(b.dataset.go)));

document.getElementById('btnSalir').addEventListener('click', async () => {
  await api('/salir', { method: 'POST' });
  location.href = '/entrar';
});

/* El Inicio vive en inicio.js. */

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
   Un solo campo, "Periodo": el nombre se arma solo. El botón se enciende
   cuando hay fecha de cierre y al menos una pregunta. Al crear, el mismo
   botón pasa a check y se transforma en el paso siguiente.
   ============================================================ */
let preguntasCache = [];
let equipo = 0;        // colaboradores activos, para el resumen
let anterior = null;   // la última medición enviada: { periodo, ids }
let creada = null;     // el borrador recién creado y cómo estaba el formulario

const nombreMedicion = () => {
  const p = document.getElementById('mPer').value.trim();
  return p ? `Clima · ${p}` : 'Clima';
};
const elegidas = () => [...document.querySelectorAll('#qlist input:checked')].map((i) => Number(i.value));
const firmaFormulario = () =>
  [document.getElementById('mPer').value.trim(), document.getElementById('mCierra').value, elegidas().join(',')].join('|');

// el trimestre en curso, o el siguiente si ese periodo ya tiene medición
function periodoSugerido(camps) {
  const [anio, mes] = hoyLima().split('-').map(Number);
  let t = Math.ceil(mes / 3);
  let a = anio;
  const usados = new Set(camps.map((c) => c.periodo));
  for (let i = 0; i < 4 && usados.has(`T${t} ${a}`); i++) {
    t = t === 4 ? 1 : t + 1;
    if (t === 1) a++;
  }
  return `T${t} ${a}`;
}

// una pregunta escrita toma bastante más que tocar una opción
function minutosPorPersona(ids) {
  const segundos = preguntasCache
    .filter((p) => ids.includes(p.id))
    .reduce((s, p) => s + (p.tipo === 'texto' ? 35 : 12), 0);
  return Math.max(1, Math.round(segundos / 60));
}

cargadores.medicion = async () => {
  const [preguntas, camps, areas] = await Promise.all([api('/preguntas'), api('/campanas'), api('/areas')]);
  preguntasCache = preguntas;
  equipo = areas.reduce((s, a) => s + a.gente, 0);

  const disponibles = new Set(preguntas.map((p) => p.id));
  const usada = camps.find((c) => c.estado !== 'borrador');
  anterior = usada ? {
    periodo: usada.periodo || usada.nombre,
    // solo las que siguen en el banco: una pregunta retirada no se puede repetir
    ids: new Set(String(usada.preguntas || '').split(',').map(Number).filter((id) => disponibles.has(id))),
  } : null;

  const per = document.getElementById('mPer');
  if (!per.value) per.value = periodoSugerido(camps);
  // con una fecha ya pasada, la medición se cerraría sola apenas abrirla
  document.getElementById('mCierra').min = hoyLima();

  const lista = document.getElementById('qlist');
  if (!lista.children.length) {
    for (const p of preguntasCache) {
      const marcada = p.orden <= 7;
      const chk = el('input', { type: 'checkbox', value: p.id, checked: marcada });
      const fila = el('label', { class: 'q' + (marcada ? ' sel' : '') }, [
        chk,
        el('div', {}, [
          el('div', { class: 'qt', text: p.texto }),
          el('div', { class: 'qd', text: p.tipo === 'texto' ? 'Respuesta escrita' : p.opciones.join(' · ') }),
        ]),
      ]);
      chk.addEventListener('change', () => { fila.classList.toggle('sel', chk.checked); actualizarMedicion(true); });
      lista.append(fila);
    }
  }
  actualizarMedicion(false);
  pintarCampanas(camps);
};

function avisoSinEquipo() {
  return el('div', { class: 'flag', style: 'margin-bottom:14px' }, [
    el('span', { class: 'dot' }),
    el('p', {}, [
      el('b', { text: 'Todavía no cargaste colaboradores. ' }),
      el('button', { type: 'button', class: 'enlace', text: 'Cargar colaboradores', onclick: () => ir('inicio') }),
      document.createTextNode(' Puedes crear el borrador igual.'),
    ]),
  ]);
}

function repetirAnterior() {
  if (!anterior || !anterior.ids.size) return null;
  const ids = elegidas();
  const iguales = ids.length === anterior.ids.size && ids.every((id) => anterior.ids.has(id));
  if (iguales) {
    return el('p', { class: 'repetir listo', 'data-iguales': '1' },
      [check(), document.createTextNode(` Son las mismas preguntas de ${anterior.periodo}`)]);
  }
  return el('p', { class: 'repetir', 'data-iguales': '0' }, el('button', {
    type: 'button', class: 'enlace', text: `Repetir las preguntas de ${anterior.periodo}`,
    onclick: () => {
      for (const chk of document.querySelectorAll('#qlist input')) {
        chk.checked = anterior.ids.has(Number(chk.value));
        chk.closest('.q').classList.toggle('sel', chk.checked);
      }
      actualizarMedicion(true);
    },
  }));
}

function actualizarMedicion(animar) {
  const ids = elegidas();
  const n = ids.length;

  const qNum = document.getElementById('qNum');
  const antes = Number(qNum.textContent);
  if (animar) Movimiento.contar(qNum, antes, n);
  else qNum.textContent = String(n);

  document.getElementById('mNombre').textContent = `Se va a llamar «${nombreMedicion()}».`;

  const aviso = document.getElementById('mAviso');
  if (!equipo && !aviso.firstChild) aviso.append(avisoSinEquipo());
  if (equipo && aviso.firstChild) aviso.replaceChildren();

  document.getElementById('mResumen').textContent = n
    ? [plural(n, 'pregunta', 'preguntas'),
       equipo ? plural(equipo, 'colaborador', 'colaboradores') : null,
       `unos ${plural(minutosPorPersona(ids), 'minuto', 'minutos')} por persona`].filter(Boolean).join(' · ')
    : 'Elige al menos una pregunta.';

  // "repetir" pasa a "son las mismas" (y vuelve) transformándose en su lugar
  const slot = document.getElementById('qRepetir');
  const nuevo = repetirAnterior();
  const actual = slot.firstChild?.dataset.iguales;
  if (!nuevo) slot.replaceChildren();
  else if (actual !== nuevo.dataset.iguales) {
    if (animar && slot.firstChild) Movimiento.reemplazar(slot, nuevo);
    else slot.replaceChildren(nuevo);
  }

  // si cambió algo después de crear, lo que corresponde es crear otra vez
  const boton = document.getElementById('btnCrear');
  if (creada && creada.firma !== firmaFormulario()) {
    creada = null;
    Movimiento.ancho(boton, () => { boton.classList.remove('hecho'); boton.replaceChildren('Crear la medición'); });
  }
  if (!creada) boton.disabled = !(document.getElementById('mCierra').value && n > 0);
}

for (const id of ['mPer', 'mCierra']) {
  document.getElementById(id).addEventListener('input', () => actualizarMedicion(true));
}

document.getElementById('btnCrear').addEventListener('click', async () => {
  const boton = document.getElementById('btnCrear');
  if (creada) { ir('envio'); return; } // ya es "Enviar la encuesta"

  boton.disabled = true;
  try {
    const r = await api('/campanas', { method: 'POST', body: {
      nombre: nombreMedicion(),
      periodo: document.getElementById('mPer').value.trim(),
      cierra_en: document.getElementById('mCierra').value,
      preguntas: elegidas(),
    } });
    creada = { id: r.id, firma: firmaFormulario() };
    Movimiento.ancho(boton, () => {
      boton.classList.add('hecho');
      boton.replaceChildren(check(), el('span', { text: 'Borrador creado' }));
    });
    Movimiento.animar(boton.firstChild, [{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 'firme');
    pintarCampanas();
    // un momento para leer el check, y el mismo botón pasa al paso siguiente
    setTimeout(() => {
      if (!creada) return;
      Movimiento.ancho(boton, () => {
        boton.classList.remove('hecho');
        boton.replaceChildren('Enviar la encuesta');
        boton.disabled = false;
      });
    }, 1100);
  } catch (e) {
    toast(e.message, true);
    boton.disabled = false;
  }
});

async function pintarCampanas(lista) {
  const camps = lista || await api('/campanas');
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

/* Resultados vive en resultados.js. */

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
/* El saludo usa el nombre de la persona, no el de la cuenta: si la cuenta
   tiene un nombre genérico, se saluda sin nombre antes que decir
   "Buenas tardes, Administración". */
const NOMBRES_DE_CUENTA = new Set(['administración', 'administracion', 'cuenta de prueba', 'admin', 'prueba']);
function primerNombre(nombre) {
  const n = String(nombre || '').trim();
  if (!n || NOMBRES_DE_CUENTA.has(n.toLowerCase())) return null;
  return n.split(/\s+/)[0];
}

// espera a que estén cargados todos los scripts: el Inicio vive en inicio.js
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const yo = await api('/yo');
    document.getElementById('ejemplo').hidden = !yo.datosEjemplo;
    document.getElementById('quienSoy').textContent = yo.nombre;
    document.getElementById('org').textContent = yo.organizacion || '—';
    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    const nombre = primerNombre(yo.nombre);
    document.getElementById('saludo').textContent = nombre ? `${saludo}, ${nombre}` : saludo;
    await cargadores.inicio();
  } catch (e) {
    toast(e.message, true);
  }
});
