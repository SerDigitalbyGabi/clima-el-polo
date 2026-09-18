/* La encuesta que ve el colaborador. Un solo POST al final:
   nadie ve una respuesta a medias, y si la persona abandona, no queda
   una respuesta trunca ensuciando el promedio. */

const tk = location.pathname.split('/e/')[1].replace(/\/$/, '');
const chat = document.getElementById('chat');
const opts = document.getElementById('opts');
const barra = document.getElementById('barra');

let datos = null;
let paso = 0;
const respuestas = {};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const hora = () =>
  new Date().toLocaleTimeString('es-PE', { hour: 'numeric', minute: '2-digit' });

function burbuja(texto, quien) {
  const d = document.createElement('div');
  d.className = 'msg ' + quien;
  d.textContent = texto;
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = hora() + (quien === 'me' ? ' ✓✓' : '');
  d.appendChild(t);
  chat.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function escribiendo(ms = 620) {
  const d = document.createElement('div');
  d.className = 'msg them typing';
  d.innerHTML = '<i></i><i></i><i></i>';
  chat.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'end' });
  await esperar(ms);
  d.remove();
}

function botones(lista, alElegir) {
  opts.innerHTML = '';
  for (const o of lista) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o;
    b.addEventListener('click', () => alElegir(o), { once: true });
    opts.appendChild(b);
  }
}

function cajaTexto(alEnviar, permitirSaltar) {
  opts.innerHTML = '';
  const cont = document.createElement('div');
  cont.className = 'libre';

  const ta = document.createElement('textarea');
  ta.rows = 1;
  ta.placeholder = 'Escribe acá…';
  ta.setAttribute('aria-label', 'Tu respuesta');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
    enviar.disabled = !ta.value.trim();
  });
  ta.addEventListener('keydown', (e) => {
    // Enter manda, Shift+Enter hace salto de linea
    if (e.key === 'Enter' && !e.shiftKey && ta.value.trim()) {
      e.preventDefault();
      enviar.click();
    }
  });

  const enviar = document.createElement('button');
  enviar.type = 'button';
  enviar.disabled = true;
  enviar.textContent = '➤';
  enviar.setAttribute('aria-label', 'Enviar respuesta');
  enviar.addEventListener('click', () => {
    const v = ta.value.trim();
    if (v) alEnviar(v);
  });

  cont.append(ta, enviar);
  opts.appendChild(cont);

  if (permitirSaltar) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'saltar';
    s.textContent = 'Prefiero no responder esta';
    s.style.cssText = 'background:none;border:0;color:#667085;font-size:13px;padding:8px 0;text-align:center';
    s.addEventListener('click', () => alEnviar(null), { once: true });
    opts.appendChild(s);
  }
  ta.focus();
}

async function preguntar() {
  const p = datos.preguntas[paso];
  barra.style.width = Math.round((paso / datos.preguntas.length) * 100) + '%';

  await escribiendo();
  const numero = `${paso + 1} de ${datos.preguntas.length}`;
  burbuja(`${numero} · ${p.texto}`, 'them');

  const seguir = (dado, mostrar) => {
    if (dado != null) respuestas[p.id] = dado;
    burbuja(mostrar || 'Prefiero no responder', 'me');
    opts.innerHTML = '';
    paso++;
    if (paso < datos.preguntas.length) preguntar();
    else terminar();
  };

  if (p.tipo === 'escala') botones(p.opciones, (o) => seguir(o, o));
  else cajaTexto((v) => seguir(v, v || undefined), true);
}

async function terminar() {
  barra.style.width = '100%';
  opts.innerHTML = '<div class="hint">Guardando…</div>';

  try {
    const r = await fetch(`/api/e/${tk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respuestas }),
    });
    const d = await r.json();
    // 409 = ya estaba guardada. Pasa cuando el primer envio llego pero se
    // perdio la confirmacion por la red: para la persona, eso es un exito.
    if (!r.ok && r.status !== 409) throw new Error(d.error || 'No se pudieron guardar tus respuestas.');

    await escribiendo();
    burbuja(
      `¡Listo! 🙌 Ya quedaron registradas tus respuestas.\n\n` +
      `Gracias por tomarte el rato. Te contamos qué se decidió hacer con lo que salió.\n\n` +
      datos.remitente,
      'them'
    );
    opts.innerHTML = '<div class="hint">Encuesta completada · ya puedes cerrar esta página</div>';
  } catch (e) {
    // no se pierde nada: los botones vuelven y puede reintentar
    opts.innerHTML = '';
    const aviso = document.createElement('div');
    aviso.className = 'hint';
    aviso.textContent = e.message + ' Revisa tu conexión.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Volver a intentar';
    opts.append(btn, aviso);
    btn.addEventListener('click', terminar, { once: true });
  }
}

function pantallaFinal(titulo, texto, icono) {
  document.getElementById('pie').style.display = 'none';
  chat.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'cierre';
  d.innerHTML = `<div class="ico">${icono}</div><h2></h2><p></p>`;
  d.querySelector('h2').textContent = titulo;
  d.querySelector('p').textContent = texto;
  chat.appendChild(d);
}

async function arrancar() {
  try {
    const r = await fetch(`/api/e/${tk}`);
    const d = await r.json();

    if (!r.ok) {
      document.getElementById('quien').textContent = 'Encuesta de clima';
      document.getElementById('est').textContent = '';
      if (r.status === 409) return pantallaFinal('Ya respondiste', d.error, '✅');
      if (r.status === 410) return pantallaFinal('Esta medición ya cerró', d.error, '🕒');
      return pantallaFinal('Link no válido', 'Pídele el link nuevo a quien te lo envió.', '🔗');
    }

    datos = d;
    document.getElementById('quien').textContent = d.remitente;
    document.title = `${d.campana} · ${d.remitente}`;

    await escribiendo(500);
    burbuja(
      `Hola ${d.saludo} 👋 Somos ${d.remitente}.\n\n` +
      `Queremos saber cómo te fue y qué podemos mejorar. Son ${d.preguntas.length} preguntas cortas, ` +
      `te toma menos de 2 minutos.\n\n` +
      `Nadie va a saber cuál respuesta es tuya: los resultados se ven juntos, por área.`,
      'them'
    );

    botones(['Sí, empecemos', 'Ahora no'], async (o) => {
      burbuja(o, 'me');
      opts.innerHTML = '';
      if (o === 'Ahora no') {
        await escribiendo();
        burbuja('Sin problema. Abre este mismo link cuando puedas 👍', 'them');
        botones(['Ya puedo, empecemos'], async () => {
          burbuja('Ya puedo, empecemos', 'me');
          opts.innerHTML = '';
          preguntar();
        });
        return;
      }
      preguntar();
    });
  } catch {
    pantallaFinal('No se pudo cargar', 'Revisa tu conexión e intenta de nuevo.', '📡');
  }
}

arrancar();
