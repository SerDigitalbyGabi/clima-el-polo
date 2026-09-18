import {
  hashear, verificar, token, tokenCorto,
  abrirSesion, leerSesion, cerrarSesion, cookieSesion, cookieVacia,
} from './auth.js';
import { valorDeOpcion, promedio, rangoAntiguedad, ocultarSiEsChico, temasRepetidos } from './puntajes.js';
import { enviarInvitacion, enlaceEncuesta, canalDisponible, normalizarTelefono } from './envio.js';
import { enviarCorreo, cuerpoAccion, correoDisponible } from './correo.js';
import { sugerir } from './sugerencias.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

const error = (msg, status = 400) => json({ error: msg }, status);

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

  // los comentarios llevan area solo si el area es lo bastante grande;
  // en un area de tres personas, decir el area es casi decir el nombre
  const textos = filas
    .filter((f) => f.tipo === 'texto' && f.texto && f.texto.trim())
    .map((f) => ({
      texto: f.texto.trim(),
      dimension: f.dimension,
      area: (respPorArea.get(f.area) || 0) >= minimo ? f.area : null,
    }));

  return {
    indice,
    invitados,
    respondieron,
    participacion: invitados ? respondieron / invitados : null,
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
    });
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
    return importar(db, cuerpo.texto || '');
  }

  /* ---------- campañas ---------- */
  if (ruta === '/campanas') {
    if (metodo === 'GET') {
      const { results } = await db.prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id) AS invitados,
                (SELECT COUNT(*) FROM invitaciones i WHERE i.campana_id = c.id AND i.respondida_en IS NOT NULL) AS respondieron
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
      return enviar(db, env, url, id, cuerpo, campana);
    }

    if (accion === 'resultados' && metodo === 'GET') {
      const a = await ajustes(db);
      const minimo = Number(a.minimo_anonimato || 4);
      const r = await calcular(db, id, minimo);
      const previa = await db.prepare(
        "SELECT id FROM campanas WHERE id < ? AND estado = 'cerrada' ORDER BY id DESC LIMIT 1"
      ).bind(id).first();
      const anterior = previa ? await calcular(db, previa.id, minimo) : null;
      const { _crudo, ...publico } = r;
      return json({
        campana,
        ...publico,
        minimo,
        anterior: anterior ? { indice: anterior.indice, participacion: anterior.participacion } : null,
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

  /* ---------- panel de inicio ---------- */
  if (ruta === '/panel') {
    const a = await ajustes(db);
    const minimo = Number(a.minimo_anonimato || 4);
    const activa = await db.prepare(
      "SELECT * FROM campanas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1"
    ).first();

    const { results: cerradas } = await db.prepare(
      "SELECT id, nombre, periodo FROM campanas WHERE estado = 'cerrada' ORDER BY id"
    ).all();

    // serie historica para el grafico
    const historico = [];
    for (const c of cerradas.slice(-8)) {
      const r = await calcular(db, c.id, minimo);
      historico.push({
        id: c.id, periodo: c.periodo || c.nombre,
        indice: r.indice, participacion: r.participacion,
        areas: r.areas.map(({ area, puntaje }) => ({ area, puntaje })),
      });
    }

    let curso = null;
    if (activa) {
      const r = await calcular(db, activa.id, minimo);
      const { results: pend } = await db.prepare(
        `SELECT a.nombre AS area, COUNT(*) AS faltan
           FROM invitaciones i
           JOIN colaboradores c ON c.id = i.colaborador_id
           JOIN areas a ON a.id = c.area_id
          WHERE i.campana_id = ? AND i.respondida_en IS NULL
          GROUP BY a.nombre ORDER BY faltan DESC`
      ).bind(activa.id).all();
      const { _crudo, ...publico } = r;
      curso = { campana: activa, ...publico, pendientesPorArea: pend };
    }

    const acciones = await db.prepare(
      `SELECT
         SUM(CASE WHEN estado = 'cerrada'  THEN 1 ELSE 0 END) AS cerradas,
         SUM(CASE WHEN estado = 'sugerida' THEN 1 ELSE 0 END) AS abiertas,
         SUM(CASE WHEN estado = 'curso'    THEN 1 ELSE 0 END) AS curso
       FROM acciones`
    ).first();

    const activos = await db.prepare(
      'SELECT COUNT(*) AS n FROM colaboradores WHERE activo = 1'
    ).first();

    return json({
      organizacion: a.organizacion,
      colaboradores: activos.n,
      curso, historico, acciones, minimo,
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

/* ============================================================
   Importar colaboradores pegando texto
   ============================================================ */
async function importar(db, texto) {
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

  const lineas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nuevas = [];
  const problemas = [];
  let n = 0;
  let yaEstaban = 0;

  for (const [i, linea] of lineas.entries()) {
    const partes = linea.split(/[\t,;]/).map((p) => p.trim());
    const [nombre, area, telefono, ingreso] = partes;

    if (i === 0 && /nombre/i.test(nombre || '')) continue; // encabezado
    if (!nombre || !area) { problemas.push(`Línea ${i + 1}: falta el nombre o el área.`); continue; }

    let areaId = porNombre.get(area.toLowerCase());
    if (!areaId) {
      // area nueva: se crea sola, es mas util que rechazar la fila
      const r = await db.prepare('INSERT INTO areas (nombre) VALUES (?) RETURNING id').bind(area).first();
      areaId = r.id;
      porNombre.set(area.toLowerCase(), areaId);
    }

    const tel = telefono ? normalizarTelefono(telefono) : null;
    if (telefono && !tel) problemas.push(`Línea ${i + 1}: el teléfono de ${nombre} no se entiende.`);

    const llaveNombre = `${nombre.toLowerCase()}|${areaId}`;
    if ((tel && telefonos.has(tel)) || nombres.has(llaveNombre)) { yaEstaban++; continue; }
    if (tel) telefonos.add(tel);
    nombres.add(llaveNombre);

    nuevas.push(db.prepare(
      'INSERT INTO colaboradores (nombre, area_id, telefono, ingreso) VALUES (?, ?, ?, ?)'
    ).bind(nombre, areaId, tel, ingreso || null));
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
