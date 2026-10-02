/* Como se convierte una respuesta en un numero.
   Las opciones vienen ordenadas de mejor a peor, asi que el puntaje sale
   de la posicion elegida: la primera vale 10, la ultima vale 0.
   Ventaja: agregar o quitar opciones a una pregunta no rompe la escala. */

export function valorDeOpcion(opciones, elegida) {
  const i = opciones.indexOf(elegida);
  if (i < 0) return null;
  if (opciones.length < 2) return 10;
  return Math.round((10 * (opciones.length - 1 - i)) / (opciones.length - 1) * 100) / 100;
}

export const promedio = (xs) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

/* Antiguedad en rangos, nunca en fecha exacta: una fecha de ingreso
   identifica a una persona casi tan bien como su nombre. */
export function rangoAntiguedad(ingreso, referencia = Date.now()) {
  if (!ingreso) return 'sin dato';
  const meses = (referencia - new Date(ingreso).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (meses < 6) return 'menos de 6 meses';
  if (meses < 24) return 'de 6 meses a 2 años';
  if (meses < 60) return 'de 2 a 5 años';
  return 'más de 5 años';
}

/* Un corte con muy pocas respuestas deja de ser anonimo: si Marketing tiene
   3 personas, el puntaje del area es practicamente el puntaje de cada una.
   Por eso todo desglose pasa por aca antes de salir al panel. */
export function ocultarSiEsChico(grupos, minimo) {
  return grupos.map((g) =>
    g.n >= minimo
      ? g
      : { ...g, puntaje: null, detalle: null, oculto: true,
          motivo: `Se muestra desde ${minimo} respuestas. Van ${g.n}.` }
  );
}

/* Palabras que se repiten en los comentarios. Sin librerias: recuento simple
   sobre bigramas, filtrando conectores. Sirve para ordenar la lectura, no
   reemplaza leer los comentarios. */
const VACIAS = new Set(`a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque
bastante bien cada casi como con contra cual cuales cuando cuanto de del desde donde dos el ella
ellas ellos en entre era eran eres es esa esas ese eso esos esta estan estas este esto estos estoy
ha hace hacen hacer hasta hay igual la las le les lo los mas me mi mientras mucho muy nada ni no
nos nosotros o os otra otras otro otros para pero poco por porque pues que quien se ser si siempre
sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tu tus un una uno unos y ya
yo nunca veces vez cosa cosas hacia toda todas`.split(/\s+/));

export function temasRepetidos(textos, tope = 8) {
  const cuenta = new Map();
  for (const t of textos) {
    const palabras = String(t || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !VACIAS.has(w));
    const vistas = new Set();
    for (let i = 0; i < palabras.length; i++) {
      for (const frase of [palabras[i], i + 1 < palabras.length ? `${palabras[i]} ${palabras[i + 1]}` : null]) {
        // una vez por comentario: que alguien repita una palabra no la vuelve un tema
        if (!frase || vistas.has(frase)) continue;
        vistas.add(frase);
        cuenta.set(frase, (cuenta.get(frase) || 0) + 1);
      }
    }
  }
  const ordenadas = [...cuenta.entries()]
    .filter(([f, n]) => (f.includes(' ') ? n >= 2 : n >= 3))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  // "quiza capacitacion" y "capacitacion" con el mismo conteo son el mismo tema
  // contado dos veces. Se queda la frase larga, que dice mas.
  const salida = [];
  for (const [frase, veces] of ordenadas) {
    const yaCubierta = salida.some(
      (s) => s.veces === veces && s.frase.includes(frase) && s.frase !== frase
    );
    if (yaCubierta) continue;
    salida.push({ frase, veces });
    if (salida.length >= tope) break;
  }
  return salida;
}
