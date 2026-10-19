/* Envio de la invitacion a la encuesta.
   Tres drivers detras de la misma interfaz. El panel elige cual usar
   con el ajuste 'canal_envio', asi que cambiar de uno a otro no toca el resto
   del codigo: es cambiar una fila en la tabla ajustes. */

export function enlaceEncuesta(origen, token) {
  return `${origen}/e/${token}`;
}

/* Numero peruano a formato E.164 sin el '+', que es lo que piden las dos APIs.
   Acepta '999 888 777', '+51 999888777', '051999888777'. */
export function normalizarTelefono(tel, prefijo = '51') {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith(prefijo) && d.length > 9) return d;
  if (d.length === 9) return prefijo + d;
  return d;
}

/* El texto de la invitación, igual por WhatsApp que por correo. */
export function textoInvitacion({ nombre, enlace, remitente }) {
  return `Hola ${String(nombre).split(' ')[0]} 👋 Somos ${remitente}.\n\n` +
    `Queremos saber cómo te fue este trimestre y qué podemos mejorar. ` +
    `Son preguntas cortas, te toma menos de 2 minutos y tus respuestas son anónimas.\n\n` +
    `Este link es solo tuyo: ${enlace}`;
}

/* ---------- manual: cero tramite, funciona hoy ----------
   No manda nada. Devuelve el link listo y un texto armado para que
   la persona a cargo lo pegue en su propio WhatsApp. */
function manual({ persona, enlace, remitente }) {
  const texto = textoInvitacion({ nombre: persona.nombre, enlace, remitente });
  return { ok: true, canal: 'manual', enviado: false, texto,
           wa: `https://wa.me/${normalizarTelefono(persona.telefono) || ''}?text=${encodeURIComponent(texto)}` };
}

/* Meta da de baja cada versión de la Graph API unos dos años después de
   lanzarla (la v20 cayó el 24/09/2026). v25.0 vence en julio de 2028:
   antes de esa fecha hay que subir este número y probar un envío. */
const VERSION_META = 'v25.0';

/* ---------- Meta Cloud API ----------
   El mensaje tiene que ser una plantilla aprobada. Los {{1}}, {{2}}... se llenan
   con 'parameters' en el mismo orden en que aparecen en la plantilla. */
