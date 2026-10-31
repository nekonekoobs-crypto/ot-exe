// Copias de seguridad (port de Respaldo.kt): mismo .zip que la app de Android, intercambiable en ambos sentidos.
const fs = require('fs');
const path = require('path');
const { crearZip, leerZip } = require('./zip');
const M = require('./models');
const { Store } = require('./store');

const DIAS = 15;
const PREFIJO = 'OT_TRACSA_respaldo_';
const CONSERVAR = 6;
const RX_ORDEN = /^ordenes\/[0-9]+\.json$/;
const RX_FOTO = /^fotos_baja\/[A-Za-z0-9_.\-]+$/;

const p2 = (n) => String(n).padStart(2, '0');
function marca(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`; }

/** ¿Ya pasaron 15 días desde la última copia (y hay algo que respaldar)? */
function toca(store, ultimoMs, ahora) {
  if (!store.todas().length) return false;
  return (ahora || Date.now()) - (ultimoMs || 0) >= DIAS * 24 * 3600 * 1000;
}

/** Arma el zip en memoria con todas las OT y fotos. */
function armarZip(store, ahora) {
  const ents = [];
  let nO = 0, nF = 0;
  for (const n of fs.readdirSync(store.dirOrdenes)) {
    if (!/^[0-9]+\.json$/.test(n)) continue;
    ents.push({ name: 'ordenes/' + n, data: fs.readFileSync(path.join(store.dirOrdenes, n)) }); nO++;
  }
  for (const n of fs.readdirSync(store.dirFotos)) {
    if (!Store.nombreSeguro(n)) continue;
    ents.push({ name: 'fotos_baja/' + n, data: fs.readFileSync(path.join(store.dirFotos, n)) }); nF++;
  }
  if (!nO) throw new Error('No hay órdenes para respaldar.');
  const d = ahora ? new Date(ahora) : new Date();
  ents.push({ name: 'manifiesto.json', data: Buffer.from(JSON.stringify({ app: 'OT TRACSA', fecha: `${marca(d).slice(0, 10)} ${p2(d.getHours())}:${p2(d.getMinutes())}`, ordenes: nO, fotos: nF })) });
  return crearZip(ents);
}

/** Crea la copia en la carpeta destino y deja solo las últimas 6. Devuelve la ruta. */
function crear(store, carpeta, ahora) {
  fs.mkdirSync(carpeta, { recursive: true });
  const nombre = PREFIJO + marca(ahora ? new Date(ahora) : new Date()) + '.zip';
  const destino = path.join(carpeta, nombre);
  fs.writeFileSync(destino, armarZip(store, ahora));
  const viejas = fs.readdirSync(carpeta).filter((n) => n.startsWith(PREFIJO) && n.endsWith('.zip')).sort().reverse();
  for (const v of viejas.slice(CONSERVAR)) { try { fs.unlinkSync(path.join(carpeta, v)); } catch (e) { /* no pasa nada */ } }
  return destino;
}

/** Revisa el .zip sin guardar nada. Lanza error si no es una copia válida. */
function inspeccionar(buf) {
  let o = 0, f = 0;
  for (const e of leerZip(buf)) {
    if (e.isDir) continue;
    if (RX_ORDEN.test(e.name)) o++;
    else if (RX_FOTO.test(e.name) && Store.nombreSeguro(e.name.slice('fotos_baja/'.length))) f++;
  }
  if (!o) throw new Error('El archivo no es una copia de seguridad de OT');
  return { ordenes: o, fotos: f };
}

/** Restaura las OT y fotos tal cual estaban. Devuelve { ordenes: [Orden], fotos } para que quien llame las marque como pendientes. */
function restaurar(store, buf) {
  const ordenes = [];
  let fotos = 0;
  for (const e of leerZip(buf)) {
    if (e.isDir) continue;
    if (RX_ORDEN.test(e.name)) ordenes.push(M.fromJson(JSON.parse(e.data().toString('utf8'))));
    else if (RX_FOTO.test(e.name)) {
      const n = e.name.slice('fotos_baja/'.length);
      if (!Store.nombreSeguro(n)) continue;
      store.guardarFoto(n, e.data()); fotos++;
    }
  }
  for (const o of ordenes) store.guardar(o);
  return { ordenes, fotos };
}

module.exports = { toca, crear, armarZip, inspeccionar, restaurar, DIAS, PREFIJO };
