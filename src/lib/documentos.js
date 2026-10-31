// Captura de una OT desde Excel (.xlsx) y Word (.docx) sin OCR (port de Documentos.kt). El PDF se lee en la ventana con OCR. Solo Node.
const { leerZip } = require('./zip');
const M = require('./models');
const F = require('./fechas');

const FECHA_DOC = /\d{1,2}\s*[/\-.]\s*(?:\d{1,2}|[A-ZÁÉÍÓÚ]{3,10})\s*[/\-.]\s*\d{2,4}/u;
const MARCA_DOC = /\b(KENWORTH|FREIGHTLINER|VOLVO|INTERNATIONAL|PETERBILT|MACK|SCANIA|MERCEDES|HINO|ISUZU|FORD|CHEVROLET|DODGE|NISSAN|TOYOTA|FOTON|JAC|IVECO|DINA|MAN|KW)\b/u;
const ETIQUETA_DOC = /^(SEGURO|ELABORACI|ENTREGA|MODELO|VIN\b|TRAZO|UNIDAD|TALLER|JEFE|OT\b)/u;
const esLet = (c) => /\p{L}/u.test(c);
const esDig = (c) => /\d/.test(c);

// ---------- Mini lector XML: eventos { t:'ini'|'fin'|'txt', n, a } ----------
function decodificar(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch (x) { return m; }
  });
}
function* xml(texto) {
  const rx = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = rx.exec(texto))) {
    if (m[1] !== undefined) { yield { t: 'txt', s: m[1] }; continue; }
    if (m[6] !== undefined) { yield { t: 'txt', s: decodificar(m[6]) }; continue; }
    if (m[3] === undefined) continue;
    const n = m[3].slice(m[3].indexOf(':') + 1);
    if (m[2]) { yield { t: 'fin', n }; continue; }
    const a = {}; const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let x;
    while ((x = ar.exec(m[4] || ''))) a[x[1].slice(x[1].indexOf(':') + 1)] = decodificar(x[2] !== undefined ? x[2] : x[3]);
    yield { t: 'ini', n, a };
    if (m[5]) yield { t: 'fin', n };
  }
}

// ---------- Excel ----------
function cadenasCompartidas(texto) {
  const lista = []; let actual = null; let enT = false;
  for (const e of xml(texto)) {
    if (e.t === 'ini') { if (e.n === 'si') actual = ''; else if (e.n === 't') enT = true; }
    else if (e.t === 'txt') { if (enT && actual !== null) actual += e.s; }
    else if (e.t === 'fin') { if (e.n === 't') enT = false; else if (e.n === 'si') { lista.push(actual || ''); actual = null; } }
  }
  return lista;
}
function columnaDe(ref) { let n = 0; for (const ch of ref) { if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64); else break; } return Math.max(n - 1, 0); }
const numeroLimpio = (s) => { const t = s.trim(); return /^-?\d+\.0+$/.test(t) ? t.split('.')[0] : t; };

function celdasHoja(texto, comp) {
  const filas = new Map(); let fila = 0, col = 0, tipo = '', valor = '', enV = false, enT = false, enCelda = false;
  for (const e of xml(texto)) {
    if (e.t === 'ini') {
      if (e.n === 'row') fila = parseInt(e.a.r, 10) || fila + 1;
      else if (e.n === 'c') { enCelda = true; col = columnaDe(e.a.r || ''); tipo = e.a.t || ''; valor = ''; }
      else if (e.n === 'v') enV = true; else if (e.n === 't' && enCelda) enT = true;
    } else if (e.t === 'txt') { if (enV || enT) valor += e.s; }
    else if (e.n === 'v') enV = false; else if (e.n === 't') enT = false;
    else if (e.n === 'c') {
      enCelda = false; let t = valor;
      if (tipo === 's') { const i = parseInt(t.trim(), 10); t = Number.isInteger(i) && comp[i] !== undefined ? comp[i] : ''; }
      else if (tipo === 'e') t = '';
      else if (tipo === 'n' || tipo === '') t = numeroLimpio(t);
      if (t.trim()) { if (!filas.has(fila)) filas.set(fila, new Map()); filas.get(fila).set(col, t); }
    }
  }
  return Array.from(filas.keys()).sort((a, b) => a - b).map((k) => { const m = filas.get(k); const ancho = Math.max(...m.keys()) + 1; return Array.from({ length: ancho }, (_, c) => m.get(c) || ''); });
}