async function meta({ persona, enlace, remitente, env }) {
  const numero = normalizarTelefono(persona.telefono);
  if (!numero) return { ok: false, error: 'La persona no tiene teléfono cargado.' };

  /* Las variables del cuerpo, en el orden en que aparecen en la plantilla
     ({{1}}, {{2}}...). Meta rechaza el envío si la cantidad no coincide con la
     de la plantilla aprobada, así que el orden se configura con WA_VARIABLES
     (por defecto "nombre,remitente"; vacío si el cuerpo no lleva variables). */
  const valores = { nombre: persona.nombre.split(' ')[0], remitente };
  const orden = String(env.WA_VARIABLES ?? 'nombre,remitente')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const desconocida = orden.find((k) => !(k in valores));
  if (desconocida) {
    return { ok: false, canal: 'meta', error: `WA_VARIABLES no reconoce "${desconocida}". Valores posibles: nombre, remitente.` };
  }
  // sin quien firma, Meta rechaza el envío con un error poco claro
  if (orden.includes('remitente') && !remitente) {
    return { ok: false, canal: 'meta', error: 'Falta quién firma los mensajes (Ajustes → Quién firma los mensajes).' };
  }
  const parametrosCuerpo = orden.map((k) => ({ type: 'text', text: valores[k] }));

  const r = await fetch(
    `https://graph.facebook.com/${VERSION_META}/${env.WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'template',
        template: {
          name: env.WA_PLANTILLA || 'invitacion_encuesta_clima',
          // tiene que coincidir exacto con el idioma con que se creo la
          // plantilla: 'es' y 'es_MX' no son intercambiables para Meta
          language: { code: env.WA_IDIOMA || 'es' },
          components: [
            // un cuerpo sin variables no lleva este componente
            ...(parametrosCuerpo.length ? [{ type: 'body', parameters: parametrosCuerpo }] : []),
            // el boton de URL dinamica recibe solo la parte variable del link
            { type: 'button', sub_type: 'url', index: '0',
              parameters: [{ type: 'text', text: enlace.split('/e/')[1] }] },
          ],
        },
      }),
    }
  );

  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, canal: 'meta',
             error: cuerpo?.error?.message || `Meta respondió ${r.status}.` };
  }
  return { ok: true, canal: 'meta', enviado: true, id: cuerpo?.messages?.[0]?.id };
}

/* ---------- Twilio ---------- */
async function twilio({ persona, enlace, remitente, env }) {
  const numero = normalizarTelefono(persona.telefono);
  if (!numero) return { ok: false, error: 'La persona no tiene teléfono cargado.' };

  const cuerpo = new URLSearchParams({
    From: `whatsapp:+${normalizarTelefono(env.TWILIO_FROM)}`,
    To: `whatsapp:+${numero}`,
  });
  if (env.TWILIO_PLANTILLA) {
    cuerpo.set('ContentSid', env.TWILIO_PLANTILLA);
    cuerpo.set('ContentVariables', JSON.stringify({
      1: persona.nombre.split(' ')[0], 2: remitente, 3: enlace,
    }));
  } else {
    cuerpo.set('Body',
      `Hola ${persona.nombre.split(' ')[0]}, somos ${remitente}. ` +
      `Cuéntanos cómo te fue este trimestre, son 2 minutos y es anónimo: ${enlace}`);
  }

  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: cuerpo,
    }
  );

  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, canal: 'twilio', error: json?.message || `Twilio respondió ${r.status}.` };
  return { ok: true, canal: 'twilio', enviado: true, id: json?.sid };
}

const drivers = { manual, meta, twilio };

/* Estado del canal de Meta, solo lectura: no manda ningún mensaje ni cuesta.
   Contesta tres cosas: si el token y el número se entienden entre sí, en qué
   estado está el número, y cómo quedó la plantilla (idioma, categoría, estado).
   Nunca devuelve el token. */
export async function estadoMeta(env) {
  const faltan = [];
  if (!env.WA_TOKEN) faltan.push('WA_TOKEN');
  if (!env.WA_PHONE_ID) faltan.push('WA_PHONE_ID');
  if (faltan.length) return { ok: false, error: `Falta configurar: ${faltan.join(', ')}.` };

  const leer = async (ruta) => {
    const r = await fetch(`https://graph.facebook.com/${VERSION_META}/${ruta}`, {
      headers: { Authorization: `Bearer ${env.WA_TOKEN}` },
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, datos: j }
      : { ok: false, codigo: j?.error?.code, error: j?.error?.message || `Meta respondió ${r.status}.` };
  };

  const campos = 'display_phone_number,verified_name,name_status,code_verification_status,quality_rating,status,platform_type';
  let numero = await leer(`${env.WA_PHONE_ID}?fields=${campos}`);
  // si algún campo no existe en esta versión, se repite con los básicos
  if (!numero.ok && numero.codigo === 100) {
    numero = await leer(`${env.WA_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating`);
  }

  const nombre = env.WA_PLANTILLA || 'invitacion_encuesta_clima';
  let plantilla = { ok: null, error: 'Sin WA_WABA_ID no se puede consultar la plantilla.' };
  if (env.WA_WABA_ID) {
    plantilla = await leer(
      `${env.WA_WABA_ID}/message_templates?name=${encodeURIComponent(nombre)}&fields=name,status,category,language,rejected_reason`
    );
  }

  // Por qué un número no puede enviar (pago, límites, restricciones) y cuántos
  // mensajes Meta contó como enviados y entregados en los últimos tres días.
  // Meta no deja consultar un mensaje suelto: estos conteos son lo más cercano.
  const salud = await leer(`${env.WA_PHONE_ID}?fields=health_status`);
  let analitica = null;
  if (env.WA_WABA_ID) {
    const fin = Math.floor(Date.now() / 1000);
    analitica = await leer(
      `${env.WA_WABA_ID}?fields=analytics.start(${fin - 3 * 86400}).end(${fin}).granularity(DAY)`
    );
  }

  // A quién pertenece la cuenta de WhatsApp y qué cuentas tiene ese negocio.
  // Sirve para saber en qué portfolio hay que cargar la tarjeta.
  let cuenta = null;
  let negocio = null;
  if (env.WA_WABA_ID) {
    cuenta = await leer(`${env.WA_WABA_ID}?fields=name,owner_business_info,account_review_status,business_verification_status,currency`);
    const idNegocio = salud.datos?.health_status?.entities?.find((e) => e.entity_type === 'BUSINESS')?.id
      || cuenta.datos?.owner_business_info?.id;
    if (idNegocio) {
      negocio = {
        datos: await leer(`${idNegocio}?fields=name,verification_status`),
        cuentas: await leer(`${idNegocio}/owned_whatsapp_business_accounts?fields=id,name&limit=25`),
      };
    }
  }

  return {
    ok: numero.ok && plantilla.ok !== false,
    esperado: { plantilla: nombre, idioma: env.WA_IDIOMA || 'es', variables: env.WA_VARIABLES ?? 'nombre,remitente' },
    numero,
    plantilla,
    salud,
    analitica,
    cuenta,
    negocio,
  };
}

