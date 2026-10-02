import { tokenCorto } from './auth.js';
import { valorDeOpcion, promedio, rangoAntiguedad } from './puntajes.js';
import { BANCO, llenar } from './sugerencias.js';

/* Datos de ejemplo.
   Sirven para ver la plataforma con datos antes de tener los reales, y para
   revisar cada pantalla en todos sus estados. Tres reglas que no se negocian:
   - Solo se cargan donde el entorno lo permite (PERMITIR_DATOS_EJEMPLO=1) y
     sobre una base vacía: nunca conviven con datos reales.
   - Mientras están cargados, la base no acepta colaboradores reales ni envía
     nada por WhatsApp o correo.
   - "Borrar y empezar con mis datos" los elimina todos de una vez.
   La marca es una fila en ajustes: no hay ninguna columna "es_ejemplo" que
   alguien pueda olvidarse de filtrar en una consulta. */

export const MARCA = 'datos_ejemplo';

export async function enModoEjemplo(db) {
  const r = await db.prepare('SELECT valor FROM ajustes WHERE clave = ?').bind(MARCA).first();
  return r?.valor === '1';
}

/* ---------- fechas, en hora de Lima (UTC-5, sin horario de verano) ---------- */
const hoy = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (iso, n) =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

/* Generador determinista: los mismos datos cada vez que se cargan, así una
   captura de hoy se puede comparar con una de la semana que viene. */
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar(lista, r) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const NOMBRES = ['Rosa', 'Julio', 'Marco', 'Diana', 'Wilmer', 'Karina', 'Luis', 'Ana', 'Pedro',
  'Milagros', 'Jorge', 'Silvia', 'Óscar', 'Nelly', 'Raúl', 'Gladys', 'Iván', 'Teresa', 'Fernando',
  'Patricia', 'Hugo', 'Carmen', 'César', 'Elena', 'Alberto', 'Yaneth', 'Manuel', 'Rocío', 'Segundo',
  'Lidia', 'Renzo', 'Sonia', 'Percy', 'Betty', 'Alexander', 'Mirtha', 'Freddy', 'Norma', 'Elmer',
  'Katia', 'Willy', 'Marisol', 'Danny', 'Ruth', 'Álvaro', 'Jhoselyn', 'Gerson', 'Edwin', 'Maribel'];
const APELLIDOS = ['Quispe', 'Ramírez', 'Aliaga', 'Chávez', 'Torres', 'Espinoza', 'Paredes',
  'Huamán', 'Ccahuana', 'Ríos', 'Tapia', 'Ancajima', 'Valdivia', 'Cárdenas', 'Mendoza', 'Purizaca',
  'Salazar', 'Ojeda', 'Yaranga', 'Bermúdez', 'Lozano', 'Palomino', 'Ticona', 'Nima', 'Cabrera',
  'Arévalo', 'Delgado', 'Chero', 'Maldonado', 'Alvarado', 'Vílchez', 'Huarcaya', 'Sandoval',
  'Peralta', 'Quezada', 'Colán', 'Ibáñez', 'Tocto', 'Rengifo', 'Céspedes'];

/* resp: cuántas personas del área responden en T2, T3 y T4.
   T2 suma 34 de 48 (71%), T3 40 (83%), T4 va en 31.
   Administración nunca llega a 4: es el área que queda oculta. */
const AREAS = [
  { nombre: 'Seguridad', gente: 14, base: 7.6, resp: [10, 12, 9] },
  { nombre: 'Limpieza', gente: 12, base: 6.9, resp: [8, 10, 8] },
  { nombre: 'Mantenimiento', gente: 9, base: 5.0, resp: [6, 7, 5] },
  { nombre: 'Atención al cliente', gente: 9, base: 7.9, resp: [7, 8, 6] },
  { nombre: 'Administración', gente: 4, base: 8.2, resp: [3, 3, 3] },
];

// cuánto se aparta cada pregunta del promedio del área
const AJUSTE = { clima: 0.5, jefatura: 0.1, recursos: -0.7, aprendizaje: -0.6, permanencia: -0.1 };
// el problema que hace que un área quede claramente más baja
const EXTRA = { 'Mantenimiento|recursos': -1.0, 'Limpieza|jefatura': -0.7 };

