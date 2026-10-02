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
async function meta({ persona, enlace, env }) {
  const numero = normalizarTelefono(persona.telefono);
  if (!numero) return { ok: false, error: 'La persona no tiene teléfono cargado.' };

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
            { type: 'body',
              parameters: [
                { type: 'text', text: persona.nombre.split(' ')[0] },
                { type: 'text', text: persona.remitente },
              ] },
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