/* ¿Meta tiene bloqueado el envío? Una sola consulta, antes de mandar una tanda.
   Meta acepta el envío igual y falla después, así que sin esto la plataforma
   marcaría "enviada" a gente que nunca va a recibir nada. Devuelve el motivo en
   palabras de Meta, o null si no hay bloqueo (o si no se pudo consultar: un
   fallo de diagnóstico no tiene que impedir el envío). */
export async function bloqueoMeta(env) {
  if (!canalDisponible('meta', env)) return null;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${VERSION_META}/${env.WA_PHONE_ID}?fields=health_status`,
      { headers: { Authorization: `Bearer ${env.WA_TOKEN}` } }
    );
    const j = await r.json().catch(() => ({}));
    const bloqueadas = (j?.health_status?.entities || []).filter((e) => e.can_send_message === 'BLOCKED');
    if (!bloqueadas.length) return null;
    return bloqueadas
      .flatMap((e) => (e.errors || []).map((x) => x.error_description))
      .filter(Boolean).join(' ') || 'Meta tiene bloqueado el envío de este número.';
  } catch {
    return null;
  }
}

/* Registra el número en la Cloud API. Meta lo pide una vez, después de verificar
   el código del chip: hasta entonces el número figura PENDING y no puede enviar.
   Escribe en Meta, así que solo se llama a pedido y con un PIN de 6 dígitos que
   elige la persona: es el PIN de la verificación en dos pasos del número. Meta
   lo bloquea si se reintenta seguido (error 133016), por eso es un solo intento. */
export async function registrarNumeroMeta(env, pin) {
  if (!canalDisponible('meta', env)) return { ok: false, error: 'Falta WA_TOKEN o WA_PHONE_ID.' };
  if (!/^\d{6}$/.test(String(pin || ''))) return { ok: false, error: 'El PIN tiene que ser de 6 dígitos.' };

  const r = await fetch(`https://graph.facebook.com/${VERSION_META}/${env.WA_PHONE_ID}/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: String(pin) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, codigo: j?.error?.code, error: j?.error?.message || `Meta respondió ${r.status}.` };
  return { ok: Boolean(j.success), respuesta: j };
}

export function canalDisponible(canal, env) {
  if (canal === 'meta')   return Boolean(env.WA_TOKEN && env.WA_PHONE_ID);
  if (canal === 'twilio') return Boolean(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM);
  return true;
}

export async function enviarInvitacion({ canal, persona, enlace, remitente, env }) {
  const driver = drivers[canal] || manual;
  // si el canal esta elegido pero le faltan credenciales, no fallamos:
  // devolvemos el link para mandarlo a mano y lo decimos.
  if (!canalDisponible(canal, env)) {
    return { ...manual({ persona, enlace, remitente }),
             aviso: `Falta configurar ${canal}. Te dejo el link para enviarlo a mano.` };
  }
  try {
    return await driver({ persona, enlace, remitente, env });
  } catch (e) {
    return { ok: false, canal, error: String(e.message || e) };
  }
}
