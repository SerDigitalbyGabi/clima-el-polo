/* Sesiones de administrador. PBKDF2 sobre WebCrypto: sin dependencias. */

const ITER = 100_000;
const DIA = 86_400_000;

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function derivar(clave, salHex) {
  const sal = Uint8Array.from(salHex.match(/../g).map((h) => parseInt(h, 16)));
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITER }, base, 256
  );
  return hex(bits);
}

export async function hashear(clave) {
  const sal = hex(bytes(16));
  return `${sal}:${await derivar(clave, sal)}`;
}

export async function verificar(clave, guardado) {
  const [sal, esperado] = String(guardado).split(':');
  if (!sal || !esperado) return false;
  const obtenido = await derivar(clave, sal);
  // comparacion en tiempo constante
  if (obtenido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < obtenido.length; i++) dif |= obtenido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

export function token(n = 16) {
  return hex(bytes(n));
}

/* Token corto para el link de la encuesta: legible, sin caracteres ambiguos. */
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function tokenCorto(largo = 10) {
  return [...bytes(largo)].map((b) => ALFA[b % ALFA.length]).join('');
}

export async function abrirSesion(db, adminId) {
  const id = token(24);
  const expira = new Date(Date.now() + 30 * DIA).toISOString();
  await db.prepare('INSERT INTO sesiones (id, admin_id, expira_en) VALUES (?, ?, ?)')
    .bind(id, adminId, expira).run();
  return id;
}

export async function leerSesion(db, req) {
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sesion=([a-f0-9]+)/);
  if (!m) return null;
  const fila = await db.prepare(
    `SELECT a.id, a.nombre, a.correo, s.expira_en
       FROM sesiones s JOIN admins a ON a.id = s.admin_id
      WHERE s.id = ?`
  ).bind(m[1]).first();
  if (!fila) return null;
  if (new Date(fila.expira_en) < new Date()) {
    await db.prepare('DELETE FROM sesiones WHERE id = ?').bind(m[1]).run();
    return null;
  }
  return { id: fila.id, nombre: fila.nombre, correo: fila.correo, sesion: m[1] };
}

export async function cerrarSesion(db, req) {
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)sesion=([a-f0-9]+)/);
  if (m) await db.prepare('DELETE FROM sesiones WHERE id = ?').bind(m[1]).run();
}

export function cookieSesion(id, seguro) {
  const base = `sesion=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`;
  return seguro ? base + '; Secure' : base;
}

export const cookieVacia = 'sesion=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
