// Almacenamiento local en disco (port de Store de Models.kt): ordenes/<id>.json y fotos_baja/<nombre>. Solo Node.
const fs = require('fs');
const path = require('path');
const M = require('./models');

class Store {
  constructor(base) {
    this.base = base;
    this.dirOrdenes = path.join(base, 'ordenes');
    this.dirFotos = path.join(base, 'fotos_baja');
    fs.mkdirSync(this.dirOrdenes, { recursive: true });
    fs.mkdirSync(this.dirFotos, { recursive: true });
  }
  guardar(o) {
    const f = path.join(this.dirOrdenes, `${o.id}.json`);
    fs.writeFileSync(f + '.tmp', JSON.stringify(M.toJson(o)));
    fs.renameSync(f + '.tmp', f);
  }
  cargar(id) {
    try { return M.fromJson(JSON.parse(fs.readFileSync(path.join(this.dirOrdenes, `${id}.json`), 'utf8'))); } catch (e) { return null; }
  }
  todas() {
    const out = [];
    for (const n of fs.readdirSync(this.dirOrdenes)) {
      if (!/^[0-9]+\.json$/.test(n)) continue;
      try { out.push(M.fromJson(JSON.parse(fs.readFileSync(path.join(this.dirOrdenes, n), 'utf8')))); } catch (e) { /* archivo dañado: se ignora */ }
    }
    return out.sort((a, b) => b.id - a.id);
  }
  borrar(id) { try { fs.unlinkSync(path.join(this.dirOrdenes, `${id}.json`)); } catch (e) { /* ya no existe */ } }
  /** Nombre de archivo seguro (sin rutas). */
  static nombreSeguro(n) { return /^[A-Za-z0-9_.\-]+$/.test(n) && n !== '.' && n !== '..'; }
  rutaFoto(nombre) { if (!Store.nombreSeguro(nombre)) throw new Error('Nombre de foto no válido'); return path.join(this.dirFotos, nombre); }
  guardarFoto(nombre, datos) { fs.writeFileSync(this.rutaFoto(nombre), datos); }
  leerFoto(nombre) { try { return fs.readFileSync(this.rutaFoto(nombre)); } catch (e) { return null; } }
  existeFoto(nombre) { try { return fs.existsSync(this.rutaFoto(nombre)); } catch (e) { return false; } }
  borrarFoto(nombre) { try { fs.unlinkSync(this.rutaFoto(nombre)); } catch (e) { /* ya no existe */ } }
}

module.exports = { Store };