function filasXlsx(buf) {
  const ents = leerZip(buf); const hojaRx = /^xl\/worksheets\/sheet\d+\.xml$/;
  const hojas = ents.filter((e) => hojaRx.test(e.name)).sort((a, b) => (parseInt(a.name.replace(/\D+/, ''), 10) || 9999) - (parseInt(b.name.replace(/\D+/, ''), 10) || 9999));
  if (!hojas.length) throw new Error('El Excel no tiene hojas');
  const ss = ents.find((e) => e.name === 'xl/sharedStrings.xml');
  return celdasHoja(hojas[0].data().toString('utf8'), ss ? cadenasCompartidas(ss.data().toString('utf8')) : []);
}

// ---------- Word ----------
function filasDocx(buf) {
  const d = leerZip(buf).find((e) => e.name === 'word/document.xml');
  if (!d) throw new Error('El Word no tiene contenido');
  const filas = []; let prof = 0, fila = null, celda = null, parrafo = '', span = 1, enT = false;
  for (const e of xml(d.data().toString('utf8'))) {
    if (e.t === 'ini') {
      if (e.n === 'tbl') prof++;
      else if (e.n === 'tr') { if (prof === 1) fila = []; }
      else if (e.n === 'tc') { if (prof === 1) { celda = ''; span = 1; } }
      else if (e.n === 'gridSpan') { if (prof === 1) span = parseInt(e.a.val, 10) || 1; }
      else if (e.n === 'p') parrafo = '';
      else if (e.n === 't') enT = true;
      else if (e.n === 'tab') parrafo += ' ';
      else if (e.n === 'br') parrafo += '\n';
    } else if (e.t === 'txt') { if (enT) parrafo += e.s; }
    else if (e.n === 't') enT = false;
    else if (e.n === 'p') { if (prof === 0) { if (parrafo.trim()) filas.push([parrafo.trim()]); } else if (celda !== null) celda += parrafo + '\n'; parrafo = ''; }
    else if (e.n === 'tc') { if (prof === 1) { fila.push((celda || '').trim()); for (let i = 1; i < span; i++) fila.push(''); celda = null; } }
    else if (e.n === 'tr') { if (prof === 1 && fila) { filas.push(fila); fila = null; } }
    else if (e.n === 'tbl') prof--;
  }
  return filas;
}

// ---------- Interpretación de la tabla ----------
const limpiar = (s) => String(s).replace(/\s+/g, ' ').trim();
const esEtiquetaDoc = (s) => ETIQUETA_DOC.test(s.toUpperCase().trim());

function valorDe(items, etiqueta, valor) {
  const completa = new RegExp('^(?:' + valor.source + ')$', 'u');
  const busca = new RegExp(valor.source, 'u');
  for (let i = 0; i < items.length; i++) {
    const u = items[i].toUpperCase(); const m = etiqueta.exec(u); if (!m) continue;
    const resto = u.substring(m.index + m[0].length);
    const v = busca.exec(resto); if (v) return v[0].trim();
    const sig = items[i + 1]; if (sig === undefined) continue;
    if (esEtiquetaDoc(sig)) continue;
    const mm = completa.exec(sig.toUpperCase().trim()); if (mm) return mm[0].trim();
  }
  return '';
}

function serialAFecha(s) {
  const n = parseFloat(s); if (isNaN(n)) return '';
  const f = new Date(Date.UTC(1899, 11, 30) + Math.trunc(n) * 86400000);
  const p = (x, l) => String(x).padStart(l, '0');
  return `${p(f.getUTCDate(), 2)}/${p(f.getUTCMonth() + 1, 2)}/${p(f.getUTCFullYear(), 4)}`;
}
function fechaDe(cab, etiqueta) {
  const f = valorDe(cab, etiqueta, FECHA_DOC); if (f) return F.normalizarFecha(f);
  return serialAFecha(valorDe(cab, etiqueta, /\d{5}(?:\.\d+)?/u));
}

