import {
  hashear, verificar, token, tokenCorto,
  abrirSesion, leerSesion, cerrarSesion, cookieSesion, cookieVacia,
} from './auth.js';
import { valorDeOpcion, promedio, rangoAntiguedad, ocultarSiEsChico, temasRepetidos } from './puntajes.js';
import { enviarInvitacion, enlaceEncuesta, canalDisponible, normalizarTelefono, textoInvitacion } from './envio.js';
import { enviarCorreo, cuerpoAccion, correoDisponible } from './correo.js';
import { sugerir } from './sugerencias.js';
import { MARCA, enModoEjemplo, cargarEjemplo, borrarEjemplo } from './ejemplo.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

const error = (msg, status = 400) => json({ error: msg }, status);

const NO_ENVIAR_EN_EJEMPLO = 'Estás viendo datos de ejemplo: no se envía nada por WhatsApp ni por correo.';
const NO_MEZCLAR_CON_EJEMPLO = 'Estás viendo datos de ejemplo. Para cargar a tu equipo, primero bórralos desde la barra de arriba.';

/* Fecha de hoy en Lima (UTC-5, sin horario de verano). SQLite trabaja en UTC:
   a las 8 de la noche en Lima, date('now') ya dice mañana. */
const hoyLima = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

/* Las mediciones con fecha de cierre vencida pasan a cerradas solas. Corre al
   entrar a la API: un UPDATE que casi siempre no toca nada, y a cambio el
   estado converge sin que nadie tenga que acordarse de pulsar "Cerrar". */
const cerrarVencidas = (db) => db.prepare(
  "UPDATE campanas SET estado = 'cerrada' WHERE estado = 'abierta' AND cierra_en IS NOT NULL AND cierra_en < ?"
).bind(hoyLima()).run();

const AJUSTES_PERMITIDOS = ['organizacion', 'remitente', 'canal_envio', 'minimo_anonimato', 'correo_desde', 'correo_nombre'];
const CANALES = ['manual', 'meta', 'twilio'];

/* Cuantas invitaciones se procesan por llamada. Un Worker tiene tope de
   subpeticiones por request, asi que en los canales que salen por API el panel
   llama en tandas hasta terminar. El canal manual no hace ninguna subpeticion:
   ahi devolvemos todo junto y la persona ve la lista completa de una. */
const TANDA_API = 20;
const TANDA_MANUAL = 500;

const ETIQUETAS = {
  clima: 'Cómo se sienten trabajando',
  jefatura: 'El jefe directo escucha',
  recursos: 'Tienen con qué trabajar',
  aprendizaje: 'Están aprendiendo algo',
  permanencia: 'Se ven acá en un año',
  convivencia: 'El trato entre compañeros',
  claridad: 'Saben qué se espera de ellos',
  reconocimiento: 'Se reconoce el trabajo',
  organizacion: 'Avisan los cambios de turno',
  seguridad: 'Se sienten seguros en el puesto',
  propuesta: 'Propuestas de mejora',
  abierta: 'Comentarios libres',
};

async function ajustes(db) {
  const { results } = await db.prepare('SELECT clave, valor FROM ajustes').all();
  return Object.fromEntries(results.map((r) => [r.clave, r.valor]));
}

async function guardarAjuste(db, clave, valor) {
  await db.prepare(
    'INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
  ).bind(clave, String(valor)).run();
}

/* ============================================================
   Resultados de una campaña
   ============================================================ */
