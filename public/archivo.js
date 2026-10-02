/* Leer la lista de colaboradores desde un archivo: Excel (.xlsx) o CSV.
   Sin librerías: un .xlsx es un zip con XML adentro, y el navegador ya sabe
   descomprimir (DecompressionStream) y leer XML (DOMParser).
   Las columnas se reconocen por su encabezado, no por su posición: cada
   empresa exporta su planilla en otro orden y con otros nombres. */

const Archivo = (() => {
  const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /* ---------- zip ---------- */
  async function abrirZip(buffer) {
    const v = new DataView(buffer);
    let fin = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo no es un Excel válido.');
    const total = v.getUint16(fin + 10, true);
    let p = v.getUint32(fin + 16, true);
    const archivos = new Map();
    for (let i = 0; i < total; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const metodo = v.getUint16(p + 10, true);
      const tam = v.getUint32(p + 20, true);
      const largoNombre = v.getUint16(p + 28, true);
      const largoExtra = v.getUint16(p + 30, true);
      const largoComent = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const nombre = new TextDecoder().decode(new Uint8Array(buffer, p + 46, largoNombre));
      archivos.set(nombre, { metodo, tam, local });
      p += 46 + largoNombre + largoExtra + largoComent;
    }
    return async (nombre) => {
      const a = archivos.get(nombre);
      if (!a) return null;
      const inicio = a.local + 30 + v.getUint16(a.local + 26, true) + v.getUint16(a.local + 28, true);
      const datos = new Uint8Array(buffer, inicio, a.tam);
      if (a.metodo === 0) return new TextDecoder().decode(datos);
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(flujo).text();
    };
  }

  /* ---------- xlsx: la primera hoja, como filas de celdas ---------- */
  async function leerXlsx(buffer) {
    const leer = await abrirZip(buffer);
    const xml = (t) => (t ? new DOMParser().parseFromString(t, 'application/xml') : null);

    const compartidos = [];
    const ss = xml(await leer('xl/sharedStrings.xml'));
    if (ss) {
      for (const si of ss.getElementsByTagName('si')) {
        compartidos.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
      }
    }

    // la primera hoja según el libro, no según el nombre del archivo interno
    let ruta = 'xl/worksheets/sheet1.xml';
    const libro = xml(await leer('xl/workbook.xml'));
    const rels = xml(await leer('xl/_rels/workbook.xml.rels'));
    const primera = libro?.getElementsByTagName('sheet')[0];
    if (primera && rels) {
      const id = primera.getAttribute('r:id');
      const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === id);
      const destino = rel?.getAttribute('Target');
      if (destino) ruta = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino;
    }
    const hoja = xml(await leer(ruta));
    if (!hoja) throw new Error('No encontramos ninguna hoja en el Excel.');

    const columna = (ref) => {
      const letras = String(ref).match(/^[A-Z]+/)?.[0] || 'A';
      return [...letras].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;
    };
    const filas = [];
    for (const row of hoja.getElementsByTagName('row')) {
      const nro = Number(row.getAttribute('r')) || filas.length + 1;
      const celdas = [];
      for (const c of row.getElementsByTagName('c')) {
        const tipo = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let valor;
        if (tipo === 's') valor = compartidos[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = [...c.getElementsByTagName('t')].map((t) => t.textContent).join('');
        else if (tipo === 'str' || tipo === 'e') valor = v ?? '';
        else if (tipo === 'b') valor = v === '1' ? 'sí' : 'no';
        else valor = v == null ? '' : Number(v);
        celdas[columna(c.getAttribute('r'))] = valor;
      }
      filas.push({ nro, celdas: Array.from(celdas, (x) => x ?? '') });
    }
    return filas;
  }

  /* ---------- csv / texto ---------- */
  function decodificar(buffer) {
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    // Excel en español guarda los CSV en Windows-1252: las tildes salen rotas en UTF-8
    return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
  }

  function leerCsv(texto) {
    texto = texto.replace(/^﻿/, '');
    const primera = texto.split(/\r?\n/)[0] || '';
    const cuenta = (c) => primera.split(c).length;
    // Excel en español separa con punto y coma; otros, con coma o tabulación
    const sep = [';', '\t', ','].sort((a, b) => cuenta(b) - cuenta(a))[0];
    const filas = [];
    let fila = [], celda = '', comillas = false, nro = 1;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (comillas) {
        if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
        else if (ch === '"') comillas = false;
        else celda += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(celda); celda = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        fila.push(celda); filas.push({ nro: nro++, celdas: fila }); fila = []; celda = '';
      } else celda += ch;
    }
    if (celda || fila.length) { fila.push(celda); filas.push({ nro, celdas: fila }); }
    return filas;
  }

  /* ---------- de filas sueltas a colaboradores ---------- */
  const ROLES = {
    completo: /^(nombres? y apellidos?|apellidos? y nombres?|nombre completo|nombres? completos?|colaborador(a|es)?|trabajador(a|es)?|empleado(a|s)?|personal)$/,
    nombres: /^(primer )?nombres?$/,
    apellidos: /apellido/,
    area: /\b(area|departamento|sector|gerencia|unidad|seccion)\b/,
    // "número" solo no alcanza: "N° de documento" no es un teléfono
    telefono: /(celular|telefono|movil|whatsapp|\bcel\b|\btel\b)/,
    ingreso: /(ingreso|alta|inicio)/,
    // si no hay ninguna "de ingreso", sirve una fecha cualquiera... salvo estas
    otraFecha: /(nac|cese|salida|baja|fin|venc)/,
  };

  function mapear(encabezado) {
    const m = { apellidos: [] };
    const t = encabezado.map(sinTildes);
    t.forEach((h, i) => {
      if (!h) return;
      if (ROLES.completo.test(h) && m.completo == null) m.completo = i;
      else if (ROLES.apellidos.test(h) && !/nombre/.test(h)) m.apellidos.push(i);
      else if (ROLES.nombres.test(h) && m.nombres == null) m.nombres = i;
      else if (ROLES.area.test(h) && m.area == null) m.area = i;
      else if (ROLES.telefono.test(h) && m.telefono == null) m.telefono = i;
      else if (ROLES.ingreso.test(h) && !ROLES.otraFecha.test(h) && m.ingreso == null) m.ingreso = i;
      else if (/nombre/.test(h) && m.completo == null && m.nombres == null) m.completo = i;
    });
    if (m.ingreso == null) {
      const i = t.findIndex((h) => /fecha/.test(h) && !ROLES.otraFecha.test(h));
      if (i >= 0) m.ingreso = i;
    }
    return m;
  }

  // Las planillas exportadas suelen venir en mayúsculas: "QUISPE MAMANI, ROSA"
  const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  function presentable(s) {
    s = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (s && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s)) {
      s = s.toLowerCase().split(' ').map((w, i) =>
        i > 0 && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return s;
  }
  // "Quispe Mamani, Rosa" → "Rosa Quispe Mamani": el saludo usa la primera palabra
  const nombreNatural = (s) => {
    const [antes, despues] = s.split(',').map((x) => x.trim());
    return despues ? `${despues} ${antes}` : s;
  };

  function fecha(v) {
    if (v === '' || v == null) return null;
    if (typeof v === 'number' && v > 20000 && v < 60000) {
      // número de serie de Excel: días desde el 30/12/1899
      return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400e3).toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // día primero, como en Perú
    if (m) {
      const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
      if (Number(m[2]) <= 12) return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return null;
  }

  async function leerColaboradores(file) {
    const nombre = file.name.toLowerCase();
    if (nombre.endsWith('.xls')) {
      throw new Error('Ese es el formato viejo de Excel. Ábrelo y guárdalo como .xlsx (o .csv), y vuelve a subirlo.');
    }
    const buffer = await file.arrayBuffer();
    const crudas = nombre.endsWith('.xlsx') ? await leerXlsx(buffer) : leerCsv(decodificar(buffer));
    const conDatos = crudas.filter((f) => f.celdas.some((c) => String(c).trim() !== ''));

    // el encabezado es la primera fila (de las 10 primeras) que nombra al nombre
    const iEnc = conDatos.slice(0, 10).findIndex((f) => f.celdas.some((c) => /nombre|apellido|colaborador|trabajador/.test(sinTildes(c))));
    const mapa = iEnc >= 0
      ? mapear(conDatos[iEnc].celdas)
      : { completo: 0, area: 1, telefono: 2, ingreso: 3, apellidos: [] }; // sin encabezado: el orden de siempre
    const cuerpo = iEnc >= 0 ? conDatos.slice(iEnc + 1) : conDatos;

    const filas = [];
    const problemas = [];
    for (const { nro, celdas } of cuerpo) {
      const de = (i) => (i == null ? '' : celdas[i] ?? '');
      // primero se reordena y después se capitaliza: así "DE LA CRUZ, MARÍA"
      // queda "María de la Cruz" y no "María De la Cruz"
      let completo = presentable(nombreNatural(String(de(mapa.completo)).trim()));
      if (!completo && (mapa.nombres != null || mapa.apellidos.length)) {
        completo = presentable([de(mapa.nombres), ...mapa.apellidos.map(de)].filter(Boolean).join(' '));
      }
      const area = presentable(de(mapa.area));
      if (!completo || !area) {
        problemas.push(`Fila ${nro}: falta ${!completo ? 'el nombre' : 'el área'}.`);
        continue;
      }
      const tel = de(mapa.telefono);
      filas.push({
        fila: nro,
        nombre: completo,
        area,
        telefono: typeof tel === 'number' ? String(Math.round(tel)) : String(tel).trim(),
        ingreso: fecha(de(mapa.ingreso)),
      });
    }
    return { filas, problemas, columnas: mapa, conEncabezado: iEnc >= 0 };
  }

  return { leerColaboradores };
})();