function desdeFilas(filas) {
  const hdr = filas.findIndex((f) => f.some((c) => { const u = c.toUpperCase(); return u.includes('CONCEPTO') || u.includes('DESCRIPCI'); }));
  if (hdr < 0) throw new Error('No se encontró la tabla de piezas (columna CONCEPTO).');
  const cab = filas.slice(0, hdr).flatMap((f) => f.flatMap((c) => c.split('\n'))).map(limpiar).filter((x) => x);
  const seguro = valorDe(cab, /SEGURO/u, /[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 .&-]*/u);
  const elaboracion = fechaDe(cab, /ELABORACI.N/u); const entrega = fechaDe(cab, /ENTREGA/u);
  const ot = valorDe(cab, /(?<![A-Z])OT(?![A-Z])/u, /\d{3,7}/u);
  const modelo = valorDe(cab, /MODELO/u, /(?:19|20)\d{2}/u);
  let vin = '';
  for (const s of cab) {
    const t = s.toUpperCase().replace(/ /g, ''); const m = /[A-HJ-NPR-Z0-9]{17}/u.exec(t); if (!m) continue;
    if ([...m[0]].filter(esDig).length >= 3 && [...m[0]].filter(esLet).length >= 3) { vin = m[0]; break; }
  }
  let unidad = valorDe(cab, /UNIDAD\W*/u, /.+/u);
  if (!unidad) unidad = cab.find((s) => { const u = s.toUpperCase(); return MARCA_DOC.test(u) && !FECHA_DOC.test(u) && !esEtiquetaDoc(u) && u.length <= 40; }) || '';
  let taller = valorDe(cab, /^TALLER\W*/u, /.+/u);
  if (!taller) { const c = cab.filter((s) => { const u = s.toUpperCase().trim(); return u.length >= 4 && [...u].every(esLet) && !esEtiquetaDoc(u) && u !== seguro && !MARCA_DOC.test(u); }); taller = c.length ? c[c.length - 1] : ''; }
  const jefe = valorDe(cab, /JEFE\s+DE\s+TALLER\W*/u, /[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]*/u);

  const titulos = filas[hdr]; const cuerpo = filas.slice(hdr + 1);
  const col = (rx) => titulos.findIndex((t) => rx.test(t.toUpperCase()));
  const cConcepto = col(/CONCEPTO|DESCRIPCI/u); let cPz = col(/^\s*(PZS?|CANT\w*)\W*$/u); const cProv = col(/PROVEED/u);
  if (cPz < 0 && cConcepto > 0) cPz = cConcepto - 1;
  const numRx = /^\d{1,3}\s*[.,]?$/u;
  const cuantos = (c) => cuerpo.filter((f) => { const v = f[c]; return v !== undefined && numRx.test(v.trim()); }).length;
  const cNum = cPz > 0 && cuantos(cPz - 1) >= 2 ? cPz - 1 : -1;

  const base = Date.now(); const items = [];
  for (const f of cuerpo) {
    const concepto = limpiar(f[cConcepto] || '');
    if (!concepto || ![...concepto].some(esLet)) continue;
    const pzTxt = limpiar(f[cPz] || '');
    const numLeido = cNum >= 0 ? parseInt((/\d{1,3}/.exec(f[cNum] || '') || [])[0], 10) || 0 : 0;
    if (!pzTxt && numLeido === 0) continue;
    const mpz = /\d+(?:[.,]\d+)?/.exec(pzTxt); let pz = mpz ? mpz[0].replace(',', '.') : '1'; if (pz.endsWith('.0')) pz = pz.slice(0, -2);
    const prov = cProv >= 0 ? limpiar(f[cProv] || '') : '';
    items.push(M.nuevoItem({ id: base + items.length, pz, concepto, proveedor: prov, num: numLeido > 0 ? numLeido : items.length + 1 }));
  }
  if (!items.length) throw new Error('No se encontraron piezas en el archivo.');
  return M.nuevaOrden({ id: base, seguro, elaboracion, entrega, ot, unidad, vin, modelo, taller, jefeTaller: jefe, items });
}

/** Lee un .xlsx o .docx (Buffer) y devuelve la OT. Los .xls / .doc antiguos se rechazan con un mensaje claro. */
function leerArchivo(nombre, buf) {
  const n = String(nombre).toLowerCase();
  if (n.endsWith('.xlsx')) return desdeFilas(filasXlsx(buf));
  if (n.endsWith('.docx')) return desdeFilas(filasDocx(buf));
  if (n.endsWith('.xls') || n.endsWith('.doc')) throw new Error('Formato antiguo (.xls / .doc). Guárdalo como .xlsx o .docx e inténtalo otra vez.');
  throw new Error('Tipo de archivo no compatible. Usa Excel (.xlsx), Word (.docx) o PDF.');
}

module.exports = { leerArchivo, filasXlsx, filasDocx, desdeFilas };
