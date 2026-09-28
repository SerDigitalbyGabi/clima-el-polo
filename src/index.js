import { api, instalar } from './api.js';
import { leerSesion } from './auth.js';

/* El Worker atiende todo (run_worker_first) y sirve los archivos estaticos
   a mano. Se hace asi para poder decidir quien ve el panel antes de
   entregarlo, no despues. */

const CABECERAS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
};

async function servir(env, ruta, req, extra = {}) {
  const r = await env.ASSETS.fetch(new Request(new URL(ruta, req.url), req));
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries({ ...CABECERAS, ...extra })) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

const aJson = (r) => {
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(CABECERAS)) h.set(k, v);
  h.set('Cache-Control', 'no-store');
  return new Response(r.body, { status: r.status, headers: h });
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      // primer arranque: crear la cuenta de administracion
      if (p === '/api/instalar' && req.method === 'POST') {
        return aJson(await instalar(env.DB, env, req, url));
      }
      if (p === '/instalar') {
        const hay = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
        if (hay.n > 0) return Response.redirect(url.origin + '/entrar', 302);
        return servir(env, '/instalar', req);
      }

      if (p.startsWith('/api/')) return aJson(await api(req, env, url, ctx));

      // la encuesta es publica: el token es la unica llave
      // OJO: se pide la ruta limpia '/encuesta', no '/encuesta.html'. Pages
      // redirige toda peticion a un .html explicito hacia la ruta sin
      // extension (asi resuelve URLs bonitas) — pedir aqui el .html directo
      // producia un 308 que apuntaba de vuelta a la misma URL, en bucle.
      if (/^\/e\/[A-Z0-9]+\/?$/.test(p)) return servir(env, '/encuesta', req);

      if (p === '/entrar') return servir(env, '/entrar', req);

      if (p === '/' || p === '/panel') {
        const hay = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
        if (hay.n === 0) return Response.redirect(url.origin + '/instalar', 302);
        const yo = await leerSesion(env.DB, req);
        if (!yo) return Response.redirect(url.origin + '/entrar', 302);
        return servir(env, '/panel', req, { 'Cache-Control': 'no-store' });
      }

      // el resto: css, js, iconos
      return servir(env, p, req);
    } catch (e) {
      console.error('fallo en', p, e);
      // el detalle va a los logs, no a la pantalla de nadie
      return new Response(
        JSON.stringify({ error: 'Algo falló de este lado. Vuelve a intentar en un momento.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CABECERAS } }
      );
    }
  },
};
