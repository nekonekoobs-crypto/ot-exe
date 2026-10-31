// Ajustes y estado de sincronización guardados en un archivo JSON (reemplaza SharedPreferences). Solo Node.
const fs = require('fs');
const path = require('path');

class Prefs {
  constructor(archivo) {
    this.archivo = archivo;
    this.d = {};
    try { this.d = JSON.parse(fs.readFileSync(archivo, 'utf8')) || {}; } catch (e) { this.d = {}; }
  }
  get(k, def) { return Object.prototype.hasOwnProperty.call(this.d, k) ? this.d[k] : def; }
  set(k, v) { this.d[k] = v; this._guardar(); }
  borrar(k) { delete this.d[k]; this._guardar(); }
  _guardar() {
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      fs.writeFileSync(this.archivo + '.tmp', JSON.stringify(this.d));
      fs.renameSync(this.archivo + '.tmp', this.archivo);
    } catch (e) { /* si no se puede guardar, se sigue en memoria */ }
  }
}
module.exports = { Prefs };
