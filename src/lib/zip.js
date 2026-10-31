// ZIP mínimo (sin dependencias): crear y leer .zip con compresión máxima. Solo Node.
const zlib = require('zlib');

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entradas: [{ name, data: Buffer }] -> Buffer del .zip (deflate nivel 9, nombres UTF-8). */
function crearZip(entradas) {
  const locales = [];
  const centrales = [];
  let offset = 0;
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entradas) {
    const nombre = Buffer.from(e.name, 'utf8');
    const crudo = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const comp = zlib.deflateRawSync(crudo, { level: 9 });
    const usaDeflate = comp.length < crudo.length;
    const datos = usaDeflate ? comp : crudo;
    const metodo = usaDeflate ? 8 : 0;
    const crc = crc32(crudo);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x0800, 6); // nombres UTF-8
    loc.writeUInt16LE(metodo, 8);
    loc.writeUInt16LE(hora, 10);
    loc.writeUInt16LE(fecha, 12);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(datos.length, 18);
    loc.writeUInt32LE(crudo.length, 22);
    loc.writeUInt16LE(nombre.length, 26);
    loc.writeUInt16LE(0, 28);
    locales.push(loc, nombre, datos);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(metodo, 10);
    cen.writeUInt16LE(hora, 12);
    cen.writeUInt16LE(fecha, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(datos.length, 20);
    cen.writeUInt32LE(crudo.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrales.push(cen, nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const cdBuf = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cdBuf.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cdBuf, fin]);
}

/** Lee un .zip. Devuelve [{ name, isDir, data() -> Buffer }]. Lanza error si no es un zip válido. */
function leerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un archivo .zip válido');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const salida = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamReal = buf.readUInt32LE(p + 24);
    const lNombre = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lComent = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + lNombre);
    p += 46 + lNombre + lExtra + lComent;
    const isDir = name.endsWith('/');
    salida.push({
      name, isDir,
      data() {
        if (isDir) return Buffer.alloc(0);
        const ln = buf.readUInt16LE(offLocal + 26);
        const le = buf.readUInt16LE(offLocal + 28);
        const ini = offLocal + 30 + ln + le;
        const crudo = buf.subarray(ini, ini + tamComp);
        if (metodo === 0) return Buffer.from(crudo);
        if (metodo === 8) {
          const r = zlib.inflateRawSync(crudo);
          if (r.length !== tamReal) throw new Error('Zip dañado (tamaño)');
          return r;
        }
        throw new Error('Compresión no compatible en el zip');
      }
    });
  }
  return salida;
}

module.exports = { crearZip, leerZip, crc32 };