const COMENTARIOS = [
  ['Mantenimiento', 'propuesta', 'Faltan herramientas en buen estado, varias llaves están gastadas.'],
  ['Mantenimiento', 'propuesta', 'Que repongan las herramientas que se malograron el mes pasado.'],
  ['Mantenimiento', 'propuesta', 'Con mejores herramientas terminaríamos más rápido los pedidos de las tiendas.'],
  ['Mantenimiento', 'propuesta', 'Las herramientas del taller no alcanzan para todos los del turno.'],
  ['Seguridad', 'propuesta', 'Que el rol de turno salga con más anticipación, a veces nos avisan un día antes.'],
  ['Limpieza', 'propuesta', 'Cuando cambian el turno nos enteramos tarde.'],
  ['Seguridad', 'propuesta', 'Sería bueno poder cambiar de turno entre compañeros con más facilidad.'],
  ['Atención al cliente', 'propuesta', 'Me gustaría recibir capacitación para atender mejor los reclamos.'],
  ['Seguridad', 'propuesta', 'Una capacitación en primeros auxilios nos vendría bien a todos.'],
  ['Limpieza', 'propuesta', 'Más capacitación para los que recién entramos.'],
  ['Atención al cliente', 'abierta', 'El ambiente con los compañeros es bueno, eso hace que uno quiera venir.'],
  ['Limpieza', 'abierta', 'Gracias por preguntar, es la primera vez que nos consultan.'],
];

/* ============================================================
   Cargar
   ============================================================ */
