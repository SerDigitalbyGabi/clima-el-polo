/* Correo por Resend. Se usa para mandarle a cada jefe la acción que quedó a
   su cargo, y para mandarle a un colaborador su link de la encuesta. */

export function correoDisponible(env) {
  return Boolean(env.RESEND_API_KEY);
}

// `nombre` permite firmar como quien manda la encuesta (la Junta, la empresa),
// y no como la plataforma
export async function enviarCorreo({ env, para, asunto, texto, responderA, nombre: firma }) {
  if (!correoDisponible(env)) {
    return { ok: false, error: 'Falta la API key de Resend. El correo no salió.' };
  }

  const desde = env.CORREO_DESDE || 'plataforma@magconsulting.pe';
  const nombre = firma || env.CORREO_NOMBRE || 'MAG Consulting';

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${nombre} <${desde}>`,
      to: Array.isArray(para) ? para : [para],
      subject: asunto,
      text: texto,
      html: aHtml(texto),
      ...(responderA ? { reply_to: responderA } : {}),
    }),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: json?.message || `Resend respondió ${r.status}.` };
  return { ok: true, id: json?.id };
}

const escapar = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function aHtml(texto) {
  const cuerpo = escapar(texto)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1B2340;max-width:560px">${cuerpo}</div>`;
}

/* El correo que recibe un jefe de area cuando se le asigna una accion. */
export function cuerpoAccion(accion, campana, venceEn) {
  const limpio = (t) => String(t || '').replace(/<[^>]+>/g, '');
  return `Hola:

En la medición de ${campana} salió esto:

${limpio(accion.evidencia)}

Lo que proponemos hacer:
${limpio(accion.detalle)}

Dónde se va a notar si funcionó: ${accion.indicador || '—'}
Esfuerzo estimado: ${accion.esfuerzo || '—'}
Fecha sugerida de cierre: ${venceEn || 'a coordinar'}

Cuando esté hecho, responde este correo y lo marcamos como cerrado en la plataforma. Si crees que no aplica o hace falta presupuesto, avísanos también.

Gracias.`;
}