async function calcular(db, campanaId, minimo) {
  const { results: filas } = await db.prepare(
    `SELECT r.id AS rid, r.area_id, ar.nombre AS area, r.antiguedad,
            d.pregunta_id, d.valor, d.opcion, d.texto,
            p.dimension, p.texto AS pregunta, p.tipo
       FROM respuestas r
       JOIN areas ar    ON ar.id = r.area_id
       JOIN detalle d   ON d.respuesta_id = r.id
       JOIN preguntas p ON p.id = d.pregunta_id
      WHERE r.campana_id = ?`
  ).bind(campanaId).all();

  const inv = await db.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN respondida_en IS NOT NULL THEN 1 ELSE 0 END) AS respondidas
       FROM invitaciones WHERE campana_id = ?`
  ).bind(campanaId).first();

  const invitados = inv?.total || 0;
  const respondieron = inv?.respondidas || 0;

  // cuantas respuestas distintas hay por area: es el n que decide si un
  // desglose se puede mostrar sin romper el anonimato
  const respPorArea = new Map();
  const vistas = new Set();
  for (const f of filas) {
    const llave = `${f.rid}|${f.area}`;
    if (vistas.has(llave)) continue;
    vistas.add(llave);
    respPorArea.set(f.area, (respPorArea.get(f.area) || 0) + 1);
  }

  const escalas = filas.filter((f) => f.tipo === 'escala' && f.valor != null);
  const indice = promedio(escalas.map((f) => f.valor));

  const agrupar = (rows, llave) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[llave];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };

  const porArea = [...agrupar(escalas, 'area')].map(([area, rows]) => ({
    area,
    puntaje: promedio(rows.map((r) => r.valor)),
    n: respPorArea.get(area) || 0,
  })).sort((a, b) => (a.puntaje ?? 99) - (b.puntaje ?? 99));

  const porAntiguedad = [...agrupar(escalas, 'antiguedad')].map(([rango, rows]) => ({
    area: rango || 'sin dato',
    puntaje: promedio(rows.map((r) => r.valor)),
    n: new Set(rows.map((r) => r.rid)).size,
  }));

  const dimensiones = [...agrupar(escalas, 'dimension')].map(([dimension, rows]) => ({
    dimension,
    etiqueta: ETIQUETAS[dimension] || dimension,
    pregunta: rows[0].pregunta,
    puntaje: promedio(rows.map((r) => r.valor)),
    n: new Set(rows.map((r) => r.rid)).size,
    porArea: [...agrupar(rows, 'area')].map(([area, rr]) => ({
      area,
      puntaje: promedio(rr.map((r) => r.valor)),
      n: respPorArea.get(area) || 0,
    })),
  })).sort((a, b) => (a.puntaje ?? 99) - (b.puntaje ?? 99));

  // Los comentarios salen sin área: junto con el estilo de quien escribe, el
  // área alcanza para adivinar el nombre. Se agrupan por tema en el panel.
  const textos = filas
    .filter((f) => f.tipo === 'texto' && f.texto && f.texto.trim())
    .map((f) => ({ texto: f.texto.trim(), dimension: f.dimension }));

  // Cómo se repartieron las respuestas de cada pregunta, en el orden de la
  // encuesta. "Favorable" es la mitad de arriba de la escala.
  const { results: deLaEncuesta } = await db.prepare(
    `SELECT p.id, p.texto, p.dimension, p.opciones
       FROM campana_preguntas cp JOIN preguntas p ON p.id = cp.pregunta_id
      WHERE cp.campana_id = ? AND p.tipo = 'escala'
      ORDER BY cp.orden`
  ).bind(campanaId).all();
  const preguntas = deLaEncuesta.map((p) => {
    const opciones = JSON.parse(p.opciones || '[]');
    const suyas = escalas.filter((f) => f.pregunta_id === p.id);
    return {
      id: p.id,
      texto: p.texto,
      etiqueta: ETIQUETAS[p.dimension] || p.dimension,
      opciones,
      conteo: opciones.map((o) => suyas.filter((f) => f.opcion === o).length),
      n: suyas.length,
      favorable: suyas.length ? suyas.filter((f) => f.valor > 5).length / suyas.length : null,
    };
  });

  return {
    indice,
    invitados,
    respondieron,
    participacion: invitados ? respondieron / invitados : null,
    preguntas,
    areas: ocultarSiEsChico(porArea, minimo),
    antiguedad: ocultarSiEsChico(porAntiguedad, minimo),
    dimensiones: dimensiones.map((d) => ({ ...d, porArea: ocultarSiEsChico(d.porArea, minimo) })),
    comentarios: textos,
    temas: temasRepetidos(textos.map((t) => t.texto)),
    // los cortes crudos no salen al panel; se usan para las sugerencias
    _crudo: { dimensiones, areas: porArea },
  };
}

/* ============================================================
   Router
   ============================================================ */
export async function api(req, env, url, ctx) {
  const db = env.DB;
  const ruta = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = req.method;
  const cuerpo = ['POST', 'PATCH', 'PUT'].includes(metodo)
    ? await req.json().catch(() => ({}))
    : {};

  await cerrarVencidas(db);

  /* ---------- encuesta pública: sin sesión ---------- */
  const mEnc = ruta.match(/^\/e\/([A-Z0-9]+)$/);
  if (mEnc) return encuesta(db, mEnc[1], metodo, cuerpo, env);

  /* ---------- entrar ---------- */
  if (ruta === '/entrar' && metodo === 'POST') {
    const { correo, clave } = cuerpo;
    const admin = await db.prepare('SELECT * FROM admins WHERE correo = ?')
      .bind(String(correo || '').toLowerCase().trim()).first();
    // mismo mensaje en los dos casos: no confirmamos si el correo existe
    if (!admin || !(await verificar(String(clave || ''), admin.hash))) {
      return error('Correo o contraseña incorrectos.', 401);
    }
    // hash del formato anterior (100k, sin conteo guardado): se regenera al
    // formato nuevo aprovechando que aca tenemos la clave en claro. Un solo
    // login lento y de ahi en adelante queda bajo el presupuesto de CPU.
    if (admin.hash.split(':').length === 2) {
      await db.prepare('UPDATE admins SET hash = ? WHERE id = ?')
        .bind(await hashear(String(clave)), admin.id).run();
    }
    const sid = await abrirSesion(db, admin.id);
    return json({ nombre: admin.nombre, correo: admin.correo }, 200,
      { 'Set-Cookie': cookieSesion(sid, url.protocol === 'https:') });
  }

  if (ruta === '/salir' && metodo === 'POST') {
    await cerrarSesion(db, req);
    return json({ ok: true }, 200, { 'Set-Cookie': cookieVacia });
  }

  /* ---------- de acá para abajo, todo pide sesión ---------- */
  const yo = await leerSesion(db, req);
  if (!yo) return error('Necesitas entrar.', 401);

  if (ruta === '/yo') {
    const a = await ajustes(db);
    // el id de sesión no sale nunca: la cookie es HttpOnly justamente para que
    // un XSS no pueda leerla, y devolverla acá tiraría esa protección abajo
    const { sesion, ...quien } = yo;
    return json({
      ...quien,
      organizacion: a.organizacion,
      canal: a.canal_envio,
      canales: {
        manual: true,
        meta: canalDisponible('meta', env),
        twilio: canalDisponible('twilio', env),
      },
      // 'correo' ya es el del admin: la bandera de Resend va con otro nombre
      correoListo: correoDisponible(env),
      datosEjemplo: a[MARCA] === '1',
    });
  }

  /* ---------- datos de ejemplo ---------- */
  if (ruta === '/ejemplo/cargar' && metodo === 'POST') {
    // en producción esta ruta no existe: el entorno tiene que permitirla
    if (env.PERMITIR_DATOS_EJEMPLO !== '1') return error('No existe esa ruta.', 404);
    const r = await cargarEjemplo(db);
    return r.error ? error(r.error, 409) : json(r);
  }

  if (ruta === '/ejemplo/borrar' && metodo === 'POST') {
    if (!(await enModoEjemplo(db))) return error('No hay datos de ejemplo para borrar.', 409);
    await borrarEjemplo(db);
    return json({ ok: true });
  }

  if (ruta === '/ajustes') {
    if (metodo === 'PATCH') {
      for (const [k, v] of Object.entries(cuerpo)) {
        if (!AJUSTES_PERMITIDOS.includes(k)) continue;
        let valor = String(v ?? '').trim();
        if (k === 'canal_envio' && !CANALES.includes(valor)) continue;
        if (k === 'minimo_anonimato') {
          // por debajo de 2 la regla deja de proteger a nadie; un valor raro
          // ("abc", "-1") tampoco puede apagarla por accidente
          const n = Math.round(Number(valor));
          valor = String(Number.isFinite(n) ? Math.min(20, Math.max(2, n)) : 4);
        }
        await guardarAjuste(db, k, valor);
      }
    }
    return json(await ajustes(db));
  }

  if (ruta === '/areas') {
    const { results } = await db.prepare(
      `SELECT a.id, a.nombre,
              (SELECT COUNT(*) FROM colaboradores c WHERE c.area_id = a.id AND c.activo = 1) AS gente
         FROM areas a ORDER BY a.nombre`
    ).all();
    return json(results);
  }

  if (ruta === '/preguntas') {
    const { results } = await db.prepare(
      'SELECT * FROM preguntas WHERE activa = 1 ORDER BY orden'
    ).all();
    return json(results.map((p) => ({ ...p, opciones: p.opciones ? JSON.parse(p.opciones) : null })));
  }

  /* ---------- colaboradores ---------- */
  if (ruta === '/colaboradores') {
    if (metodo === 'GET') {
      const area = url.searchParams.get('area');
      const { results } = await db.prepare(
        `SELECT c.*, a.nombre AS area
           FROM colaboradores c JOIN areas a ON a.id = c.area_id
          WHERE c.activo = 1 ${area ? 'AND a.nombre = ?' : ''}
          ORDER BY a.nombre, c.nombre`
      ).bind(...(area ? [area] : [])).all();
      return json(results.map((c) => ({ ...c, antiguedad: rangoAntiguedad(c.ingreso) })));
    }
    if (metodo === 'POST') {
      if (await enModoEjemplo(db)) return error(NO_MEZCLAR_CON_EJEMPLO, 409);
      const { nombre, area_id, telefono, ingreso } = cuerpo;
      if (!nombre || !area_id) return error('Falta el nombre o el área.');
      const r = await db.prepare(
        'INSERT INTO colaboradores (nombre, area_id, telefono, ingreso) VALUES (?, ?, ?, ?) RETURNING id'
      ).bind(String(nombre).trim(), area_id, telefono || null, ingreso || null).first();
      return json({ id: r.id }, 201);
    }
  }

  const mCol = ruta.match(/^\/colaboradores\/(\d+)$/);
  if (mCol) {
    const id = Number(mCol[1]);
    if (metodo === 'PATCH') {
      const campos = ['nombre', 'area_id', 'telefono', 'ingreso'].filter((k) => k in cuerpo);
      if (!campos.length) return error('No mandaste nada para cambiar.');
      await db.prepare(
        `UPDATE colaboradores SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
      ).bind(...campos.map((c) => cuerpo[c] || null), id).run();
      return json({ ok: true });
    }
    if (metodo === 'DELETE') {
      // baja logica: si se borrara la fila, las invitaciones de campanas
      // pasadas se irian con ella y el historico quedaria mal contado
      await db.prepare('UPDATE colaboradores SET activo = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (ruta === '/colaboradores/importar' && metodo === 'POST') {
    if (await enModoEjemplo(db)) return error(NO_MEZCLAR_CON_EJEMPLO, 409);
    if (Array.isArray(cuerpo.filas)) {
      if (cuerpo.filas.length > 500) return error('Son demasiadas filas para una sola carga. Divide el archivo.');
      return importar(db, cuerpo.filas.map((f) => ({ ...f, etiqueta: `Fila ${f.fila}` })));
    }
    // texto pegado: una línea por persona, en el orden de siempre
    const filas = String(cuerpo.texto || '').split(/\r?\n/)
      .map((linea, i) => ({ linea: linea.trim(), i }))
      .filter(({ linea }) => linea)
      .filter(({ linea }, k) => !(k === 0 && /nombre/i.test(linea.split(/[\t,;]/)[0])))
      .map(({ linea, i }) => {
        const [nombre, area, telefono, ingreso] = linea.split(/[\t,;]/).map((p) => p.trim());
        return { nombre, area, telefono, ingreso, etiqueta: `Línea ${i + 1}` };
      });
    return importar(db, filas);
  }

  /* ---------- campañas ---------- */
  if (ruta === '/campanas') {
    if (metodo === 'GET') {
      const { results } = await db.prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id) AS invitados,
                (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id AND i.respondida_en IS NOT NULL) AS respondieron,
                (SELECT COUNT(*) FROM campana_preguntas cp WHERE cp.campana_id = c.id) AS n_preguntas,
                -- para "repetir las preguntas de la anterior" y que los resultados se puedan comparar
                (SELECT GROUP_CONCAT(cp.pregunta_id) FROM campana_preguntas cp WHERE cp.campana_id = c.id) AS preguntas
           FROM campanas c ORDER BY c.id DESC`
      ).all();
      return json(results);
    }
    if (metodo === 'POST') {
      const { nombre, periodo, cierra_en, preguntas } = cuerpo;
      if (!nombre) return error('Ponle un nombre a la medición.');
      if (!Array.isArray(preguntas) || !preguntas.length) return error('Elige al menos una pregunta.');
      const c = await db.prepare(
        'INSERT INTO campanas (nombre, periodo, cierra_en) VALUES (?, ?, ?) RETURNING id'
      ).bind(nombre, periodo || null, cierra_en || null).first();
      await db.batch(preguntas.map((pid, i) =>
        db.prepare('INSERT INTO campana_preguntas (campana_id, pregunta_id, orden) VALUES (?, ?, ?)')
          .bind(c.id, pid, i)
      ));
      return json({ id: c.id }, 201);
    }
  }

  const mCamp = ruta.match(/^\/campanas\/(\d+)(\/\w+)?$/);
  if (mCamp) {
    const id = Number(mCamp[1]);
    const accion = (mCamp[2] || '').slice(1);
    const campana = await db.prepare('SELECT * FROM campanas WHERE id = ?').bind(id).first();
    if (!campana) return error('Esa medición no existe.', 404);

    if (accion === 'abrir' && metodo === 'POST') {
      const { results: gente } = await db.prepare(
        'SELECT id FROM colaboradores WHERE activo = 1'
      ).all();
      if (!gente.length) return error('No hay colaboradores activos cargados.');
      // un token por persona, y solo si todavia no lo tiene
      await db.batch([
        ...gente.map((g) =>
          db.prepare(
            `INSERT INTO invitaciones (token, campana_id, colaborador_id) VALUES (?, ?, ?)
             ON CONFLICT (campana_id, colaborador_id) DO NOTHING`
          ).bind(tokenCorto(), id, g.id)
        ),
        db.prepare("UPDATE campanas SET estado = 'abierta', abre_en = ? WHERE id = ?").bind(hoyLima(), id),
      ]);
      return json({ ok: true, invitados: gente.length });
    }

    if (accion === 'cerrar' && metodo === 'POST') {
      await db.prepare("UPDATE campanas SET estado = 'cerrada' WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (accion === 'invitaciones' && metodo === 'GET') {
      const { results } = await db.prepare(
        `SELECT i.token, i.respondida_en, i.enviada_en, i.recordada_en,
                c.nombre, c.telefono, a.nombre AS area
           FROM invitaciones i
           JOIN colaboradores c ON c.id = i.colaborador_id
           JOIN areas a ON a.id = c.area_id
          WHERE i.campana_id = ?
          ORDER BY a.nombre, c.nombre`
      ).bind(id).all();
      return json(results.map((r) => ({ ...r, enlace: enlaceEncuesta(url.origin, r.token) })));
    }

    if (accion === 'enviar' && metodo === 'POST') {
      if (await enModoEjemplo(db)) return error(NO_ENVIAR_EN_EJEMPLO, 403);
      return enviar(db, env, url, id, cuerpo, campana);
    }

    /* La invitación de una persona, por correo. El mismo texto que por
       WhatsApp. La dirección se escribe en el momento y no se guarda. */
    if (accion === 'correo' && metodo === 'POST') {
      if (await enModoEjemplo(db)) return error(NO_ENVIAR_EN_EJEMPLO, 403);
      if (campana.estado !== 'abierta') return error('La medición no está abierta.', 409);
      const destino = String(cuerpo.correo || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) return error('Ese correo no parece válido.');
      const inv = await db.prepare(
        `SELECT i.token, i.respondida_en, c.nombre
           FROM invitaciones i JOIN colaboradores c ON c.id = i.colaborador_id
          WHERE i.campana_id = ? AND i.token = ?`
      ).bind(id, String(cuerpo.token || '')).first();
      if (!inv) return error('Esa invitación no existe.', 404);
      if (inv.respondida_en) return error('Esa persona ya respondió.', 409);

      const a = await ajustes(db);
      const remitente = a.remitente || a.organizacion;
      const r = await enviarCorreo({
        env,
        para: destino,
        nombre: remitente,
        asunto: 'Cuéntanos cómo te fue este trimestre',
        texto: textoInvitacion({ nombre: inv.nombre, enlace: enlaceEncuesta(url.origin, inv.token), remitente }),
      });
      if (!r.ok) return error(r.error, 502);
      await db.prepare(
        "UPDATE invitaciones SET enviada_en = COALESCE(enviada_en, datetime('now')), canal = 'correo' WHERE token = ?"
      ).bind(inv.token).run();
      return json({ ok: true });
    }

    if (accion === 'resultados' && metodo === 'GET') {
      const a = await ajustes(db);
      const minimo = Number(a.minimo_anonimato || 4);
      const r = await calcular(db, id, minimo);

      // Con menos respuestas que el mínimo no sale nada más que el conteo:
      // con una sola, el "promedio general" es exactamente lo que dijo esa
      // persona. El panel muestra cuántas faltan; el detalle no viaja.
      if (r.respondieron < minimo) {
        return json({ campana, invitados: r.invitados, respondieron: r.respondieron, minimo, insuficiente: true });
      }

      // la anterior para comparar: la última cerrada que también llegó al mínimo
      const { results: previas } = await db.prepare(
        "SELECT id, nombre, periodo FROM campanas WHERE id < ? AND estado = 'cerrada' ORDER BY id DESC LIMIT 6"
      ).bind(id).all();
      let anterior = null;
      for (const p of previas) {
        const c = await calcular(db, p.id, minimo);
        if (c.respondieron >= minimo) { anterior = { ...c, periodo: p.periodo || p.nombre }; break; }
      }
      const { _crudo, ...publico } = r;
      return json({
        campana,
        ...publico,
        minimo,
        anterior: anterior ? { indice: anterior.indice, participacion: anterior.participacion, periodo: anterior.periodo } : null,
        sugerencias: sugerir({
          dimensiones: _crudo.dimensiones,
          areas: _crudo.areas,
          participacion: r.participacion,
          comentarios: r.comentarios.length,
          temas: r.temas,
          anterior: anterior ? { dimensiones: anterior._crudo.dimensiones } : null,
        }),
      });
    }
  }

  /* ---------- evolución, para el gráfico de Resultados ---------- */
  if (ruta === '/evolucion') {
    const a = await ajustes(db);
    const minimo = Number(a.minimo_anonimato || 4);
    const { results } = await db.prepare(
      "SELECT id, nombre, periodo, estado FROM campanas WHERE estado != 'borrador' ORDER BY id"
    ).all();
    const serie = [];
    for (const c of results.slice(-8)) {
      const r = await calcular(db, c.id, minimo);
      if (r.respondieron < minimo) continue; // misma regla que el resto: sin mínimo, no hay punto
      serie.push({
        id: c.id, periodo: c.periodo || c.nombre, estado: c.estado, indice: r.indice,
        areas: r.areas.map(({ area, puntaje }) => ({ area, puntaje })),
      });
    }
    return json(serie);
  }

  /* ---------- panel de inicio ---------- */
  if (ruta === '/panel') {
    const a = await ajustes(db);
    const minimo = Number(a.minimo_anonimato || 4);

    const gente = await db.prepare(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT area_id) AS areas FROM colaboradores WHERE activo = 1'
    ).first();

    const conConteos = `SELECT c.*,
        (SELECT COUNT(*) FROM campana_preguntas cp WHERE cp.campana_id = c.id) AS n_preguntas,
        (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id) AS invitados,
        (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id AND i.respondida_en IS NOT NULL) AS respondieron
      FROM campanas c`;
    const ultima = await db.prepare(`${conConteos} ORDER BY c.id DESC LIMIT 1`).first();
    const borrador = await db.prepare(`${conConteos} WHERE c.estado = 'borrador' ORDER BY c.id DESC LIMIT 1`).first();
    const activa = await db.prepare(`${conConteos} WHERE c.estado = 'abierta' ORDER BY c.id DESC LIMIT 1`).first();

    const { results: cerradas } = await db.prepare(
      "SELECT id, nombre, periodo FROM campanas WHERE estado = 'cerrada' ORDER BY id"
    ).all();

    // Serie histórica. Una medición con menos respuestas que el mínimo no
    // entra: su promedio general sería casi el de cada persona.
    const historico = [];
    for (const c of cerradas.slice(-8)) {
      const r = await calcular(db, c.id, minimo);
      if (r.respondieron < minimo) continue;
      historico.push({
        id: c.id, nombre: c.nombre, periodo: c.periodo || c.nombre,
        indice: r.indice, participacion: r.participacion,
        respondieron: r.respondieron, invitados: r.invitados,
        areas: r.areas.map(({ area, puntaje }) => ({ area, puntaje })),
      });
    }

    // La encuesta en curso solo necesita conteos: quién respondió, no qué.
    let curso = null;
    if (activa) {
      const { results: porArea } = await db.prepare(
        `SELECT a.nombre AS area, COUNT(*) AS invitados,
                SUM(CASE WHEN i.respondida_en IS NOT NULL THEN 1 ELSE 0 END) AS respondieron
           FROM invitaciones i
           JOIN colaboradores c ON c.id = i.colaborador_id
           JOIN areas a ON a.id = c.area_id
          WHERE i.campana_id = ?
          GROUP BY a.nombre ORDER BY a.nombre`
      ).bind(activa.id).all();
      curso = {
        campana: activa,
        invitados: activa.invitados,
        respondieron: activa.respondieron,
        participacion: activa.invitados ? activa.respondieron / activa.invitados : null,
        porArea,
      };
    }

    const acciones = await db.prepare(
      `SELECT
         SUM(CASE WHEN estado = 'cerrada'  THEN 1 ELSE 0 END) AS cerradas,
         SUM(CASE WHEN estado = 'sugerida' THEN 1 ELSE 0 END) AS abiertas,
         SUM(CASE WHEN estado = 'curso'    THEN 1 ELSE 0 END) AS curso,
         SUM(CASE WHEN estado IN ('sugerida', 'curso') THEN 1 ELSE 0 END) AS pendientes
       FROM acciones`
    ).first();

    const { results: proximas } = await db.prepare(
      `SELECT id, titulo, prioridad, responsable, estado FROM acciones
        WHERE estado IN ('sugerida', 'curso')
        ORDER BY CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, id
        LIMIT 3`
    ).all();

    return json({
      organizacion: a.organizacion,
      colaboradores: gente.n,
      areas: gente.areas,
      ultima, borrador, curso, historico, acciones, proximas, minimo,
    });
  }

  /* ---------- acciones ---------- */
  if (ruta === '/acciones') {
    if (metodo === 'GET') {
      const c = url.searchParams.get('campana');
      const { results } = await db.prepare(
        `SELECT * FROM acciones ${c ? 'WHERE campana_id = ?' : ''} ORDER BY
           CASE prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, id DESC`
      ).bind(...(c ? [c] : [])).all();
      return json(results);
    }
    if (metodo === 'POST') {
      const c = cuerpo;
      const r = await db.prepare(
        `INSERT INTO acciones (campana_id, titulo, prioridad, evidencia, detalle, responsable, correo, esfuerzo, indicador, vence_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      ).bind(c.campana_id || null, c.titulo, c.prioridad || 'media', c.evidencia || null,
             c.detalle || null, c.responsable || null, c.correo || null,
             c.esfuerzo || null, c.indicador || null, c.vence_en || null).first();
      return json({ id: r.id }, 201);
    }
  }

  const mAcc = ruta.match(/^\/acciones\/(\d+)(\/\w+)?$/);
  if (mAcc) {
    const id = Number(mAcc[1]);
    const accion = (mAcc[2] || '').slice(1);

    if (accion === 'enviar' && metodo === 'POST') {
      if (await enModoEjemplo(db)) return error(NO_ENVIAR_EN_EJEMPLO, 403);
      const a = await db.prepare('SELECT * FROM acciones WHERE id = ?').bind(id).first();
      if (!a) return error('Esa acción no existe.', 404);
      const destino = cuerpo.correo || a.correo;
      if (!destino) return error('Falta el correo del responsable.');
      const camp = a.campana_id
        ? await db.prepare('SELECT nombre FROM campanas WHERE id = ?').bind(a.campana_id).first()
        : null;
      const r = await enviarCorreo({
        env, para: destino,
        asunto: cuerpo.asunto || `Acción a tu cargo · ${a.titulo}`,
        texto: cuerpo.texto || cuerpoAccion(a, camp?.nombre || 'la última medición', a.vence_en),
        responderA: yo.correo,
      });
      if (!r.ok) return error(r.error, 502);
      await db.prepare(
        "UPDATE acciones SET estado = 'curso', correo = ?, actualizada_en = datetime('now') WHERE id = ?"
      ).bind(destino, id).run();
      return json({ ok: true, id: r.id });
    }

    if (metodo === 'PATCH') {
      const campos = ['estado', 'responsable', 'correo', 'vence_en', 'detalle', 'prioridad']
        .filter((k) => k in cuerpo);
      if (!campos.length) return error('No mandaste nada para cambiar.');
      await db.prepare(
        `UPDATE acciones SET ${campos.map((c) => `${c} = ?`).join(', ')}, actualizada_en = datetime('now') WHERE id = ?`
      ).bind(...campos.map((c) => cuerpo[c]), id).run();
      return json({ ok: true });
    }
    if (metodo === 'DELETE') {
      await db.prepare('DELETE FROM acciones WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  return error('No existe esa ruta.', 404);
}

/* ============================================================
   Encuesta que ve el colaborador
   ============================================================ */
async function encuesta(db, tk, metodo, cuerpo, env) {
  const inv = await db.prepare(
    `SELECT i.*, c.nombre, c.ingreso, c.area_id, ca.nombre AS campana, ca.estado, ca.cierra_en
       FROM invitaciones i
       JOIN colaboradores c ON c.id = i.colaborador_id
       JOIN campanas ca ON ca.id = i.campana_id
      WHERE i.token = ?`
  ).bind(tk).first();

  if (!inv) return error('Este link no es válido.', 404);
  if (inv.estado !== 'abierta') return error('Esta medición ya cerró. Gracias igual.', 410);
  if (inv.respondida_en) return error('Ya registramos tus respuestas. ¡Gracias!', 409);

  const a = await ajustes(db);

  if (metodo === 'GET') {
    const { results } = await db.prepare(
      `SELECT p.* FROM campana_preguntas cp
         JOIN preguntas p ON p.id = cp.pregunta_id
        WHERE cp.campana_id = ? ORDER BY cp.orden`
    ).bind(inv.campana_id).all();
    return json({
      // solo el primer nombre: el saludo no necesita mas y el link puede
      // terminar reenviado a un grupo
      saludo: String(inv.nombre).split(' ')[0],
      remitente: a.remitente || a.organizacion,
      campana: inv.campana,
      cierra: inv.cierra_en,
      preguntas: results.map((p) => ({
        id: p.id, texto: p.texto, tipo: p.tipo,
        opciones: p.opciones ? JSON.parse(p.opciones) : null,
      })),
    });
  }

  if (metodo === 'POST') {
    const dadas = cuerpo.respuestas;
    if (!dadas || typeof dadas !== 'object') return error('No llegaron respuestas.');

    const { results: preguntas } = await db.prepare(
      `SELECT p.* FROM campana_preguntas cp
         JOIN preguntas p ON p.id = cp.pregunta_id
        WHERE cp.campana_id = ?`
    ).bind(inv.campana_id).all();

    // Primero se reclama la invitacion, en un solo UPDATE condicional: si dos
    // envios llegan a la vez, uno cambia la fila y el otro ve 0 cambios. Recien
    // despues se guarda la respuesta. Sigue sin existir ninguna columna que una
    // la invitacion con la respuesta: son dos escrituras, no una relacion.
    const reclamo = await db.prepare(
      "UPDATE invitaciones SET respondida_en = datetime('now') WHERE token = ? AND respondida_en IS NULL"
    ).bind(tk).run();
    if (!reclamo.meta?.changes) return error('Ya registramos tus respuestas. ¡Gracias!', 409);

    let respuestaId = null;
    try {
      const resp = await db.prepare(
        'INSERT INTO respuestas (campana_id, area_id, antiguedad, fecha) VALUES (?, ?, ?, ?) RETURNING id'
      ).bind(inv.campana_id, inv.area_id, rangoAntiguedad(inv.ingreso), hoyLima()).first();
      respuestaId = resp.id;

      const inserts = [];
      for (const p of preguntas) {
        const dada = dadas[p.id];
        if (dada == null || dada === '') continue;
        if (p.tipo === 'escala') {
          const opciones = JSON.parse(p.opciones || '[]');
          const valor = valorDeOpcion(opciones, String(dada));
          if (valor == null) continue; // opcion que no existe: se descarta
          inserts.push(db.prepare(
            'INSERT INTO detalle (respuesta_id, pregunta_id, valor, opcion) VALUES (?, ?, ?, ?)'
          ).bind(respuestaId, p.id, valor, String(dada)));
        } else {
          inserts.push(db.prepare(
            'INSERT INTO detalle (respuesta_id, pregunta_id, texto) VALUES (?, ?, ?)'
          ).bind(respuestaId, p.id, String(dada).slice(0, 2000)));
        }
      }
      if (inserts.length) await db.batch(inserts);
      return json({ ok: true });
    } catch (e) {
      // se libera el reclamo para que la persona pueda reintentar, y no queda
      // una respuesta a medias ensuciando el promedio
      await db.batch([
        ...(respuestaId ? [db.prepare('DELETE FROM respuestas WHERE id = ?').bind(respuestaId)] : []),
        db.prepare('UPDATE invitaciones SET respondida_en = NULL WHERE token = ?').bind(tk),
      ]);
      throw e;
    }
  }

  return error('Método no permitido.', 405);
}

/* ============================================================
   Envío de invitaciones, por tandas
   ============================================================ */
async function enviar(db, env, url, campanaId, cuerpo, campana) {
  const a = await ajustes(db);
  const canal = cuerpo.canal || a.canal_envio || 'manual';
  const soloPendientes = cuerpo.recordatorio === true;

  const { results } = await db.prepare(
    `SELECT i.token, c.nombre, c.telefono
       FROM invitaciones i
       JOIN colaboradores c ON c.id = i.colaborador_id
      WHERE i.campana_id = ?
        AND i.respondida_en IS NULL
        ${soloPendientes ? 'AND i.enviada_en IS NOT NULL' : 'AND i.enviada_en IS NULL'}
      ORDER BY c.nombre
      LIMIT ?`
  ).bind(campanaId, canal === 'manual' ? TANDA_MANUAL : TANDA_API).all();

  const salida = [];
  const marcas = [];
  for (const p of results) {
    const r = await enviarInvitacion({
      canal,
      persona: { nombre: p.nombre, telefono: p.telefono, remitente: a.remitente },
      enlace: enlaceEncuesta(url.origin, p.token),
      remitente: a.remitente || a.organizacion,
      env,
    });
    salida.push({ nombre: p.nombre, telefono: p.telefono, token: p.token, ...r });
    if (r.ok && r.enviado) {
      marcas.push(db.prepare(
        soloPendientes
          ? "UPDATE invitaciones SET recordada_en = datetime('now'), canal = ? WHERE token = ?"
          : "UPDATE invitaciones SET enviada_en = datetime('now'), canal = ? WHERE token = ?"
      ).bind(canal, p.token));
    }
  }
  if (marcas.length) await db.batch(marcas);

  const restan = await db.prepare(
    `SELECT COUNT(*) AS n FROM invitaciones
      WHERE campana_id = ? AND respondida_en IS NULL
        ${soloPendientes ? 'AND enviada_en IS NOT NULL AND recordada_en IS NULL' : 'AND enviada_en IS NULL'}`
  ).bind(campanaId).first();

  return json({
    canal,
    procesados: salida.length,
    restantes: canal === 'manual' ? 0 : Math.max(0, (restan?.n || 0)),
    resultados: salida,
  });
}

/* Fecha de ingreso a ISO. Acepta 2023-03-15 y 15/03/2023 (día primero, como
   se escribe en Perú). Lo demás no se adivina: queda sin fecha. */
function fechaISO(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/* ============================================================
   Importar colaboradores: desde un archivo o pegando texto
   ============================================================ */
async function importar(db, filas) {
  const { results: areas } = await db.prepare('SELECT id, nombre FROM areas').all();
  const porNombre = new Map(areas.map((a) => [a.nombre.toLowerCase(), a.id]));

  // Quien ya esta cargado no se vuelve a cargar: pegar la misma lista dos
  // veces (porque se corrigio un error de tipeo, por ejemplo) no puede
  // duplicar a toda la planilla. Se reconoce por telefono, o por nombre+area
  // cuando no hay telefono.
  const { results: existentes } = await db.prepare(
    'SELECT nombre, area_id, telefono FROM colaboradores WHERE activo = 1'
  ).all();
  const telefonos = new Set(existentes.map((c) => c.telefono).filter(Boolean));
  const nombres = new Set(existentes.map((c) => `${c.nombre.toLowerCase()}|${c.area_id}`));

  const nuevas = [];
  const problemas = [];
  let n = 0;
  let yaEstaban = 0;

  for (const f of filas) {
    const nombre = String(f.nombre ?? '').trim();
    const area = String(f.area ?? '').trim();
    const telefono = String(f.telefono ?? '').trim();
    if (!nombre || !area) { problemas.push(`${f.etiqueta}: falta el nombre o el área.`); continue; }

    let areaId = porNombre.get(area.toLowerCase());
    if (!areaId) {
      // area nueva: se crea sola, es mas util que rechazar la fila
      const r = await db.prepare('INSERT INTO areas (nombre) VALUES (?) RETURNING id').bind(area).first();
      areaId = r.id;
      porNombre.set(area.toLowerCase(), areaId);
    }

    const tel = telefono ? normalizarTelefono(telefono) : null;
    if (telefono && !tel) problemas.push(`${f.etiqueta}: el teléfono de ${nombre} no se entiende.`);
    const ingreso = f.ingreso ? fechaISO(f.ingreso) : null;
    if (f.ingreso && !ingreso) problemas.push(`${f.etiqueta}: la fecha de ingreso de ${nombre} no se entiende; quedó sin fecha.`);

    const llaveNombre = `${nombre.toLowerCase()}|${areaId}`;
    if ((tel && telefonos.has(tel)) || nombres.has(llaveNombre)) { yaEstaban++; continue; }
    if (tel) telefonos.add(tel);
    nombres.add(llaveNombre);

    nuevas.push(db.prepare(
      'INSERT INTO colaboradores (nombre, area_id, telefono, ingreso) VALUES (?, ?, ?, ?)'
    ).bind(nombre, areaId, tel, ingreso));
    n++;
  }

  if (nuevas.length) await db.batch(nuevas);
  return json({ agregados: n, yaEstaban, problemas });
}

/* ============================================================
   Primer arranque: crear la cuenta de administración
   ============================================================ */
export async function instalar(db, env, req, url) {
  const hay = await db.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (hay.n > 0) return error('La plataforma ya está instalada.', 409);

  const { correo, clave, nombre } = await req.json().catch(() => ({}));
  if (!correo || !clave) return error('Falta el correo o la contraseña.');
  if (String(clave).length < 10) return error('La contraseña necesita al menos 10 caracteres.');

  const r = await db.prepare(
    'INSERT INTO admins (correo, nombre, hash) VALUES (?, ?, ?) RETURNING id'
  ).bind(String(correo).toLowerCase().trim(), nombre || 'Administración', await hashear(String(clave))).first();

  const sid = await abrirSesion(db, r.id);
  return json({ ok: true }, 201, { 'Set-Cookie': cookieSesion(sid, url.protocol === 'https:') });
}
