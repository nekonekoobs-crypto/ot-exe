// OCR de las fotos (tesseract.js en el proceso principal; idioma español, datos locales). Devuelve líneas para OcrParser.
const path = require('path');
const fs = require('fs');

let trabajador = null;

function carpetaDatos() {
  const c = [path.join(process.resourcesPath || '', 'tessdata'), path.join(__dirname, '..', 'assets', 'tessdata')];
  return c.find((d) => fs.existsSync(path.join(d, 'spa.traineddata'))) || c[0];
}

async function obtener() {
  if (trabajador) return trabajador;
  const { createWorker } = require('tesseract.js');
  const opc = { langPath: carpetaDatos(), gzip: false, cacheMethod: 'none' };
  // Dentro del instalador los workers no pueden leerse del paquete .asar: se usan los archivos desempaquetados
  try { opc.workerPath = path.join(path.dirname(require.resolve('tesseract.js/package.json')), 'src', 'worker-script', 'node', 'index.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); } catch (e) { /* se usa el valor por omisión */ }
  trabajador = await createWorker('spa', 1, opc);
  return trabajador;
}

/** Convierte lo que devuelve tesseract.js en las líneas que espera OcrParser. */
function aLineas(data) {
  const lineas = Array.isArray(data.lines) ? data.lines : [];
  const out = [];
  for (const l of lineas) {
    const texto = String(l.text || '').replace(/\s+/g, ' ').trim();
    if (!texto || !l.bbox) continue;
    let slope = null;
    const b = l.baseline;
    if (b && b.has_baseline !== false && typeof b.x1 === 'number' && b.x1 - b.x0 > 20) slope = (b.y1 - b.y0) / (b.x1 - b.x0);
    out.push({
      text: texto, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, slope,
      words: (l.words || []).filter((w) => w.bbox && String(w.text).trim()).map((w) => ({ text: String(w.text).trim(), x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }))
    });
  }
  return out;
}

async function leer(buf) {
  const w = await obtener();
  const r = await w.recognize(Buffer.from(buf), {}, { blocks: true });
  return aLineas(r.data);
}

async function cerrar() { if (trabajador) { try { await trabajador.terminate(); } catch (e) { /* ya cerrado */ } trabajador = null; } }

module.exports = { leer, cerrar, aLineas };