export async function cargarEjemplo(db) {
  if (await enModoEjemplo(db)) {
    await borrarEjemplo(db); // volver a cargar = empezar de cero, sin acumular
  } else {
    const ocupada = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM colaboradores) + (SELECT COUNT(*) FROM campanas)
            + (SELECT COUNT(*) FROM acciones) AS n`
    ).first();
    if (ocupada.n > 0) {
      return { error: 'Esta base ya tiene datos. Los datos de ejemplo solo se cargan en una base vacía, para que nunca se mezclen con los reales.' };
    }
  }

  const { results: preguntas } = await db.prepare(
    'SELECT id, dimension, tipo, opciones FROM preguntas WHERE activa = 1 AND orden <= 7 ORDER BY orden'
  ).all();
  const escalas = preguntas.filter((p) => p.tipo === 'escala')
    .map((p) => ({ ...p, opciones: JSON.parse(p.opciones || '[]') }));
  const porDimension = Object.fromEntries(preguntas.map((p) => [p.dimension, p]));

  const r = azar(2026);
  const st = [];
  const q = (sql, ...params) => st.push(db.prepare(sql).bind(...params));

  // la marca va en la misma transacción que los datos: o entra todo, o nada
  q(`INSERT INTO ajustes (clave, valor) VALUES (?, '1')
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`, MARCA);

  /* ---------- áreas ----------
     Las que no son del ejemplo se van: la base está vacía (lo verificamos
     arriba), así que ninguna tiene gente, y "48 personas en 5 áreas" tiene
     que leerse igual en todas las pantallas. */
  const nombresEjemplo = AREAS.map((a) => a.nombre);
  q(`DELETE FROM areas WHERE nombre NOT IN (${nombresEjemplo.map(() => '?').join(', ')})`, ...nombresEjemplo);
  const { results: existentes } = await db.prepare('SELECT id, nombre FROM areas').all();
  const idArea = new Map(existentes
    .filter((a) => nombresEjemplo.includes(a.nombre))
    .map((a) => [a.nombre, a.id]));
  let sigArea = Math.max(0, ...existentes.map((a) => a.id)) + 1;
  for (const a of AREAS) {
    if (idArea.has(a.nombre)) continue;
    idArea.set(a.nombre, sigArea);
    q('INSERT INTO areas (id, nombre) VALUES (?, ?)', sigArea++, a.nombre);
  }

  /* ---------- colaboradores ----------
     Todos entraron antes de T2, así los tres periodos invitan a las mismas 48
     personas. Sin teléfono: un número inventado puede ser el de alguien real. */
  const usados = new Set();
  const nombreNuevo = () => {
    for (;;) {
      const n = NOMBRES[Math.floor(r() * NOMBRES.length)];
      const [a1, a2] = barajar(APELLIDOS, r);
      const completo = `${n} ${a1} ${a2}`;
      if (!usados.has(completo)) { usados.add(completo); return completo; }
    }
  };
  const tramos = [
    ['2026-04-05', '2026-05-25', 7],  // menos de 6 meses
    ['2024-10-01', '2025-11-30', 12], // de 6 meses a 2 años
    ['2021-10-01', '2024-09-30', 17], // de 2 a 5 años
    ['2012-03-01', '2021-09-30', 12], // más de 5 años
  ];
  const ingresos = barajar(tramos.flatMap(([desde, hasta, n]) =>
    Array.from({ length: n }, () => sumarDias(desde, Math.floor(r() * diasEntre(desde, hasta))))
  ), r);

  const gente = [];
  let sigColab = 1;
  for (const a of AREAS) {
    for (let i = 0; i < a.gente; i++) {
      const p = {
        id: sigColab++, area: a, ingreso: ingresos.pop(),
        // cada persona tiene su propio tono, parecido de una medición a otra
        tono: (r() - 0.5) * 2.2,
      };
      gente.push(p);
      q('INSERT INTO colaboradores (id, nombre, area_id, telefono, ingreso) VALUES (?, ?, ?, NULL, ?)',
        p.id, nombreNuevo(), idArea.get(a.nombre), p.ingreso);
    }
  }

  /* ---------- mediciones ---------- */
  const d = hoy();
  const mediciones = [
    { periodo: 'T2 2026', abre: '2026-06-01', cierra: '2026-06-15', estado: 'cerrada', ajuste: -0.4 },
    { periodo: 'T3 2026', abre: '2026-09-01', cierra: '2026-09-15', estado: 'cerrada', ajuste: 0 },
    { periodo: 'T4 2026', abre: sumarDias(d, -3), cierra: sumarDias(d, 7), estado: 'abierta', ajuste: 0.15 },
  ];

  let sigResp = 1;
  const t3 = [];   // filas de T3, para que la evidencia de las acciones cite números reales
  let idT3 = null;

  mediciones.forEach((m, im) => {
    const idCamp = im + 1;
    if (m.periodo === 'T3 2026') idT3 = idCamp;
    q(`INSERT INTO campanas (id, nombre, periodo, estado, abre_en, cierra_en, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      idCamp, `Clima · ${m.periodo}`, m.periodo, m.estado, m.abre, m.cierra,
      `${sumarDias(m.abre, -3)} 15:00:00`);
    preguntas.forEach((p, i) =>
      q('INSERT INTO campana_preguntas (campana_id, pregunta_id, orden) VALUES (?, ?, ?)', idCamp, p.id, i));

    const ultimoDia = m.estado === 'abierta' ? d : m.cierra;
    const responden = new Set(AREAS.flatMap((a) =>
      barajar(gente.filter((p) => p.area === a), r).slice(0, a.resp[im]).map((p) => p.id)));

    const respondieronAca = [];

    for (const p of gente) {
      if (!responden.has(p.id)) {
        q('INSERT INTO invitaciones (token, campana_id, colaborador_id) VALUES (?, ?, ?)',
          tokenCorto(), idCamp, p.id);
        continue;
      }
      const fecha = sumarDias(m.abre, Math.floor(r() * (diasEntre(m.abre, ultimoDia) + 1)));
      const hora = `${String(13 + Math.floor(r() * 10)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00`;
      q('INSERT INTO invitaciones (token, campana_id, colaborador_id, respondida_en) VALUES (?, ?, ?, ?)',
        tokenCorto(), idCamp, p.id, `${fecha} ${hora}`);

      const idResp = sigResp++;
      q('INSERT INTO respuestas (id, campana_id, area_id, antiguedad, fecha) VALUES (?, ?, ?, ?, ?)',
        idResp, idCamp, idArea.get(p.area.nombre),
        rangoAntiguedad(p.ingreso, Date.parse(fecha + 'T12:00:00Z')), fecha);

      for (const pr of escalas) {
        const k = pr.opciones.length;
        let s = p.area.base + (AJUSTE[pr.dimension] ?? 0)
          + (EXTRA[`${p.area.nombre}|${pr.dimension}`] ?? 0) + m.ajuste + p.tono;
        s = Math.min(10, Math.max(0, s));
        const f = (1 - s / 10) * (k - 1) + (r() - 0.5) * 0.9;
        const opcion = pr.opciones[Math.min(k - 1, Math.max(0, Math.round(f)))];
        const valor = valorDeOpcion(pr.opciones, opcion);
        q('INSERT INTO detalle (respuesta_id, pregunta_id, valor, opcion) VALUES (?, ?, ?, ?)',
          idResp, pr.id, valor, opcion);
        if (idCamp === idT3) t3.push({ area: p.area.nombre, dimension: pr.dimension, valor });
      }
      respondieronAca.push({ idResp, area: p.area.nombre });
    }

    // Los 12 comentarios van a T4, que es la medición que Resultados abre
    // primero. Uno por persona, de alguien del área que lo escribiría.
    if (m.estado === 'abierta') {
      const libres = barajar(respondieronAca, r);
      for (const [area, dim, texto] of COMENTARIOS) {
        const i = Math.max(0, libres.findIndex((x) => x.area === area));
        const [quien] = libres.splice(i, 1);
        const pregunta = porDimension[dim];
        if (quien && pregunta) {
          q('INSERT INTO detalle (respuesta_id, pregunta_id, texto) VALUES (?, ?, ?)',
            quien.idResp, pregunta.id, texto);
        }
      }
    }
  });

  /* ---------- cinco acciones en "Qué hacer ahora", sobre T3 ---------- */
  const prom = (filtro) => promedio(t3.filter(filtro).map((f) => f.valor));
  const fmt = (x) => (x ?? 0).toFixed(1);
  const general = (dim) => prom((f) => f.dimension === dim);
  const enArea = (dim, area) => prom((f) => f.dimension === dim && f.area === area);

  const acciones = [
    ['alta', 'curso', 'recursos', 'Mantenimiento', 'mantenimiento@example.com',
      `La pregunta sobre herramientas marcó ${fmt(general('recursos'))} sobre 10, y en Mantenimiento baja a ${fmt(enArea('recursos', 'Mantenimiento'))}.`],
    ['alta', 'sugerida', 'jefatura', 'Limpieza', 'limpieza@example.com',
      `La pregunta sobre el jefe directo marcó ${fmt(general('jefatura'))} sobre 10, y en Limpieza baja a ${fmt(enArea('jefatura', 'Limpieza'))}.`],
    ['media', 'sugerida', 'aprendizaje', null, 'jefaturas@example.com',
      `La pregunta sobre aprendizaje marcó ${fmt(general('aprendizaje'))} sobre 10, la más baja después de herramientas.`],
    ['media', 'sugerida', 'permanencia', null, 'jefaturas@example.com',
      `La pregunta sobre verse acá en un año marcó ${fmt(general('permanencia'))} sobre 10.`],
    ['baja', 'cerrada', null, null, 'administracion@example.com',
      'La medición anterior tuvo 71% de participación. Contar qué se hizo con los resultados es lo que la sube.'],
  ];
  for (const [prioridad, estado, dim, area, correo, evidencia] of acciones) {
    const b = dim ? BANCO[dim] : {
      titulo: 'Contarles los resultados por el mismo canal',
      detalle: 'Manda un mensaje corto por el mismo canal: el puntaje general, las dos cosas que más se repitieron y las dos que se van a hacer con fecha. Cinco líneas alcanzan.',
      responsable: 'Administración', esfuerzo: '20 minutos', indicador: 'Participación de la próxima medición',
    };
    q(`INSERT INTO acciones (campana_id, titulo, prioridad, evidencia, detalle, responsable, correo,
                             esfuerzo, indicador, estado, vence_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      idT3, llenar(b.titulo, area), prioridad, evidencia, llenar(b.detalle, area),
      llenar(b.responsable, area), correo, b.esfuerzo, b.indicador, estado, sumarDias(d, 14));
  }

  await db.batch(st);
  return { ok: true, colaboradores: gente.length, mediciones: mediciones.length, acciones: acciones.length };
}

/* ============================================================
   Borrar y empezar con mis datos
   ============================================================ */
export async function borrarEjemplo(db) {
  // en orden de dependencias, y en una sola transacción
  await db.batch([
    'DELETE FROM detalle', 'DELETE FROM respuestas', 'DELETE FROM invitaciones',
    'DELETE FROM campana_preguntas', 'DELETE FROM acciones', 'DELETE FROM campanas',
    'DELETE FROM colaboradores', 'DELETE FROM areas',
  ].map((s) => db.prepare(s)).concat(
    db.prepare('DELETE FROM ajustes WHERE clave = ?').bind(MARCA)
  ));
}
